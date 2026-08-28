import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { GoogleLoginButton } from './GoogleLoginButton';
import { CopyableId } from '../common/CopyableId';
import { SignOutConfirmModal } from '../common/SignOutConfirmModal';
import { Key, ShieldCheck, LogOut, CheckCircle, Mail, Clock } from 'lucide-react';

export const AuthenticationView: React.FC = () => {
  const { user, session, signOut } = useAuth();
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleConfirmSignOut = async () => {
    try {
      setIsSigningOut(true);
      await signOut();
    } finally {
      setIsSigningOut(false);
      setShowConfirm(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-5 sm:p-6 space-y-2">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-xl">
            <Key className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white flex items-center space-x-2">
              <span>Authentication & Session Management</span>
            </h2>
            <p className="text-xs text-slate-400">
              Google OAuth 2.0 integration and authenticated Supabase session status.
            </p>
          </div>
        </div>
      </div>

      {user ? (
        <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-700/60">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg">
                <CheckCircle className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-bold text-white">Google OAuth Session Active</div>
                <div className="text-xs text-slate-400 font-mono">{user.email}</div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowConfirm(true)}
              className="px-4 py-2 bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-200 rounded-lg text-xs font-semibold transition-all flex items-center space-x-2 w-fit"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>

          {/* Session Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3.5 bg-slate-900 rounded-lg border border-slate-800 space-y-1">
              <span className="text-slate-400">Auth Provider</span>
              <div className="font-bold text-amber-400 font-mono">
                {user.app_metadata?.provider || 'google'}
              </div>
            </div>

            <div className="p-3.5 bg-slate-900 rounded-lg border border-slate-800 space-y-1">
              <span className="text-slate-400">Token Expiration</span>
              <div className="font-bold text-slate-200 font-mono flex items-center space-x-1">
                <Clock className="w-3 h-3 text-slate-400" />
                <span>
                  {session?.expires_at ? new Date(session.expires_at * 1000).toLocaleTimeString() : 'Active'}
                </span>
              </div>
            </div>
          </div>

          <div className="p-4 bg-slate-900 rounded-lg border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-400">Auth User UID</span>
            <CopyableId id={user.id} label="UID" />
          </div>
        </div>
      ) : (
        <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-8 text-center space-y-4">
          <Key className="w-8 h-8 text-slate-500 mx-auto" />
          <div>
            <h3 className="text-sm font-bold text-white">No Active Session</h3>
            <p className="text-xs text-slate-400 mt-1">Please sign in with your authorized Google account.</p>
          </div>
          <div className="max-w-xs mx-auto">
            <GoogleLoginButton />
          </div>
        </div>
      )}

      {/* Sign Out Confirmation Modal */}
      <SignOutConfirmModal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleConfirmSignOut}
        isSigningOut={isSigningOut}
      />
    </div>
  );
};
