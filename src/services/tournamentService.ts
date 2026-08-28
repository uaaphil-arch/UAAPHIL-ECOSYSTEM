import { supabase } from '../lib/supabase';
import {
  Tournament,
  TournamentSnapshot,
  TournamentEvent,
  Registration,
  Court,
  CreateSnapshotResponse,
  LockTournamentResponse,
  TournamentStatus,
  LineupRole,
  TournamentClosureSeal,
  TournamentSignatory,
  FinalizeTournamentResponse,
} from '../types/tournament';
import {
  SetEventLineupPayload,
  SwapLineupPayload,
  LineupRpcResponse,
} from '../types/playerMembership';

export function normalizeSupabaseError(error: unknown): string {
  if (!error) return 'An unexpected error occurred.';
  const err = error as { code?: string; message?: string; details?: string };
  const message = err.message || 'Unknown database error';
  const code = err.code ? `[SQLSTATE ${err.code}] ` : '';

  if (err.code === '28000') {
    return `${code}Authentication required. Please sign in to perform this operation.`;
  }
  if (err.code === '42501') {
    return `${code}Permission denied: ${message}`;
  }
  if (err.code === '42200') {
    return `${code}Ineligible athlete: ${message}`;
  }
  if (err.code === 'P0002') {
    return `${code}Resource not found: ${message}`;
  }
  if (err.code === '22023') {
    return `${code}Invalid tournament lifecycle state: ${message}`;
  }
  if (err.code === '22000') {
    return `${code}Invalid argument: ${message}`;
  }
  if (err.code === '23505') {
    return `${code}Conflict: An active snapshot or unique record already exists.`;
  }

  return `${code}${message}`;
}

