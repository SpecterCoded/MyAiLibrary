import React, { useState, useEffect } from 'react';
import { X, User, Bell, Lock, Laptop } from 'lucide-react';
import { useAppContext } from '../AppContext';

type SettingsTab = 'account' | 'privacy' | 'settings' | 'notifications';

export function SettingsDialog() {
  const { settingsOpen, setSettingsOpen } = useAppContext();
  const [activeTab, setActiveTab] = useState<SettingsTab>('account');
  
  // Settings state
  const [name, setName] = useState('Navigation Architect');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  // Initialize from the real theme already applied on <html> so this dialog
  // never overrides the app-wide theme on mount (was hardcoded false, which
  // forced light mode whenever the notebook view mounted).
  const [darkMode, setDarkMode] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );

  // Load profile details from database
  useEffect(() => {
    if (!settingsOpen) return;
    const fetchProfile = async () => {
      try {
        const token = localStorage.getItem('access_token');
        if (!token) return;
        const res = await fetch('/me', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setName(data.username || 'Navigation Architect');
          setPhotoUrl(data.avatar_url || null);
        }
      } catch (err) {
        console.error('Failed to load profile in SettingsDialog:', err);
      }
    };
    fetchProfile();
  }, [settingsOpen]);

  const handleTogglePhoto = async () => {
    const nextUrl = photoUrl ? null : "https://api.dicebear.com/7.x/notionists/svg?seed=Felix";
    setPhotoUrl(nextUrl);

    try {
      const token = localStorage.getItem('access_token');
      if (!token) return;
      
      // 1. Update DB
      await fetch('/me/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ avatar_url: nextUrl })
      });

      // 2. Update localStorage for immediate local sync
      const userId = localStorage.getItem('user_id') || 'default_user';
      if (nextUrl) {
        localStorage.setItem(`user_avatar_${userId}`, nextUrl);
      } else {
        localStorage.removeItem(`user_avatar_${userId}`);
      }

      // 3. Dispatch storage event for other components to update
      window.dispatchEvent(new Event('storage'));
    } catch (err) {
      console.error('Failed to update avatar:', err);
    }
  };

  // Apply dark mode
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  if (!settingsOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setSettingsOpen(false)}>
      <div 
        className="flex w-full max-w-[800px] h-[600px] bg-white dark:bg-[#191919] rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-[240px] bg-[#F7F7F5] dark:bg-[#202020] border-r border-[#EFEFED] dark:border-gray-800 p-4 pt-6">
          <div className="font-semibold text-[11px] uppercase tracking-wider text-[#9A9A97] mb-3 px-2">Account</div>
          <div 
            className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[14px] cursor-pointer mb-1 transition-colors ${activeTab === 'account' ? 'bg-[#EFEFED] dark:bg-[#333] font-medium text-[#37352F] dark:text-gray-200' : 'hover:bg-[#EFEFED] dark:hover:bg-[#333] text-[#737373]'}`}
            onClick={() => setActiveTab('account')}
          >
             <User size={16} /> My account
          </div>
          <div 
            className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[14px] cursor-pointer mb-1 transition-colors ${activeTab === 'privacy' ? 'bg-[#EFEFED] dark:bg-[#333] font-medium text-[#37352F] dark:text-gray-200' : 'hover:bg-[#EFEFED] dark:hover:bg-[#333] text-[#737373]'}`}
            onClick={() => setActiveTab('privacy')}
          >
             <Lock size={16} /> Data privacy
          </div>
          
          <div className="font-semibold text-[11px] uppercase tracking-wider text-[#9A9A97] mt-8 mb-3 px-2">Workspace</div>
          <div 
            className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[14px] cursor-pointer mb-1 transition-colors ${activeTab === 'settings' ? 'bg-[#EFEFED] dark:bg-[#333] font-medium text-[#37352F] dark:text-gray-200' : 'hover:bg-[#EFEFED] dark:hover:bg-[#333] text-[#737373]'}`}
            onClick={() => setActiveTab('settings')}
          >
             <Laptop size={16} /> Settings
          </div>
          <div 
            className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[14px] cursor-pointer mb-1 transition-colors ${activeTab === 'notifications' ? 'bg-[#EFEFED] dark:bg-[#333] font-medium text-[#37352F] dark:text-gray-200' : 'hover:bg-[#EFEFED] dark:hover:bg-[#333] text-[#737373]'}`}
            onClick={() => setActiveTab('notifications')}
          >
             <Bell size={16} /> Notifications
          </div>
        </div>
        
        <div className="flex-1 flex flex-col p-10 bg-white dark:bg-[#191919] relative">
          <button className="absolute top-6 right-6 text-gray-400 hover:text-[#37352F] dark:hover:text-gray-200 transition-colors" onClick={() => setSettingsOpen(false)}>
            <X size={20} />
          </button>
          
          {activeTab === 'account' && (
            <>
              <h2 className="text-[20px] font-bold text-[#37352F] dark:text-white border-b border-[#EFEFED] dark:border-[#333] pb-4 mb-6">My account</h2>
              <div className="space-y-8">
                 <div>
                    <label className="block text-[11px] font-semibold text-[#9A9A97] mb-3 tracking-wider uppercase">Photo</label>
                    <div className="flex items-center gap-5">
                      <img src={photoUrl ? photoUrl : "https://avatar.vercel.sh/user"} className="w-[64px] h-[64px] rounded-full shadow-sm border border-gray-100 dark:border-gray-700" alt="profile" />
                      <button 
                        className="px-4 py-1.5 text-sm bg-white dark:bg-[#2A2A2A] border border-[#EFEFED] dark:border-gray-700 rounded text-[#37352F] dark:text-gray-200 shadow-sm hover:bg-[#F9F9F8] dark:hover:bg-[#333] font-medium transition-colors"
                        onClick={handleTogglePhoto}
                      >
                        {photoUrl ? 'Remove Photo' : 'Upload photo'}
                      </button>
                    </div>
                 </div>
                 
                 <div className="h-px bg-[#EFEFED] dark:bg-[#333] w-full mt-2 mb-2" />
                 
                 <div>
                    <label className="block text-[11px] font-semibold text-[#9A9A97] mb-3 tracking-wider uppercase">Email</label>
                    <div className="text-[14px] text-[#37352F] dark:text-gray-300 font-medium">sksmamwi38m@gmail.com</div>
                 </div>
                 <div>
                    <label className="block text-[11px] font-semibold text-[#9A9A97] mb-3 tracking-wider uppercase">Preferred Name</label>
                    <input 
                      type="text" 
                      className="w-full max-w-sm px-3 py-2 border border-[#EFEFED] dark:border-gray-700 dark:bg-[#2A2A2A] dark:text-gray-200 rounded-md text-sm outline-none focus:border-blue-400 focus:shadow-[0_0_0_2px_rgba(59,130,246,0.2)] transition-all font-medium text-[#37352F]" 
                      value={name} 
                      onChange={(e) => setName(e.target.value)}
                    />
                 </div>
              </div>
            </>
          )}

          {activeTab === 'privacy' && (
            <>
              <h2 className="text-[20px] font-bold text-[#37352F] dark:text-white border-b border-[#EFEFED] dark:border-[#333] pb-4 mb-6">Data Privacy</h2>
              <div className="space-y-6">
                 <div>
                    <h3 className="text-[14px] font-medium text-[#37352F] dark:text-gray-200 mb-1">Analytics</h3>
                    <p className="text-[12px] text-[#9A9A97] mb-3">Allow us to collect usage data to improve the app.</p>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" className="w-4 h-4 rounded border-gray-300" defaultChecked />
                      <span className="text-[14px] text-[#37352F] dark:text-gray-300">Enable Analytics</span>
                    </label>
                 </div>
                 <div className="h-px bg-[#EFEFED] dark:bg-[#333] w-full" />
                 <div>
                    <h3 className="text-[14px] font-medium text-[#37352F] dark:text-gray-200 mb-1">Delete Account</h3>
                    <p className="text-[12px] text-[#9A9A97] mb-3">Permanently delete your account and all your data.</p>
                    <button className="px-4 py-1.5 text-sm bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/50 rounded text-red-600 dark:text-red-400 shadow-sm hover:bg-red-100 font-medium transition-colors">
                      Delete Account
                    </button>
                 </div>
              </div>
            </>
          )}

          {activeTab === 'settings' && (
            <>
              <h2 className="text-[20px] font-bold text-[#37352F] dark:text-white border-b border-[#EFEFED] dark:border-[#333] pb-4 mb-6">Workspace Settings</h2>
              <div className="space-y-6">
                 <div>
                    <h3 className="text-[14px] font-medium text-[#37352F] dark:text-gray-200 mb-1">Appearance</h3>
                    <p className="text-[12px] text-[#9A9A97] mb-3">Choose the theme for your workspace.</p>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="theme" checked={!darkMode} onChange={() => setDarkMode(false)} className="w-4 h-4" />
                        <span className="text-[14px] text-[#37352F] dark:text-gray-300">Light</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="theme" checked={darkMode} onChange={() => setDarkMode(true)} className="w-4 h-4" />
                        <span className="text-[14px] text-[#37352F] dark:text-gray-300">Dark</span>
                      </label>
                    </div>
                 </div>
                 <div className="h-px bg-[#EFEFED] dark:bg-[#333] w-full" />
                 <div>
                    <h3 className="text-[14px] font-medium text-[#37352F] dark:text-gray-200 mb-1">Language mapping</h3>
                    <p className="text-[12px] text-[#9A9A97] mb-3">Change the primary language of the UI.</p>
                    <select className="px-3 py-2 border border-[#EFEFED] dark:border-gray-700 bg-white dark:bg-[#2A2A2A] rounded-md text-[14px] outline-none w-64 text-[#37352F] dark:text-gray-200">
                      <option>English</option>
                      <option>Spanish</option>
                      <option>French</option>
                      <option>German</option>
                    </select>
                 </div>
              </div>
            </>
          )}

          {activeTab === 'notifications' && (
            <>
              <h2 className="text-[20px] font-bold text-[#37352F] dark:text-white border-b border-[#EFEFED] dark:border-[#333] pb-4 mb-6">Notifications</h2>
              <div className="space-y-6">
                 <div>
                    <h3 className="text-[14px] font-medium text-[#37352F] dark:text-gray-200 mb-1">Email Notifications</h3>
                    <p className="text-[12px] text-[#9A9A97] mb-3">Receive email updates about activity in your workspace.</p>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 rounded border-gray-300" 
                        checked={notificationsEnabled} 
                        onChange={() => setNotificationsEnabled(!notificationsEnabled)}
                      />
                      <span className="text-[14px] text-[#37352F] dark:text-gray-300">{notificationsEnabled ? 'Enabled' : 'Disabled'}</span>
                    </label>
                 </div>
                 <div className="h-px bg-[#EFEFED] dark:bg-[#333] w-full" />
                 <div>
                    <h3 className="text-[14px] font-medium text-[#37352F] dark:text-gray-200 mb-1">Push Notifications</h3>
                    <p className="text-[12px] text-[#9A9A97] mb-3">Receive desktop notifications.</p>
                    <button className="px-4 py-1.5 text-sm bg-white dark:bg-[#2A2A2A] border border-[#EFEFED] dark:border-gray-700 rounded text-[#37352F] dark:text-gray-200 shadow-sm hover:bg-[#F9F9F8] dark:hover:bg-[#333] font-medium transition-colors">
                      Enable Desktop Notifications
                    </button>
                 </div>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
