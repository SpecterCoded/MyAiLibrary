import { motion } from 'framer-motion';
import { Sparkles, BarChart2, ReceiptText, Target, Play, Music } from 'lucide-react';

const SUGGESTIONS = [
  {
    icon: BarChart2,
    title: "How's my campaign?",
    desc: "Get a quick overview of your campaign's performance, including reach, engagement, and ROI.",
    btn: "View Report",
    prompt: "Can you give me a quick overview of my campaign's performance, including reach, engagement, and ROI?"
  },
  {
    icon: ReceiptText,
    title: "Any spend issues?",
    desc: "Identify sudden spikes or dips in ad spend and get suggestions to optimize your budget.",
    btn: "Analyze Budget",
    prompt: "Are there any spend issues, spikes, or dips in my ad budget? Please analyze."
  },
  {
    icon: Target,
    title: "Which ads work best?",
    desc: "See the top-performing ads based on clicks, conversions, and engagement to refine your strategy.",
    btn: "View Insights",
    prompt: "Which ads / ad creatives are performing best this week in terms of clicks, conversions, and engagement?"
  }
];

interface HomeViewProps {
  displayName: string;
  onSelectSuggestion: (suggestion: any) => void;
  suggestions?: any[] | null;
}

export default function HomeView({ displayName, onSelectSuggestion, suggestions }: HomeViewProps) {
  const isLoading = suggestions === null;
  const cards = suggestions && suggestions.length > 0 ? suggestions : SUGGESTIONS;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';

  const getMediaBadge = (kind: string) => {
    switch (kind) {
      case 'video':
        return { label: 'Video', icon: Play, bg: '#FEF3C7', color: '#92400E' };
      case 'audio':
        return { label: 'Audio', icon: Music, bg: '#FCE7F3', color: '#9D174D' };
      default:
        return { label: 'Media', icon: Play, bg: '#EEF2FF', color: '#4338CA' };
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="flex flex-col items-center justify-center w-full px-6 pt-[8vh]"
    >
      <div className="flex items-center justify-center w-12 h-12 rounded-full border border-gray-200 shadow-sm mb-6 bg-white animate-pulse">
        <Sparkles size={20} strokeWidth={2} className="text-gray-800" />
      </div>

      <h1 className="text-3xl sm:text-4xl font-semibold text-gray-900 tracking-tight">{greeting}, {displayName}</h1>
      <p className="text-gray-500 mt-3 text-base sm:text-lg text-center">
        {suggestions && suggestions.length > 0
          ? 'Here are your latest media — click to explore.'
          : 'Hey there! What can I help you explore today?'}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-12 w-full max-w-[900px]">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-slate-50 border border-gray-100 rounded-3xl p-6 sm:p-7 flex flex-col animate-pulse">
              <div className="w-6 h-6 rounded-md bg-gray-200 mb-4" />
              <div className="h-4 bg-gray-200 rounded-full w-3/4 mb-2" />
              <div className="h-3 bg-gray-100 rounded-full w-full mb-1.5" />
              <div className="h-3 bg-gray-100 rounded-full w-5/6 mb-8" />
              <div className="h-9 bg-gray-100 rounded-full w-full" />
            </div>
          ))
        ) : (
          cards.map((sug: any, i: number) => {
            const isDynamic = suggestions && suggestions.length > 0;
            const badge = isDynamic ? getMediaBadge(sug.kind) : null;
            const BadgeIcon = badge?.icon;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 + (i * 0.1) }}
                onClick={() => onSelectSuggestion(sug)}
                className="bg-slate-50 border border-gray-100 rounded-3xl p-6 sm:p-7 flex flex-col group hover:-translate-y-1.5 hover:shadow-[0_12px_30px_rgb(0,0,0,0.06)] hover:bg-white transition-all duration-300 cursor-pointer relative overflow-hidden"
              >
                {isDynamic && badge && (
                  <span className="absolute top-4 right-4 text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
                    style={{ background: badge.bg, color: badge.color }}>
                    {badge.label}
                  </span>
                )}
                {isDynamic && badge && BadgeIcon ? (
                  <div className="w-9 h-9 rounded-xl mb-4 flex items-center justify-center"
                    style={{ background: badge.bg }}>
                    <BadgeIcon size={18} strokeWidth={2} style={{ color: badge.color }} />
                  </div>
                ) : (
                  <sug.icon size={22} strokeWidth={2} className="text-gray-800 mb-4" />
                )}
                <h3 className="font-semibold text-gray-900 text-[17px] mb-2 pr-12 leading-snug truncate" title={sug.title}>{sug.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed mb-8 flex-grow line-clamp-3">{sug.desc}</p>
                <button className="w-full rounded-full border border-gray-200 bg-white py-2.5 text-sm font-medium text-gray-700 group-hover:bg-gray-50 group-hover:border-gray-300 transition-colors duration-300 pointer-events-none">{sug.btn}</button>
              </motion.div>
            );
          })
        )}
      </div>
    </motion.div>
  );
}
