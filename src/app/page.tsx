// In /app/page.tsx
'use client';

import { useState } from 'react';

// Define the types for our results for better autocompletion and safety
type AnalyzedItem = {
  item_name: string;
  description: string;
  search_query: string;
  category: string;
  significance_score: number;
};

type VisionApiResponse = {
  image_type: 'Product Shot' | 'Outfit Shot';
  analyzed_items: AnalyzedItem[];
};

type SearchResult = {
  title: string;
  link: string;
  source: string;
  price: string;
  thumbnail: string;
  price_tier: 'Affordable' | 'Mid-Range' | 'Premium';
};

export default function HomePage() {
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [visionData, setVisionData] = useState<VisionApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState<Set<string>>(new Set());
  const [searchError, setSearchError] = useState<string | null>(null);
  
  // Function to convert file to base64
  const toBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) return;

    setIsLoading(true);
    setError(null);
    setVisionData(null);
    setSearchResults([]);
    setIsSearching(new Set());
    setSearchError(null);

    try {
      const base64Image = await toBase64(file);
      setImageBase64(base64Image);
      
      const response = await fetch('/api/vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Image }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `API request failed with status ${response.status}`);
      }
      
      const data: VisionApiResponse = await response.json();
      setVisionData(data);

    } catch (err: any) {
      setError(err.message || 'An unknown error occurred.');
    } finally {
      setIsLoading(false);
    }
  };

  // Function to search for products
  const handleItemSearch = async (searchQuery: string) => {
    if (!searchQuery || isSearching.has(searchQuery)) return;

    setIsSearching(prev => new Set(prev).add(searchQuery));
    setSearchResults([]);
    setSearchError(null);

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery, imageBase64 }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Search API request failed with status ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Search failed');
      }
      
      setSearchResults(data.data || []);
      
    } catch (err: any) {
      setSearchError(err.message || 'An error occurred while searching for products.');
    } finally {
      setIsSearching(prev => {
        const newSet = new Set(prev);
        newSet.delete(searchQuery);
        return newSet;
      });
    }
  };

  return (
    <div className="container mx-auto p-8 max-w-2xl">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-2">AI Shop the Look</h1>
        <p className="text-gray-600 mb-8">Upload an image to get a detailed breakdown of the fashion items.</p>
      </div>
      
      <form onSubmit={handleSubmit} className="mb-8 p-6 border rounded-lg bg-gray-50">
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files ? e.target.files[0] : null)}
          className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
        />
        <button type="submit" disabled={!file || isLoading} className="w-full mt-4 px-4 py-2 bg-blue-600 text-white font-bold rounded-lg disabled:bg-gray-400 hover:bg-blue-700 transition-colors">
          {isLoading ? 'Analyzing...' : 'Find My Style'}
        </button>
      </form>

      {error && <p className="my-4 text-center text-red-600 bg-red-100 p-3 rounded-lg">Error: {error}</p>}
      
      {visionData && (
        <div>
          <h2 className="text-2xl font-bold mb-4">
            Analysis Results: <span className="text-lg font-medium text-gray-600">{visionData.image_type}</span>
          </h2>
          <ul className="space-y-4">
            {visionData.analyzed_items.map((item, index) => (
              <li key={index} className="border p-4 rounded-lg shadow-sm bg-white">
                <h3 className="text-xl font-semibold text-gray-800">{item.item_name}</h3>
                <p className="text-gray-600 mt-1">{item.description}</p>
                <div className="mt-2 text-xs text-gray-500">
                  <span>Category: {item.category}</span> | <span>Significance: {item.significance_score}/10</span>
                </div>
                <button
                  onClick={() => handleItemSearch(item.search_query)}
                  disabled={isSearching.size > 0}
                  className="mt-3 text-sm font-medium text-blue-600 hover:underline disabled:text-gray-400 disabled:no-underline"
                >
                  {isSearching.has(item.search_query) ? 'Searching...' : `Find similar items →`}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isSearching.size > 0 && searchResults.length === 0 && (
        <div className="mt-8 border-t pt-6">
          <h2 className="text-2xl font-bold mb-4">Shopping Results</h2>
          <p className="text-center text-gray-600">Searching for products...</p>
        </div>
      )}

      {searchResults.length > 0 && (
        <div className="mt-8 border-t pt-6">
          <h2 className="text-2xl font-bold mb-4">Shopping Results</h2>
          
          {searchError && (
            <p className="my-4 text-center text-red-600 bg-red-100 p-3 rounded-lg">Error: {searchError}</p>
          )}
          
          {!searchError && searchResults.length === 0 ? (
            <p className="text-center text-gray-600">No products found. Try a different search.</p>
          ) : (
            <div className="space-y-6">
              {['Affordable', 'Mid-Range', 'Premium'].map((tier) => {
                const productsInTier = searchResults.filter(p => p.price_tier === tier);
                if (productsInTier.length === 0) return null;

                return (
                  <div key={tier}>
                    <h3 className="text-xl font-semibold mb-3 text-gray-700">{tier}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {productsInTier.map((product, index) => (
                        <a 
                          href={product.link} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          key={index} 
                          className="border p-4 rounded-lg shadow-sm bg-white hover:shadow-md transition-shadow"
                        >
                          <div className="flex items-start space-x-4">
                            {product.thumbnail && (
                              <img 
                                src={product.thumbnail} 
                                alt={product.title} 
                                className="w-20 h-20 object-contain"
                              />
                            )}
                            <div>
                              <h3 className="font-medium text-gray-800">{product.title}</h3>
                              <p className="text-blue-600 font-bold mt-1">{product.price}</p>
                              <p className="text-gray-500 text-sm mt-1">{product.source}</p>
                            </div>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
