import { supabase, isSupabaseConfigured } from '../lib/supabase';
import {
  EventAssignment,
  EventRole,
  EndOfficialShiftResult,
  BatchShiftEndResult,
  ShiftReconciliationResult,
} from '../types/eventAssignment';

export interface BatchRotationItem {
  court_id: string;
  outgoing_assignment_id: string;
  outgoing_user_id: string;
  incoming_user_id: string;
}

export interface BatchRotationResult {
  success: boolean;
  event_id: string;
  tournament_id: string;
  rotated_count: number;
  rotated_courts: string[];
  executed_at: string;
}

export const eventAssignmentService = {
  /**
   * Fetches active event assignments for the authenticated user via public.event_assignments.
   */
  async fetchMyAssignments(userId: string): Promise<EventAssignment[]> {
    if (!isSupabaseConfigured || !userId) return [];

    const { data, error } = await supabase
      .from('event_assignments')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (error) {
      console.error('Error fetching active event assignments:', error.message);
      throw new Error(error.message);
    }

    return (data as EventAssignment[]) || [];
  },

  /**
   * Fetches all event assignments for a given event.
   */
  async fetchEventAssignments(eventId: string): Promise<EventAssignment[]> {
    if (!isSupabaseConfigured || !eventId) return [];

    const { data, error } = await supabase
      .from('event_assignments')
      .select(`
        *,
        profiles:user_id (
          full_name,
          email
        )
      `)
      .eq('event_id', eventId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching event assignments:', error.message);
      throw new Error(error.message);
    }

    return (data || []).map((row: any) => ({
      ...row,
      user_full_name: row.profiles?.full_name || null,
      user_email: row.profiles?.email || null,
    }));
  },

  /**
   * Assigns an event operational role via the database-authoritative SECURITY DEFINER RPC `assign_event_role`.
   * Invariants:
   * - COURT_MANAGER: courtId must be null (event-wide).
   * - TABLE_OFFICIAL: courtId must be a valid UUID.
   */
  async assignEventRole(
    eventId: string,
    targetUserId: string,
    role: EventRole,
    courtId: string | null = null
  ): Promise<EventAssignment> {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase client is not configured.');
    }

    const effectiveCourtId = role === 'COURT_MANAGER' ? null : (courtId || null);

    if (role === 'TABLE_OFFICIAL' && !effectiveCourtId) {
      throw new Error('Court ID is required for TABLE_OFFICIAL assignments.');
    }

    const { data, error } = await supabase.rpc('assign_event_role', {
      p_event_id: eventId,
      p_user_id: targetUserId,
      p_role: role,
      p_court_id: effectiveCourtId,
    });

    if (error) {
      console.error('Error assigning event role via RPC assign_event_role:', error.message);
      throw new Error(error.message);
    }

    return data as EventAssignment;
  },

  /**
   * Revokes an active event assignment via the database-authoritative SECURITY DEFINER RPC `revoke_event_role`.
   */
  async revokeEventRole(assignmentId: string): Promise<EventAssignment> {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase client is not configured.');
    }

    const { data, error } = await supabase.rpc('revoke_event_role', {
      p_assignment_id: assignmentId,
    });

    if (error) {
      console.error('Error revoking event role via RPC revoke_event_role:', error.message);
      throw new Error(error.message);
    }

    return data as EventAssignment;
  },

  /**
   * Searches active candidate profiles for official role assignment.
   */
  async searchCandidateUsers(query: string = ''): Promise<Array<{ id: string; full_name: string; email: string }>> {
    if (!isSupabaseConfigured) return [];

    let q = supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('status', 'ACTIVE')
      .limit(30);

    const trimmed = query.trim();
    if (trimmed) {
      // If valid UUID, match ID or text fields
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
      if (isUuid) {
        q = q.or(`id.eq.${trimmed},full_name.ilike.%${trimmed}%,email.ilike.%${trimmed}%`);
      } else {
        q = q.or(`full_name.ilike.%${trimmed}%,email.ilike.%${trimmed}%`);
      }
    }

    const { data, error } = await q;
    if (error) {
      console.warn('Error fetching candidate profiles for assignment:', error.message);
      return [];
    }

    return (data || []) as Array<{ id: string; full_name: string; email: string }>;
  },

  /**
   * Atomically rotates multiple Table Officials across multiple courts via SECURITY DEFINER RPC `batch_rotate_officials`.
   * Enforces all-or-nothing atomicity and fail-closed active-bout safety (INV-08).
   */
  async batchRotateOfficials(
    eventId: string,
    rotations: BatchRotationItem[]
  ): Promise<BatchRotationResult> {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase client is not configured.');
    }

    if (!eventId) {
      throw new Error('Event ID is required for batch shift rotation.');
    }

    if (!rotations || rotations.length === 0) {
      throw new Error('At least one rotation item is required.');
    }

    const { data, error } = await supabase.rpc('batch_rotate_officials', {
      p_event_id: eventId,
      p_rotations: rotations,
    });

    if (error) {
      console.error('Error executing batch official rotation via RPC batch_rotate_officials:', error.message);
      throw new Error(error.message);
    }

    return data as BatchRotationResult;
  },

  /**
   * Concludes an individual active official shift via database-authoritative SECURITY DEFINER RPC `end_official_shift`.
   * Enforces INV-08 active-bout safety (fail-closed if court has LIVE match).
   */
  async endOfficialShift(assignmentId: string): Promise<EndOfficialShiftResult> {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase client is not configured.');
    }

    if (!assignmentId) {
      throw new Error('Assignment ID is required to end official shift.');
    }

    const { data, error } = await supabase.rpc('end_official_shift', {
      p_assignment_id: assignmentId,
    });

    if (error) {
      console.error('Error ending official shift via RPC end_official_shift:', error.message);
      throw new Error(error.message);
    }

    return data as EndOfficialShiftResult;
  },

  /**
   * Concludes multiple active official shifts in an event via database-authoritative SECURITY DEFINER RPC `batch_end_official_shifts`.
   * Enforces all-or-nothing atomicity and INV-08 active-bout safety.
   */
  async batchEndShifts(
    eventId: string,
    assignmentIds: string[]
  ): Promise<BatchShiftEndResult> {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase client is not configured.');
    }

    if (!eventId) {
      throw new Error('Event ID is required for batch shift conclusion.');
    }

    if (!assignmentIds || assignmentIds.length === 0) {
      throw new Error('At least one assignment ID is required.');
    }

    const { data, error } = await supabase.rpc('batch_end_official_shifts', {
      p_event_id: eventId,
      p_assignment_ids: assignmentIds,
    });

    if (error) {
      console.error('Error batch ending official shifts via RPC batch_end_official_shifts:', error.message);
      throw new Error(error.message);
    }

    return data as BatchShiftEndResult;
  },

  /**
   * Idempotently reconciles stale active assignments for an event via SECURITY DEFINER RPC `reconcile_event_assignments`.
   * Deactivates lingering assignments from completed tournaments, deactivated courts, or inactive profiles.
   */
  async reconcileEventAssignments(eventId: string): Promise<ShiftReconciliationResult> {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase client is not configured.');
    }

    if (!eventId) {
      throw new Error('Event ID is required for assignment reconciliation.');
    }

    const { data, error } = await supabase.rpc('reconcile_event_assignments', {
      p_event_id: eventId,
    });

    if (error) {
      console.error('Error reconciling event assignments via RPC reconcile_event_assignments:', error.message);
      throw new Error(error.message);
    }

    return data as ShiftReconciliationResult;
  },
};

