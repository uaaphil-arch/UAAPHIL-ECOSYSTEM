import React, { useState, useEffect } from 'react';
import { 
  Wifi, 
  WifiOff, 
  Radio, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw, 
  Clock,
  Activity,
  Database
} from 'lucide-react';

export type DiagnosticSyncStatus = 'SYNCED' | 'SYNCHRONIZING' | 'RECONNECTING' | 'SYNC_ERROR' | 'OFFLINE';

export interface OperationalDiagnosticBarProps {
  isOnline?: boolean;
  isRealtimeConnected?: boolean;
  syncStatus?: DiagnosticSyncStatus;
  lastSyncedAt?: Date | null;
  isLoading?: boolean;
  onForceSync?: () => void | Promise<void>;
  staleThresholdSeconds?: number;
  compact?: boolean;
  className?: string;
  contextLabel?: string;
}

export const OperationalDiagnosticBar: React.FC<OperationalDiagnosticBarProps> = ({
  isOnline = true,
  isRealtimeConnected = true,
  syncStatus = 'SYNCED',
  lastSyncedAt = null,
  isLoading = false,
  onForceSync,
  staleThresholdSeconds = 60,
  compact = false,
  className = '',
  contextLabel = 'Operations Telemetry',
}) => {
  const [secondsAgo, setSecondsAgo] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  // Timer to calculate seconds since last authoritative sync
  useEffect(() => {
    const updateElapsed = () => {
      if (!lastSyncedAt) {
        setSecondsAgo(0);
        return;
      }
      const diffSec = Math.floor((Date.now() - new Date(lastSyncedAt).getTime()) / 1000);
      setSecondsAgo(Math.max(0, diffSec));
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [lastSyncedAt]);

  const isStale = Boolean(
    isOnline &&
    lastSyncedAt &&
    secondsAgo > staleThresholdSeconds &&
    syncStatus !== 'SYNCHRONIZING'
  );

  const handleManualSync = async () => {
    if (!onForceSync || isSyncing || isLoading || !isOnline) return;
    try {
      setIsSyncing(true);
      await Promise.resolve(onForceSync());
    } finally {
      setIsSyncing(false);
    }
  };

  const formatTime = (d: Date | null) => {
    if (!d) return '--:--:--';
    return new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  };

  // Determine effective status
  const effectiveStatus: DiagnosticSyncStatus = !isOnline
    ? 'OFFLINE'
    : isLoading || isSyncing
    ? 'SYNCHRONIZING'
    : (syncStatus as DiagnosticSyncStatus) || 'SYNCED';

  return (
    <div
      className={`bg-slate-950/90 border border-slate-800 rounded-xl px-4 py-2.5 shadow-md flex flex-wrap items-center justify-between gap-3 text-xs ${className}`}
    >
      {/* Left: Connection Indicators */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
          <Activity className="w-3.5 h-3.5 text-indigo-400" />
          <span>{contextLabel}</span>
        </div>

        <div className="h-4 w-px bg-slate-800 hidden sm:block" />

        {/* Network / Internet Badge */}
        {isOnline ? (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <Wifi className="w-3.5 h-3.5" />
            <span>Internet Online</span>
          </span>
        ) : (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse">
            <WifiOff className="w-3.5 h-3.5" />
            <span>Internet Offline</span>
          </span>
        )}

        {/* Realtime Stream Badge */}
        {isOnline && (
          isRealtimeConnected ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
              <Radio className="w-3.5 h-3.5 text-indigo-400" />
              <span>Realtime Connected</span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30">
              <Radio className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
              <span>Realtime Reconnecting</span>
            </span>
          )
        )}
      </div>

      {/* Right: Sync Status & Force Sync Button */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Sync Status Badge */}
        {effectiveStatus === 'OFFLINE' && (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-rose-950/60 text-rose-300 border border-rose-800">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
            <span>Sync Blocked (Offline)</span>
          </span>
        )}

        {effectiveStatus === 'SYNCHRONIZING' && (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
            <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin" />
            <span>Synchronizing live data...</span>
          </span>
        )}

        {effectiveStatus === 'SYNC_ERROR' && (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/40">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
            <span>Sync Error</span>
          </span>
        )}

        {effectiveStatus === 'SYNCED' && (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-slate-900 text-slate-300 border border-slate-800">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>
              Authoritative Sync: <strong className="font-mono text-white">{formatTime(lastSyncedAt)}</strong>
            </span>
          </span>
        )}

        {/* Stale Data Alert */}
        {isStale && (
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse" title="Telemetry data may be out of date. Click Force Sync to refetch.">
            <Clock className="w-3 h-3 text-amber-400" />
            <span>Stale ({secondsAgo}s ago)</span>
          </span>
        )}

        {/* Force Sync Action */}
        {onForceSync && (
          <button
            type="button"
            onClick={handleManualSync}
            disabled={!isOnline || isLoading || isSyncing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg text-xs font-semibold border border-slate-700 hover:border-slate-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            title="Force immediate authoritative data sync"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-amber-400 ${isLoading || isSyncing ? 'animate-spin' : ''}`} />
            <span>Force Sync</span>
          </button>
        )}
      </div>
    </div>
  );
};
