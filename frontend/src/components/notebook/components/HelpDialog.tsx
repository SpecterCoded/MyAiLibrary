import React, { useState } from 'react';
import { X, Search, Book, MessageCircle, ArrowRight, PlayCircle, Keyboard, Zap } from 'lucide-react';
import { useAppContext } from '../AppContext';

export function HelpDialog() {
  const { helpOpen, setHelpOpen } = useAppContext();
  const [searchQuery, setSearchQuery] = useState('');

  if (!helpOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div 
        className="bg-white dark:bg-[#191919] w-full max-w-[700px] rounded-xl shadow-2xl overflow-hidden flex flex-col font-sans transition-all max-h-[85vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6 border-b border-[#EFEFED] dark:border-gray-800 relative bg-[#F7F7F5] dark:bg-[#202020]">
          <button 
             className="absolute top-6 right-6 text-[#9A9A97] hover:text-[#37352F] dark:hover:text-gray-200 transition-colors" 
             onClick={() => setHelpOpen(false)}
          >
            <X size={20} />
          </button>
          
          <h2 className="text-[22px] font-bold text-[#37352F] dark:text-white mb-2">How can we help?</h2>
          <p className="text-[14px] text-[#737373] mb-6">Search for answers or browse our documentation.</p>

          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9A9A97]" />
            <input 
              type="text" 
              placeholder="Search help articles..." 
              className="w-full pl-10 pr-4 py-3 bg-white dark:bg-[#2A2A2A] border border-[#EFEFED] dark:border-gray-700 rounded-lg outline-none focus:border-blue-400 focus:shadow-[0_0_0_2px_rgba(59,130,246,0.2)] transition-all text-[#37352F] dark:text-gray-200 shadow-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-white dark:bg-[#191919]">
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <div className="p-4 border border-[#EFEFED] dark:border-gray-800 rounded-lg hover:border-gray-300 dark:hover:border-gray-600 transition-colors cursor-pointer group flex flex-col items-start bg-white dark:bg-[#2A2A2A]">
               <div className="bg-[#EFEFED] dark:bg-[#333] p-2 rounded-md mb-3 text-[#37352F] dark:text-gray-200">
                  <Book size={20} />
               </div>
               <h3 className="font-semibold text-[15px] text-[#37352F] dark:text-gray-200 mb-1">Documentation</h3>
               <p className="text-[13px] text-[#737373] mb-4">Detailed guides on all features and capabilities.</p>
               <span className="text-blue-500 text-[13px] font-medium flex items-center group-hover:underline mt-auto">Read guides <ArrowRight size={14} className="ml-1" /></span>
            </div>

            <div className="p-4 border border-[#EFEFED] dark:border-gray-800 rounded-lg hover:border-gray-300 dark:hover:border-gray-600 transition-colors cursor-pointer group flex flex-col items-start bg-white dark:bg-[#2A2A2A]">
               <div className="bg-blue-50 dark:bg-blue-900/20 p-2 rounded-md mb-3 text-blue-600 dark:text-blue-400">
                  <PlayCircle size={20} />
               </div>
               <h3 className="font-semibold text-[15px] text-[#37352F] dark:text-gray-200 mb-1">Video Tutorials</h3>
               <p className="text-[13px] text-[#737373] mb-4">Watch quick videos to master the workspace.</p>
               <span className="text-blue-500 text-[13px] font-medium flex items-center group-hover:underline mt-auto">Watch videos <ArrowRight size={14} className="ml-1" /></span>
            </div>
          </div>

          <h3 className="text-[12px] font-bold uppercase tracking-wider text-[#9A9A97] mb-4 px-1">Popular Articles</h3>
          <div className="space-y-1 mb-8">
            {['Keyboard shortcuts', 'Formatting your notes', 'Organizing with folders and tags', 'Using graph view'].map((article, i) => (
              <div key={i} className="flex items-center justify-between p-3 hover:bg-[#F7F7F5] dark:hover:bg-[#202020] rounded-md cursor-pointer transition-colors group text-[#37352F] dark:text-gray-300">
                <div className="flex items-center text-[14px]">
                  {i === 0 ? <Keyboard size={16} className="text-[#9A9A97] mr-3" /> : <Zap size={16} className="text-[#9A9A97] mr-3" />}
                  {article}
                </div>
                <ArrowRight size={16} className="text-[#9A9A97] opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            ))}
          </div>

          <div className="bg-[#F7F7F5] dark:bg-[#202020] rounded-lg p-5 flex items-center justify-between border border-[#EFEFED] dark:border-gray-800">
             <div>
                <h4 className="font-semibold text-[14px] text-[#37352F] dark:text-gray-200 mb-1">Still need help?</h4>
                <p className="text-[13px] text-[#737373]">Chat with our support team or send us an email.</p>
             </div>
             <button className="flex items-center gap-2 px-4 py-2 bg-[#37352F] dark:bg-white text-white dark:text-[#191919] text-[13px] font-medium rounded-md hover:bg-[#2A2823] dark:hover:bg-gray-200 transition-colors shadow-sm">
                <MessageCircle size={16} /> Contact Support
             </button>
          </div>
          
        </div>
      </div>
    </div>
  );
}
