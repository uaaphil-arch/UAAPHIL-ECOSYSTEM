import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { CopyableId } from '../common/CopyableId';
import { 
  Database, 
  ChevronDown, 
  ChevronRight
} from 'lucide-react';

interface DiagnosticSectionProps {
  title: string;
  badge?: string;
  badgeColor?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

const DiagnosticSection: React.FC<DiagnosticSectionProps> = ({
  title,
  badge,
  badgeColor = 'bg-slate-800 text-slate-300 border-slate-700',
  children,
  defaultOpen = false,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-800/40 transition-colors text-left"
      >
        <div className="flex items-center space-x-2.5">
          {isOpen ? (
            <ChevronDown className="w-4 h-4 text-amber-400 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-500 flex-shrink-0" />
          )}
          <span className="text-xs sm:text-sm font-bold text-slate-100">{title}</span>
        </div>
        {badge && (
          <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${badgeColor}`}>
            {badge}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="px-5 pb-5 pt-1 border-t border-slate-800/80 space-y-3">
          {children}
        </div>
      )}
    </div>
  );
};

export const DatabaseDiagnosticsView: React.FC = () => {
  const { user, session, profile, roles, isConfigured } = useAuth();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-5 sm:p-6 space-y-2">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded-xl">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white flex items-center space-x-2">
              <span>Database Diagnostics & Technical Inspector</span>
            </h2>
            <p className="text-xs text-slate-400">
              Inspection panel for Supabase Auth, Profiles, permanent RBAC, and server invariants.
            </p>
          </div>
        </div>
      </div>

      {/* 1. Supabase Client Configuration */}
      <DiagnosticSection
        title="1. Supabase Client & Connection Status"
        badge={isConfigured ? 'CONNECTED' : 'DISCONNECTED'}
        badgeColor={isConfigured ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : 'bg-rose-950 text-rose-300 border-rose-800'}
        defaultOpen={true}
      >
        <div className="space-y-2 text-xs font-mono text-slate-300 bg-slate-950/80 p-4 rounded-lg border border-slate-800/90">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
            <span className="text-slate-500">Client Initialized:</span>
            <span className="text-emerald-400 font-bold">{isConfigured ? 'TRUE' : 'FALSE'}</span>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
            <span className="text-slate-500">Auth URL Detected:</span>
            <span className="text-slate-300 truncate max-w-xs">{import.meta.env.VITE_SUPABASE_URL || 'Configured in client'}</span>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
            <span className="text-slate-500">Session Persistence:</span>
            <span className="text-cyan-400">localStorage / autoRefreshToken: true</span>
          </div>
        </div>
      </DiagnosticSection>

      {/* 2. Authentication & JWT Token Claims */}
      <DiagnosticSection
        title="2. Supabase Auth (auth.users & JWT Session)"
        badge={user ? 'AUTHENTICATED' : 'UNAUTHENTICATED'}
        badgeColor={user ? 'bg-blue-950 text-blue-300 border-blue-800' : 'bg-slate-800 text-slate-400 border-slate-700'}
        defaultOpen={true}
      >
        {user ? (
          <div className="space-y-3 text-xs">
            <div className="bg-slate-950/80 p-4 rounded-lg border border-slate-800/90 space-y-2 font-mono">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 pb-2 border-b border-slate-800">
                <span className="text-slate-500">Auth UID:</span>
                <CopyableId id={user.id} label="" />
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <span className="text-slate-500">Email:</span>
                <span className="text-slate-200">{user.email}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <span className="text-slate-500">Provider:</span>
                <span className="text-amber-400 font-bold">{user.app_metadata?.provider || 'google'}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <span className="text-slate-500">JWT Expiry:</span>
                <span className="text-slate-400">
                  {session?.expires_at ? new Date(session.expires_at * 1000).toLocaleString() : 'N/A'}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500 italic p-3">No active authenticated session detected.</p>
        )}
      </DiagnosticSection>

      {/* 3. Public Profile Record */}
      <DiagnosticSection
        title="3. Public Profile (public.profiles)"
        badge={profile ? (profile.status || profile.account_status) : 'NO RECORD'}
        badgeColor={(profile?.status || profile?.account_status) === 'ACTIVE' ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : 'bg-amber-950 text-amber-300 border-amber-800'}
      >
        {profile ? (
          <div className="bg-slate-950/80 p-4 rounded-lg border border-slate-800/90 space-y-2 font-mono text-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 pb-2 border-b border-slate-800">
              <span className="text-slate-500">Profile ID:</span>
              <CopyableId id={profile.id} label="" />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <span className="text-slate-500">Full Name:</span>
              <span className="text-slate-200">{profile.full_name || '<NULL>'}</span>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <span className="text-slate-500">Account Status:</span>
              <span className="text-emerald-400 font-bold">{profile.status || profile.account_status}</span>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <span className="text-slate-500">Phone Number:</span>
              <span className="text-slate-400">{profile.phone || profile.phone_number || '<UNSET>'}</span>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <span className="text-slate-500">Updated At:</span>
              <span className="text-slate-400">{new Date(profile.updated_at).toLocaleString()}</span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500 italic p-3">Profile record has not been loaded.</p>
        )}
      </DiagnosticSection>

      {/* 4. Permanent RBAC Roles */}
      <DiagnosticSection
        title="4. Permanent RBAC Roles (public.user_roles)"
        badge={`${roles.length} ROLES`}
        badgeColor={roles.length > 0 ? 'bg-purple-950 text-purple-300 border-purple-800' : 'bg-slate-800 text-slate-400 border-slate-700'}
      >
        <div className="space-y-3 text-xs">
          <div className="bg-slate-950/80 p-4 rounded-lg border border-slate-800/90 space-y-2">
            <div className="text-slate-400 font-sans text-xs mb-2">
              Assigned permanent roles loaded from database table <code className="font-mono text-slate-300">public.user_roles</code>:
            </div>
            {roles.length === 0 ? (
              <p className="text-xs text-slate-500 italic">No permanent roles assigned to this profile.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {roles.map((r) => (
                  <span
                    key={r}
                    className={`px-3 py-1 rounded-md text-xs font-mono font-bold border ${
                      r === 'SUPER_ADMIN'
                        ? 'bg-amber-950 text-amber-300 border-amber-800'
                        : r === 'ADMIN'
                        ? 'bg-purple-950 text-purple-300 border-purple-800'
                        : r === 'ORGANIZER'
                        ? 'bg-blue-950 text-blue-300 border-blue-800'
                        : 'bg-emerald-950 text-emerald-300 border-emerald-800'
                    }`}
                  >
                    {r}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </DiagnosticSection>
    </div>
  );
};
