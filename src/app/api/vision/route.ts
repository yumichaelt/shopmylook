// In /app/api/vision/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize the Gemini client with your API Key
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const classificationPrompt = `
  Analyze the provided image and classify its type. Is it a 'Product Shot' (focused on a single item, often with a clean or simple background) or an 'Outfit Shot' (showing a person wearing multiple distinct items as a complete look)?
  Respond with ONLY a valid JSON object in the format: {"image_type": "TYPE"} where TYPE is either "Product Shot" or "Outfit Shot".
`;

const outfitPrompt = `
  You are a world-class fashion expert and stylist. Your task is to analyze the user-provided image of an outfit and break it down into a complete, structured list of all identifiable fashion items.
  The output MUST be a single, valid JSON object with one key: "outfit_items", which is an array of objects.
  For each object, provide these keys:
  1. "item_name": A short, clear name for the item (e.g., "Windbreaker Jacket").
  2. "description": A one-sentence, visually descriptive summary.
  3. "search_query": An optimized, concise search query for Google Shopping.
  4. "category": Categorize the item into ONE of the following: "Outerwear", "Tops", "Bottoms", "Footwear", "Bags", "Accessories".
  5. "significance_score": A numerical score from 1 to 10 indicating the item's importance to the overall look (10 is a 'hero' piece, 1 is a minor detail).
  Do not add text or explanation outside of the single JSON object response.
`;

const singleItemPrompt = `
  You are a fashion expert. Analyze this single product image and provide a highly detailed description and search query.
  The output MUST be a single, valid JSON object with one key: "outfit_items", which is an array containing a single object.
  For that object, provide these keys: "item_name", "description", "search_query", "category", and a "significance_score" of 10.
`;

// Helper function to call Gemini and parse the JSON response
async function callGemini(imagePart: any, prompt: string) {
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });
  const result = await model.generateContent([prompt, imagePart]);
  const response = result.response;
  const rawJsonText = response.text();
  return JSON.parse(rawJsonText.replace(/```json/g, '').replace(/```/g, '').trim());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const base64Image = body.image;
    if (!base64Image) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    const imagePart = {
      inlineData: {
        data: base64Image.replace(/^data:image\/\w+;base64,/, ""),
        mimeType: 'image/jpeg', // Adjust mimeType if you handle other formats
      },
    };

    // --- STAGE 1: CLASSIFY INTENT ---
    const classificationResult = await callGemini(imagePart, classificationPrompt);
    const imageType = classificationResult.image_type;

    let analysisResult;

    // --- STAGE 2: TAILORED ANALYSIS ---
    if (imageType === 'Product Shot') {
      console.log("Image classified as 'Product Shot'. Performing single-item analysis.");
      analysisResult = await callGemini(imagePart, singleItemPrompt);
    } else { // 'Outfit Shot'
      console.log("Image classified as 'Outfit Shot'. Performing full outfit analysis.");
      analysisResult = await callGemini(imagePart, outfitPrompt);
    }

    // Sort the results by significance score
    analysisResult.outfit_items.sort((a: any, b: any) => b.significance_score - a.significance_score);

    // Return the structured data to the frontend
    return NextResponse.json({
      image_type: imageType,
      analyzed_items: analysisResult.outfit_items,
    });

  } catch (error) {
    console.error("Error in Vision API:", error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Failed to analyze image', details: errorMessage }, { status: 500 });
  }
}
