import React, { useState, useEffect } from 'react';
import { X, Check, Archive as ArchiveIcon, BellOff, Info, ArrowRight, Sparkles, Trash2 } from 'lucide-react';

interface Notification {
  id: string;
  user_id: string;
  category: string;
  title: string;
  message: string;
  link: string | null;
  actor_id: string | null;
  actor: { name: string; avatar: string } | null;
  item_thumb: string | null;
  item_meta: string | null;
  is_read: boolean;
  is_archived: boolean;
  created_at: string;
}

interface NotificationPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onRefreshCount?: () => void;
}

function formatRelativeTime(dateStr: string) {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  } catch {
    return '';
  }
}

const getCategoryConfig = (category: string) => {
  const configs: Record<string, { label: string; color: string; icon: string }> = {
    download: { label: 'Downloads', color: 'bg-indigo-500', icon: '📥' },
    processing: { label: 'AI Pipeline', color: 'bg-purple-600', icon: '✨' },
    share: { label: 'Sharing', color: 'bg-emerald-500', icon: '🔗' },
    team: { label: 'Teams', color: 'bg-blue-500', icon: '👥' },
    system: { label: 'System', color: 'bg-zinc-500', icon: '⚙️' },
  };
  return configs[category] || { label: 'Alert', color: 'bg-zinc-500', icon: '🔔' };
};

