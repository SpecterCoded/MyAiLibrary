import { useEffect, useState, useCallback } from 'react';

export interface Quote {
  id: number;
  text: string;
  author: string;
  role: string;
  image: string;
}

const localQuotesPool = [
  { text: "The market is a device for transferring money from the impatient to the patient.", author: "Warren Buffett", role: "Chairman & CEO, Berkshire Hathaway" },
  { text: "I believe the very best money is made at the market turns. Everyone says you get killed trying to pick tops and bottoms.", author: "Paul Tudor Jones", role: "Founder, Tudor Investment Corp" },
  { text: "The core of my philosophy is that I don't know. The fact that the financial markets are inherently unstable.", author: "George Soros", role: "Chair, Soros Fund Management" },
  { text: "If most traders would learn to sit on their hands 50 percent of the time, they would make a lot more money.", author: "Bill Lipschutz", role: "Head of FX, Hathersage Capital" },
  { text: "There is only one side of the market and it is not the bull side or the bear side, but the right side.", author: "Jesse Livermore", role: "Pioneer Day Trader" }
];

export function useQuotes() {
  const [history, setHistory] = useState<Quote[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [loading, setLoading] = useState(true);

  const fetchBatch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/quotes/batch?count=15');
      if (!res.ok) throw new Error('Failed to fetch from quote API');
      const data = await res.json();
      setHistory(data);
      setCurrentIndex(0);
    } catch (err: any) {
      console.warn("Using fallback local quotes due to API error:", err);
      // Fallback
      const fallbackData = localQuotesPool.map((q, idx) => ({
        id: Date.now() + idx,
        text: q.text,
        author: q.author,
        role: q.role,
        image: `https://picsum.photos/seed/${100 + idx}/1080/1920`
      }));
      setHistory(fallbackData);
      setCurrentIndex(0);
    } finally {
      setLoading(false);
    }
  }, []);

  const nextQuote = useCallback(() => {
    if (currentIndex < history.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      fetchBatch();
    }
  }, [currentIndex, history.length, fetchBatch]);

  const prevQuote = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  }, [currentIndex]);

  const goToIndex = useCallback((index: number) => {
    if (index >= 0 && index < history.length) {
      setCurrentIndex(index);
    }
  }, [history.length]);

  useEffect(() => {
    if (history.length === 0) {
      fetchBatch();
    }
  }, [fetchBatch, history.length]);

  return { 
    currentQuote: history[currentIndex] || null, 
    loading,
    nextQuote, 
    prevQuote,
    goToIndex,
    historyLength: history.length,
    currentIndex
  };
}
