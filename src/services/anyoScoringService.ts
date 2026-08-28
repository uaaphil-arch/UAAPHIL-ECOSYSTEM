import { supabase } from '../lib/supabase';
import {
  AnyoCategorySession,
  AnyoPerformance,
  AnyoScore,
  AnyoTieTier,
  AnyoPanelSize,
  AnyoCalcMethod,
} from '../types/tournament';

export const anyoScoringService = {
  // 1. Fetch or initialize session for an Anyo event
  async getSession(sessionId: string): Promise<AnyoCategorySession | null> {
    const { data, error } = await supabase
      .from('anyo_category_sessions')
      .select('*, event:events(*), court:courts(*)')
      .eq('id', sessionId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching Anyo session:', error);
      return null;
    }

    return (data as unknown) as AnyoCategorySession | null;
  },

  async getOrCreateSession(
    tournamentId: string,
    eventId: string,
    courtId?: string
  ): Promise<AnyoCategorySession> {
    const { data: existing, error: fetchErr } = await supabase
      .from('anyo_category_sessions')
      .select('*, event:events(*), court:courts(*)')
      .eq('tournament_id', tournamentId)
      .eq('event_id', eventId)
      .maybeSingle();

    if (fetchErr) {
      console.error('Error fetching Anyo session:', fetchErr);
    }

    if (existing) {
      return existing as unknown as AnyoCategorySession;
    }

    // Call RPC to initialize (deriving panel_size and calc_method authoritatively from event contract)
    const { data, error } = await supabase.rpc('initialize_anyo_category_session', {
      p_tournament_id: tournamentId,
      p_event_id: eventId,
      p_court_id: courtId || null,
    });

    if (error) {
      console.error('initialize_anyo_category_session error:', error);
      throw new Error(error.message || 'Failed to initialize Anyo session');
    }

    const sessionId = (data as { session_id: string }).session_id;
    const { data: newSession, error: reloadErr } = await supabase
      .from('anyo_category_sessions')
      .select('*, event:events(*), court:courts(*)')
      .eq('id', sessionId)
      .single();

    if (reloadErr || !newSession) {
      throw new Error('Failed to load initialized Anyo session');
    }

    return newSession as unknown as AnyoCategorySession;
  },

  // 2. Fetch all performances for an Anyo session in sequential order
  async getSessionPerformances(sessionId: string): Promise<AnyoPerformance[]> {
    const { data, error } = await supabase
      .from('anyo_performances')
      .select(`
        *,
        registration:registrations (
          id,
          team_name,
          user_profile:profiles!registrations_user_id_fkey (
            id,
            full_name,
            email,
            avatar_url
          )
        )
      `)
      .eq('session_id', sessionId)
      .order('order_number', { ascending: true });

    if (error) {
      console.error('Error fetching Anyo performances:', error);
      throw new Error(error.message || 'Failed to load performance order');
    }

    return (data as unknown) as AnyoPerformance[];
  },

  // 3. Generate Achievement-Based Seeded Marching Order (Server-Authoritative)
  async generateSeededMarchingOrder(
    sessionId: string,
    isRegeneration: boolean = false
  ): Promise<{
    success: boolean;
    session_id: string;
    draw_status: string;
    draw_version: number;
    total_performers: number;
    tier_distribution: Record<string, number>;
    seeding_cutoff_at: string;
    marching_order: Array<{
      performance_id: string;
      order_number: number;
      seed_tier: number;
      historical_classification: string;
      draw_group: string;
    }>;
  }> {
    const { data, error } = await supabase.rpc('generate_anyo_marching_order', {
      p_session_id: sessionId,
      p_is_regeneration: isRegeneration,
    });

    if (error) {
      console.error('generate_anyo_marching_order error:', error);
      throw new Error(error.message || 'Failed to generate seeded marching order');
    }

    return data;
  },

  // 4. Confirm and Lock Official Marching Order
  async confirmMarchingOrder(sessionId: string): Promise<{ success: boolean; draw_status: string }> {
    const { data, error } = await supabase.rpc('confirm_anyo_marching_order', {
      p_session_id: sessionId,
    });

    if (error) {
      console.error('confirm_anyo_marching_order error:', error);
      throw new Error(error.message || 'Failed to confirm official marching order');
    }

    return data;
  },

  // 5. Get Marching Order Preview with Detailed Metadata
  async getMarchingOrderPreview(sessionId: string): Promise<{
    session_id: string;
    draw_status: string;
    draw_version: number;
    draw_generated_at: string | null;
    draw_confirmed_at: string | null;
    draw_metadata: Record<string, unknown>;
    performances: Array<AnyoPerformance & {
      athlete_name: string;
      athlete_avatar_url: string | null;
      school_club: string | null;
    }>;
  }> {
    const { data, error } = await supabase.rpc('get_anyo_marching_order_preview', {
      p_session_id: sessionId,
    });

    if (error) {
      console.error('get_anyo_marching_order_preview error:', error);
      throw new Error(error.message || 'Failed to fetch marching order preview');
    }

    return data;
  },

  // 6. Reorder performances before competition start (Mandatory Reason Validation)
  async reorderPerformances(
    sessionId: string,
    performanceIds: string[],
    reason: string
  ): Promise<void> {
    const trimmedReason = reason?.trim();
    if (!trimmedReason) {
      throw new Error('A non-empty written reason must be explicitly provided for manual performance reordering.');
    }

    const { error } = await supabase.rpc('reorder_anyo_performances', {
      p_session_id: sessionId,
      p_performance_ids: performanceIds,
      p_reason: trimmedReason,
    });

    if (error) {
      console.error('reorder_anyo_performances error:', error);
      throw new Error(error.message || 'Failed to reorder performances');
    }
  },

  // 4a. Physical Court Check-in
  async markPerformerCheckedIn(performanceId: string): Promise<void> {
    const { error } = await supabase.rpc('mark_anyo_performer_checked_in', {
      p_performance_id: performanceId,
    });

    if (error) {
      console.error('mark_anyo_performer_checked_in error:', error);
      throw new Error(error.message || 'Failed to check-in performer');
    }
  },
  // 4. Call / activate a performer
  async callPerformer(performanceId: string): Promise<void> {
    const { error } = await supabase.rpc('call_anyo_performer', {
      p_performance_id: performanceId,
    });

    if (error) {
      console.error('call_anyo_performer error:', error);
      throw new Error(error.message || 'Failed to call performer');
    }
  },

  // 5. Submit judge scores via canonical record_anyo_score RPC
  async recordAnyoScore(
    performanceId: string,
    judgeScores: number[],
    tier: AnyoTieTier = 'TIER_1'
  ): Promise<{ calculated_score: number }> {
    const { data, error } = await supabase.rpc('record_anyo_score', {
      p_performance_id: performanceId,
      p_judge_scores: judgeScores,
      p_tier: tier,
    });

    if (error) {
      console.error('record_anyo_score error:', error);
      throw new Error(error.message || 'Failed to record Anyo score');
    }

    return data as { calculated_score: number };
  },

  // 6. Record DQ or No-Show
  async recordDqOrNoShow(
    performanceId: string,
    outcome: 'DQ' | 'NO_SHOW',
    reason?: string,
    isRetroactive: boolean = false
  ): Promise<void> {
    const { error } = await supabase.rpc('record_anyo_dq_or_noshow', {
      p_performance_id: performanceId,
      p_outcome: outcome,
      p_reason: reason || null,
      p_is_retroactive: isRetroactive,
    });

    if (error) {
      console.error('record_anyo_dq_or_noshow error:', error);
      throw new Error(error.message || 'Failed to record outcome');
    }
  },

  // 7. Record Tier 3 Majority Vote Tally
  async recordTier3Majority(
    sessionId: string,
    tiedPerformanceIds: string[],
    tallies: Record<string, number>,
    winningPerformanceId: string
  ): Promise<void> {
    const { error } = await supabase.rpc('record_anyo_tier3_majority', {
      p_session_id: sessionId,
      p_tied_performance_ids: tiedPerformanceIds,
      p_tallies: tallies,
      p_winning_performance_id: winningPerformanceId,
    });

    if (error) {
      console.error('record_anyo_tier3_majority error:', error);
      throw new Error(error.message || 'Failed to record Tier 3 majority tally');
    }
  },

  // 8. Finalize Anyo Category (Organizer / Court Manager only)
  async finalizeCategory(sessionId: string): Promise<{ ranked_count: number }> {
    const { data, error } = await supabase.rpc('finalize_anyo_category', {
      p_session_id: sessionId,
    });

    if (error) {
      console.error('finalize_anyo_category error:', error);
      throw new Error(error.message || 'Failed to finalize Anyo category');
    }

    return data as { ranked_count: number };
  },

  // 9. Fetch all scores for a session
  async getSessionScores(sessionId: string): Promise<AnyoScore[]> {
    const { data, error } = await supabase
      .from('anyo_scores')
      .select('*')
      .eq('session_id', sessionId);

    if (error) {
      console.error('Error fetching Anyo scores:', error);
      return [];
    }

    return (data as unknown) as AnyoScore[];
  },
};