export const tournamentService = {
  // Fetch tournaments
  async getTournaments(): Promise<Tournament[]> {
    const { data, error } = await supabase
      .from('tournaments')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw new Error(normalizeSupabaseError(error));
    return (data || []) as Tournament[];
  },

  // Get tournament by ID
  async getTournamentById(id: string): Promise<Tournament | null> {
    const { data, error } = await supabase
      .from('tournaments')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(normalizeSupabaseError(error));
    }
    return data as Tournament;
  },

  // Create tournament (starts in DRAFT)
  async createTournament(payload: {
    name: string;
    slug: string;
    description?: string;
    start_date: string;
    end_date: string;
  }): Promise<Tournament> {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) throw new Error('Authentication required to create tournament.');

    const { data, error } = await supabase
      .from('tournaments')
      .insert({
        organizer_id: userData.user.id,
        name: payload.name,
        slug: payload.slug,
        description: payload.description || null,
        start_date: payload.start_date,
        end_date: payload.end_date,
        status: 'DRAFT',
      })
      .select('*')
      .single();

    if (error) throw new Error(normalizeSupabaseError(error));
    return data as Tournament;
  },

  // Update status (DRAFT -> REGISTRATION_OPEN -> REGISTRATION_CLOSED)
  // NOTE: Transition to ONGOING MUST use lockAndSnapshotTournament RPC
  async updateTournamentStatus(id: string, status: 'REGISTRATION_OPEN' | 'REGISTRATION_CLOSED' | 'COMPLETED' | 'CANCELLED'): Promise<Tournament> {
    if (status === ('ONGOING' as unknown)) {
      throw new Error('Transition to ONGOING must be performed via lockAndSnapshotTournament RPC.');
    }

    const { data, error } = await supabase
      .from('tournaments')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw new Error(normalizeSupabaseError(error));
    return data as Tournament;
  },

  // Fetch active snapshot for a tournament
  async getActiveSnapshot(tournamentId: string): Promise<TournamentSnapshot | null> {
    const { data, error } = await supabase
      .from('tournament_snapshots')
      .select('*')
      .eq('tournament_id', tournamentId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (error.code === 'PGRST116') return null;
      console.warn('Could not fetch active snapshot:', normalizeSupabaseError(error));
      throw new Error(normalizeSupabaseError(error));
    }
    if (!data) return null;
    const raw = data as Record<string, unknown>;
    return {
      ...raw,
      id: (raw.id || raw.snapshot_id) as string,
    } as TournamentSnapshot;
  },

  // Fetch snapshot by snapshot ID
  async getSnapshotById(snapshotId: string): Promise<TournamentSnapshot | null> {
    const { data, error } = await supabase
      .from('tournament_snapshots')
      .select('*')
      .eq('id', snapshotId)
      .maybeSingle();

    if (error) {
      if (error.code === 'PGRST116') return null;
      console.warn('Could not fetch snapshot by id:', normalizeSupabaseError(error));
      throw new Error(normalizeSupabaseError(error));
    }
    if (!data) return null;
    const raw = data as Record<string, unknown>;
    return {
      ...raw,
      id: (raw.id || raw.snapshot_id) as string,
    } as TournamentSnapshot;
  },

  // RPC: Create initial snapshot in DRAFT
  async createInitialTournamentSnapshot(
    tournamentId: string,
    configuration: Record<string, unknown> = {}
  ): Promise<CreateSnapshotResponse> {
    const { data, error } = await supabase.rpc('create_initial_tournament_snapshot', {
      p_tournament_id: tournamentId,
      p_configuration: configuration,
    });

    if (error) throw new Error(normalizeSupabaseError(error));
    const raw = (data || {}) as {
      snapshot_id?: string;
      id?: string;
      tournament_id?: string;
      version?: number;
      success?: boolean;
      [key: string]: unknown;
    };
    const resolvedId = (raw.id || raw.snapshot_id || '') as string;
    return {
      ...raw,
      id: resolvedId,
      snapshot_id: resolvedId,
      version: raw.version ?? 1,
      tournament_id: raw.tournament_id || tournamentId,
      is_active: true,
      success: raw.success ?? true,
    } as CreateSnapshotResponse;
  },

  // RPC: Pre-competition Lock (transitions to ONGOING)
  async lockAndSnapshotTournament(tournamentId: string): Promise<LockTournamentResponse> {
    const { data, error } = await supabase.rpc('lock_and_snapshot_tournament', {
      p_tournament_id: tournamentId,
    });

    if (error) throw new Error(normalizeSupabaseError(error));
    return data as LockTournamentResponse;
  },

  // Fetch events bound to snapshot
  async getEventsBySnapshotId(snapshotId: string): Promise<TournamentEvent[]> {
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('snapshot_id', snapshotId)
      .order('name', { ascending: true });

    if (error) throw new Error(normalizeSupabaseError(error));
    return (data || []) as TournamentEvent[];
  },

  // Fetch events by tournament ID via active snapshot
  async getEventsByTournamentId(tournamentId: string): Promise<TournamentEvent[]> {
    const snapshot = await this.getActiveSnapshot(tournamentId);
    if (!snapshot) {
      // Check if tournament exists and is in a registration or competition state
      const { data: tournament } = await supabase
        .from('tournaments')
        .select('id, name, status')
        .eq('id', tournamentId)
        .maybeSingle();

      if (tournament && ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'ONGOING', 'COMPLETED'].includes(tournament.status)) {
        console.warn(`[INTEGRITY NOTICE] Tournament ${tournament.name} (${tournament.id}) is in ${tournament.status} state but has no active snapshot record in tournament_snapshots.`);
      }
      return [];
    }
    return this.getEventsBySnapshotId(snapshot.id);
  },

  // Create event (STRICTLY requires snapshot_id)
  async createEvent(payload: {
    snapshot_id: string;
    name: string;
    category: string;
    division: string;
    weight_class?: string | null;
    gender?: string | null;
    rules_override?: Record<string, unknown>;
  }): Promise<TournamentEvent> {
    if (!payload.snapshot_id) {
      throw new Error('Invariant violation: snapshot_id is required to create an event.');
    }

    const { data, error } = await supabase
      .from('events')
      .insert({
        snapshot_id: payload.snapshot_id,
        name: payload.name,
        category: payload.category,
        division: payload.division,
        weight_class: payload.weight_class || null,
        gender: payload.gender || null,
        rules_override: payload.rules_override || {},
      })
      .select('*')
      .single();

    if (error) throw new Error(normalizeSupabaseError(error));
    return data as TournamentEvent;
  },

  // Delete event (allowed only in DRAFT or REGISTRATION_OPEN per RLS)
  async deleteEvent(eventId: string): Promise<void> {
    const { error } = await supabase
      .from('events')
      .delete()
      .eq('id', eventId);

    if (error) throw new Error(normalizeSupabaseError(error));
  },

  // Fetch registrations for events under a tournament snapshot
  async getRegistrationsBySnapshot(snapshotId: string): Promise<Registration[]> {
    const { data: events, error: eventsErr } = await supabase
      .from('events')
      .select('id')
      .eq('snapshot_id', snapshotId);

    if (eventsErr) throw new Error(normalizeSupabaseError(eventsErr));
    if (!events || events.length === 0) return [];

    const eventIds = events.map((e) => e.id);
    const { data, error } = await supabase
      .from('registrations')
      .select(`
        *,
        event:events(*),
        user_profile:profiles!registrations_user_id_fkey(full_name, email)
      `)
      .in('event_id', eventIds)
      .order('created_at', { ascending: false });

    if (error) throw new Error(normalizeSupabaseError(error));
    return (data || []) as unknown as Registration[];
  },

  // Submit athlete self-registration (permitted only in REGISTRATION_OPEN)
  async registerAthlete(eventId: string, teamName?: string): Promise<Registration> {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) throw new Error('Authentication required to register.');

    const { data, error } = await supabase
      .from('registrations')
      .insert({
        event_id: eventId,
        user_id: userData.user.id,
        team_name: teamName || null,
        is_approved: false,
      })
      .select('*')
      .single();

    if (error) throw new Error(normalizeSupabaseError(error));
    return data as Registration;
  },

  // Update registration approval / weigh_in (prior to ONGOING)
  async updateRegistration(
    registrationId: string,
    updates: {
      is_approved?: boolean;
      weigh_in_weight?: number | null;
    }
  ): Promise<Registration> {
    const { data: userData } = await supabase.auth.getUser();
    const payload: Record<string, unknown> = {
      ...updates,
      updated_at: new Date().toISOString(),
    };
    if (updates.is_approved !== undefined && userData.user) {
      payload.approved_by = updates.is_approved ? userData.user.id : null;
    }

    const { data, error } = await supabase
      .from('registrations')
      .update(payload)
      .eq('id', registrationId)
      .select('*')
      .single();

    if (error) throw new Error(normalizeSupabaseError(error));
    return data as Registration;
  },

  // Fetch courts for tournament
  async getCourts(tournamentId: string): Promise<Court[]> {
    const { data, error } = await supabase
      .from('courts')
      .select('*')
      .eq('tournament_id', tournamentId)
      .order('identifier', { ascending: true });

    if (error) throw new Error(normalizeSupabaseError(error));
    return (data || []) as Court[];
  },

  // Add court
  async createCourt(tournamentId: string, name: string, identifier: string): Promise<Court> {
    const { data, error } = await supabase
      .from('courts')
      .insert({
        tournament_id: tournamentId,
        name,
        identifier,
        is_active: true,
      })
      .select('*')
      .single();

    if (error) throw new Error(normalizeSupabaseError(error));
    return data as Court;
  },

  /**
   * Set starting lineup and standby reserve athletes for an event
   * RPC: public.coach_set_event_lineup
   */
  async coachSetEventLineup(payload: SetEventLineupPayload): Promise<LineupRpcResponse> {
    const { data, error } = await supabase.rpc('coach_set_event_lineup', {
      p_event_id: payload.event_id,
      p_club_id: payload.club_id,
      p_lineup_user_ids: payload.lineup_user_ids,
      p_reserve_user_ids: payload.reserve_user_ids,
    });

    if (error) throw new Error(normalizeSupabaseError(error));
    return data as LineupRpcResponse;
  },

  /**
   * Atomically swap one LINEUP player with one RESERVE player before tournament lock
   * RPC: public.swap_event_lineup_reserve
   */
  async swapEventLineupReserve(payload: SwapLineupPayload): Promise<LineupRpcResponse> {
    const { data, error } = await supabase.rpc('swap_event_lineup_reserve', {
      p_event_id: payload.event_id,
      p_club_id: payload.club_id,
      p_lineup_reg_id: payload.lineup_reg_id,
      p_reserve_reg_id: payload.reserve_reg_id,
    });

    if (error) throw new Error(normalizeSupabaseError(error));
    return data as LineupRpcResponse;
  },

  /**
   * Fetch registrations for a specific event with lineup roles and optional club filter
   */
  async getEventRegistrationsWithLineup(eventId: string, clubId?: string): Promise<Registration[]> {
    let query = supabase
      .from('registrations')
      .select(`
        *,
        event:events(*),
        user_profile:profiles!registrations_user_id_fkey(full_name, email)
      `)
      .eq('event_id', eventId);

    if (clubId) {
      query = query.eq('club_id', clubId);
    }

    const { data, error } = await query.order('created_at', { ascending: true });

    if (error) throw new Error(normalizeSupabaseError(error));
    return (data || []) as unknown as Registration[];
  },

  /**
   * Finalize and atomically seal a tournament using the official PostgreSQL RPC
   * RPC: public.finalize_tournament
   */
  async finalizeTournament(payload: {
    tournamentId: string;
    signatories?: TournamentSignatory[];
    notes?: string;
  }): Promise<FinalizeTournamentResponse> {
    const { data, error } = await supabase.rpc('finalize_tournament', {
      p_tournament_id: payload.tournamentId,
      p_signatories: payload.signatories || [],
      p_notes: payload.notes || '',
    });

    if (error) throw new Error(normalizeSupabaseError(error));
    return data as FinalizeTournamentResponse;
  },

  /**
   * Fetch official closure seal record for a completed tournament
   */
  async getTournamentClosureSeal(tournamentId: string): Promise<TournamentClosureSeal | null> {
    const { data, error } = await supabase
      .from('tournament_closure_seals')
      .select('*')
      .eq('tournament_id', tournamentId)
      .maybeSingle();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(normalizeSupabaseError(error));
    }
    return data as TournamentClosureSeal | null;
  },

  /**
   * Diagnostic helper to inspect preflight readiness before invoking finalize_tournament
   */
  async getTournamentPreflightDiagnostics(tournamentId: string): Promise<{
    isLocked: boolean;
    uncompletedMatches: number;
    inProgressMatches: number;
    unresolvedWinners: number;
    uncompletedAnyo: number;
    unresolvedWeighIns: number;
    totalBoutsCompleted: number;
    totalAnyoCompleted: number;
    totalApprovedAthletes: number;
    weighInRequired: boolean;
  }> {
    const snapshot = await this.getActiveSnapshot(tournamentId);

    const [matchesRes, anyoRes, tourneyRes, eventsRes] = await Promise.all([
      supabase
        .from('matches')
        .select('id, status, court_identifier, winner_registration_id')
        .eq('tournament_id', tournamentId),
      supabase
        .from('anyo_performances')
        .select('id, status')
        .eq('tournament_id', tournamentId),
      supabase
        .from('tournaments')
        .select('weigh_in_required')
        .eq('id', tournamentId)
        .single(),
      snapshot?.id
        ? supabase
            .from('events')
            .select('id')
            .eq('snapshot_id', snapshot.id)
        : Promise.resolve({ data: [] as { id: string }[], error: null }),
    ]);

    if (matchesRes.error) {
      throw new Error(`Failed to load tournament matches: ${matchesRes.error.message}`);
    }
    if (anyoRes.error) {
      throw new Error(`Failed to load anyo performances: ${anyoRes.error.message}`);
    }
    if (tourneyRes.error) {
      throw new Error(`Failed to load tournament configuration: ${tourneyRes.error.message}`);
    }
    if (eventsRes.error) {
      throw new Error(`Failed to load tournament events: ${eventsRes.error.message}`);
    }

    const eventIds = (eventsRes.data || []).map((e) => e.id);
    let registrations: { id: string; is_approved: boolean; weigh_in_weight: number | null }[] = [];

    if (eventIds.length > 0) {
      const regRes = await supabase
        .from('registrations')
        .select('id, is_approved, weigh_in_weight')
        .in('event_id', eventIds);

      if (regRes.error) {
        throw new Error(`Failed to load athlete registrations: ${regRes.error.message}`);
      }
      registrations = regRes.data || [];
    }

    const weighInRequired = tourneyRes.data?.weigh_in_required ?? true;
    const isLocked = snapshot?.is_active ?? false;
    const matches = matchesRes.data || [];
    const anyo = anyoRes.data || [];

    const nonByeMatches = matches.filter((m) => m.court_identifier !== 'BYE');
    const uncompletedMatches = nonByeMatches.filter((m) => m.status !== 'COMPLETED').length;
    const inProgressMatches = matches.filter((m) => m.status === 'IN_PROGRESS').length;
    const unresolvedWinners = nonByeMatches.filter(
      (m) => m.status === 'COMPLETED' && !m.winner_registration_id
    ).length;
    const totalBoutsCompleted = nonByeMatches.filter((m) => m.status === 'COMPLETED').length;

    const uncompletedAnyo = anyo.filter((a) => a.status !== 'COMPLETED').length;
    const totalAnyoCompleted = anyo.filter((a) => a.status === 'COMPLETED').length;

    const approvedRegs = registrations.filter((r) => r.is_approved === true);
    const unresolvedWeighIns = weighInRequired
      ? approvedRegs.filter((r) => r.weigh_in_weight === null || r.weigh_in_weight === undefined).length
      : 0;

    return {
      isLocked,
      uncompletedMatches,
      inProgressMatches,
      unresolvedWinners,
      uncompletedAnyo,
      unresolvedWeighIns,
      totalBoutsCompleted,
      totalAnyoCompleted,
      totalApprovedAthletes: approvedRegs.length,
      weighInRequired,
    };
  },
};
