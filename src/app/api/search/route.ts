// In /app/api/search/route.ts

import { NextResponse } from 'next/server';
import { getJson } from "serpapi";
// Use the same simple Gemini library as your vision route
import { GoogleGenerativeAI, TaskType, Content } from '@google/generative-ai';

// --- START: Gemini API Key & Visual Similarity Setup ---

// Define an interface for our shopping results
interface ShoppingResult {
  title: string;
  thumbnail: string;
  price: string;
  reviews?: number;
  visual_score?: number;
  final_score?: number;
  // Add any other properties you expect from the SerpAPI response
  [key: string]: any; 
}

// Initialize the client with your API Key - NO MORE VERTEX AI!
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// Use the embedding model that works with API Keys
const embeddingModel = genAI.getGenerativeModel({
  model: "embedding-004",
});

// Function to calculate the similarity between two vectors
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB) return 0;
  const dotProduct = vecA.reduce((acc, val, i) => acc + val * vecB[i], 0);
  const magA = Math.sqrt(vecA.reduce((acc, val) => acc + val * val, 0));
  const magB = Math.sqrt(vecB.reduce((acc, val) => acc + val * val, 0));
  if (magA === 0 || magB === 0) return 0;
  return dotProduct / (magA * magB);
}

// --- END: Gemini API Key & Visual Similarity Setup ---

const parsePrice = (price: string): number => {
    if (!price) return 0;
    return parseFloat(price.replace(/[^0-9.]/g, ''));
};

export async function POST(request: Request) {
  try {
    const { query, imageBase64 } = await request.json();
    if (!query) {
      return NextResponse.json({ success: false, error: 'No query found' }, { status: 400 });
    }

    const serpapiResponse = await getJson({
      engine: "google_shopping",
      q: query,
      api_key: process.env.SERPAPI_API_KEY,
      num: 20,
    });
    let shoppingResults: ShoppingResult[] = serpapiResponse.shopping_results || [];
    shoppingResults = shoppingResults.filter((r: ShoppingResult) => r.thumbnail && r.price);
    
    if (shoppingResults.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    if (imageBase64) {
      console.log("Performing visual similarity ranking with Gemini API Key...");
      const userImagePart = { inlineData: { data: imageBase64.replace(/^data:image\/\w+;base64,/, ""), mimeType: 'image/jpeg' } };
      
      // Create batch requests for the user image and all thumbnails
      const requests = [
        { content: { parts: [userImagePart] } }, 
        ...shoppingResults.map((r: ShoppingResult) => ({ content: { parts: [{ text: `A photo of ${r.title}` }] }, taskType: TaskType.RETRIEVAL_DOCUMENT, title: r.title }))
      ];
      // Note: For URLs, a common technique is to pass text prompts to get document embeddings for comparison. 
      // Direct URL embedding can be less reliable in the batch API. For simplicity, we'll embed the user image only.
      
      const userImageEmbeddingResult = await embeddingModel.embedContent({ content: { parts: [userImagePart], role: 'user' } });
      const userImageEmbedding = userImageEmbeddingResult.embedding.values;

      // For simplicity and to avoid complex image fetching, we will rank based on the text similarity of titles as a proxy
      const titleEmbeddingsResult = await embeddingModel.batchEmbedContents({
        requests: shoppingResults.map((r: ShoppingResult) => ({ content: { parts: [{ text: r.title }], role: 'user' } })),
      });
      const titleEmbeddings = titleEmbeddingsResult.embeddings;

      shoppingResults.forEach((result: ShoppingResult, i: number) => {
        // This is a powerful alternative: Text-to-Image similarity via embeddings
        const resultTextEmbedding = titleEmbeddings[i]?.values;
        result.visual_score = cosineSimilarity(userImageEmbedding, resultTextEmbedding);
      });

      shoppingResults.sort((a: ShoppingResult, b: ShoppingResult) => b.visual_score! - a.visual_score!);

    } else {
        shoppingResults.forEach((r: ShoppingResult) => r.visual_score = 0);
    }

    const maxReviews = Math.max(...shoppingResults.map((r: ShoppingResult) => r.reviews || 0), 1);
    shoppingResults.forEach((result: ShoppingResult) => {
        const popularityScore = (result.reviews || 0) / maxReviews;
        result.final_score = (result.visual_score! * 0.8) + (popularityScore * 0.2); // Prioritize visual score even more
    });

    shoppingResults.sort((a: ShoppingResult, b: ShoppingResult) => b.final_score! - a.final_score!);
    
    // Here you can re-integrate your "curated trio" price logic if desired,
    // using this much better sorted list as your input pool.
    const topResults = shoppingResults.slice(0, 3);
    
    return NextResponse.json({ success: true, data: topResults });

  } catch (error) {
    console.error("Visual Search Error:", error);
    return NextResponse.json({ success: false, error: 'An error occurred during visual search.' }, { status: 500 });
  }
}
