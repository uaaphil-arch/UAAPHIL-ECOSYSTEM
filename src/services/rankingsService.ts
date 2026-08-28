import { supabase } from '../lib/supabase';
import { TeamMedalTally, AthleteStanding, EventPodium, TournamentStandingsSummary } from '../types/rankings';

export const rankingsService = {
  /**
   * Fetch official Team / Club Medal Tally for a tournament.
   * Leverages authoritative PostgreSQL RPC with client-side snapshot fallback.
   */
  async getTeamMedalTally(tournamentId: string): Promise<TeamMedalTally[]> {
    if (!tournamentId) return [];

    try {
      const { data, error } = await supabase.rpc('get_tournament_medal_tally', {
        p_tournament_id: tournamentId
      });

      if (!error && Array.isArray(data)) {
        return data as TeamMedalTally[];
      }
    } catch {
      // Fall through to client snapshot calculation
    }

    return this.calculateClientSideTally(tournamentId);
  },

  /**
   * Fetch official Athlete Individual Standings.
   */
  async getAthleteStandings(tournamentId: string): Promise<AthleteStanding[]> {
    if (!tournamentId) return [];

    try {
      const { data, error } = await supabase.rpc('get_tournament_athlete_standings', {
        p_tournament_id: tournamentId
      });

      if (!error && Array.isArray(data)) {
        return data as AthleteStanding[];
      }
    } catch {
      // Fall through to client fallback
    }

    return this.calculateClientSideAthleteStandings(tournamentId);
  },

  /**
   * Fetch Event Podiums (Gold, Silver, Bronze for each category).
   */
  async getEventPodiums(tournamentId: string): Promise<EventPodium[]> {
    if (!tournamentId) return [];

    try {
      const { data, error } = await supabase.rpc('get_tournament_event_podiums', {
        p_tournament_id: tournamentId
      });

      if (!error && Array.isArray(data)) {
        return data as EventPodium[];
      }
    } catch {
      // Fall through to client fallback
    }

    return this.calculateClientSidePodiums(tournamentId);
  },

  /**
   * Fetch Tournament Standings Summary (Progress, Total Medals, Provisional status).
   */
  async getStandingsSummary(tournamentId: string): Promise<TournamentStandingsSummary | null> {
    if (!tournamentId) return null;

    try {
      const { data, error } = await supabase.rpc('get_tournament_standings_summary', {
        p_tournament_id: tournamentId
      });

      if (!error && data && !data.error) {
        return data as TournamentStandingsSummary;
      }
    } catch {
      // Fall through
    }

    const { data: tourney } = await supabase
      .from('tournaments')
      .select('*')
      .eq('id', tournamentId)
      .single();

    if (!tourney) return null;

    const podiums = await this.calculateClientSidePodiums(tournamentId);
    let totalGold = 0;
    let totalSilver = 0;
    let totalBronze = 0;
    let finalizedEvents = 0;

    podiums.forEach(p => {
      if (p.status === 'FINALIZED' || p.status === 'COMPLETED') {
        finalizedEvents++;
        if (p.gold_winner) totalGold++;
        if (p.silver_winner) totalSilver++;
        totalBronze += p.bronze_winners.length;
      }
    });

    // Scoped unique teams and athletes derivation via snapshot -> events -> registrations
    const { data: snapshots } = await supabase
      .from('tournament_snapshots')
      .select('id')
      .eq('tournament_id', tournamentId);

    const snapshotIds = (snapshots || []).map(s => s.id);
    let teamsCount = 0;
    let athletesCount = 0;

    if (snapshotIds.length > 0) {
      const { data: tourneyEvents } = await supabase
        .from('events')
        .select('id')
        .in('snapshot_id', snapshotIds);

      const eventIds = (tourneyEvents || []).map(e => e.id);
      if (eventIds.length > 0) {
        const { data: regs } = await supabase
          .from('registrations')
          .select('user_id, team_name')
          .in('event_id', eventIds);

        const uniqueTeams = new Set((regs || []).map(r => r.team_name).filter(Boolean));
        const uniqueAthletes = new Set((regs || []).map(r => r.user_id).filter(Boolean));
        teamsCount = uniqueTeams.size;
        athletesCount = uniqueAthletes.size;
      }
    }

    return {
      tournament_id: tourney.id,
      tournament_name: tourney.name,
      status: tourney.status,
      is_provisional: finalizedEvents < podiums.length || podiums.length === 0,
      total_events: podiums.length,
      finalized_events: finalizedEvents,
      total_gold_awarded: totalGold,
      total_silver_awarded: totalSilver,
      total_bronze_awarded: totalBronze,
      total_medals_awarded: totalGold + totalSilver + totalBronze,
      teams_competing: teamsCount,
      athletes_competing: athletesCount
    };
  },

  /**
   * Client-side snapshot calculation of event podiums adhering to frozen bracket_system rules.
   */
  async calculateClientSidePodiums(tournamentId: string): Promise<EventPodium[]> {
    // 1. Fetch Tournament Snapshots & Config
    const { data: snapshots } = await supabase
      .from('tournament_snapshots')
      .select('id, configuration, is_active')
      .eq('tournament_id', tournamentId)
      .order('created_at', { ascending: false });

    const snapshotIds = (snapshots || []).map(s => s.id);
    if (snapshotIds.length === 0) return [];

    const activeSnapshot = snapshots?.find(s => s.is_active) || snapshots?.[0];

    // Fetch Tournament Events by snapshot_id
    const { data: events } = await supabase
      .from('events')
      .select('*')
      .in('snapshot_id', snapshotIds)
      .order('name', { ascending: true });

    if (!events || events.length === 0) return [];

    const snapshotEvents: Array<{ id: string; rules_override?: Record<string, unknown>; category_configuration?: Record<string, unknown>; bracket_system?: string }> = 
      (activeSnapshot?.configuration as { events?: Array<{ id: string; rules_override?: Record<string, unknown>; category_configuration?: Record<string, unknown>; bracket_system?: string }> })?.events || [];

    // 2. Fetch Anyo finalized sessions
    const { data: anyoSessions } = await supabase
      .from('anyo_category_sessions')
      .select('id, event_id, status')
      .eq('tournament_id', tournamentId);

    const anyoSessionMap = new Map((anyoSessions || []).map(s => [s.event_id, s]));

    // Fetch Anyo performances if any sessions exist
    const sessionIds = (anyoSessions || []).filter(s => s.status === 'FINALIZED').map(s => s.id);
    let anyoPerformances: Array<{ session_id: string; registration_id: string; performer_name: string; school_club: string; medal_awarded: string; final_score: number }> = [];

    if (sessionIds.length > 0) {
      const { data: perfs } = await supabase
        .from('anyo_performances')
        .select(`
          session_id,
          registration_id,
          medal_awarded,
          final_score,
          registration:registrations (
            id,
            team_name,
            user_profile:profiles!registrations_user_id_fkey (
              id,
              full_name
            )
          )
        `)
        .in('session_id', sessionIds)
        .in('medal_awarded', ['GOLD', 'SILVER', 'BRONZE']);

      anyoPerformances = (perfs || []).map((p: any) => ({
        session_id: p.session_id,
        registration_id: p.registration_id,
        performer_name: p.registration?.user_profile?.full_name || 'Performer',
        school_club: p.registration?.team_name || 'Club',
        medal_awarded: p.medal_awarded,
        final_score: p.final_score
      }));
    }

    // 3. Fetch Sparring matches & results
    const { data: matches } = await supabase
      .from('matches')
      .select(`
        id, event_id, status, bracket_node_index, red_corner_registration_id, blue_corner_registration_id, winner_registration_id,
        match_results (winner_registration_id, is_official)
      `)
      .eq('tournament_id', tournamentId);

    // Collect all relevant registration IDs to fetch athlete names & club names
    const allRegIds = new Set<string>();
    matches?.forEach(m => {
      if (m.red_corner_registration_id) allRegIds.add(m.red_corner_registration_id);
      if (m.blue_corner_registration_id) allRegIds.add(m.blue_corner_registration_id);
      if (m.winner_registration_id) allRegIds.add(m.winner_registration_id);
    });

    let regInfoMap = new Map<string, { athlete_name: string; team_name: string }>();
    if (allRegIds.size > 0) {
      const { data: regs } = await supabase
        .from('registrations')
        .select(`
          id, team_name, user_id,
          athlete_profile:profiles!registrations_user_id_fkey(full_name)
        `)
        .in('id', Array.from(allRegIds));

      regs?.forEach(r => {
        const prof = (r.athlete_profile as unknown) as { full_name?: string } | null;
        regInfoMap.set(r.id, {
          athlete_name: prof?.full_name || 'Athlete',
          team_name: r.team_name || 'Club'
        });
      });
    }

    const podiums: EventPodium[] = [];

    for (const evt of events) {
      const isAnyo = Boolean(
        evt.name?.toLowerCase().includes('anyo') ||
        evt.name?.toLowerCase().includes('form') ||
        evt.weight_category?.toLowerCase().includes('anyo') ||
        evt.is_team_event
      );

      if (isAnyo) {
        const sess = anyoSessionMap.get(evt.id);
        if (sess && sess.status === 'FINALIZED') {
          const sessPerfs = anyoPerformances.filter(p => p.session_id === sess.id);
          const goldPerf = sessPerfs.find(p => p.medal_awarded === 'GOLD');
          const silverPerf = sessPerfs.find(p => p.medal_awarded === 'SILVER');
          const bronzePerfs = sessPerfs.filter(p => p.medal_awarded === 'BRONZE');

          podiums.push({
            event_id: evt.id,
            event_name: evt.name,
            gender_category: evt.gender_category,
            weight_category: evt.weight_category,
            is_anyo: true,
            status: 'FINALIZED',
            gold_winner: goldPerf ? {
              registration_id: goldPerf.registration_id,
              athlete_name: goldPerf.performer_name,
              team_name: goldPerf.school_club,
              final_score: goldPerf.final_score
            } : null,
            silver_winner: silverPerf ? {
              registration_id: silverPerf.registration_id,
              athlete_name: silverPerf.performer_name,
              team_name: silverPerf.school_club,
              final_score: silverPerf.final_score
            } : null,
            bronze_winners: bronzePerfs.map(b => ({
              registration_id: b.registration_id,
              athlete_name: b.performer_name,
              team_name: b.school_club,
              final_score: b.final_score
            }))
          });
        } else {
          podiums.push({
            event_id: evt.id,
            event_name: evt.name,
            gender_category: evt.gender_category,
            weight_category: evt.weight_category,
            is_anyo: true,
            status: (sess?.status as EventPodium['status']) || 'PENDING',
            gold_winner: null,
            silver_winner: null,
            bronze_winners: []
          });
        }
      } else {
        // Sparring / Full Contact
        const eventMatches = (matches || []).filter(m => m.event_id === evt.id);
        const finalMatch = eventMatches.find(m => m.bracket_node_index === 1);
        const isFinalCompleted = finalMatch && finalMatch.status === 'COMPLETED' && Boolean(finalMatch.winner_registration_id);

        if (isFinalCompleted && finalMatch) {
          const goldWinnerReg = finalMatch.winner_registration_id!;
          const silverWinnerReg = goldWinnerReg === finalMatch.red_corner_registration_id
            ? finalMatch.blue_corner_registration_id
            : finalMatch.red_corner_registration_id;

          const goldInfo = regInfoMap.get(goldWinnerReg);
          const silverInfo = silverWinnerReg ? regInfoMap.get(silverWinnerReg) : null;

          // Snapshot bracket_system rule check
          const snapEvt = snapshotEvents.find(e => e.id === evt.id);
          const rawBracketSystem = 
            (snapEvt?.rules_override?.bracket_model as string) ||
            (snapEvt?.rules_override?.bracket_system as string) ||
            (snapEvt?.category_configuration?.bracket_system as string) ||
            snapEvt?.bracket_system ||
            'SINGLE_ELIMINATION_TWO_BRONZE';

          const isOptionA = 
            rawBracketSystem === 'SINGLE_ELIMINATION_BRONZE_BOUT' ||
            rawBracketSystem === 'WITH_BATTLE_FOR_BRONZE';

          // Identify Semifinal 1 (node 2) & Semifinal 2 (node 3) losers
          const semi1 = eventMatches.find(m => m.bracket_node_index === 2 && m.status === 'COMPLETED');
          const semi2 = eventMatches.find(m => m.bracket_node_index === 3 && m.status === 'COMPLETED');

          const semi1Loser = semi1 ? (
            semi1.winner_registration_id === semi1.red_corner_registration_id
              ? semi1.blue_corner_registration_id
              : semi1.red_corner_registration_id
          ) : null;

          const semi2Loser = semi2 ? (
            semi2.winner_registration_id === semi2.red_corner_registration_id
              ? semi2.blue_corner_registration_id
              : semi2.red_corner_registration_id
          ) : null;

          const bronzeWinners: EventPodium['bronze_winners'] = [];

          if (isOptionA) {
            // Battle for Bronze Match: match node 0 between semi1Loser and semi2Loser
            const bronzeMatch = eventMatches.find(m =>
              m.status === 'COMPLETED' &&
              m.bracket_node_index !== 1 &&
              m.bracket_node_index !== 2 &&
              m.bracket_node_index !== 3 &&
              Boolean(m.winner_registration_id) &&
              (
                m.bracket_node_index === 0 ||
                (semi1Loser && semi2Loser && (
                  (m.red_corner_registration_id === semi1Loser && m.blue_corner_registration_id === semi2Loser) ||
                  (m.red_corner_registration_id === semi2Loser && m.blue_corner_registration_id === semi1Loser)
                ))
              )
            );

            if (bronzeMatch && bronzeMatch.winner_registration_id) {
              const bInfo = regInfoMap.get(bronzeMatch.winner_registration_id);
              if (bInfo) {
                bronzeWinners.push({
                  registration_id: bronzeMatch.winner_registration_id,
                  athlete_name: bInfo.athlete_name,
                  team_name: bInfo.team_name
                });
              }
            }
          } else {
            // TWO_BRONZE_NO_BATTLE: Both semifinal losers get Bronze
            if (semi1Loser) {
              const b1Info = regInfoMap.get(semi1Loser);
              if (b1Info) {
                bronzeWinners.push({
                  registration_id: semi1Loser,
                  athlete_name: b1Info.athlete_name,
                  team_name: b1Info.team_name
                });
              }
            }
            if (semi2Loser) {
              const b2Info = regInfoMap.get(semi2Loser);
              if (b2Info) {
                bronzeWinners.push({
                  registration_id: semi2Loser,
                  athlete_name: b2Info.athlete_name,
                  team_name: b2Info.team_name
                });
              }
            }
          }

          podiums.push({
            event_id: evt.id,
            event_name: evt.name,
            gender_category: evt.gender_category,
            weight_category: evt.weight_category,
            is_anyo: false,
            status: 'COMPLETED',
            gold_winner: goldInfo ? {
              registration_id: goldWinnerReg,
              athlete_name: goldInfo.athlete_name,
              team_name: goldInfo.team_name
            } : null,
            silver_winner: silverInfo && silverWinnerReg ? {
              registration_id: silverWinnerReg,
              athlete_name: silverInfo.athlete_name,
              team_name: silverInfo.team_name
            } : null,
            bronze_winners: bronzeWinners
          });
        } else {
          podiums.push({
            event_id: evt.id,
            event_name: evt.name,
            gender_category: evt.gender_category,
            weight_category: evt.weight_category,
            is_anyo: false,
            status: (finalMatch?.status as EventPodium['status']) || 'PENDING',
            gold_winner: null,
            silver_winner: null,
            bronze_winners: []
          });
        }
      }
    }

    return podiums;
  },

  /**
   * Client-side snapshot calculation fallback if RPC is not yet deployed remotely.
   */
  async calculateClientSideTally(tournamentId: string): Promise<TeamMedalTally[]> {
    const podiums = await this.calculateClientSidePodiums(tournamentId);

    const map: Record<string, { gold: number; silver: number; bronze: number }> = {};

    podiums.forEach(p => {
      if (p.status === 'FINALIZED' || p.status === 'COMPLETED') {
        if (p.gold_winner?.team_name) {
          const t = p.gold_winner.team_name;
          if (!map[t]) map[t] = { gold: 0, silver: 0, bronze: 0 };
          map[t].gold++;
        }
        if (p.silver_winner?.team_name) {
          const t = p.silver_winner.team_name;
          if (!map[t]) map[t] = { gold: 0, silver: 0, bronze: 0 };
          map[t].silver++;
        }
        p.bronze_winners.forEach(b => {
          if (b.team_name) {
            const t = b.team_name;
            if (!map[t]) map[t] = { gold: 0, silver: 0, bronze: 0 };
            map[t].bronze++;
          }
        });
      }
    });

    const entries = Object.keys(map).map(team_name => {
      const { gold, silver, bronze } = map[team_name];
      return {
        team_name,
        school_club: team_name,
        gold_count: gold,
        silver_count: silver,
        bronze_count: bronze,
        total_medals: gold + silver + bronze,
        rank: 1,
        rank_display: '1',
        is_tied: false
      };
    });

    // Olympic sort
    entries.sort((a, b) => {
      if (b.gold_count !== a.gold_count) return b.gold_count - a.gold_count;
      if (b.silver_count !== a.silver_count) return b.silver_count - a.silver_count;
      if (b.bronze_count !== a.bronze_count) return b.bronze_count - a.bronze_count;
      if (b.total_medals !== a.total_medals) return b.total_medals - a.total_medals;
      return a.team_name.localeCompare(b.team_name);
    });

    // Rank & ties
    for (let i = 0; i < entries.length; i++) {
      if (i > 0) {
        const prev = entries[i - 1];
        const curr = entries[i];
        if (
          curr.gold_count === prev.gold_count &&
          curr.silver_count === prev.silver_count &&
          curr.bronze_count === prev.bronze_count &&
          curr.total_medals === prev.total_medals
        ) {
          entries[i].rank = prev.rank;
          entries[i].is_tied = true;
          entries[i - 1].is_tied = true;
        } else {
          entries[i].rank = i + 1;
        }
      }
    }

    entries.forEach(e => {
      e.rank_display = e.is_tied ? `T-${e.rank}` : `${e.rank}`;
    });

    return entries;
  },

  /**
   * Client-side athlete individual standings calculation fallback.
   */
  async calculateClientSideAthleteStandings(tournamentId: string): Promise<AthleteStanding[]> {
    const podiums = await this.calculateClientSidePodiums(tournamentId);

    const map: Record<string, {
      registration_id: string;
      athlete_name: string;
      team_name: string;
      gold: number;
      silver: number;
      bronze: number;
      events_participated: number;
      events_won: number;
    }> = {};

    podiums.forEach(p => {
      if (p.status === 'FINALIZED' || p.status === 'COMPLETED') {
        if (p.gold_winner) {
          const id = p.gold_winner.registration_id;
          if (!map[id]) {
            map[id] = {
              registration_id: id,
              athlete_name: p.gold_winner.athlete_name,
              team_name: p.gold_winner.team_name,
              gold: 0,
              silver: 0,
              bronze: 0,
              events_participated: 0,
              events_won: 0
            };
          }
          map[id].gold++;
          map[id].events_won++;
          map[id].events_participated++;
        }

        if (p.silver_winner) {
          const id = p.silver_winner.registration_id;
          if (!map[id]) {
            map[id] = {
              registration_id: id,
              athlete_name: p.silver_winner.athlete_name,
              team_name: p.silver_winner.team_name,
              gold: 0,
              silver: 0,
              bronze: 0,
              events_participated: 0,
              events_won: 0
            };
          }
          map[id].silver++;
          map[id].events_participated++;
        }

        p.bronze_winners.forEach(b => {
          const id = b.registration_id;
          if (!map[id]) {
            map[id] = {
              registration_id: id,
              athlete_name: b.athlete_name,
              team_name: b.team_name,
              gold: 0,
              silver: 0,
              bronze: 0,
              events_participated: 0,
              events_won: 0
            };
          }
          map[id].bronze++;
          map[id].events_participated++;
        });
      }
    });

    const entries: AthleteStanding[] = Object.values(map).map(a => ({
      athlete_id: a.registration_id,
      registration_id: a.registration_id,
      athlete_name: a.athlete_name,
      team_name: a.team_name,
      gold_count: a.gold,
      silver_count: a.silver,
      bronze_count: a.bronze,
      total_medals: a.gold + a.silver + a.bronze,
      events_participated: a.events_participated,
      events_won: a.events_won,
      rank: 1,
      rank_display: '1',
      is_tied: false
    }));

    // Olympic sort
    entries.sort((a, b) => {
      if (b.gold_count !== a.gold_count) return b.gold_count - a.gold_count;
      if (b.silver_count !== a.silver_count) return b.silver_count - a.silver_count;
      if (b.bronze_count !== a.bronze_count) return b.bronze_count - a.bronze_count;
      if (b.total_medals !== a.total_medals) return b.total_medals - a.total_medals;
      return a.athlete_name.localeCompare(b.athlete_name);
    });

    // Rank & ties
    for (let i = 0; i < entries.length; i++) {
      if (i > 0) {
        const prev = entries[i - 1];
        const curr = entries[i];
        if (
          curr.gold_count === prev.gold_count &&
          curr.silver_count === prev.silver_count &&
          curr.bronze_count === prev.bronze_count &&
          curr.total_medals === prev.total_medals
        ) {
          entries[i].rank = prev.rank;
          entries[i].is_tied = true;
          entries[i - 1].is_tied = true;
        } else {
          entries[i].rank = i + 1;
        }
      }
    }

    entries.forEach(e => {
      e.rank_display = e.is_tied ? `T-${e.rank}` : `${e.rank}`;
    });

    return entries;
  }
};
