import React, { useState } from 'react';
import type { AuthContextType } from '../../../App';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { logActivity } from '../../../utils/activityLogger';

export function LoginForm({ ctx }: { ctx: AuthContextType }) {
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [rememberMe, setRememberMe] = useState(() => {
    return localStorage.getItem('remember_me') === 'true';
  });

  const validate = () => {
    const newErrors: typeof errors = {};
    if (!ctx.email) newErrors.email = 'Email or Username is required';
    if (!password) newErrors.password = 'Password is required';
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!validate()) return;

    setLoading(true);
    try {
      let targetEmail = ctx.email.trim();
      if (!targetEmail.includes('@')) {
        const resolveRes = await fetch(`/auth/resolve-email?username_or_email=${encodeURIComponent(targetEmail)}`);
        if (!resolveRes.ok) {
          throw new Error('Username not found');
        }
        const resolveData = await resolveRes.json();
        targetEmail = resolveData.email;
      }

      const { auth } = await import('../../../firebase');
      const { signInWithEmailAndPassword, setPersistence, browserLocalPersistence, browserSessionPersistence } = await import('firebase/auth');

      localStorage.setItem('remember_me', rememberMe.toString());
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);

      const userCredential = await signInWithEmailAndPassword(auth, targetEmail, password);
      
      if (!userCredential.user.emailVerified) {
        throw new Error('Please verify your email address before logging in.');
      }

      const firebaseToken = await userCredential.user.getIdToken();
      
      // Exchange Firebase token for backend JWT tokens (with longer lifetime)
      const sessionRes = await fetch('/auth/firebase-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firebase_token: firebaseToken,
          remember_me: rememberMe,
        }),
      });

      if (!sessionRes.ok) {
        const errData = await sessionRes.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to create session');
      }

      const sessionData = await sessionRes.json();
      
      // Store backend JWT tokens (these last 2 days or 30 days with remember_me)
      localStorage.setItem('access_token', sessionData.access_token);
      localStorage.setItem('refresh_token', sessionData.refresh_token);

      // Store user details
      if (sessionData.user) {
        localStorage.setItem('user_id', sessionData.user.id);
        localStorage.setItem('username', sessionData.user.username);
        localStorage.setItem('email', sessionData.user.email);
        ctx.setName(sessionData.user.username);
      } else {
        // Fallback: fetch user profile
        const profileResponse = await fetch('/me', {
          headers: { 'Authorization': `Bearer ${sessionData.access_token}` }
        });
        if (profileResponse.ok) {
          const profileData = await profileResponse.json();
          localStorage.setItem('user_id', profileData.user_id);
          localStorage.setItem('username', profileData.username);
          localStorage.setItem('email', profileData.email);
          ctx.setName(profileData.username);
        }
      }

      logActivity('auth', 'Logged in', targetEmail);
      ctx.onLoginSuccess();
    } catch (err: any) {
      if (err.code === 'auth/invalid-credential') {
        setSubmitError('Invalid email or password');
      } else {
        setSubmitError(err.message || 'An error occurred during log in');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      <h2 className="text-3xl font-semibold mb-2">Log in to your account</h2>
      <p className="text-gray-500 mb-8">Welcome back! Please enter your details.</p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <Input
          label="Email | Username"
          type="text"
          placeholder="Enter your email or username"
          value={ctx.email}
          onChange={(e) => ctx.setEmail(e.target.value)}
          error={errors.email}
        />
        
        <div className="flex flex-col gap-4">
          <Input
            label="Password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            enablePasswordToggle={true}
          />
          <div className="flex items-center justify-between mt-1">
            <div className="flex items-center">
              <label htmlFor="remember" className="flex items-center cursor-pointer group">
                <div className="relative flex items-center">
                  <input 
                    id="remember" 
                    type="checkbox" 
                    className="peer sr-only" 
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  <div className="h-5 w-5 rounded-md border-2 border-gray-300 bg-white group-hover:border-blue-500 peer-checked:border-blue-600 peer-checked:bg-blue-600 transition-all flex items-center justify-center shadow-sm">
                    <svg className="w-3.5 h-3.5 text-white opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                </div>
                <span className="ml-2.5 block text-sm font-medium text-gray-700 select-none group-hover:text-gray-900 transition-colors">
                  Remember for 30 days
                </span>
              </label>
            </div>
            <button 
              type="button" 
              onClick={() => ctx.setView('forgot')}
              className="text-sm font-semibold text-blue-600 hover:text-blue-700"
            >
              Forgot password?
            </button>
          </div>
        </div>

        {submitError && (
          <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg border border-red-200">
            {submitError}
          </div>
        )}

        <Button type="submit" disabled={loading} className="mt-2 text-base">
          {loading ? 'Signing in...' : 'Sign in'}
        </Button>
        <Button 
          type="button" 
          variant="outline" 
          className="text-base flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          Sign in with Google
        </Button>
      </form>

      <p className="mt-8 text-center text-sm text-gray-500">
        Don't have an account?{' '}
        <button 
          onClick={() => ctx.setView('signup')}
          className="font-semibold text-blue-600 hover:text-blue-500"
        >
          Sign up
        </button>
      </p>
    </div>
  );
}