import { supabase } from '../lib/supabase';

const STORAGE_KEY_PREFIX = 'uaaphil_read_notifs';
const NOTIFICATION_SYNC_EVENT = 'uaaphil_notification_read_sync';

/**
 * Helper to get the local storage key for a user and tournament.
 */
function getStorageKey(userId: string, tournamentId?: string): string {
  const scope = tournamentId || 'global';
  return `${STORAGE_KEY_PREFIX}_${userId}_${scope}`;
}

/**
 * Loads read notification IDs from client-side storage cache.
 */
function getCachedReadIds(userId: string, tournamentId?: string): Set<string> {
  try {
    const raw = localStorage.getItem(getStorageKey(userId, tournamentId));
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set<string>(parsed) : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

/**
 * Saves read notification IDs to client-side storage cache.
 */
function setCachedReadIds(userId: string, ids: Set<string>, tournamentId?: string): void {
  try {
    localStorage.setItem(getStorageKey(userId, tournamentId), JSON.stringify(Array.from(ids)));
  } catch (err) {
    console.warn('Failed to cache notification read IDs in localStorage:', err);
  }
}

export const notificationService = {
  /**
   * Fetches the set of read notification IDs for the authenticated user and tournament scope.
   * Merges server-side database state with local cache for instant offline/online consistency.
   */
  async fetchReadNotificationIds(userId: string, tournamentId?: string): Promise<Set<string>> {
    const cached = getCachedReadIds(userId, tournamentId);

    if (!userId) {
      return cached;
    }

    try {
      // 1. Query server-side RPC
      const { data, error } = await supabase.rpc('get_user_read_notification_ids', {
        p_tournament_id: tournamentId || null
      });

      if (!error && Array.isArray(data)) {
        // Merge server array into cached set
        data.forEach((id: string) => cached.add(id));
        setCachedReadIds(userId, cached, tournamentId);
        return cached;
      }

      // 2. Direct fallback query if RPC is not available
      const query = supabase
        .from('user_notification_reads')
        .select('notification_id')
        .eq('user_id', userId);

      if (tournamentId) {
        query.or(`tournament_id.eq.${tournamentId},tournament_id.is.null`);
      }

      const { data: rows, error: selectError } = await query;
      if (!selectError && rows) {
        rows.forEach((r: { notification_id: string }) => cached.add(r.notification_id));
        setCachedReadIds(userId, cached, tournamentId);
      }
    } catch (err) {
      console.warn('Network or DB error fetching read notification IDs, using local cache:', err);
    }

    return cached;
  },

  /**
   * Marks a single notification as read for the user.
   * Optimistically updates local cache and persists to database.
   */
  async markAsRead(
    userId: string,
    notificationId: string,
    auditLogId?: string,
    tournamentId?: string
  ): Promise<boolean> {
    if (!notificationId) return false;

    // Optimistic cache update
    if (userId) {
      const cached = getCachedReadIds(userId, tournamentId);
      cached.add(notificationId);
      setCachedReadIds(userId, cached, tournamentId);
    }

    // Broadcast change for other components/tabs
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(NOTIFICATION_SYNC_EVENT, { detail: { notificationId } }));
    }

    if (!userId) return true;

    try {
      const { error } = await supabase.rpc('mark_notification_read', {
        p_notification_id: notificationId,
        p_audit_log_id: auditLogId || null,
        p_tournament_id: tournamentId || null
      });

      if (error) {
        // Direct table insert fallback
        await supabase.from('user_notification_reads').upsert({
          user_id: userId,
          notification_id: notificationId,
          audit_log_id: auditLogId || null,
          tournament_id: tournamentId || null,
          read_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,notification_id'
        });
      }
      return true;
    } catch (err) {
      console.warn('Failed to persist notification read state to DB:', err);
      return false;
    }
  },

  /**
   * Marks an array of notifications as read for the user.
   * Optimistically updates local cache and persists to database.
   */
  async markAllAsRead(
    userId: string,
    notificationIds: string[],
    tournamentId?: string
  ): Promise<boolean> {
    if (!notificationIds || notificationIds.length === 0) return true;

    // Optimistic cache update
    if (userId) {
      const cached = getCachedReadIds(userId, tournamentId);
      notificationIds.forEach((id) => cached.add(id));
      setCachedReadIds(userId, cached, tournamentId);
    }

    // Broadcast change
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(NOTIFICATION_SYNC_EVENT, { detail: { all: true } }));
    }

    if (!userId) return true;

    try {
      const { error } = await supabase.rpc('mark_all_notifications_read', {
        p_notification_ids: notificationIds,
        p_tournament_id: tournamentId || null
      });

      if (error) {
        // Direct batch upsert fallback
        const records = notificationIds.map((id) => ({
          user_id: userId,
          notification_id: id,
          tournament_id: tournamentId || null,
          read_at: new Date().toISOString()
        }));
        await supabase.from('user_notification_reads').upsert(records, {
          onConflict: 'user_id,notification_id'
        });
      }
      return true;
    } catch (err) {
      console.warn('Failed to persist batch notification read state to DB:', err);
      return false;
    }
  },

  /**
   * Subscribes to local and cross-tab read state changes.
   */
  subscribeToReadStateChanges(onSync: () => void): () => void {
    if (typeof window === 'undefined') return () => {};

    const handleCustomEvent = () => onSync();
    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key && e.key.startsWith(STORAGE_KEY_PREFIX)) {
        onSync();
      }
    };

    window.addEventListener(NOTIFICATION_SYNC_EVENT, handleCustomEvent);
    window.addEventListener('storage', handleStorageEvent);

    return () => {
      window.removeEventListener(NOTIFICATION_SYNC_EVENT, handleCustomEvent);
      window.removeEventListener('storage', handleStorageEvent);
    };
  }
};
