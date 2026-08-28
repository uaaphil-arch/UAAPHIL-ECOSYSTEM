/**
 * Authoritative Event Assignment Types
 * Corresponds to public.event_assignments schema (migration 20260813000005)
 * Reference: /docs/UAAPHIL_MASTER_WORKFLOW.md Section 4, 4A, 25A, 47B
 */

export type EventRole = 'COURT_MANAGER' | 'TABLE_OFFICIAL';

export interface EventAssignment {
  id: string;
  event_id: string;
  user_id: string;
  role: EventRole;
  court_id: string | null; // NULL for event-wide COURT_MANAGER, UUID for court-scoped TABLE_OFFICIAL
  assigned_by: string;
  is_active: boolean;
  created_at: string;
  revoked_at: string | null;
  revoked_by: string | null;

  // Joined profile metadata (optional UI convenience)
  user_full_name?: string | null;
  user_email?: string | null;
  court_name?: string | null;
}

export interface EndOfficialShiftResult {
  success: boolean;
  assignment_id: string;
  event_id: string;
  court_id: string | null;
  official_user_id: string;
  role: EventRole;
  ended_at: string;
}

export interface BatchShiftEndResult {
  success: boolean;
  event_id: string;
  tournament_id: string;
  ended_count: number;
  ended_assignments: string[];
  executed_at: string;
}

export interface ShiftReconciliationResult {
  success: boolean;
  event_id: string;
  tournament_id: string;
  reconciled_count: number;
  reconciled_assignment_ids: string[];
  stale_reason: string;
  reconciled_at: string;
}
