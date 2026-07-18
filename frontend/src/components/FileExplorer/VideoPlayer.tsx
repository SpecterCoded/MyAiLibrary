'use client';
import { createPlayer } from '@videojs/react';
import { MinimalVideoSkin, Video, videoFeatures } from '@videojs/react/video';
import '@videojs/react/video/minimal-skin.css';

const Player = createPlayer({ features: videoFeatures });

export function VideoPlayer({ src, poster, className }: { src: string; poster?: string; className?: string }) {
  return (
    <div className={className || "w-[80vw] max-w-[850px] aspect-video relative bg-slate-950 rounded-2xl overflow-hidden shadow-2xl border border-slate-800 flex items-center justify-center"}>
      <Player.Provider>
        <MinimalVideoSkin poster={poster} className="w-full h-full">
          <Video src={src} playsInline className="w-full h-full object-contain" />
        </MinimalVideoSkin>
      </Player.Provider>
    </div>
  );
}
