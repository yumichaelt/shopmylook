// In /app/api/search/route.ts

import { NextResponse } from 'next/server';
import { getJson } from "serpapi";
import { GoogleGenerativeAI } from '@google/generative-ai';
import sharp from 'sharp';

// --- START: Definitive Model Setup ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// We will use ONE powerful, multimodal model for everything.
// Based on your list, this is a great choice that is not rate-limited for you.
const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
// --- END: Definitive Model Setup ---

// (Helper functions like parsePrice, brand lists, etc. remain the same)
const parsePrice = (price: string): number => {
    if (!price) return 0;
    return parseFloat(price.replace(/[^0-9.]/g, ''));
};
const MID_RANGE_BRANDS = [
  'nike', 'adidas', 'j.crew', 'banana republic', 'madewell', 'levi\'s',
  'everlane', 'reformation', 'calvin klein', 'tommy hilfiger', 'polo ralph lauren',
  'under armour', 'lululemon', 'patagonia', 'the north face', 'zara'
];
const PREMIUM_BRANDS = [
  'gucci', 'prada', 'saint laurent', 'balenciaga', 'burberry', 'moncler',
  'loewe', 'fendi', 'versace', 'givenchy', 'alexander mcqueen', 'acne studios',
  'ami paris', 'canada goose', 'stone island'
];
const containsKnownBrand = (title: string, brandList: string[]): boolean => {
  if (!title) return false;
  const lowerCaseTitle = title.toLowerCase();
  return brandList.some(brand => lowerCaseTitle.includes(brand));
};

interface ShoppingResult {
  title: string;
  thumbnail: string;
  price: string;
  reviews?: number;
  visual_score: number;
  final_score: number;
  position: number;
  link: string;
  source: string;
}
// ---

export async function POST(request: Request) {
  try {
    const { query, imageBase64 } = await request.json();
    if (!query) return NextResponse.json({ success: false, error: 'No query found' });

    const serpapiResponse = await getJson({
      engine: "google_shopping",
      q: query,
      api_key: process.env.SERPAPI_API_KEY,
      num: 20, // We can use a smaller pool since the ranking will be better
    });
    
    let highQualityResults: ShoppingResult[] = serpapiResponse.shopping_results?.filter(
      (r: any) => r.price && r.thumbnail
    ) || [];

    if (highQualityResults.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    // --- Visual Ranking Layer (AI-as-Judge Method) ---
    if (imageBase64) {
      console.log("Performing visual similarity ranking with AI-as-Judge...");
      const imageBuffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ""), 'base64');
      const compressedImageBuffer = await sharp(imageBuffer).resize(256, 256, { fit: 'inside' }).jpeg({ quality: 60 }).toBuffer();
      const compressedBase64 = compressedImageBuffer.toString('base64');
      const userImagePart = { inlineData: { data: compressedBase64, mimeType: 'image/jpeg' } };

      // 1. Create an array of promises for parallel execution
      const scorePromises = highQualityResults.map((product: any) => {
        const productText = `${product.title}. ${product.snippet || ''} ${product.product_highlights?.join('. ') || ''}`;
        const comparisonPrompt = `
          Here are two items. Item A is in the provided image. Item B is a product listing described as: "${productText}".
          On a scale of 1 to 10, how visually similar is Item B to Item A in terms of style, pattern, and color?
          Respond with ONLY a valid JSON object in the format: {"visual_score": [score]}
        `;
        // Return the promise from generateContent
        return model.generateContent({
          contents: [{ role: 'user', parts: [userImagePart, { text: comparisonPrompt }] }]
        });
      });

      // 2. Execute all promises in parallel
      const scoreResults = await Promise.all(scorePromises);

      // 3. Parse the scores from the AI's responses
      highQualityResults.forEach((result: any, i: number) => {
        try {
          const generationResult = scoreResults[i];
          const jsonText = generationResult.response.candidates?.[0].content.parts[0].text || '{"visual_score": 0}';
          const scoreObject = JSON.parse(jsonText.replace(/```json/g, '').replace(/```/g, '').trim());
          result.visual_score = scoreObject.visual_score || 0;
        } catch (e) {
          console.warn("Failed to parse AI score for item, defaulting to 0", result.title);
          result.visual_score = 0;
        }
      });
      
      // 4. Calculate final hybrid score
      const maxReviews = Math.max(...highQualityResults.map((r: any) => r.reviews || 0), 1);
      highQualityResults.forEach((result: any) => {
        const popularityScore = (result.reviews || 0) / maxReviews;
        result.final_score = (result.visual_score / 10 * 0.8) + (popularityScore * 0.2); // Normalize visual score from 1-10 scale
      });

      // 5. Sort by the final score
      highQualityResults.sort((a: any, b: any) => b.final_score - a.final_score);
    }
    
    // --- Curation Layer (This logic remains the same) ---
    const priceBrackets = {
      budget: { min: 0, max: 75 },
      midRange: { min: 75, max: 250, target: 162.5 },
      premium: { min: 250, max: Infinity },
    };

    const budgetItems = highQualityResults.filter((item: ShoppingResult) => parsePrice(item.price) < priceBrackets.budget.max);
    let midRangeItems = highQualityResults.filter((item: ShoppingResult) => parsePrice(item.price) >= priceBrackets.midRange.min && parsePrice(item.price) < priceBrackets.midRange.max);
    let premiumItems = highQualityResults.filter((item: ShoppingResult) => parsePrice(item.price) >= priceBrackets.premium.min);

    midRangeItems = midRangeItems.filter((item: ShoppingResult) => containsKnownBrand(item.title, MID_RANGE_BRANDS));
    premiumItems = premiumItems.filter((item: ShoppingResult) => containsKnownBrand(item.title, PREMIUM_BRANDS));

    let bestBudget = budgetItems[0];
    let bestMidRange = midRangeItems[0];
    let bestPremium = premiumItems[0];

    const usedPositions = new Set<number>();
    if (bestBudget) usedPositions.add(bestBudget.position);
    if (bestMidRange) usedPositions.add(bestMidRange.position);
    if (bestPremium) usedPositions.add(bestPremium.position);

    let leftoverPool = highQualityResults.filter((item: ShoppingResult) => !usedPositions.has(item.position));

    if (!bestPremium && leftoverPool.length > 0) {
        leftoverPool.sort((a: ShoppingResult, b: ShoppingResult) => parsePrice(b.price) - parsePrice(a.price));
        const fallbackPremium = leftoverPool.shift();
        if (fallbackPremium) {
            bestPremium = fallbackPremium;
            usedPositions.add(bestPremium.position);
        }
    }
    
    let finalResults: any[] = [];
    if (bestBudget) finalResults.push({ ...bestBudget, price_tier: 'Affordable' });
    if (bestMidRange) finalResults.push({ ...bestMidRange, price_tier: 'Mid-Range' });
    if (bestPremium) finalResults.push({ ...bestPremium, price_tier: 'Premium' });
    
    finalResults.sort((a: any, b: any) => parsePrice(a.price) - parsePrice(b.price));

    return NextResponse.json({ success: true, data: finalResults.slice(0, 3) });

  } catch (error) {
    console.error("Search Error:", error);
    return NextResponse.json({ success: false, error: 'An error occurred during search.' }, { status: 500 });
  }
}
