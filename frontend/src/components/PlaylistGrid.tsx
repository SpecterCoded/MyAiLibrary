import React, { useState, useEffect } from 'react';
import PlaylistCard, { type PlaylistIconType } from './PlaylistCard';
import { PlaylistCardSkeleton } from './loadingskeleton';
import EmptyState from './EmptyState';
import { ArrowRight } from 'lucide-react';

interface PlaylistGridProps {
  isLoading?: boolean;
  onNavigateToFolder: (id: string, name: string) => void;
  onCreatePlaylistClick: () => void;
  onSeeAllClick?: () => void;
  limit?: number;
  onShare?: (id: string, name: string) => void;
}

interface BackendPlaylist {
  id: string;
  name: string;
  description?: string;
  icon_type?: string;
  is_favorite?: number;
  created_at?: string | null;
  updated_at?: string | null;
  item_count?: number;
}

const PlaylistGrid: React.FC<PlaylistGridProps> = ({ 
  isLoading: initialLoading = false, 
  onNavigateToFolder,
  onCreatePlaylistClick,
  onSeeAllClick,
  limit,
  onShare
}) => {
  const [playlists, setPlaylists] = useState<BackendPlaylist[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPlaylists = async () => {
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch('/playlists', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setPlaylists(data);
      } else {
        console.error('Failed to fetch playlists');
      }
    } catch (err) {
      console.error('Error fetching playlists:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlaylists();
    
    window.addEventListener('refresh-playlists', fetchPlaylists);
    return () => {
      window.removeEventListener('refresh-playlists', fetchPlaylists);
    };
  }, []);

  const showLoading = initialLoading || loading;

  if (showLoading) {
    return (
      <section className="flex flex-col gap-5">
        <div className="flex items-center justify-between select-none px-1">
          <h2 className="text-xl font-bold text-slate-800 tracking-tight">Latest Playlists</h2>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <PlaylistCardSkeleton />
          <PlaylistCardSkeleton />
          <PlaylistCardSkeleton />
        </div>
      </section>
    );
  }

  if (playlists.length === 0) {
    return (
      <section className="flex flex-col gap-5">
        <div className="flex items-center justify-between select-none px-1">
          <h2 className="text-xl font-bold text-slate-800 tracking-tight">Latest Playlists</h2>
        </div>
        <EmptyState onNewDocument={onCreatePlaylistClick} />
      </section>
    );
  }

  const getPlaylistCardProps = (name: string, description: string | undefined | null, iconType: string | undefined | null, itemCount: number | undefined, idx: number) => {
    const categories = ["Design System", "Product Dev", "Marketing", "Feedback Sync", "UX Research"];
    const dates = ["Sun - Sep 29th", "Tue - Oct 8th", "Thu - Oct 10th", "Mon - Oct 12th", "Wed - Oct 14th"];
    const timeframes = ["02:35 PM - 02:45 PM", "11:00 AM - 11:30 AM", "03:30 PM - 04:00 PM", "10:00 AM - 11:30 AM", "01:00 PM - 02:30 PM"];
    const fallbackDescriptions = [
      "Workspace playlist containing transcripts, resources, and documents.",
      "A collection of indexed folders and files for quick AI queries.",
      "Project playlist organized for codebase indexing and knowledge search.",
      "Sync session documents, notes, and resources for team alignment.",
      "UX/UI research papers, design system specs, and assets collection."
    ];
    const iconTypes: PlaylistIconType[] = ['shape', 'initials'];

    return {
      category: categories[idx % categories.length],
      title: name,
      date: dates[idx % dates.length],
      timeframe: timeframes[idx % timeframes.length],
      description: (description && description.trim()) ? description : fallbackDescriptions[idx % fallbackDescriptions.length],
      iconType: (iconType && iconType.trim()) ? (iconType as PlaylistIconType) : iconTypes[idx % iconTypes.length],
      itemCount: itemCount != null ? `${itemCount} item${itemCount === 1 ? '' : 's'}` : '0 items'
    };
  };

  const displayedPlaylists = limit ? playlists.slice(0, limit) : playlists;

  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-center justify-between select-none px-1">
        <h2 className="text-xl font-bold text-slate-800 tracking-tight">Latest Playlists</h2>
        {limit && playlists.length > limit && (
          <button
            onClick={onSeeAllClick}
            className="flex items-center gap-1.5 text-[13px] font-bold text-slate-400 hover:text-indigo-600 transition-colors group cursor-pointer"
          >
            Explore All
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {displayedPlaylists.map((playlist, index) => {
          const cardProps = getPlaylistCardProps(playlist.name, playlist.description, playlist.icon_type, playlist.item_count, index);
          return (
            <PlaylistCard
              key={playlist.id}
              id={playlist.id}
              {...cardProps}
              isFavorite={playlist.is_favorite === 1}
              onNavigate={() => onNavigateToFolder(playlist.id, playlist.name)}
              onShare={onShare}
              createdAt={playlist.created_at}
              updatedAt={playlist.updated_at}
            />
          );
        })}
      </div>
    </section>
  );
};

export default PlaylistGrid;
