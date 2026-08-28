import { supabase } from '../lib/supabase';
import { Court, CourtAssignment, Match, DecisionType, ScoringRound, CornerColor } from '../types/tournament';

export const scoringService = {
  // 1. Fetch all courts for a tournament with their current live/assigned matches
  async getCourtsWithAssignments(tournamentId: string): Promise<{
    courts: Court[];
    assignments: CourtAssignment[];
  }> {
    // A. Fetch courts
    const { data: courts, error: courtsError } = await supabase
      .from('courts')
      .select('*')
      .eq('tournament_id', tournamentId)
      .order('identifier', { ascending: true });

    if (courtsError) {
      console.error('Error fetching courts:', courtsError);
      throw new Error(`Failed to load tournament courts: ${courtsError.message}`);
    }

    // B. Fetch active assignments (ASSIGNED or LIVE) for these courts
    const courtIds = (courts || []).map((c) => c.id);
    if (courtIds.length === 0) {
      return { courts: [], assignments: [] };
    }

    const { data: assignments, error: assignmentsError } = await supabase
      .from('court_assignments')
      .select(`
        id,
        court_id,
        match_id,
        status,
        assigned_at,
        court:courts(id, name, identifier, is_active, tournament_id, created_at),
        match:matches(
          id,
          tournament_id,
          event_id,
          bracket_node_index,
          round_number,
          match_number,
          court_identifier,
          red_corner_registration_id,
          blue_corner_registration_id,
          winner_registration_id,
          status,
          created_at,
          event:events(id, name, category, division, weight_class, gender),
          red_registration:registrations!matches_red_corner_registration_id_fkey(
            id,
            team_name,
            weigh_in_weight,
            is_approved,
            user_profile:profiles!registrations_user_id_fkey(id, full_name, email)
          ),
          blue_registration:registrations!matches_blue_corner_registration_id_fkey(
            id,
            team_name,
            weigh_in_weight,
            is_approved,
            user_profile:profiles!registrations_user_id_fkey(id, full_name, email)
          )
        )
      `)
      .in('court_id', courtIds)
      .in('status', ['ASSIGNED', 'LIVE'])
      .order('assigned_at', { ascending: true });

    if (assignmentsError) {
      console.error('Error fetching court assignments:', assignmentsError);
      throw new Error(`Failed to load court assignments: ${assignmentsError.message}`);
    }

    return {
      courts: courts || [],
      assignments: ((assignments as unknown) as CourtAssignment[]) || [],
    };
  },

  // 2. Fetch all SCHEDULED matches ready for court assignment (both corners populated)
  async getAssignableMatches(tournamentId: string): Promise<Match[]> {
    // Fetch all SCHEDULED matches with both corners populated
    const { data: matches, error } = await supabase
      .from('matches')
      .select(`
        id,
        tournament_id,
        event_id,
        bracket_node_index,
        round_number,
        match_number,
        court_identifier,
        red_corner_registration_id,
        blue_corner_registration_id,
        winner_registration_id,
        status,
        created_at,
        event:events(id, name, category, division, weight_class, gender),
        red_registration:registrations!matches_red_corner_registration_id_fkey(
          id,
          team_name,
          weigh_in_weight,
          is_approved,
          user_profile:profiles!registrations_user_id_fkey(id, full_name, email)
        ),
        blue_registration:registrations!matches_blue_corner_registration_id_fkey(
          id,
          team_name,
          weigh_in_weight,
          is_approved,
          user_profile:profiles!registrations_user_id_fkey(id, full_name, email)
        )
      `)
      .eq('tournament_id', tournamentId)
      .eq('status', 'SCHEDULED')
      .not('red_corner_registration_id', 'is', null)
      .not('blue_corner_registration_id', 'is', null)
      .order('round_number', { ascending: true })
      .order('match_number', { ascending: true });

    if (error) {
      console.error('Error fetching assignable matches:', error);
      throw new Error(`Failed to load assignable matches: ${error.message}`);
    }

    // Filter out matches that already have an active ASSIGNED or LIVE court assignment
    const { data: activeAssignments, error: activeError } = await supabase
      .from('court_assignments')
      .select('match_id')
      .in('status', ['ASSIGNED', 'LIVE']);

    if (activeError) {
      console.error('Error checking active assignments:', activeError);
      throw new Error(`Failed to verify active court assignments: ${activeError.message}`);
    }

    const assignedMatchIds = new Set((activeAssignments || []).map((a) => a.match_id));
    const availableMatches = (matches || []).filter((m) => !assignedMatchIds.has(m.id));

    return (availableMatches as unknown) as Match[];
  },

  // 3. Assign a match to a court via RPC
  async assignMatchToCourt(matchId: string, courtId: string): Promise<{ success: boolean; assignment_id: string }> {
    const { data, error } = await supabase.rpc('assign_match_to_court', {
      p_match_id: matchId,
      p_court_id: courtId,
    });

    if (error) {
      console.error('assign_match_to_court RPC error:', error);
      throw new Error(error.message || 'Failed to assign match to court');
    }

    return data as { success: boolean; assignment_id: string };
  },

  // 4. Start a court match via RPC (Transitions assignment to LIVE, match to IN_PROGRESS)
  async startCourtMatch(assignmentId: string): Promise<{ success: boolean; match_id: string; court_id: string }> {
    const { data, error } = await supabase.rpc('start_court_match', {
      p_court_assignment_id: assignmentId,
    });

    if (error) {
      console.error('start_court_match RPC error:', error);
      throw new Error(error.message || 'Failed to start court match');
    }

    return data as { success: boolean; match_id: string; court_id: string };
  },

  // 5. Complete a court match via RPC (Declares winner, advances bracket, marks assignment COMPLETED)
  async completeCourtMatch(
    matchId: string,
    winnerRegistrationId: string,
    decisionType: DecisionType
  ): Promise<{
    success: boolean;
    winner_registration_id: string;
    decision_type: string;
    advanced_to_parent: boolean;
  }> {
    const { data, error } = await supabase.rpc('complete_court_match', {
      p_match_id: matchId,
      p_winner_registration_id: winnerRegistrationId,
      p_decision_type: decisionType,
    });

    if (error) {
      console.error('complete_court_match RPC error:', error);
      throw new Error(error.message || 'Failed to complete court match');
    }

    return data as {
      success: boolean;
      winner_registration_id: string;
      decision_type: string;
      advanced_to_parent: boolean;
    };
  },

  // 6. Cancel a match assignment via RPC
  async cancelMatchAssignment(assignmentId: string, reason?: string): Promise<{ success: boolean }> {
    const { data, error } = await supabase.rpc('cancel_match_assignment', {
      p_court_assignment_id: assignmentId,
      p_reason: reason || null,
    });

    if (error) {
      console.error('cancel_match_assignment RPC error:', error);
      throw new Error(error.message || 'Failed to cancel match assignment');
    }

    return data as { success: boolean };
  },

  // 7. Get match details by ID
  async getMatchDetails(matchId: string): Promise<Match | null> {
    const { data, error } = await supabase
      .from('matches')
      .select(`
        id,
        tournament_id,
        event_id,
        bracket_node_index,
        round_number,
        match_number,
        court_identifier,
        red_corner_registration_id,
        blue_corner_registration_id,
        winner_registration_id,
        status,
        created_at,
        event:events(id, name, category, division, weight_class, gender),
        red_registration:registrations!matches_red_corner_registration_id_fkey(
          id,
          team_name,
          weigh_in_weight,
          is_approved,
          user_profile:profiles!registrations_user_id_fkey(id, full_name, email)
        ),
        blue_registration:registrations!matches_blue_corner_registration_id_fkey(
          id,
          team_name,
          weigh_in_weight,
          is_approved,
          user_profile:profiles!registrations_user_id_fkey(id, full_name, email)
        )
      `)
      .eq('id', matchId)
      .single();

    if (error) {
      console.error('Error fetching match details:', error);
      return null;
    }

    return (data as unknown) as Match;
  },

  // 8. Record round score via RPC
  async recordRoundScore(
    matchId: string,
    roundNumber: number,
    redScore: number,
    blueScore: number,
    redAdvantage: boolean = false,
    blueAdvantage: boolean = false,
    winnerCorner: CornerColor | null = null,
    isConfirmed: boolean = false
  ): Promise<{ success: boolean; round_id: string }> {
    const { data, error } = await supabase.rpc('record_round_score', {
      p_match_id: matchId,
      p_round_number: roundNumber,
      p_red_score: redScore,
      p_blue_score: blueScore,
      p_red_advantage: redAdvantage,
      p_blue_advantage: blueAdvantage,
      p_winner_corner: winnerCorner,
      p_is_confirmed: isConfirmed,
    });

    if (error) {
      console.error('record_round_score RPC error:', error);
      throw new Error(error.message || 'Failed to record round score');
    }

    return data as { success: boolean; round_id: string };
  },

  // 9. Fetch persisted scoring rounds for a match
  async getScoringRounds(matchId: string): Promise<ScoringRound[]> {
    const { data, error } = await supabase
      .from('scoring_rounds')
      .select('*')
      .eq('match_id', matchId)
      .order('round_number', { ascending: true });

    if (error) {
      console.error('Error fetching scoring rounds:', error);
      return [];
    }

    return (data as ScoringRound[]) || [];
  },

  // 10. Check if user is an event-scoped official or permanent admin for tournament via authoritative RPC
  async checkOfficialAuthority(
    userId: string,
    tournamentId: string,
    eventId?: string,
    courtId?: string,
    allowCourtManager: boolean = true
  ): Promise<boolean> {
    if (!userId || (!tournamentId && !eventId)) return false;

    const { data, error } = await supabase.rpc('is_authorized_tournament_official', {
      p_user_id: userId,
      p_tournament_id: tournamentId || null,
      p_event_id: eventId || null,
      p_court_id: courtId || null,
      p_allow_court_manager: allowCourtManager,
    });

    if (error) {
      console.warn('is_authorized_tournament_official RPC check warning:', error.message);
      return false;
    }

    return Boolean(data);
  },
};
