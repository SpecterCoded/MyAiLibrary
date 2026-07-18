import React, { useEffect, useState } from 'react';
import type { AuthContextType } from '../../../App';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { CheckCircle2, ShieldAlert, KeyRound, Loader2 } from 'lucide-react';
import { auth } from '../../../firebase';
import { applyActionCode, confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';

interface ActionHandlerProps {
  ctx: AuthContextType;
  mode: string;
  oobCode: string;
}

export function ActionHandler({ ctx, mode, oobCode }: ActionHandlerProps) {
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Reset password state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdFocused, setPwdFocused] = useState(false);
  const [emailForReset, setEmailForReset] = useState('');

  // Password strength helper
  const getPwdStrength = () => {
    let score = 0;
    if (newPassword.length > 0) score += 1;
    if (newPassword.length >= 8) score += 1;
    if (/[A-Z]/.test(newPassword) || /[0-9]/.test(newPassword)) score += 1;
    if (/[^A-Za-z0-9]/.test(newPassword)) score += 1;
    return Math.min(4, score);
  };

  useEffect(() => {
    if (mode === 'verifyEmail') {
      handleVerifyEmail();
    } else if (mode === 'resetPassword') {
      handleVerifyResetCode();
    } else {
      setError('Invalid action mode.');
      setLoading(false);
    }
  }, [mode, oobCode]);

  const handleVerifyEmail = async () => {
    try {
      await applyActionCode(auth, oobCode);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to verify email. The code may be expired or already used.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyResetCode = async () => {
    try {
      const email = await verifyPasswordResetCode(auth, oobCode);
      setEmailForReset(email);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Invalid or expired password reset link.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await confirmPasswordReset(auth, oobCode, newPassword);
      setSuccess(true);
      // Clear URL query parameters
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (err: any) {
      setError(err.message || 'Failed to reset password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoToLogin = () => {
    // Clear URL parameters
    window.history.replaceState({}, document.title, window.location.pathname);
    ctx.setView('login');
  };

  // Rendering Loader State
  if (loading && mode === 'verifyEmail') {
    return (
      <div className="w-full max-w-md mx-auto text-center py-12">
        <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
        <h3 className="text-xl font-semibold text-gray-900">Verifying your email...</h3>
        <p className="text-gray-500 text-sm mt-2">Please wait while we confirm your verification code.</p>
      </div>
    );
  }

  // Rendering Email Verification Success / Failure
  if (mode === 'verifyEmail') {
    return (
      <div className="w-full max-w-md mx-auto">
        <div className="bg-white rounded-3xl border border-gray-100 shadow-xl shadow-gray-100/50 p-8 text-center relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl -mr-10 -mt-10"></div>
          
          {success ? (
            <>
              <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-6 shadow-inner">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3">Email verified!</h2>
              <p className="text-gray-500 text-sm sm:text-base leading-relaxed mb-8">
                Your email address has been successfully verified. You can now access all features of TraderBox.
              </p>
              <Button 
                onClick={handleGoToLogin}
                className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl shadow-lg shadow-emerald-500/20 active:scale-[0.98] transition-all"
              >
                Sign in to your account
              </Button>
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-6">
                <ShieldAlert className="w-10 h-10" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3">Verification failed</h2>
              <p className="text-gray-500 text-sm sm:text-base leading-relaxed mb-6">
                {error || 'The verification link is invalid, expired, or has already been used.'}
              </p>
              <Button 
                onClick={handleGoToLogin}
                variant="outline"
                className="w-full py-3 rounded-xl"
              >
                Back to sign in
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  // Rendering Password Reset Flow
  if (mode === 'resetPassword') {
    const resetComplete = success && !loading && !emailForReset;

    if (loading && !emailForReset) {
      return (
        <div className="w-full max-w-md mx-auto text-center py-12">
          <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-900">Checking reset link...</h3>
        </div>
      );
    }

    if (error && !emailForReset) {
      return (
        <div className="w-full max-w-md mx-auto">
          <div className="bg-white rounded-3xl border border-gray-100 shadow-xl shadow-gray-100/50 p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-6">
              <ShieldAlert className="w-10 h-10" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">Invalid reset link</h2>
            <p className="text-gray-500 text-sm mb-6">{error}</p>
            <Button onClick={handleGoToLogin} variant="outline" className="w-full py-3 rounded-xl">
              Back to log in
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="w-full max-w-md mx-auto">
        <div className="bg-white rounded-3xl border border-gray-100 shadow-xl shadow-gray-100/50 p-6 sm:p-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl -mr-10 -mt-10"></div>
          
          {resetComplete ? (
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3">Password updated!</h2>
              <p className="text-gray-500 text-sm sm:text-base leading-relaxed mb-8">
                Your password has been successfully reset. You can now log in using your new credentials.
              </p>
              <Button 
                onClick={handleGoToLogin}
                className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl shadow-lg shadow-blue-500/20 active:scale-[0.98] transition-all"
              >
                Log in to TraderBox
              </Button>
            </div>
          ) : (
            <div>
              <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center mb-6">
                <KeyRound className="w-6 h-6 text-blue-600" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2 tracking-tight">Create new password</h2>
              <p className="text-gray-500 text-sm sm:text-base mb-6">
                Setting a password for <span className="font-semibold text-gray-700">{emailForReset}</span>
              </p>

              {error && (
                <div className="mb-6 p-4 text-sm text-red-700 bg-red-50 rounded-xl border border-red-100 flex items-start gap-2 text-left">
                  <ShieldAlert className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleResetPasswordSubmit} className="space-y-5">
                <div className="space-y-1">
                  <Input
                    label="New Password"
                    type="password"
                    placeholder="Enter new password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    onFocus={() => setPwdFocused(true)}
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
                      <p className="text-xs text-gray-500">Must be at least 8 characters.</p>
                    </div>
                  )}
                </div>

                <Input
                  label="Confirm Password"
                  type="password"
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />

                <Button 
                  type="submit" 
                  disabled={loading}
                  className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl shadow-lg active:scale-[0.98] transition-all"
                >
                  {loading ? 'Updating password...' : 'Reset password'}
                </Button>
              </form>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
