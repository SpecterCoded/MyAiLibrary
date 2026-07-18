import React, { useState } from 'react';
import type { AuthContextType } from '../../../App';
import { Button } from '../ui/Button';
import { ArrowLeft, Mail, RefreshCw, CheckCircle2, ShieldAlert } from 'lucide-react';
import { auth } from '../../../firebase';
import { sendEmailVerification } from 'firebase/auth';

export function EmailVerification({ ctx }: { ctx: AuthContextType }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [verified, setVerified] = useState(false);

  const handleCheckVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    setChecking(true);
    setError(null);
    try {
      if (auth.currentUser) {
        await auth.currentUser.reload();
        
        if (auth.currentUser.emailVerified) {
          const idToken = await auth.currentUser.getIdToken();
          await fetch('/auth/complete-signup', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${idToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              username: ctx.name || ctx.email?.split('@')[0] || 'user',
              avatar_url: ctx.avatar || '',
            }),
          });
          setVerified(true);
          setTimeout(() => {
            ctx.setView('login');
            ctx.setAvatar('');
            ctx.setEmail('');
            ctx.setName('');
          }, 2000);
        } else {
          setError("Verification not detected yet. Please click the link in your email and try again.");
        }
      } else {
        setError("No user session found. Please sign up or log in again.");
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred while checking verification status');
    } finally {
      setChecking(false);
    }
  };

  const handleResend = async () => {
    setLoading(true);
    setError(null);
    setResendMessage(null);
    try {
      if (auth.currentUser) {
        await sendEmailVerification(auth.currentUser);
        setResendMessage('Verification link resent successfully. Please check your inbox.');
      } else {
        setError("No active user session to resend email.");
      }
    } catch (err: any) {
      setError(err.message || 'Failed to resend verification link');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Back Button */}
      <button 
        onClick={() => ctx.setView('avatar')}
        className="group mb-6 inline-flex items-center gap-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
        aria-label="Go back"
      >
        <div className="w-8 h-8 rounded-full border border-gray-200 dark:border-gray-700 flex items-center justify-center group-hover:bg-gray-50 dark:group-hover:bg-gray-800 group-hover:border-gray-300 dark:group-hover:border-gray-600 transition-all">
          <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
        </div>
        <span>Back</span>
      </button>

      {/* Main Card */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-gray-100 dark:border-gray-800 shadow-xl shadow-gray-100/50 dark:shadow-black/20 p-6 sm:p-8 relative overflow-hidden">
        {/* Animated Background Blob */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 dark:bg-blue-500/10 rounded-full blur-3xl -mr-10 -mt-10"></div>
        
        <div className="relative flex flex-col items-center text-center">
          {/* Success State */}
          {verified ? (
            <>
              <div className="relative mb-6">
                <div className="absolute inset-0 bg-emerald-500/20 dark:bg-emerald-500/30 rounded-2xl blur-md scale-95"></div>
                <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-tr from-emerald-500 to-green-400 flex items-center justify-center text-white shadow-lg shadow-emerald-500/30">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-3 tracking-tight">
                Email verified!
              </h2>
              <p className="text-gray-500 dark:text-gray-400 text-sm sm:text-base leading-relaxed mb-6">
                Redirecting you to login...
              </p>
              <div className="w-full py-4 flex flex-col items-center justify-center gap-2 text-emerald-600 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-500/10 rounded-xl border border-emerald-100 dark:border-emerald-500/20">
                <RefreshCw className="w-5 h-5 animate-spin" />
                <span className="text-xs font-semibold">Taking you to sign in...</span>
              </div>
            </>
          ) : (
            <>
              {/* Animated Mail Icon Container */}
              <div className="relative mb-6">
                <div className="absolute inset-0 bg-blue-500/20 dark:bg-blue-500/30 rounded-2xl blur-md scale-95 animate-pulse"></div>
                <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-lg shadow-blue-500/30">
                  <Mail className="w-8 h-8 animate-[bounce_2s_infinite]" />
                </div>
                <span className="absolute -top-1 -right-1 flex h-4 w-4">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-4 w-4 bg-blue-500"></span>
                </span>
              </div>

              {/* Title and Description */}
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-3 tracking-tight">
                Verify your email
              </h2>
              <p className="text-gray-500 dark:text-gray-400 text-sm sm:text-base leading-relaxed mb-6">
                We sent a verification link to your email address:
              </p>

              {/* Styled Email Pill */}
              <div className="w-full bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-3 border border-gray-100 dark:border-gray-700/80 mb-6 flex items-center justify-center gap-2 select-all font-mono text-sm text-gray-800 dark:text-gray-200 break-all">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                {ctx.email || 'your-email@example.com'}
              </div>

              {/* Checking Status Overlay / Loader */}
              {checking && (
                <div className="w-full py-4 flex flex-col items-center justify-center gap-2 text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-500/10 rounded-xl mb-4 border border-blue-100 dark:border-blue-500/20">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span className="text-xs font-semibold">Checking verification status...</span>
                </div>
              )}

              {/* Error Messages */}
              {error && (
                <div className="w-full mb-6 p-4 text-sm text-red-700 dark:text-red-400 bg-red-50/80 dark:bg-red-500/10 backdrop-blur-sm rounded-xl border border-red-100 dark:border-red-500/20 flex items-start gap-2.5 text-left">
                  <ShieldAlert className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {resendMessage && (
                <div className="w-full mb-6 p-4 text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-50/80 dark:bg-emerald-500/10 backdrop-blur-sm rounded-xl border border-emerald-100 dark:border-emerald-500/20 flex items-start gap-2.5 text-left">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                  <span>{resendMessage}</span>
                </div>
              )}

              {/* Action Button */}
              <form onSubmit={handleCheckVerification} className="w-full space-y-4">
                <Button 
                  type="submit" 
                  disabled={checking || loading}
                  className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl shadow-lg shadow-blue-500/20 active:scale-[0.98] transition-all duration-200"
                >
                  {checking ? 'Checking status...' : 'I have verified my email'}
                </Button>
              </form>

              {/* Resend Action */}
              <div className="mt-6 text-sm text-gray-500 dark:text-gray-400">
                Didn't receive the email?{' '}
                <button 
                  onClick={handleResend}
                  disabled={loading || checking}
                  className="font-bold text-blue-600 dark:text-blue-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors disabled:opacity-50"
                >
                  Click to resend
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Bottom Option */}
      <div className="mt-8 flex justify-center">
        <button 
          onClick={() => ctx.setView('login')}
          className="inline-flex items-center gap-2 text-sm font-semibold text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to log in</span>
        </button>
      </div>
    </div>
  );
}