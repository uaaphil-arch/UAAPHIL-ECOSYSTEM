import React from 'react';
import { Wifi, WifiOff, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';

export type AnyoSyncState = 'LIVE' | 'SYNCING' | 'STALE' | 'OFFLINE' | 'RECOVERING';

interface AnyoLiveSyncBadgeProps {
  syncState: AnyoSyncState;
  lastSyncTimestamp: number | null;
  onManualSync?: () => void | Promise<void>;
  isSyncing?: boolean;
  compact?: boolean;
  arenaMode?: boolean;
}

export const AnyoLiveSyncBadge: React.FC<AnyoLiveSyncBadgeProps> = ({
  syncState,
  lastSyncTimestamp,
  onManualSync,
  isSyncing = false,
  compact = false,
  arenaMode = false,
}) => {
  const [secondsAgo, setSecondsAgo] = React.useState<number>(() => {
    return lastSyncTimestamp ? Math.max(0, Math.floor((Date.now() - lastSyncTimestamp) / 1000)) : 0;
  });

  React.useEffect(() => {
    const timer = setInterval(() => {
      if (lastSyncTimestamp) {
        setSecondsAgo(Math.max(0, Math.floor((Date.now() - lastSyncTimestamp) / 1000)));
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [lastSyncTimestamp]);

  const formatAge = (secs: number) => {
    if (secs < 3) return 'just now';
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    return `${mins}m ago`;
  };

  const config = {
    LIVE: {
      bg: 'bg-emerald-950/80 border-emerald-700/80 text-emerald-300',
      dot: 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]',
      icon: <Wifi className="w-3.5 h-3.5 text-emerald-400" />,
      label: 'LIVE',
      sublabel: lastSyncTimestamp ? `Authoritative data confirmed ${formatAge(secondsAgo)}` : 'Authoritative Data Confirmed',
    },
    SYNCING: {
      bg: 'bg-amber-950/80 border-amber-700/80 text-amber-300',
      dot: 'bg-amber-400 animate-ping',
      icon: <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin" />,
      label: 'SYNCING',
      sublabel: 'Synchronizing with tournament server…',
    },
    RECOVERING: {
      bg: 'bg-blue-950/90 border-blue-600 text-blue-200 ring-1 ring-blue-500/50',
      dot: 'bg-blue-400 animate-pulse',
      icon: <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin" />,
      label: 'RECONNECTING',
      sublabel: 'Connection restored — verifying authoritative results…',
    },
    STALE: {
      bg: 'bg-amber-950/95 border-amber-600 text-amber-200 ring-1 ring-amber-500/60',
      dot: 'bg-amber-500',
      icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />,
      label: 'STALE',
      sublabel: lastSyncTimestamp ? `STALE — Last authoritative data confirmed ${formatAge(secondsAgo)}` : 'STALE — Data Outdated',
    },
    OFFLINE: {
      bg: 'bg-rose-950/95 border-rose-800 text-rose-200 ring-1 ring-rose-500/50',
      dot: 'bg-rose-500',
      icon: <WifiOff className="w-3.5 h-3.5 text-rose-400" />,
      label: 'OFFLINE',
      sublabel: 'OFFLINE — No live connection to tournament server',
    },
  }[syncState];

  if (compact) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full border text-xs font-mono font-bold ${config.bg}`}
      >
        <span className="relative flex h-2 w-2">
          <span className={`inline-flex rounded-full h-2 w-2 ${config.dot}`} />
        </span>
        <span>{config.label}</span>
        <span className="text-[10px] opacity-80">
          ({syncState === 'LIVE' ? formatAge(secondsAgo) : syncState === 'STALE' ? `Stale: ${formatAge(secondsAgo)}` : config.label})
        </span>
        {onManualSync && (
          <button
            type="button"
            onClick={onManualSync}
            disabled={isSyncing}
            title="Force refresh authoritative state"
            aria-label="Force refresh authoritative state"
            className="ml-1 p-0.5 hover:text-white transition-colors rounded-sm focus:outline-hidden"
          >
            <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
          </button>
        )}
      </div>
    );
  }

  if (arenaMode) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`inline-flex items-center gap-3 px-4 py-2 rounded-2xl border text-sm font-bold ${config.bg} shadow-lg`}
      >
        <span className="relative flex h-3 w-3">
          <span className={`inline-flex rounded-full h-3 w-3 ${config.dot}`} />
        </span>
        <div className="flex items-center gap-2 font-mono">
          <span className="tracking-wider uppercase font-black">{config.label}</span>
          <span className="text-slate-400">•</span>
          <span className="text-xs opacity-90">{config.sublabel}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`inline-flex items-center justify-between gap-3 px-3.5 py-1.5 rounded-xl border text-xs font-medium ${config.bg} shadow-sm`}
    >
      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className={`inline-flex rounded-full h-2.5 w-2.5 ${config.dot}`} />
        </span>
        <div className="flex items-center gap-1.5">
          <span className="font-black font-mono tracking-wider">{config.label}</span>
          <span className="text-slate-400">•</span>
          <span className="text-[11px] font-mono opacity-90">{config.sublabel}</span>
        </div>
      </div>

      {onManualSync && (
        <button
          type="button"
          onClick={onManualSync}
          disabled={isSyncing}
          title="Force refresh authoritative state"
          aria-label="Force refresh authoritative state"
          className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-900/60 hover:bg-slate-800 text-[11px] font-bold text-slate-200 border border-slate-700/60 transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">{isSyncing ? 'Syncing...' : 'Re-sync'}</span>
        </button>
      )}
    </div>
  );
};