const NotificationPanel: React.FC<NotificationPanelProps> = ({ isOpen, onClose, onRefreshCount }) => {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [animate, setAnimate] = useState(false);
  const [activeTab, setActiveTab] = useState('General');
  
  // Separate states for active (Inbox) and archived alerts
  const [allInboxNotifications, setAllInboxNotifications] = useState<Notification[]>([]);
  const [archivedNotifications, setArchivedNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      const frame = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setAnimate(true);
        });
      });
      return () => cancelAnimationFrame(frame);
    } else {
      setAnimate(false);
      const timer = setTimeout(() => setShouldRender(false), 400);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const fetchNotifications = async () => {
    setLoading(true);
    const token = localStorage.getItem('access_token');
    if (!token) return;
    try {
      // 1. Fetch active notifications (inbox contains both general and mentions)
      const response = await fetch(`http://127.0.0.1:8000/notifications?tab=Inbox`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setAllInboxNotifications(data);
      }

      // 2. Fetch archived notifications
      const archiveRes = await fetch(`http://127.0.0.1:8000/notifications?tab=Archive`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (archiveRes.ok) {
        const archiveData = await archiveRes.json();
        setArchivedNotifications(archiveData);
      }
    } catch (err) {
      console.error('Failed to fetch notifications', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen]);

  if (!shouldRender) return null;

  // Deriving lists locally
  const generalNotifications = allInboxNotifications.filter(n => 
    ['download', 'processing', 'system'].includes(n.category)
  );

  const mentionsNotifications = allInboxNotifications.filter(n => 
    ['share', 'team'].includes(n.category)
  );

  const getDisplayNotifications = () => {
    if (activeTab === 'General') return generalNotifications;
    if (activeTab === 'Mentions') return mentionsNotifications;
    return archivedNotifications;
  };

  const displayList = getDisplayNotifications();

  const handleMarkAsRead = async (id: string) => {
    const token = localStorage.getItem('access_token');
    if (!token) return;
    try {
      const response = await fetch(`http://127.0.0.1:8000/notifications/${id}/read`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        setAllInboxNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
        if (onRefreshCount) onRefreshCount();
      }
    } catch (err) {
      console.error('Failed to mark notification as read', err);
    }
  };

  const handleMarkAllAsRead = async () => {
    const token = localStorage.getItem('access_token');
    if (!token) return;
    try {
      const response = await fetch('http://127.0.0.1:8000/notifications/read-all', {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        setAllInboxNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
        if (onRefreshCount) onRefreshCount();
      }
    } catch (err) {
      console.error('Failed to mark all notifications as read', err);
    }
  };

  const handleArchive = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const token = localStorage.getItem('access_token');
    if (!token) return;
    try {
      const response = await fetch(`http://127.0.0.1:8000/notifications/${id}/archive`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const archivedItem = allInboxNotifications.find(n => n.id === id);
        setAllInboxNotifications(prev => prev.filter(n => n.id !== id));
        if (archivedItem) {
          setArchivedNotifications(prev => [{ ...archivedItem, is_archived: true }, ...prev]);
        }
        if (onRefreshCount) onRefreshCount();
      }
    } catch (err) {
      console.error('Failed to archive notification', err);
    }
  };

  const handleDeleteNotification = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const token = localStorage.getItem('access_token');
    if (!token) return;
    try {
      const response = await fetch(`http://127.0.0.1:8000/notifications/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        setArchivedNotifications(prev => prev.filter(n => n.id !== id));
        if (onRefreshCount) onRefreshCount();
      }
    } catch (err) {
      console.error('Failed to permanently delete notification', err);
    }
  };

  const handleClearAllArchive = async () => {
    const token = localStorage.getItem('access_token');
    if (!token) return;
    try {
      const response = await fetch('http://127.0.0.1:8000/notifications/archive', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        setArchivedNotifications([]);
        if (onRefreshCount) onRefreshCount();
      }
    } catch (err) {
      console.error('Failed to clear archived notifications', err);
    }
  };

  const handleNotificationClick = async (notif: Notification) => {
    if (!notif.is_read) {
      await handleMarkAsRead(notif.id);
    }

    if (notif.link) {
      if (notif.link.startsWith('/folders/')) {
        const folderId = notif.link.split('/').pop();
        if (folderId) {
          window.dispatchEvent(new CustomEvent('app-navigate', { detail: { view: 'folder', id: folderId } }));
        }
      } else if (notif.link === '/downloads') {
        window.dispatchEvent(new CustomEvent('app-navigate', { detail: { view: 'downloads' } }));

      } else if (notif.link.startsWith('/document-intelligence')) {
        const params = new URLSearchParams(notif.link.split('?')[1] || '');
        const resourceId = params.get('resourceId');
        if (resourceId) {
          window.dispatchEvent(new CustomEvent('app-navigate', { detail: { view: 'document-intelligence', resourceId } }));
        }
      } else if (notif.link.startsWith('/audio-player') || notif.link.startsWith('/video-player')) {
        const queryParams = notif.link.split('?')[1];
        if (queryParams) {
          window.location.search = queryParams;
        }
      }
    }
    onClose();
  };

  const getEmptyStateMessage = () => {
    if (activeTab === 'Archive') {
      return { title: 'No archived alerts', desc: 'Alerts you dismiss will show up here.' };
    }
    if (activeTab === 'Mentions') {
      return { title: 'No shares or invites', desc: 'When team members share playlists or notes, you\'ll see them here.' };
    }
    return { title: 'You\'re all caught up', desc: 'No background downloads or index pipelines are active right now.' };
  };

  const empty = getEmptyStateMessage();

  return (
    <>
      {/* Backdrop */}
      <div 
        className={`fixed inset-0 z-40 bg-transparent transition-opacity duration-150 ${animate ? 'opacity-100' : 'opacity-0'}`} 
        onClick={onClose}
      ></div>

      <div 
        className={`fixed right-8 top-28 z-40 w-full max-w-[500px] bg-white dark:bg-slate-900 rounded-3xl border border-zinc-100 dark:border-white/10 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.12)] p-6 font-sans text-zinc-900 dark:text-slate-100 select-none transition-all duration-400 origin-top-right ${animate ? 'translate-y-0 opacity-100 scale-100' : '-translate-y-4 opacity-0 scale-95'}`}
        style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        
        {/* Header section */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[20px] font-bold tracking-tight text-zinc-900 dark:text-white">Notifications</h2>
          {activeTab === 'Archive' ? (
            archivedNotifications.length > 0 && (
              <button 
                onClick={handleClearAllArchive}
                className="text-[12px] font-semibold text-rose-600 dark:text-rose-455 hover:text-rose-700 dark:hover:text-rose-300 flex items-center gap-1 transition-colors"
              >
                <Trash2 size={13} />
                Clear all archive
              </button>
            )
          ) : (
            allInboxNotifications.some(n => !n.is_read) && (
              <button 
                onClick={handleMarkAllAsRead}
                className="text-[12px] font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 flex items-center gap-1 transition-colors"
              >
                <Check size={14} />
                Mark all read
              </button>
            )
          )}
        </div>
        
        {/* Filter Tabs */}
        <div className="flex items-center gap-2 mb-5">
          {['General', 'Mentions', 'Archive'].map((tab) => {
            const isGeneralUnread = tab === 'General' && generalNotifications.some(n => !n.is_read);
            const isMentionsUnread = tab === 'Mentions' && mentionsNotifications.some(n => !n.is_read);
            const hasUnread = isGeneralUnread || isMentionsUnread;

            return (
              <button 
                key={tab} 
                onClick={() => setActiveTab(tab)}
                className={`relative px-4 py-1.5 text-[12px] font-semibold rounded-full transition-all border border-zinc-200/50 dark:border-white/5 ${
                  activeTab === tab 
                    ? 'bg-zinc-900 dark:bg-indigo-600 text-white shadow-sm border-transparent' 
                    : 'bg-zinc-50 dark:bg-slate-800 text-zinc-500 dark:text-slate-400 hover:bg-zinc-100 dark:hover:bg-slate-700'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  {tab}
                  {hasUnread && (
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-450 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {/* Notification Stream */}
        <div className="max-h-[380px] overflow-y-auto pr-1 space-y-4 no-scrollbar">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-zinc-400">
              <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3"></div>
              <span className="text-[13px] font-medium">Checking notifications...</span>
            </div>
          ) : displayList.length === 0 ? (
            <div className="py-16 px-4 flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 bg-zinc-50 dark:bg-slate-800 rounded-2xl flex items-center justify-center text-zinc-400 dark:text-slate-500 mb-3 border border-zinc-100 dark:border-white/5">
                <BellOff size={22} />
              </div>
              <h3 className="text-sm font-bold text-zinc-800 dark:text-slate-200">{empty.title}</h3>
              <p className="text-[12px] text-zinc-400 dark:text-slate-400 max-w-[240px] mt-1">{empty.desc}</p>
            </div>
          ) : (
            displayList.map((item) => {
              const config = getCategoryConfig(item.category);
              const fallbackAvatar = `https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100`;

              return (
                <div 
                  key={item.id} 
                  onClick={() => handleNotificationClick(item)}
                  className={`group relative flex gap-3 p-3 rounded-2xl border transition-all cursor-pointer ${
                    item.is_read 
                      ? 'bg-transparent border-transparent hover:bg-zinc-50 dark:hover:bg-slate-800/40' 
                      : 'bg-indigo-50/30 dark:bg-indigo-950/10 border-indigo-100/50 dark:border-indigo-950/20 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20'
                  }`}
                >
                  {/* Left Unread Marker Column */}
                  <div className="w-1.5 flex justify-center pt-3 shrink-0">
                    {!item.is_read && (
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 dark:bg-indigo-500 animate-pulse" />
                    )}
                  </div>

                  {/* Content Column */}
                  <div className="flex-1 min-w-0">
                    {/* Header Info */}
                    <div className="flex items-center gap-2">
                      {(!item.actor_id || !item.actor || item.actor?.name === 'System') ? (
                        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white shrink-0 shadow-sm shadow-blue-500/10">
                          <Sparkles size={13} strokeWidth={2.5} />
                        </div>
                      ) : (
                        <img 
                          src={item.actor.avatar || fallbackAvatar} 
                          alt="" 
                          className="w-7 h-7 rounded-full object-cover border border-zinc-100 dark:border-white/10 shrink-0" 
                        />
                      )}
                      <div className="flex flex-wrap items-center gap-x-1.5 text-[13px] min-w-0">
                        <span className="font-bold text-zinc-900 dark:text-white truncate">
                          {item.actor?.name || 'System'}
                        </span>
                        
                        {/* Dynamic category badge */}
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-zinc-200/60 dark:border-white/5 rounded-md bg-white dark:bg-slate-800 shadow-sm text-[10px] font-bold text-zinc-700 dark:text-slate-300 shrink-0">
                          <span className={`w-3.5 h-3.5 rounded flex items-center justify-center text-[10px] text-white ${config.color}`}>
                            {config.icon}
                          </span>
                          {config.label}
                        </span>
                      </div>

                      {/* Right-aligned actions on hover */}
                      {activeTab === 'Archive' ? (
                        <button 
                          onClick={(e) => handleDeleteNotification(e, item.id)}
                          className="ml-auto p-1 text-zinc-400 hover:text-rose-600 dark:hover:text-rose-455 hover:bg-zinc-100 dark:hover:bg-slate-700 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Delete permanently"
                        >
                          <Trash2 size={13} />
                        </button>
                      ) : (
                        <button 
                          onClick={(e) => handleArchive(e, item.id)}
                          className="ml-auto p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-slate-200 hover:bg-zinc-100 dark:hover:bg-slate-700 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Dismiss"
                        >
                          <ArchiveIcon size={14} />
                        </button>
                      )}
                    </div>

                    {/* Notification content body */}
                    <div className="mt-2 pl-9 text-[12px] text-zinc-600 dark:text-slate-300 font-medium leading-relaxed">
                      {item.message}
                    </div>

                    {/* Footer Row */}
                    <div className="flex items-center gap-2 pl-9 mt-1.5 text-[10px] text-zinc-400 dark:text-slate-500 font-semibold">
                      <span>{formatRelativeTime(item.created_at)}</span>
                      {item.link && (
                        <>
                          <span>&bull;</span>
                          <span className="text-indigo-600 dark:text-indigo-400 flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
                            View details
                            <ArrowRight size={10} />
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
};

export default NotificationPanel;
