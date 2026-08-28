import { supabase } from '../lib/supabase';
import {
  PublicScheduledMatch,
  PublicCourtOverview,
  PublicTournamentScheduleSummary,
  AthleteSearchResultItem,
  RealtimeSyncState,
} from '../types/publicSchedule';

/**
 * Normalizes athlete names and school/club information without exposing private registration records.
 */
function extractPublicAthleteInfo(reg: any, cornerLabel: string) {
  if (!reg) {
    return {
      registration_id: null,
      full_name: cornerLabel,
      school_club: '',
      team_name: '',
      gender: null,
    };
  }

  const name =
    reg.user_profile?.full_name ||
    reg.team_name ||
    cornerLabel;

  const club = reg.team_name || '';

  return {
    registration_id: reg.id || null,
    full_name: name,
    school_club: club,
    team_name: club,
    gender: null,
  };
}

/**
 * Maps a raw match record joined with event & registrations to a safe, public scheduled match.
 */
function mapToPublicScheduledMatch(m: any): PublicScheduledMatch {
  const isBye =
    m.court_identifier === 'BYE' ||
    (!m.red_corner_registration_id && m.blue_corner_registration_id) ||
    (!m.blue_corner_registration_id && m.red_corner_registration_id);

  const redAthlete = extractPublicAthleteInfo(
    m.red_registration,
    isBye && !m.red_corner_registration_id ? 'BYE' : m.red_corner_registration_id ? 'Athlete (Red)' : 'TBD'
  );

  const blueAthlete = extractPublicAthleteInfo(
    m.blue_registration,
    isBye && !m.blue_corner_registration_id ? 'BYE' : m.blue_corner_registration_id ? 'Athlete (Blue)' : 'TBD'
  );

  const eventName = m.event?.name || 'Tournament Event';
  const divName = typeof m.event?.division === 'string' ? m.event.division : 'Open Division';
  const catName = typeof m.event?.category === 'string' ? m.event.category : 'Open Category';
  const gender = m.event?.gender || 'Open';
  const weight = m.event?.weight_class || 'Standard';

  let winnerCorner: 'RED' | 'BLUE' | null = null;
  if (m.winner_registration_id) {
    if (m.winner_registration_id === m.red_corner_registration_id) winnerCorner = 'RED';
    else if (m.winner_registration_id === m.blue_corner_registration_id) winnerCorner = 'BLUE';
  }

  return {
    id: m.id,
    match_number: m.match_number || 0,
    tournament_id: m.tournament_id,
    event_id: m.event_id,
    event_name: eventName,
    division_name: divName,
    category_name: catName,
    gender,
    weight_class: weight,
    round_name: `Round ${m.round_number || 1}`,
    round_number: m.round_number || 1,
    court_identifier: m.court_identifier || 'Unassigned',
    status: (m.status as any) || 'SCHEDULED',
    scheduled_time: m.scheduled_time || null,
    started_at: m.started_at || null,
    completed_at: m.completed_at || null,
    red_athlete: redAthlete,
    blue_athlete: blueAthlete,
    winner_registration_id: m.winner_registration_id || null,
    winner_corner: winnerCorner,
    bracket_node_index: m.bracket_node_index,
  };
}

