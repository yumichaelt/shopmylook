// In /app/api/search/route.ts

import { NextResponse } from 'next/server';
import { getJson } from "serpapi";

const parsePrice = (price: string): number => {
    if (!price) return 0;
    return parseFloat(price.replace(/[^0-9.]/g, ''));
};

export async function POST(request: Request) {
  try {
    const { query } = await request.json();
    if (!query) {
      return NextResponse.json({ success: false, error: 'No query found' }, { status: 400 });
    }

    const response = await getJson({
      engine: "google_shopping",
      q: query,
      api_key: process.env.SERPAPI_API_KEY,
      num: 40, 
    });

    const shopping_results = response.shopping_results || [];
    
    const highQualityResults = shopping_results.filter(
      (result: any) => result.price && result.thumbnail && parsePrice(result.price) > 0
    );

    const priceBrackets = {
      budget: { min: 0, max: 75 },
      midRange: { min: 75, max: 250, target: 162.5 },
      premium: { min: 250, max: Infinity },
    };

    const budgetItems: any[] = [];
    const midRangeItems: any[] = [];
    const premiumItems: any[] = [];

    highQualityResults.forEach((item: any) => {
      const price = parsePrice(item.price);
      if (price < priceBrackets.budget.max) budgetItems.push(item);
      else if (price < priceBrackets.midRange.max) midRangeItems.push(item);
      else if (price >= priceBrackets.premium.min) premiumItems.push(item);
    });

    const sortFn = (a: any, b: any) => (b.reviews || 0) - (a.reviews || 0);
    budgetItems.sort(sortFn);
    midRangeItems.sort(sortFn);
    premiumItems.sort(sortFn);

    let bestBudget = budgetItems.shift();
    let bestMidRange = midRangeItems.shift();
    let bestPremium = premiumItems.shift();

    // --- Start: New "Closest to Price Tier" Fallback Logic ---

    // Create a pool of all remaining items from all tiers
    let leftoverPool = [...budgetItems, ...midRangeItems, ...premiumItems];
    
    // Fallback for PREMIUM tier
    if (!bestPremium && leftoverPool.length > 0) {
        console.log("Premium tier empty. Finding most expensive fallback.");
        // Sort leftovers by price descending to find the most expensive
        leftoverPool.sort((a, b) => parsePrice(b.price) - parsePrice(a.price));
        bestPremium = leftoverPool.shift(); // Take the most expensive
    }

    // Fallback for BUDGET tier
    if (!bestBudget && leftoverPool.length > 0) {
        console.log("Budget tier empty. Finding least expensive fallback.");
        // Sort leftovers by price ascending to find the cheapest
        leftoverPool.sort((a, b) => parsePrice(a.price) - parsePrice(b.price));
        bestBudget = leftoverPool.shift(); // Take the least expensive
    }
    
    // Fallback for MID-RANGE tier
    if (!bestMidRange && leftoverPool.length > 0) {
        console.log("Mid-range tier empty. Finding closest price fallback.");
        // Sort leftovers by proximity to the middle of the mid-range bracket
        leftoverPool.sort((a, b) => 
            Math.abs(parsePrice(a.price) - priceBrackets.midRange.target) - 
            Math.abs(parsePrice(b.price) - priceBrackets.midRange.target)
        );
        bestMidRange = leftoverPool.shift(); // Take the one with the smallest price difference
    }

    // --- End: New Fallback Logic ---

    let finalResults: any[] = [];
    if (bestBudget) finalResults.push({ ...bestBudget, price_tier: 'Affordable' });
    if (bestMidRange) finalResults.push({ ...bestMidRange, price_tier: 'Mid-Range' });
    if (bestPremium) finalResults.push({ ...bestPremium, price_tier: 'Premium' });
    
    // Final sort to ensure display order is always low -> high price
    finalResults.sort((a, b) => parsePrice(a.price) - parsePrice(b.price));

    console.log(`Returning ${finalResults.length} price-tier-aware results.`);

    return NextResponse.json({ success: true, results: finalResults });

  } catch (error) {
    console.error("SerpAPI Error:", error);
    return NextResponse.json({ success: false, error: 'An error occurred while searching for products.' }, { status: 500 });
  }
}
