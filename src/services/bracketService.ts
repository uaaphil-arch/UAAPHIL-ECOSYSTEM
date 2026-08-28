import { supabase } from '../lib/supabase';
import { Match, TournamentEvent, Registration } from '../types/tournament';
import {
  BracketGenerationResult,
  BracketNode,
  BracketParticipant,
  BracketRound,
  EventBracket,
  BracketSummary,
} from '../types/brackets';

export function normalizeBracketError(error: unknown): string {
  if (!error) return 'An unexpected error occurred.';
  const err = error as { code?: string; message?: string; details?: string };
  const message = err.message || 'Unknown database error';
  const code = err.code ? `[SQLSTATE ${err.code}] ` : '';

  if (err.code === '40100') {
    return `${code}Authentication required. Please sign in to generate tournament brackets.`;
  }
  if (err.code === '40300') {
    return `${code}Permission denied: Only SUPER_ADMIN or ADMIN can generate tournament brackets.`;
  }
  if (err.code === '22000') {
    return `${code}Operation rejected: ${message}`;
  }
  if (err.code === '42501') {
    return `${code}Permission denied: ${message}`;
  }
  if (err.code === 'P0002') {
    return `${code}Target tournament not found.`;
  }
  return `${code}${message}`;
}

export const bracketService = {
  /**
   * Calls the authoritative database RPC to generate tournament brackets from the frozen snapshot.
   * Enforces backend security, snapshot validation, and regeneration locks.
   */
  async generateTournamentBrackets(tournamentId: string): Promise<BracketGenerationResult> {
    try {
      const { data, error } = await supabase.rpc('generate_tournament_brackets', {
        p_tournament_id: tournamentId,
      });

      if (error) {
        console.error('Error in generate_tournament_brackets RPC:', error);
        throw error;
      }

      return data as BracketGenerationResult;
    } catch (err) {
      throw new Error(normalizeBracketError(err));
    }
  },

  /**
   * Fetches all matches for a tournament with full event and registration associations.
   */
  async getTournamentBracketMatches(tournamentId: string): Promise<Match[]> {
    try {
      const { data, error } = await supabase
        .from('matches')
        .select(`
          *,
          event:events (
            id,
            name,
            gender,
            division,
            category,
            weight_class
          ),
          red_registration:registrations!matches_red_corner_registration_id_fkey (
            id,
            team_name,
            weigh_in_weight,
            is_approved,
            user_id,
            user_profile:profiles!registrations_user_id_fkey (
              id,
              full_name,
              email
            )
          ),
          blue_registration:registrations!matches_blue_corner_registration_id_fkey (
            id,
            team_name,
            weigh_in_weight,
            is_approved,
            user_id,
            user_profile:profiles!registrations_user_id_fkey (
              id,
              full_name,
              email
            )
          ),
          winner_registration:registrations!matches_winner_registration_id_fkey (
            id,
            team_name,
            is_approved,
            user_id,
            user_profile:profiles!registrations_user_id_fkey (
              id,
              full_name,
              email
            )
          )
        `)
        .eq('tournament_id', tournamentId)
        .order('round_number', { ascending: false })
        .order('match_number', { ascending: true });

      if (error) {
        console.error('Error fetching tournament bracket matches:', error);
        throw error;
      }

      return (data || []) as unknown as Match[];
    } catch (err) {
      throw new Error(normalizeBracketError(err));
    }
  },

  /**
   * Fetches all matches for a specific event with joined registration data.
   */
  async getEventBracketMatches(eventId: string): Promise<Match[]> {
    try {
      const { data, error } = await supabase
        .from('matches')
        .select(`
          *,
          event:events (
            id,
            name,
            gender,
            division,
            category,
            weight_class
          ),
          red_registration:registrations!matches_red_corner_registration_id_fkey (
            id,
            team_name,
            weigh_in_weight,
            is_approved,
            user_id,
            user_profile:profiles!registrations_user_id_fkey (
              id,
              full_name,
              email
            )
          ),
          blue_registration:registrations!matches_blue_corner_registration_id_fkey (
            id,
            team_name,
            weigh_in_weight,
            is_approved,
            user_id,
            user_profile:profiles!registrations_user_id_fkey (
              id,
              full_name,
              email
            )
          ),
          winner_registration:registrations!matches_winner_registration_id_fkey (
            id,
            team_name,
            is_approved,
            user_id,
            user_profile:profiles!registrations_user_id_fkey (
              id,
              full_name,
              email
            )
          )
        `)
        .eq('event_id', eventId)
        .order('round_number', { ascending: false })
        .order('bracket_node_index', { ascending: true });

      if (error) {
        console.error('Error fetching event bracket matches:', error);
        throw error;
      }

      return (data || []) as unknown as Match[];
    } catch (err) {
      throw new Error(normalizeBracketError(err));
    }
  },

  /**
   * Summarizes bracket health and status across a tournament.
   */
  async getBracketSummary(tournamentId: string): Promise<BracketSummary> {
    try {
      const { data, error } = await supabase
        .from('matches')
        .select('id, event_id, status, court_identifier')
        .eq('tournament_id', tournamentId);

      if (error) {
        console.error('Error fetching bracket summary:', error);
        throw error;
      }

      const matches = data || [];
      const eventSet = new Set<string>();
      let completedCount = 0;
      let liveCount = 0;
      let scheduledCount = 0;
      let byesCount = 0;
      let hasActiveOrCompleted = false;

      matches.forEach((m) => {
        if (m.event_id) eventSet.add(m.event_id);

        if (m.court_identifier === 'BYE') {
          byesCount++;
        } else if (m.status === 'COMPLETED') {
          completedCount++;
          hasActiveOrCompleted = true;
        } else if (m.status === 'IN_PROGRESS') {
          liveCount++;
          hasActiveOrCompleted = true;
        } else if (m.status === 'SCHEDULED') {
          scheduledCount++;
        }
      });

      return {
        tournament_id: tournamentId,
        total_events: eventSet.size,
        total_bracket_nodes: matches.length,
        total_byes: byesCount,
        completed_matches: completedCount,
        live_matches: liveCount,
        scheduled_matches: scheduledCount,
        has_active_or_completed_matches: hasActiveOrCompleted,
      };
    } catch (err) {
      throw new Error(normalizeBracketError(err));
    }
  },

  /**
   * Transforms flat database matches into structured tree rounds for visual rendering.
   */
  buildEventBracket(event: TournamentEvent, matches: Match[]): EventBracket {
    const isAnyo =
      event.name?.toLowerCase().includes('anyo') ||
      (typeof event.category === 'string' && event.category.toLowerCase().includes('anyo')) ||
      false;

    if (!matches || matches.length === 0) {
      return {
        event,
        is_anyo: isAnyo,
        rounds: [],
        total_matches: 0,
        completed_matches: 0,
        live_matches: 0,
        scheduled_matches: 0,
        byes_count: 0,
      };
    }

    // Filter to matches belonging strictly to this event
    const eventMatches = matches.filter((m) => m.event_id === event.id);

    // Group matches by round_number
    const roundMap = new Map<number, Match[]>();
    let maxRound = 1;

    eventMatches.forEach((m) => {
      const rNum = m.round_number || 1;
      if (rNum > maxRound) maxRound = rNum;
      if (!roundMap.has(rNum)) {
        roundMap.set(rNum, []);
      }
      roundMap.get(rNum)!.push(m);
    });

    const rounds: BracketRound[] = [];
    let completedCount = 0;
    let liveCount = 0;
    let scheduledCount = 0;
    let byesCount = 0;

    // Build rounds starting from Round 1 up to Finals
    // (Sort rounds in chronological tournament order: Round 1 -> Round 2 -> Quarters -> Semis -> Finals)
    const sortedRoundNumbers = Array.from(roundMap.keys()).sort((a, b) => a - b);

    sortedRoundNumbers.forEach((rNum) => {
      const rawMatches = roundMap.get(rNum) || [];
      // Sort matches by match_number or bracket_node_index
      rawMatches.sort((a, b) => (a.match_number || 0) - (b.match_number || 0));

      const roundName = getRoundDisplayName(rNum, maxRound);

      const nodes: BracketNode[] = rawMatches.map((m) => {
        const isBye = m.court_identifier === 'BYE';
        const isLive = m.status === 'IN_PROGRESS';
        const isCompleted = m.status === 'COMPLETED';

        if (isBye) byesCount++;
        else if (isCompleted) completedCount++;
        else if (isLive) liveCount++;
        else if (m.status === 'SCHEDULED') scheduledCount++;

        const redReg = m.red_registration;
        const blueReg = m.blue_registration;

        const redName = isBye && !redReg && blueReg
          ? 'BYE'
          : getRegistrationDisplayName(redReg, m.red_corner_registration_id ? 'Athlete (Red)' : 'TBD / Advancing');

        const blueName = isBye && !blueReg && redReg
          ? 'BYE'
          : getRegistrationDisplayName(blueReg, m.blue_corner_registration_id ? 'Athlete (Blue)' : 'TBD / Advancing');

        const redPart: BracketParticipant = {
          registration_id: m.red_corner_registration_id,
          athlete_name: redName,
          club_or_school: getRegistrationClub(redReg),
          corner: 'RED',
          is_bye: isBye && !m.red_corner_registration_id,
        };

        const bluePart: BracketParticipant = {
          registration_id: m.blue_corner_registration_id,
          athlete_name: blueName,
          club_or_school: getRegistrationClub(blueReg),
          corner: 'BLUE',
          is_bye: isBye && !m.blue_corner_registration_id,
        };

        let winnerCorner: 'RED' | 'BLUE' | null = null;
        if (m.winner_registration_id) {
          if (m.winner_registration_id === m.red_corner_registration_id) {
            winnerCorner = 'RED';
          } else if (m.winner_registration_id === m.blue_corner_registration_id) {
            winnerCorner = 'BLUE';
          }
        }

        return {
          match_id: m.id,
          event_id: m.event_id,
          tournament_id: m.tournament_id || '',
          bracket_node_index: m.bracket_node_index || 0,
          round_number: rNum,
          round_name: m.round_name || roundName,
          match_number: m.match_number || 0,
          court_identifier: m.court_identifier,
          status: m.status,
          red_participant: redPart,
          blue_participant: bluePart,
          winner_registration_id: m.winner_registration_id,
          winner_corner: winnerCorner,
          next_match_id: m.next_match_id,
          next_match_corner: m.next_match_corner,
          is_bye_node: isBye,
          is_live: isLive,
          is_completed: isCompleted,
          raw_match: m,
        };
      });

      rounds.push({
        round_number: rNum,
        round_name: roundName,
        nodes,
      });
    });

    return {
      event,
      is_anyo: isAnyo,
      rounds,
      total_matches: eventMatches.length,
      completed_matches: completedCount,
      live_matches: liveCount,
      scheduled_matches: scheduledCount,
      byes_count: byesCount,
    };
  },

  /**
   * Subscribes to real-time changes on matches for the tournament.
   */
  subscribeToMatches(tournamentId: string, onUpdate: () => void) {
    const channel = supabase
      .channel(`tournament-bracket-${tournamentId}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'matches',
          filter: `tournament_id=eq.${tournamentId}`,
        },
        () => {
          onUpdate();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },
};

/**
 * Derives official single-elimination round labels based on tree distance from finals.
 */
function getRoundDisplayName(roundNumber: number, maxRound: number): string {
  const diffFromFinal = maxRound - roundNumber;
  switch (diffFromFinal) {
    case 0:
      return 'Finals';
    case 1:
      return 'Semi-Finals';
    case 2:
      return 'Quarter-Finals';
    case 3:
      return 'Round of 16';
    case 4:
      return 'Round of 32';
    case 5:
      return 'Round of 64';
    default:
      return roundNumber === 0 ? 'Battle for Bronze' : `Round ${roundNumber}`;
  }
}

function getRegistrationDisplayName(reg?: any, fallback?: string): string {
  if (!reg) return fallback || 'TBD / Advancing';
  if (reg.full_name) return reg.full_name;
  if (reg.user_profile?.full_name) return reg.user_profile.full_name;
  if (reg.team_name) return reg.team_name;
  return fallback || 'TBD / Advancing';
}

function getRegistrationClub(reg?: any): string {
  if (!reg) return '';
  if (reg.school_club) return reg.school_club;
  if (reg.team_name) return reg.team_name;
  return '';
}

