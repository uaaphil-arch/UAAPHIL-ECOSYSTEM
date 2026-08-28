import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { AnyoSyncState } from '../components/competition/AnyoLiveSyncBadge';

interface UseAnyoRealtimeSyncOptions {
  sessionId: string;
  onRefresh: () => void | Promise<void>;
  staleThresholdSeconds?: number; // Default: 30s
}

export interface AnyoRealtimeSyncResult {
  syncState: AnyoSyncState;
  lastSyncTimestamp: number | null;
  isSyncing: boolean;
  error: string | null;
  syncNow: () => Promise<void>;
}

export function useAnyoRealtimeSync({
  sessionId,
  onRefresh,
  staleThresholdSeconds = 30,
}: UseAnyoRealtimeSyncOptions): AnyoRealtimeSyncResult {
  const [syncState, setSyncState] = useState<AnyoSyncState>('SYNCING');
  const [lastSyncTimestamp, setLastSyncTimestamp] = useState<number | null>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const syncSeqRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);
  const lastSyncTimeRef = useRef<number | null>(null);
  const isChannelSubscribedRef = useRef<boolean>(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  // Execute authoritative synchronization with race-condition protection
  const syncNow = useCallback(async (isRecovery: boolean = false) => {
    if (!sessionId) return;
    const currentSeq = ++syncSeqRef.current;
    setIsSyncing(true);
    if (isRecovery) {
      setSyncState('RECOVERING');
    } else {
      setSyncState((prev) => (prev === 'OFFLINE' ? 'RECOVERING' : 'SYNCING'));
    }

    try {
      await onRefreshRef.current();

      // Only update if this is still the most recent in-flight request and component is mounted
      if (isMountedRef.current && currentSeq === syncSeqRef.current) {
        const now = Date.now();
        lastSyncTimeRef.current = now;
        setLastSyncTimestamp(now);
        setError(null);

        const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
        if (!isOnline) {
          setSyncState('OFFLINE');
        } else {
          setSyncState('LIVE');
        }
      }
    } catch (err: unknown) {
      if (isMountedRef.current && currentSeq === syncSeqRef.current) {
        console.error('[AnyoRealtimeSync] Authoritative refresh failed:', err);
        setError(err instanceof Error ? err.message : 'Synchronization failed');
        setSyncState(typeof navigator !== 'undefined' && !navigator.onLine ? 'OFFLINE' : 'STALE');
      }
    } finally {
      if (isMountedRef.current && currentSeq === syncSeqRef.current) {
        setIsSyncing(false);
      }
    }
  }, [sessionId]);

  useEffect(() => {
    isMountedRef.current = true;
    syncSeqRef.current = 0;
    lastSyncTimeRef.current = null;
    setLastSyncTimestamp(null);
    setSyncState('SYNCING');

    // Run immediate initial authoritative sync
    syncNow();

    // Supabase Realtime channel setup
    let debounceTimer: NodeJS.Timeout | null = null;
    const debouncedRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (isMountedRef.current) {
          syncNow();
        }
      }, 250);
    };

    const channelTopic = `anyo_sync_${sessionId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const channel = supabase
      .channel(channelTopic)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'anyo_performances',
          filter: `session_id=eq.${sessionId}`,
        },
        () => debouncedRefresh()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'anyo_scores',
          filter: `session_id=eq.${sessionId}`,
        },
        () => debouncedRefresh()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'anyo_category_sessions',
          filter: `id=eq.${sessionId}`,
        },
        () => debouncedRefresh()
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          isChannelSubscribedRef.current = true;
          if (isMountedRef.current) {
            const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
            if (!isOnline) {
              setSyncState('OFFLINE');
            } else {
              setSyncState((prev) => (prev === 'SYNCING' || prev === 'RECOVERING' ? prev : 'LIVE'));
            }
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          isChannelSubscribedRef.current = false;
          if (isMountedRef.current) {
            const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
            setSyncState(isOnline ? 'STALE' : 'OFFLINE');
          }
        }
      });

    // Browser Network & Sleep/Wake event listeners
    const handleOnline = () => {
      if (isMountedRef.current) {
        syncNow(true);
      }
    };

    const handleOffline = () => {
      if (isMountedRef.current) {
        setSyncState('OFFLINE');
      }
    };

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        // Tab restored to focus after sleep or backgrounding
        if (isMountedRef.current) {
          syncNow(true);
        }
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Periodic connection health evaluator (every 1s)
    const healthInterval = setInterval(() => {
      if (!isMountedRef.current) return;
      const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

      if (!isOnline) {
        setSyncState('OFFLINE');
        return;
      }

      if (isChannelSubscribedRef.current) {
        // Healthy active subscription - maintain LIVE state (unless currently in middle of an in-flight sync/recovery)
        setSyncState((prev) => (prev === 'SYNCING' || prev === 'RECOVERING' ? prev : 'LIVE'));
      } else {
        // Channel failed, closed, or timed out
        setSyncState((prev) => (prev === 'SYNCING' || prev === 'RECOVERING' ? prev : 'STALE'));
      }
    }, 1000);

    return () => {
      isMountedRef.current = false;
      if (debounceTimer) clearTimeout(debounceTimer);
      clearInterval(healthInterval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      supabase.removeChannel(channel);
    };
  }, [sessionId, syncNow, staleThresholdSeconds]);

  return {
    syncState,
    lastSyncTimestamp,
    isSyncing,
    error,
    syncNow,
  };
}
