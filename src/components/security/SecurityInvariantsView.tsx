import React from 'react';
import { Lock, ShieldCheck, ShieldAlert, Layers, CheckCircle2 } from 'lucide-react';

export const SecurityInvariantsView: React.FC = () => {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-5 sm:p-6 space-y-2">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-xl">
            <Lock className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white flex items-center space-x-2">
              <span>System & Security Invariants</span>
            </h2>
            <p className="text-xs text-slate-400">
              Authoritative multi-tier security boundaries, RLS policies, and RPC enforcement.
            </p>
          </div>
        </div>
      </div>

      {/* Invariants Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Tier 1: RBAC & Mutation Model */}
        <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-5 space-y-3">
          <div className="flex items-center space-x-2 text-xs font-bold text-amber-400 uppercase tracking-wider">
            <ShieldCheck className="w-4 h-4" />
            <span>1. Permanent RBAC Mutation</span>
          </div>
          <ul className="text-xs text-slate-300 space-y-2 list-disc pl-4 leading-relaxed">
            <li><strong>Zero Direct Table Writes:</strong> Direct REST <code className="font-mono text-slate-200">INSERT</code>, <code className="font-mono text-slate-200">UPDATE</code>, and <code className="font-mono text-slate-200">DELETE</code> on <code className="font-mono text-slate-200">public.user_roles</code> are denied by RLS default-deny.</li>
            <li><strong>RPC Delegation:</strong> Permanent role changes occur exclusively via PostgreSQL SECURITY DEFINER RPCs (<code className="font-mono text-amber-300">assign_permanent_role</code> and <code className="font-mono text-amber-300">revoke_permanent_role</code>).</li>
            <li><strong>Super Admin Exclusivity:</strong> Only authenticated users holding active <code className="font-mono text-amber-400">SUPER_ADMIN</code> can invoke role management RPCs.</li>
          </ul>
        </div>

        {/* Tier 2: Anti-Escalation & Safety Guards */}
        <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-5 space-y-3">
          <div className="flex items-center space-x-2 text-xs font-bold text-rose-400 uppercase tracking-wider">
            <ShieldAlert className="w-4 h-4" />
            <span>2. Anti-Escalation & Safeguards</span>
          </div>
          <ul className="text-xs text-slate-300 space-y-2 list-disc pl-4 leading-relaxed">
            <li><strong>Protected SUPER_ADMIN:</strong> <code className="font-mono text-amber-300">SUPER_ADMIN</code> is managed exclusively through OAuth triggers & frozen allowlists. It cannot be assigned or revoked via permanent role management RPCs.</li>
            <li><strong>Self-Mutation Block:</strong> Super Admins are strictly prohibited from mutating roles on their own account (`auth.uid() = target_user_id`).</li>
            <li><strong>Active Status Enforcement:</strong> Target profiles must possess <code className="font-mono text-emerald-400">account_status = 'ACTIVE'</code> to receive or revoke roles.</li>
          </ul>
        </div>

        {/* Tier 3: Tournament Snapshots */}
        <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-5 space-y-3">
          <div className="flex items-center space-x-2 text-xs font-bold text-blue-400 uppercase tracking-wider">
            <Layers className="w-4 h-4" />
            <span>3. Tournament Snapshots</span>
          </div>
          <ul className="text-xs text-slate-300 space-y-2 list-disc pl-4 leading-relaxed">
            <li><strong>Immutable Snapshots:</strong> Tournament creation creates an immutable snapshot of all competition configurations, divisions, categories, and rules.</li>
            <li><strong>Zero Retroactive Drift:</strong> Subsequent modifications to global templates never alter existing tournament snapshots.</li>
          </ul>
        </div>

        {/* Tier 4: Court & Live Scoring Concurrency */}
        <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-5 space-y-3">
          <div className="flex items-center space-x-2 text-xs font-bold text-purple-400 uppercase tracking-wider">
            <CheckCircle2 className="w-4 h-4" />
            <span>4. Court Concurrency & Match Safety</span>
          </div>
          <ul className="text-xs text-slate-300 space-y-2 list-disc pl-4 leading-relaxed">
            <li><strong>Single Live Match:</strong> Exactly one match may be in <code className="font-mono text-emerald-400">LIVE</code> status on a court at any given time.</li>
            <li><strong>Strict Match Lifecycle:</strong> Matches strictly follow <code className="font-mono text-slate-300">PENDING → LIVE → FINISHED</code>.</li>
          </ul>
        </div>

        {/* Tier 5: Temporary Event Role & Staffing Invariants */}
        <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-5 space-y-3 md:col-span-2">
          <div className="flex items-center space-x-2 text-xs font-bold text-teal-400 uppercase tracking-wider">
            <ShieldCheck className="w-4 h-4" />
            <span>5. Event Role & Staffing Invariants</span>
          </div>
          <ul className="text-xs text-slate-300 space-y-2 list-disc pl-4 leading-relaxed">
            <li><strong>Event-Wide Court Manager:</strong> Exactly 1 active <code className="font-mono text-teal-300">COURT_MANAGER</code> per event/tournament with <code className="font-mono text-slate-200">court_id = NULL</code>. Event authority oversees all courts.</li>
            <li><strong>Court-Scoped Table Officials:</strong> <code className="font-mono text-teal-300">TABLE_OFFICIAL</code> requires non-null <code className="font-mono text-slate-200">court_id</code>. Supports 1, 2, 3+ concurrent active officials per court sharing match operations.</li>
            <li><strong>Role-Separation Integrity:</strong> Temporary event assignments are stored in <code className="font-mono text-slate-200">public.event_assignments</code> and never grant permanent identity privileges in <code className="font-mono text-slate-200">public.user_roles</code>.</li>
          </ul>
        </div>
      </div>
    </div>
  );
};
