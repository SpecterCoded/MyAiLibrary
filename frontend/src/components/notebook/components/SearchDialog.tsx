import React, { useState, useEffect } from 'react';
import { Search, FileText } from 'lucide-react';
import { useAppContext } from '../AppContext';

export function SearchDialog() {
  const { searchOpen, setSearchOpen, notes, setSelectedNoteId, setCurrentView } = useAppContext();
  const [query, setQuery] = useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSearchOpen(false);
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setSearchOpen]);

  useEffect(() => {
    if (searchOpen) setTimeout(() => inputRef.current?.focus(), 10);
    else setQuery('');
  }, [searchOpen]);

  if (!searchOpen) return null;

  const results = notes.filter(n => 
    n.status !== 'deleted' && 
    (n.title.toLowerCase().includes(query.toLowerCase()))
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={() => setSearchOpen(false)}>
      <div 
        className="w-full max-w-2xl bg-white dark:bg-[#1E1E1E] rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <Search size={20} className="text-gray-400 mr-3" />
          <input 
             ref={inputRef}
             type="text" 
             className="flex-1 bg-transparent border-none outline-none text-lg text-[#37352F] dark:text-gray-200 placeholder-gray-400"
             placeholder="Search notes..."
             value={query}
             onChange={e => setQuery(e.target.value)}
          />
          <button onClick={() => setSearchOpen(false)} className="text-[11px] font-semibold tracking-wider text-gray-400 hover:text-gray-600 px-2 py-1 bg-gray-100 rounded">ESC</button>
        </div>
        
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-500 font-medium">No results found for "{query}"</div>
          ) : (
             <div className="px-2 py-2 text-[11px] font-semibold text-[#9A9A97] tracking-wider uppercase">SUGGESTIONS</div>
          )}
          {results.map(result => (
            <div 
               key={result.id}
               className="flex items-center gap-3 px-4 py-3 hover:bg-[#EFEFED] dark:hover:bg-[#333] cursor-pointer rounded-lg mx-1 transition-colors"
               onClick={() => {
                 setSearchOpen(false);
                 setSelectedNoteId(result.id);
                 setCurrentView('note');
               }}
            >
               <FileText size={18} className="text-[#9A9A97]" />
               <div>
                  <div className="text-[14px] font-medium text-[#37352F] dark:text-gray-200">{result.title || 'Untitled Note'}</div>
                  <div className="text-[12px] font-medium text-[#9A9A97] mt-0.5">
                    Updated {new Date(result.updatedAt).toLocaleDateString()}
                  </div>
               </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
