import React, { useState } from 'react';
import type { AuthContextType } from '../../../App';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { ArrowLeft, KeyRound } from 'lucide-react';

export function ForgotPassword({ ctx }: { ctx: AuthContextType }) {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ctx.email) {
      setError('Email is required');
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(ctx.email)) {
      setError('Must be a valid email');
      return;
    }
    
    setError('');
    setLoading(true);
    try {
      const { auth } = await import('../../../firebase');
      const { sendPasswordResetEmail } = await import('firebase/auth');
      await sendPasswordResetEmail(auth, ctx.email.trim());
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || 'Failed to request password reset.');
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="w-full">
      <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center mb-6 shadow-sm border border-gray-200">
        <KeyRound className="w-6 h-6 text-gray-700" />
      </div>

      <h2 className="text-3xl font-semibold mb-2">Forgot password?</h2>
      <p className="text-gray-500 mb-8">
        No worries, we'll send you reset instructions.
      </p>

      {!submitted ? (
        <form onSubmit={handleSubmit} className="space-y-6">
          <Input
            label="Email"
            type="email"
            placeholder="Enter your email"
            value={ctx.email}
            onChange={(e) => ctx.setEmail(e.target.value)}
            error={error}
          />

          <Button type="submit" disabled={loading} className="text-base">
            {loading ? 'Sending link...' : 'Reset password'}
          </Button>
        </form>
      ) : (
        <div className="space-y-6">
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-800 text-sm">
            We've sent a password reset link to <span className="font-semibold">{ctx.email}</span>. Please check your inbox and follow the instructions to reset your password.
          </div>
        </div>
      )}

      <div className="mt-8 flex justify-center">
        <button 
          onClick={() => ctx.setView('login')}
          className="text-sm font-semibold flex items-center gap-2 text-gray-500 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to log in
        </button>
      </div>
    </div>
  );
}