export const publicScheduleService = {
  /**
   * Reads the full public tournament schedule with multi-court categorization.
   * STRICTLY READ-ONLY. Zero mutations.
   */
  async getPublicTournamentSchedule(tournamentId: string): Promise<PublicTournamentScheduleSummary> {
    try {
      // 1. Fetch tournament basic info
      const { data: tournament, error: tourneyErr } = await supabase
        .from('tournaments')
        .select('id, name')
        .eq('id', tournamentId)
        .single();

      if (tourneyErr) throw tourneyErr;

      // 2. Fetch courts for the tournament
      const { data: courtsData, error: courtsErr } = await supabase
        .from('courts')
        .select('id, name, identifier, is_active')
        .eq('tournament_id', tournamentId)
        .order('identifier', { ascending: true });

      if (courtsErr) throw courtsErr;

      // 3. Fetch all matches with event and registration info
      const { data: matchesData, error: matchesErr } = await supabase
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
          event:events (
            id,
            name,
            gender,
            weight_class,
            category,
            division
          ),
          red_registration:registrations!matches_red_corner_registration_id_fkey (
            id,
            user_id,
            team_name,
            weigh_in_weight,
            is_approved,
            user_profile:profiles!registrations_user_id_fkey (
              id,
              full_name
            )
          ),
          blue_registration:registrations!matches_blue_corner_registration_id_fkey (
            id,
            user_id,
            team_name,
            weigh_in_weight,
            is_approved,
            user_profile:profiles!registrations_user_id_fkey (
              id,
              full_name
            )
          ),
          winner_registration:registrations!matches_winner_registration_id_fkey (
            id,
            user_id,
            team_name,
            user_profile:profiles!registrations_user_id_fkey (
              id,
              full_name
            )
          )
        `)
        .eq('tournament_id', tournamentId)
        .order('match_number', { ascending: true });

      if (matchesErr) throw matchesErr;

      const mappedMatches: PublicScheduledMatch[] = (matchesData || [])
        .filter((m) => m.court_identifier !== 'BYE') // Keep actual competition matches for the arena board
        .map(mapToPublicScheduledMatch);

      // 4. Build court overviews
      const courtsList = courtsData || [];
      const courtOverviews: PublicCourtOverview[] = courtsList.map((c) => {
        const courtIdStr = c.identifier || c.name;
        const courtMatches = mappedMatches.filter(
          (m) => m.court_identifier?.toLowerCase() === courtIdStr?.toLowerCase()
        );

        const nowPlaying = courtMatches.find((m) => m.status === 'IN_PROGRESS') || null;
        const upcomingMatches = courtMatches.filter((m) => m.status === 'SCHEDULED');
        const onDeck = upcomingMatches.length > 0 ? upcomingMatches[0] : null;
        const completedMatchesCount = courtMatches.filter((m) => m.status === 'COMPLETED').length;

        return {
          court_id: c.id,
          court_name: c.name || `Ring ${c.identifier}`,
          court_identifier: c.identifier,
          is_active: c.is_active,
          now_playing: nowPlaying,
          on_deck: onDeck,
          in_queue_count: upcomingMatches.length,
          upcoming_matches: upcomingMatches,
          completed_matches_count: completedMatchesCount,
        };
      });

      const totalMatches = mappedMatches.length;
      const completedMatches = mappedMatches.filter((m) => m.status === 'COMPLETED').length;
      const inProgressMatches = mappedMatches.filter((m) => m.status === 'IN_PROGRESS').length;
      const scheduledMatches = mappedMatches.filter((m) => m.status === 'SCHEDULED').length;

      return {
        tournament_id: tournament?.id || tournamentId,
        tournament_name: tournament?.name || 'Tournament Schedule',
        total_matches: totalMatches,
        completed_matches: completedMatches,
        in_progress_matches: inProgressMatches,
        scheduled_matches: scheduledMatches,
        courts: courtOverviews,
        all_matches: mappedMatches,
      };
    } catch (err: any) {
      console.error('Error fetching public tournament schedule:', err);
      throw new Error(err.message || 'Failed to load public tournament schedule.');
    }
  },

  /**
   * Searches for upcoming and completed matches for a given athlete name or school/club.
   */
  async searchAthleteSchedule(
    tournamentId: string,
    query: string
  ): Promise<AthleteSearchResultItem[]> {
    if (!query.trim()) return [];
    const q = query.trim().toLowerCase();

    try {
      const schedule = await this.getPublicTournamentSchedule(tournamentId);
      const results: AthleteSearchResultItem[] = [];

      schedule.all_matches.forEach((m) => {
        // Check Red
        const redNameMatch = m.red_athlete.full_name.toLowerCase().includes(q);
        const redClubMatch = m.red_athlete.school_club.toLowerCase().includes(q);
        if (redNameMatch || redClubMatch) {
          results.push({
            match: m,
            athlete: m.red_athlete,
            corner: 'RED',
            is_winner: m.winner_corner === 'RED',
          });
        }

        // Check Blue
        const blueNameMatch = m.blue_athlete.full_name.toLowerCase().includes(q);
        const blueClubMatch = m.blue_athlete.school_club.toLowerCase().includes(q);
        if (blueNameMatch || blueClubMatch) {
          results.push({
            match: m,
            athlete: m.blue_athlete,
            corner: 'BLUE',
            is_winner: m.winner_corner === 'BLUE',
          });
        }
      });

      return results;
    } catch (err) {
      console.error('Error searching athlete schedule:', err);
      return [];
    }
  },

  /**
   * Sets up a real-time Postgres subscription for matches and court status.
   * Debounces updates and triggers the onUpdate callback.
   */
  subscribeToPublicSchedule(
    tournamentId: string,
    onUpdate: () => void,
    onStatusChange?: (status: RealtimeSyncState) => void
  ): () => void {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const debouncedRefresh = () => {
      if (onStatusChange) onStatusChange('SYNCING');
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        onUpdate();
        if (onStatusChange) onStatusChange('CONNECTED');
      }, 300);
    };

    const channel = supabase
      .channel(`public_arena_schedule_${tournamentId}_${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'matches',
          filter: `tournament_id=eq.${tournamentId}`,
        },
        () => {
          debouncedRefresh();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'courts',
          filter: `tournament_id=eq.${tournamentId}`,
        },
        () => {
          debouncedRefresh();
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (onStatusChange) onStatusChange('CONNECTED');
        } else if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
          if (onStatusChange) onStatusChange('RECONNECTING');
        } else if (status === 'CLOSED') {
          if (onStatusChange) onStatusChange('OFFLINE');
        }
      });

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  },
};
