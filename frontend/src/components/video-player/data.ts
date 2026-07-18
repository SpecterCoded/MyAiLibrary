export const transcript = [
  {
    id: 1,
    name: "Ehsan",
    time: "10:03",
    text: "Alright, let's start. I want to go over where we stand on the sprint and what's blocking us from completing the AI module.",
    avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?q=80&w=150&auto=format&fit=crop",
  },
  {
    id: 2,
    name: "Ava",
    time: "10:03",
    text: "From the design side, the Meeting Details screen is ready. I just want to validate interactions for the transcript comments handoff.",
    highlight: "Meeting",
    avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?q=80&w=150&auto=format&fit=crop",
  },
  {
    id: 3,
    name: "Harry",
    time: "10:06",
    text: "The backend API for transcript search is running fine locally, but latency jumps under high load. I'm testing caching strategies.",
    avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?q=80&w=150&auto=format&fit=crop",
  },
  {
    id: 4,
    name: "Mary",
    time: "10:09",
    text: "From the user testing session yesterday, people loved the minimal layout, but some asked for a compact mode",
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?q=80&w=150&auto=format&fit=crop",
  },
  {
    id: 5,
    name: "Ehsan",
    time: "10:11",
    text: "Got it. Let's plan to introduce that after Beta. Any blockers?",
    avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?q=80&w=150&auto=format&fit=crop",
  },
  {
    id: 6,
    name: "Harry",
    time: "10:12",
    text: "None right now, just need to finalize the caching implementation by tomorrow noon.",
    avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?q=80&w=150&auto=format&fit=crop",
  }
];

export const timelineData = [
  {
    id: 1,
    name: "Ehsan",
    avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?q=80&w=150&auto=format&fit=crop",
    percent: "32%",
    total: "3m",
    color: "bg-[#a7f3d0]", // Emerald 200
    segments: [{ left: "0%", width: "15%" }, { left: "25%", width: "10%" }, { left: "45%", width: "5%" }, { left: "70%", width: "15%" }]
  },
  {
    id: 2,
    name: "Ava",
    avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?q=80&w=150&auto=format&fit=crop",
    percent: "34%",
    total: "3.5m",
    color: "bg-[#fdba74]", // Orange 300
    segments: [{ left: "15%", width: "10%" }, { left: "35%", width: "10%" }, { left: "55%", width: "8%" }, { left: "85%", width: "10%" }]
  },
  {
    id: 3,
    name: "Harry",
    avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?q=80&w=150&auto=format&fit=crop",
    percent: "12%",
    total: "1m",
    color: "bg-[#93c5fd]", // Blue 300
    segments: [{ left: "20%", width: "5%" }, { left: "40%", width: "10%" }, { left: "60%", width: "5%" }]
  },
  {
    id: 4,
    name: "Mary",
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?q=80&w=150&auto=format&fit=crop",
    percent: "56%",
    total: "1m", // Image has 56% but 1m, keeping literal to image for look, though math is odd
    color: "bg-[#d8b4fe]", // Purple 300
    segments: [{ left: "50%", width: "5%" }, { left: "65%", width: "20%" }, { left: "95%", width: "5%" }]
  }
];
