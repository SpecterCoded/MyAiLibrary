import React, { useState, useEffect } from 'react';
import type { AuthContextType } from '../../../App';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { logActivity } from '../../../utils/activityLogger';

export function SignupForm({ ctx }: { ctx: AuthContextType }) {
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string; name?: string }>({});
  const [userFocused, setUserFocused] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [pwdFocused, setPwdFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [isUsernameAvailable, setIsUsernameAvailable] = useState<boolean | null>(null);
  const [isEmailAvailable, setIsEmailAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    if (ctx.name.trim().length < 4) {
      setIsUsernameAvailable(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/auth/check-username?username=${encodeURIComponent(ctx.name.trim())}`, {
          signal: controller.signal
        });
        if (response.ok) {
          const data = await response.json();
          setIsUsernameAvailable(data.available);
        }
      } catch (err) {
        // ignore abort or fetch errors
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [ctx.name]);

  useEffect(() => {
    if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(ctx.email)) {
      setIsEmailAvailable(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/auth/check-email?email=${encodeURIComponent(ctx.email.trim())}`, {
          signal: controller.signal
        });
        if (response.ok) {
          const data = await response.json();
          setIsEmailAvailable(data.available);
        }
      } catch (err) {
        // ignore abort or fetch errors
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [ctx.email]);

  const getUsernameStatus = () => {
    if (!ctx.name.trim()) return 'none';
    if (ctx.name.trim().length < 4) return 'invalid';
    if (isUsernameAvailable === false) return 'invalid';
    return 'valid';
  };

  const getEmailStatus = () => {
    if (!ctx.email.trim()) return 'none';
    if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(ctx.email)) return 'invalid';
    if (isEmailAvailable === false) return 'invalid';
    return 'valid';
  };

  const getPwdStrength = () => {
    let score = 0;
    if (password.length > 0) score += 1;
    if (password.length >= 8) score += 1;
    if (/[A-Z]/.test(password) || /[0-9]/.test(password)) score += 1;
    if (/[^A-Za-z0-9]/.test(password)) score += 1;
    return Math.min(4, score);
  };

  const getPasswordStatus = () => {
    if (!password) return 'none';
    if (!pwdFocused && !password) return 'none';
    if (password.length < 8) return 'invalid';
    return 'valid';
  };

  const validate = () => {
    const newErrors: typeof errors = {};
    if (!ctx.name.trim()) newErrors.name = 'Username is required';
    else if (ctx.name.trim().length < 4) newErrors.name = 'Must be at least 4 characters';
    else if (isUsernameAvailable === false) newErrors.name = 'Username already taken';

    if (!ctx.email) newErrors.email = 'Email is required';
    else if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(ctx.email)) newErrors.email = 'Must be a valid email';
    else if (isEmailAvailable === false) newErrors.email = 'Email already exists';

    if (!password) newErrors.password = 'Password is required';
    else if (password.length < 8) newErrors.password = 'Must be at least 8 characters';
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!validate()) return;

    setLoading(true);
    try {
      // Temporarily store signup info in sessionStorage. 
      // The account will only be written to DB once storage path setup is fully completed.
      sessionStorage.setItem('temp_signup', JSON.stringify({
        username: ctx.name.trim(),
        email: ctx.email.trim(),
        password: password
      }));

      logActivity('auth', 'Signed up', ctx.email.trim());
      // Proceed to avatar selection
      ctx.setView('avatar');
    } catch (err: any) {
      setSubmitError(err.message || 'An error occurred during signup');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      <h2 className="text-3xl font-semibold mb-2">Create an account</h2>
      <p className="text-gray-500 mb-8">Start your 30-day free trial.</p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <Input
          label="Username"
          type="text"
          placeholder="Enter your username"
          value={ctx.name}
          onChange={(e) => ctx.setName(e.target.value)}
          onFocus={() => setUserFocused(true)}
          error={errors.name}
          validationState={getUsernameStatus()}
        />
        
        <Input
          label="Email"
          type="email"
          placeholder="Enter your email"
          value={ctx.email}
          onChange={(e) => ctx.setEmail(e.target.value)}
          onFocus={() => setEmailFocused(true)}
          error={errors.email}
          validationState={getEmailStatus()}
        />
        
        <div className="space-y-1">
          <Input
            label="Password"
            type="password"
            placeholder="Create a password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onFocus={() => setPwdFocused(true)}
            error={errors.password}
            validationState={getPasswordStatus()}
            enablePasswordToggle={true}
          />
          {pwdFocused && (
            <div className="pt-2 px-1">
              <div className="flex gap-1 h-1.5 w-full mb-2">
                {[1, 2, 3, 4].map((level) => (
                  <div 
                    key={level} 
                    className={`h-full flex-1 rounded-full transition-colors ${level <= getPwdStrength() ? (getPwdStrength() < 2 ? 'bg-red-500' : getPwdStrength() < 3 ? 'bg-orange-500' : getPwdStrength() < 4 ? 'bg-yellow-500' : 'bg-green-500') : 'bg-gray-200'}`} 
                  />
                ))}
              </div>
            </div>
          )}
          <p className="text-sm text-gray-500 pl-1">Must be at least 8 characters.</p>
        </div>

        {submitError && (
          <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg border border-red-200">
            {submitError}
          </div>
        )}

        <Button type="submit" disabled={loading} className="mt-2 text-base">
          {loading ? 'Creating account...' : 'Get started'}
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
          Sign up with Google
        </Button>
      </form>

      <p className="mt-8 text-center text-sm text-gray-500">
        Already have an account?{' '}
        <button 
          onClick={() => ctx.setView('login')}
          className="font-semibold text-blue-600 hover:text-blue-500"
        >
          Log in
        </button>
      </p>
    </div>
  );
}
