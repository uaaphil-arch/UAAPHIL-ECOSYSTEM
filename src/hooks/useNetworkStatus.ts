import { useState, useEffect, useRef } from 'react';

export interface NetworkStatus {
  isOnline: boolean;
  isReconnecting: boolean;
  lastOnlineAt: Date | null;
  lastOfflineAt: Date | null;
  lastChangedAt: Date | null;
  isTabVisible: boolean;
}

/**
 * P5-04: Resilient observer for browser network connectivity and tab visibility.
 * Listens to native window 'online', 'offline', and 'visibilitychange' events.
 * Exposes reconnection transients and timestamps for operational diagnostics.
 * Performs zero polling, zero backend writes, and strictly respects component lifecycle.
 */
export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      return navigator.onLine;
    }
    return true;
  });

  const [isReconnecting, setIsReconnecting] = useState<boolean>(false);
  const [lastOnlineAt, setLastOnlineAt] = useState<Date | null>(() => (isOnline ? new Date() : null));
  const [lastOfflineAt, setLastOfflineAt] = useState<Date | null>(() => (!isOnline ? new Date() : null));
  const [lastChangedAt, setLastChangedAt] = useState<Date | null>(new Date());
  const [isTabVisible, setIsTabVisible] = useState<boolean>(() => {
    if (typeof document !== 'undefined') {
      return document.visibilityState === 'visible';
    }
    return true;
  });

  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      const now = new Date();
      setIsOnline(true);
      setIsReconnecting(true);
      setLastOnlineAt(now);
      setLastChangedAt(now);

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      // Keep reconnecting flag for 2.5s to allow refetch synchronization to kick in
      reconnectTimeoutRef.current = setTimeout(() => {
        setIsReconnecting(false);
      }, 2500);
    };

    const handleOffline = () => {
      const now = new Date();
      setIsOnline(false);
      setIsReconnecting(false);
      setLastOfflineAt(now);
      setLastChangedAt(now);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined') {
        const visible = document.visibilityState === 'visible';
        setIsTabVisible(visible);
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  return {
    isOnline,
    isReconnecting,
    lastOnlineAt,
    lastOfflineAt,
    lastChangedAt,
    isTabVisible,
  };
}
