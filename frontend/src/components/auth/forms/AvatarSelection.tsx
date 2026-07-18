import React, { useState } from 'react';
import type { AuthContextType } from '../../../App';
import { Button } from '../ui/Button';
import { ArrowLeft } from 'lucide-react';

const SEEDS = ['Felix', 'Jack', 'Leo', 'Max', 'Oscar', 'Luna', 'Bella', 'Mia', 'Chloe', 'Lily'];

export function AvatarSelection({ ctx }: { ctx: AuthContextType }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = (seed: string) => {
    ctx.setAvatar(`https://api.dicebear.com/7.x/notionists/svg?seed=${seed}`);
  };

  const registerUserAndProceed = async (avatarUrl: string) => {
    setError(null);
    setLoading(true);
    try {
      const tempSignupStr = sessionStorage.getItem('temp_signup');
      if (!tempSignupStr) {
        throw new Error('Onboarding signup session expired. Please restart signup.');
      }
      const tempSignup = JSON.parse(tempSignupStr);

      // Use Firebase Auth
      const { auth } = await import('../../../firebase');
      const { createUserWithEmailAndPassword, updateProfile, sendEmailVerification } = await import('firebase/auth');

      // 1. Create account on Firebase
      const userCredential = await createUserWithEmailAndPassword(auth, tempSignup.email.trim(), tempSignup.password);
      
      // 2. Update Firebase display name
      await updateProfile(userCredential.user, { displayName: tempSignup.username.trim() });
      
      // 3. Send email verification link
      await sendEmailVerification(userCredential.user);
      
      // 4. Save avatar temporarily in sessionStorage
      sessionStorage.setItem('temp_avatar', avatarUrl);
      
      // 5. Navigate to verification screen
      ctx.setView('verify');
    } catch (err: any) {
      setError(err.message || 'Failed to complete account registration.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ctx.avatar) return;
    await registerUserAndProceed(ctx.avatar);
  };

  const handleSkip = async () => {
    const PALETTES = [
      'fdf6e2', // Cream
      'e3faf2', // Mint
      'e8eafe', // Indigo Lavender
      'ffebec', // Pink Rose
      'fff4e6', // Soft Orange
      'f3f0fc', // Lilac
      'e6f4ea', // Pastel Green
      'fce8e6', // Soft Red
      'e8f0fe', // Light Blue
      'fef7e0'  // Pastel Yellow
    ];
    const randomBg = PALETTES[Math.floor(Math.random() * PALETTES.length)];
    const initialsAvatar = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(ctx.name || 'User')}&backgroundColor=${randomBg}`;
    
    ctx.setAvatar(initialsAvatar);
    await registerUserAndProceed(initialsAvatar);
  };

  return (
    <div className="w-full">
      <button 
        onClick={() => ctx.setView('signup')}
        className="w-10 h-10 -ml-2 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-colors mb-4"
        aria-label="Go back"
      >
        <ArrowLeft className="w-5 h-5" />
      </button>

      <h2 className="text-3xl font-semibold mb-2">Choose an avatar</h2>
      <p className="text-gray-500 mb-8">Personalize your profile with an avatar.</p>

      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="grid grid-cols-5 gap-3">
          {SEEDS.map((seed) => {
            const url = `https://api.dicebear.com/7.x/notionists/svg?seed=${seed}`;
            const isSelected = ctx.avatar === url;
            
            return (
              <button
                key={seed}
                type="button"
                onClick={() => handleSelect(seed)}
                className={`relative aspect-square rounded-2xl border-2 overflow-hidden transition-all duration-200 ${
                  isSelected 
                    ? 'border-blue-600 ring-4 ring-blue-600/20 bg-blue-50/50' 
                    : 'border-transparent bg-gray-50 hover:bg-gray-100 hover:scale-105'
                }`}
              >
                <img 
                  src={url} 
                  alt={`Avatar option ${seed}`} 
                  className="w-full h-full object-cover p-2"
                />
              </button>
            );
          })}
        </div>

        {error && (
          <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg border border-red-200">
            {error}
          </div>
        )}

        <Button 
          type="submit" 
          disabled={!ctx.avatar || loading}
          className="text-base"
        >
          {loading ? 'Saving avatar...' : 'Continue'}
        </Button>
      </form>

      <div className="mt-6 flex justify-center">
        <button 
          onClick={handleSkip}
          disabled={loading}
          className="text-sm font-semibold text-gray-500 hover:text-gray-900 disabled:opacity-50"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
