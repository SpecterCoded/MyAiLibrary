import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { VideoPlayer } from '../FileExplorer/VideoPlayer';
import { getAccessToken } from '../../utils/auth';

interface ChatDrawerVideoPlayerProps {
  resourceId: string;
  timestamp?: number;
}

export default function ChatDrawerVideoPlayer({ resourceId, timestamp }: ChatDrawerVideoPlayerProps) {
  const [objectUrl, setObjectUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const loadMedia = async () => {
      setLoading(true);
      try {
        const token = getAccessToken();
        const res = await fetch(`/resources/${resourceId}/file`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        if (!res.ok) throw new Error("Failed to load file");
        const blob = await res.blob();
        if (active) {
          const url = URL.createObjectURL(blob);
          setObjectUrl(url);
        }
      } catch (err) {
        console.error("Error loading preview media:", err);
      } finally {
        if (active) setLoading(false);
      }
    };
    loadMedia();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [resourceId]);

  if (loading) {
    return (
      <div className="rounded-xl overflow-hidden shadow-sm border border-gray-200/50 bg-slate-950 aspect-video flex items-center justify-center w-full">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  if (!objectUrl) {
    return (
      <div className="rounded-xl overflow-hidden shadow-sm border border-gray-200/50 bg-slate-950 aspect-video flex items-center justify-center text-white text-xs font-mono w-full">
        Failed to load media
      </div>
    );
  }

  const finalSrc = objectUrl ? `${objectUrl}#t=${timestamp || 0}` : '';

  return (
    <VideoPlayer src={finalSrc} className="w-full aspect-video relative bg-slate-950 rounded-xl overflow-hidden shadow-sm border border-gray-200/50 flex items-center justify-center [&_.vjs-tech]:object-contain" />
  );
}
