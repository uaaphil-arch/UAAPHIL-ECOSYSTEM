import React from 'react';
import { ShieldAlert, ArrowLeft } from 'lucide-react';
import { NavigationTab } from '../../utils/authorization';

interface UnauthorizedAccessViewProps {
  attemptedTab: NavigationTab;
  onReturnToDashboard: () => void;
}

export const UnauthorizedAccessView: React.FC<UnauthorizedAccessViewProps> = ({
  attemptedTab,
  onReturnToDashboard,
}) => {
  return (
    <div className="bg-slate-800/80 border border-rose-900/50 rounded-2xl p-8 sm:p-12 text-center space-y-5 max-w-lg mx-auto my-8 shadow-xl">
      <div className="w-14 h-14 bg-rose-950/80 border border-rose-800/70 text-rose-400 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
        <ShieldAlert className="w-7 h-7" />
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-bold text-white tracking-tight">Access Restricted</h2>
        <p className="text-xs text-slate-400 leading-relaxed">
          Your current account permissions do not authorize access to the requested section (<code className="font-mono text-rose-300 font-semibold">{attemptedTab}</code>).
        </p>
      </div>

      <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800 text-[11px] text-slate-500 font-mono">
        Authorization Policy: Strict Role Verification Enforced
      </div>

      <div className="pt-2">
        <button
          type="button"
          onClick={onReturnToDashboard}
          className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition-all inline-flex items-center space-x-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Return to Dashboard</span>
        </button>
      </div>
    </div>
  );
};
