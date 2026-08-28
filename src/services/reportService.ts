import { supabase } from '../lib/supabase';
import { tournamentService } from './tournamentService';
import { rankingsService } from './rankingsService';
import { Tournament, TournamentSnapshot, Registration, Match, AnyoCategorySession, Court, TournamentEvent } from '../types/tournament';
import { EventPodium, TeamMedalTally, AthleteStanding, TournamentStandingsSummary } from '../types/rankings';
import { CertificateRecipient, ResultBookData, MedalAwardType } from '../types/reports';

export const reportService = {
  /**
   * Compiles the authoritative Result Book and reporting data payload
   * directly from O-35 RPC outputs, matches, registrations, courts, and frozen tournament snapshots.
   */
  async compileResultBookData(tournamentId: string): Promise<ResultBookData> {
    if (!tournamentId) {
      throw new Error('Tournament ID is required to compile Result Book.');
    }

    // 1. Fetch Tournament details & frozen snapshot
    const [tournament, snapshot] = await Promise.all([
      tournamentService.getTournamentById(tournamentId),
      tournamentService.getActiveSnapshot(tournamentId),
    ]);

    if (!tournament) {
      throw new Error(`Tournament ${tournamentId} not found.`);
    }

    // 2. Fetch Authoritative O-35 Standings, Tally, Podiums, and Summary
    const [teamTally, athleteStandings, eventPodiums, summary] = await Promise.all([
      rankingsService.getTeamMedalTally(tournamentId),
      rankingsService.getAthleteStandings(tournamentId),
      rankingsService.getEventPodiums(tournamentId),
      rankingsService.getStandingsSummary(tournamentId),
    ]);

    // 3. Fetch Events for Tournament (via active snapshot or all snapshots)
    const { data: snapshotEvents } = snapshot
      ? await supabase.from('events').select('*').eq('snapshot_id', snapshot.id)
      : await supabase.from('events').select('*').in(
          'snapshot_id',
          (await supabase.from('tournament_snapshots').select('id').eq('tournament_id', tournamentId)).data?.map(s => s.id) || []
        );

    const events = (snapshotEvents || []) as TournamentEvent[];
    const eventIds = events.map((e) => e.id);

    // 4. Fetch Matches, Anyo Sessions, Registrations, and Courts
    const [matchesRes, anyoSessionsRes, regsRes, courtsRes] = await Promise.all([
      supabase
        .from('matches')
        .select(`
          *,
          match_results (*)
        `)
        .eq('tournament_id', tournamentId)
        .order('bracket_node_index', { ascending: true }),
      supabase
        .from('anyo_category_sessions')
        .select(`
          *,
          anyo_performances:anyo_performances!anyo_performances_session_id_fkey (*)
        `)
        .eq('tournament_id', tournamentId),
      eventIds.length > 0
        ? supabase
            .from('registrations')
            .select(`
              *,
              event:events (*),
              user_profile:profiles!registrations_user_id_fkey (full_name, email)
            `)
            .in('event_id', eventIds)
        : Promise.resolve({ data: [] }),
      supabase
        .from('courts')
        .select('*')
        .eq('tournament_id', tournamentId)
        .order('identifier', { ascending: true }),
    ]);

    const rawMatches = (matchesRes.data || []) as unknown as Match[];
    const anyoCategorySessions = (anyoSessionsRes.data || []) as unknown as AnyoCategorySession[];
    const registrations = (regsRes.data || []) as unknown as Registration[];
    const courts = (courtsRes.data || []) as Court[];

    // Build lookup maps for fast hydration
    const regMap = new Map<string, Registration>();
    registrations.forEach((r) => regMap.set(r.id, r));

    const eventMap = new Map<string, TournamentEvent>();
    events.forEach((e) => eventMap.set(e.id, e));

    // Hydrate matches with event and registration details for self-contained reporting
    const matches: Match[] = rawMatches.map((m) => {
      const redReg = m.red_corner_registration_id ? regMap.get(m.red_corner_registration_id) : undefined;
      const blueReg = m.blue_corner_registration_id ? regMap.get(m.blue_corner_registration_id) : undefined;
      const winnerReg = m.winner_registration_id ? regMap.get(m.winner_registration_id) : undefined;
      const matchedEvent = m.event_id ? eventMap.get(m.event_id) : undefined;

      return {
        ...m,
        event: matchedEvent || m.event,
        red_registration: redReg || m.red_registration,
        blue_registration: blueReg || m.blue_registration,
        winner_registration: winnerReg || m.winner_registration,
      };
    });

    // 4. Derive provisional status from O-35 summary or tournament status
    const isProvisional = summary.is_provisional || tournament.status !== 'COMPLETED';

    return {
      tournament,
      snapshot,
      summary,
      teamTally,
      athleteStandings,
      eventPodiums,
      matches,
      anyoCategorySessions,
      registrations,
      courts,
      events,
      generatedAt: new Date().toISOString(),
      isProvisional,
    };
  },

  /**
   * Generates Award Certificates for Gold, Silver, and Bronze winners.
   * CONSUMES O-35 OUTPUT VERBATIM:
   * - TWO_BRONZE_NO_BATTLE yields 2 Bronze winners from O-35 -> 2 Bronze certificates
   * - WITH_BATTLE_FOR_BRONZE yields 1 Bronze winner from O-35 -> 1 Bronze certificate
   */
  generateAwardCertificates(
    eventPodiums: EventPodium[],
    tournament: Tournament,
    isProvisional: boolean
  ): CertificateRecipient[] {
    const certificates: CertificateRecipient[] = [];

    eventPodiums.forEach((podium) => {
      const eventName = podium.event_name;
      const category = podium.is_anyo ? 'ANYO' : 'SPARRING';
      const gender = podium.gender_category || 'OPEN';
      const weightClass = podium.weight_category || '';

      // 1. Gold Medal Winner
      if (podium.gold_winner) {
        certificates.push({
          id: `CERT-GOLD-${podium.event_id}-${podium.gold_winner.registration_id || 'reg'}`,
          registrationId: podium.gold_winner.registration_id,
          recipientName: podium.gold_winner.athlete_name,
          teamName: podium.gold_winner.team_name,
          role: 'ATHLETE',
          certificateType: 'AWARD',
          medalType: 'GOLD',
          eventId: podium.event_id,
          eventName,
          eventCategory: category,
          eventGender: gender,
          eventWeightClass: weightClass,
          finalScore: podium.gold_winner.final_score,
          tournamentId: tournament.id,
          tournamentName: tournament.name,
          tournamentDate: `${tournament.start_date} to ${tournament.end_date}`,
          verificationHash: this.computeVerificationHash(
            tournament.id,
            podium.gold_winner.athlete_name,
            eventName,
            'GOLD'
          ),
          isProvisional,
          issuedAt: new Date().toISOString(),
        });
      }

      // 2. Silver Medal Winner
      if (podium.silver_winner) {
        certificates.push({
          id: `CERT-SILVER-${podium.event_id}-${podium.silver_winner.registration_id || 'reg'}`,
          registrationId: podium.silver_winner.registration_id,
          recipientName: podium.silver_winner.athlete_name,
          teamName: podium.silver_winner.team_name,
          role: 'ATHLETE',
          certificateType: 'AWARD',
          medalType: 'SILVER',
          eventId: podium.event_id,
          eventName,
          eventCategory: category,
          eventGender: gender,
          eventWeightClass: weightClass,
          finalScore: podium.silver_winner.final_score,
          tournamentId: tournament.id,
          tournamentName: tournament.name,
          tournamentDate: `${tournament.start_date} to ${tournament.end_date}`,
          verificationHash: this.computeVerificationHash(
            tournament.id,
            podium.silver_winner.athlete_name,
            eventName,
            'SILVER'
          ),
          isProvisional,
          issuedAt: new Date().toISOString(),
        });
      }

      // 3. Bronze Medal Winner(s)
      // Exactly matches O-35 bronze_winners length (1 or 2)
      if (podium.bronze_winners && podium.bronze_winners.length > 0) {
        podium.bronze_winners.forEach((bronze, idx) => {
          certificates.push({
            id: `CERT-BRONZE-${podium.event_id}-${bronze.registration_id || idx}`,
            registrationId: bronze.registration_id,
            recipientName: bronze.athlete_name,
            teamName: bronze.team_name,
            role: 'ATHLETE',
            certificateType: 'AWARD',
            medalType: 'BRONZE',
            eventId: podium.event_id,
            eventName,
            eventCategory: category,
            eventGender: gender,
            eventWeightClass: weightClass,
            finalScore: bronze.final_score,
            tournamentId: tournament.id,
            tournamentName: tournament.name,
            tournamentDate: `${tournament.start_date} to ${tournament.end_date}`,
            verificationHash: this.computeVerificationHash(
              tournament.id,
              bronze.athlete_name,
              eventName,
              `BRONZE-${idx + 1}`
            ),
            isProvisional,
            issuedAt: new Date().toISOString(),
          });
        });
      }
    });

    return certificates;
  },

  /**
   * Generates Participation Certificates for all registered athletes and coaches.
   */
  generateParticipationCertificates(
    registrations: Registration[],
    tournament: Tournament,
    isProvisional: boolean
  ): CertificateRecipient[] {
    const certificates: CertificateRecipient[] = [];
    const seen = new Set<string>();

    registrations.forEach((reg) => {
      const athleteName = reg.user_profile?.full_name || 'Athlete';
      const teamName = reg.team_name || 'Independent Club';
      const uniqueKey = `${athleteName}-${teamName}`;

      if (!seen.has(uniqueKey)) {
        seen.add(uniqueKey);
        certificates.push({
          id: `CERT-PART-${reg.id || Math.random().toString(36).substring(2, 9)}`,
          registrationId: reg.id,
          athleteId: reg.user_id,
          recipientName: athleteName,
          teamName: teamName,
          role: 'ATHLETE',
          certificateType: 'PARTICIPATION',
          tournamentId: tournament.id,
          tournamentName: tournament.name,
          tournamentDate: `${tournament.start_date} to ${tournament.end_date}`,
          verificationHash: this.computeVerificationHash(
            tournament.id,
            athleteName,
            'PARTICIPATION',
            'PARTICIPATION'
          ),
          isProvisional,
          issuedAt: new Date().toISOString(),
        });
      }
    });

    return certificates;
  },

  /**
   * Deterministic verification hash calculation for certificate authenticity.
   */
  computeVerificationHash(
    tournamentId: string,
    recipientName: string,
    eventOrRole: string,
    designation: string
  ): string {
    const raw = `${tournamentId}:${recipientName.toUpperCase()}:${eventOrRole}:${designation}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const char = raw.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0; // Convert to 32bit integer
    }
    const hex = Math.abs(hash).toString(16).toUpperCase().padStart(8, '0');
    return `UAAPHIL-2026-${hex.substring(0, 4)}-${hex.substring(4, 8)}`;
  },

  /**
   * Complete Result Book Structured JSON Export (RFC 8259 Compliant Machine-Readable Package)
   * Serializes the authoritative compiled ResultBookData payload into a structured JSON export.
   */
  exportResultBookJSON(data: ResultBookData): void {
    const exportPayload = {
      export_type: 'UAAPHIL_OFFICIAL_RESULT_BOOK',
      schema_version: '1.0.0',
      exported_at: new Date().toISOString(),
      generated_at: data.generatedAt,
      is_provisional: data.isProvisional,
      tournament: data.tournament,
      snapshot: data.snapshot,
      summary: data.summary,
      team_medal_tally: data.teamTally,
      athlete_standings: data.athleteStandings,
      event_podiums: data.eventPodiums,
      events: data.events,
      matches: data.matches,
      anyo_category_sessions: data.anyoCategorySessions,
      registrations: data.registrations,
      courts: data.courts,
    };

    const jsonContent = JSON.stringify(exportPayload, null, 2);
    const filename = `${this.sanitizeFilename(data.tournament?.name || 'Tournament')}_Official_Result_Book.json`;
    this.triggerDownload(jsonContent, filename, 'application/json;charset=utf-8;');
  },

  /**
   * CSV Generation & Export Utilities
   */
  exportMedalTallyCSV(tally: TeamMedalTally[], tournamentName: string) {
    const headers = ['Rank', 'Team / School Club', 'Gold', 'Silver', 'Bronze', 'Total Medals', 'Is Tied'];
    const rows = tally.map((t) => [
      t.rank_display,
      `"${t.team_name.replace(/"/g, '""')}"`,
      t.gold_count,
      t.silver_count,
      t.bronze_count,
      t.total_medals,
      t.is_tied ? 'YES' : 'NO',
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    this.triggerDownload(csvContent, `${this.sanitizeFilename(tournamentName)}_Medal_Tally.csv`);
  },

  exportAthleteStandingsCSV(standings: AthleteStanding[], tournamentName: string) {
    const headers = ['Rank', 'Athlete Name', 'Team / Club', 'Gold', 'Silver', 'Bronze', 'Total Medals', 'Events Won', 'Events Participated', 'Is Tied'];
    const rows = standings.map((a) => [
      a.rank_display,
      `"${a.athlete_name.replace(/"/g, '""')}"`,
      `"${a.team_name.replace(/"/g, '""')}"`,
      a.gold_count,
      a.silver_count,
      a.bronze_count,
      a.total_medals,
      a.events_won,
      a.events_participated,
      a.is_tied ? 'YES' : 'NO',
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    this.triggerDownload(csvContent, `${this.sanitizeFilename(tournamentName)}_Athlete_Standings.csv`);
  },

  exportEventPodiumsCSV(podiums: EventPodium[], tournamentName: string) {
    const headers = [
      'Event Name',
      'Discipline',
      'Gender',
      'Weight / Division',
      'Status',
      'Gold Winner',
      'Gold Team',
      'Silver Winner',
      'Silver Team',
      'Bronze 1 Winner',
      'Bronze 1 Team',
      'Bronze 2 Winner',
      'Bronze 2 Team',
    ];

    const rows = podiums.map((p) => {
      const b1 = p.bronze_winners[0];
      const b2 = p.bronze_winners[1];
      return [
        `"${p.event_name.replace(/"/g, '""')}"`,
        p.is_anyo ? 'ANYO' : 'SPARRING',
        p.gender_category || 'OPEN',
        `"${(p.weight_category || '').replace(/"/g, '""')}"`,
        p.status,
        `"${(p.gold_winner?.athlete_name || 'TBD').replace(/"/g, '""')}"`,
        `"${(p.gold_winner?.team_name || 'TBD').replace(/"/g, '""')}"`,
        `"${(p.silver_winner?.athlete_name || 'TBD').replace(/"/g, '""')}"`,
        `"${(p.silver_winner?.team_name || 'TBD').replace(/"/g, '""')}"`,
        `"${(b1?.athlete_name || '').replace(/"/g, '""')}"`,
        `"${(b1?.team_name || '').replace(/"/g, '""')}"`,
        `"${(b2?.athlete_name || '').replace(/"/g, '""')}"`,
        `"${(b2?.team_name || '').replace(/"/g, '""')}"`,
      ];
    });

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    this.triggerDownload(csvContent, `${this.sanitizeFilename(tournamentName)}_Event_Podiums.csv`);
  },

  exportDelegationRosterCSV(registrations: Registration[], tournamentName: string) {
    const headers = ['Registration ID', 'Athlete Name', 'Team / Club', 'Lineup Role', 'Weight', 'Division', 'Approval Status'];
    const rows = registrations.map((r) => {
      const athleteName = r.user_profile?.full_name || 'Athlete';
      const team = r.team_name || 'Independent Club';
      const division = r.event?.division || 'OPEN';
      const weight = r.weigh_in_weight ? `${r.weigh_in_weight} kg` : (r.event?.weight_class || 'N/A');
      const lineup = r.lineup_role || 'LINEUP';
      return [
        r.id,
        `"${athleteName.replace(/"/g, '""')}"`,
        `"${team.replace(/"/g, '""')}"`,
        lineup,
        `"${weight.replace(/"/g, '""')}"`,
        `"${division.replace(/"/g, '""')}"`,
        r.is_approved ? 'APPROVED' : 'PENDING',
      ];
    });

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    this.triggerDownload(csvContent, `${this.sanitizeFilename(tournamentName)}_Delegation_Roster.csv`);
  },

  /**
   * Official Match Results CSV Export (RFC 4180 Compliant)
   */
  exportMatchResultsCSV(matches: Match[], tournamentName: string) {
    const headers = [
      'Match ID',
      'Event Name',
      'Category',
      'Division',
      'Round',
      'Court / Mat',
      'Scheduled Time',
      'Red Corner Athlete',
      'Red Corner Club',
      'Blue Corner Athlete',
      'Blue Corner Club',
      'Match Status',
      'Winner Athlete',
      'Winner Club',
      'Win Type',
      'Rounds Won Red',
      'Rounds Won Blue',
    ];

    const rows = matches.map((m) => {
      const eventName = m.event?.name || 'Sparring Event';
      const category = m.event?.category || 'SPARRING';
      const division = typeof m.event?.division === 'string' ? m.event.division : 'OPEN';
      const round = m.round_name || (m.round_number ? `Round ${m.round_number}` : 'N/A');
      const court = m.court_identifier || 'TBD';
      const scheduledTime = m.created_at ? new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'TBD';
      
      const redAthlete = m.red_registration?.user_profile?.full_name || 'TBD / BYE';
      const redClub = m.red_registration?.team_name || 'N/A';
      const blueAthlete = m.blue_registration?.user_profile?.full_name || 'TBD / BYE';
      const blueClub = m.blue_registration?.team_name || 'N/A';

      const winnerReg = m.winner_registration;
      const winnerAthlete = winnerReg?.user_profile?.full_name || (m.status === 'COMPLETED' ? 'Declared' : 'Pending');
      const winnerClub = winnerReg?.team_name || (m.status === 'COMPLETED' ? 'N/A' : 'Pending');

      const matchRes = (m as any).match_results;
      const resultObj = Array.isArray(matchRes) && matchRes.length > 0 ? matchRes[0] : matchRes;
      const winType = resultObj?.decision_type || (m.status === 'COMPLETED' ? 'OFFICIAL' : 'N/A');
      const rWonRed = resultObj?.rounds_won_red !== undefined ? resultObj.rounds_won_red : '';
      const rWonBlue = resultObj?.rounds_won_blue !== undefined ? resultObj.rounds_won_blue : '';

      return [
        m.id,
        `"${eventName.replace(/"/g, '""')}"`,
        category,
        `"${division.replace(/"/g, '""')}"`,
        `"${round.replace(/"/g, '""')}"`,
        `"${court.replace(/"/g, '""')}"`,
        `"${scheduledTime}"`,
        `"${redAthlete.replace(/"/g, '""')}"`,
        `"${redClub.replace(/"/g, '""')}"`,
        `"${blueAthlete.replace(/"/g, '""')}"`,
        `"${blueClub.replace(/"/g, '""')}"`,
        m.status,
        `"${winnerAthlete.replace(/"/g, '""')}"`,
        `"${winnerClub.replace(/"/g, '""')}"`,
        winType,
        rWonRed,
        rWonBlue,
      ];
    });

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    this.triggerDownload(csvContent, `${this.sanitizeFilename(tournamentName)}_Match_Results.csv`);
  },

  /**
   * Official Weigh-In Records CSV Export
   */
  exportWeighInRecordsCSV(registrations: Registration[], tournamentName: string) {
    const headers = [
      'Registration ID',
      'Athlete Name',
      'Team / Club',
      'Event Name',
      'Category',
      'Division',
      'Registered Weight Class',
      'Recorded Weight (kg)',
      'Min Allowed (kg)',
      'Max Allowed (kg)',
      'Weigh-In Status',
      'Lineup Role',
      'Approval Status',
    ];

    const rows = registrations.map((r) => {
      const athleteName = r.user_profile?.full_name || 'Athlete';
      const team = r.team_name || 'Independent Club';
      const eventName = r.event?.name || 'Arnis Event';
      const category = r.event?.category || 'SPARRING';
      const division = r.event?.division || 'OPEN';
      const weightClass = r.event?.weight_class || 'Open Weight';
      const minW = r.event?.min_weight !== null && r.event?.min_weight !== undefined ? r.event.min_weight : '';
      const maxW = r.event?.max_weight !== null && r.event?.max_weight !== undefined ? r.event.max_weight : '';
      const recordedW = r.weigh_in_weight !== null && r.weigh_in_weight !== undefined ? r.weigh_in_weight : '';
      
      let status = 'PENDING';
      if (r.weigh_in_weight !== null && r.weigh_in_weight !== undefined) {
        if (r.event?.min_weight && r.weigh_in_weight < r.event.min_weight) {
          status = 'UNDERWEIGHT';
        } else if (r.event?.max_weight && r.weigh_in_weight > r.event.max_weight) {
          status = 'OVERWEIGHT';
        } else {
          status = 'PASSED';
        }
      }

      return [
        r.id,
        `"${athleteName.replace(/"/g, '""')}"`,
        `"${team.replace(/"/g, '""')}"`,
        `"${eventName.replace(/"/g, '""')}"`,
        category,
        `"${division.replace(/"/g, '""')}"`,
        `"${weightClass.replace(/"/g, '""')}"`,
        recordedW,
        minW,
        maxW,
        status,
        r.lineup_role || 'LINEUP',
        r.is_approved ? 'APPROVED' : 'PENDING',
      ];
    });

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    this.triggerDownload(csvContent, `${this.sanitizeFilename(tournamentName)}_Weigh_In_Records.csv`);
  },

  /**
   * Club / Delegation Performance Digest CSV Export
   */
  exportClubSummaryCSV(
    clubName: string,
    registrations: Registration[],
    matches: Match[],
    eventPodiums: EventPodium[],
    tournamentName: string
  ) {
    const clubRegs = registrations.filter((r) => (r.team_name || '').toLowerCase() === clubName.toLowerCase());
    const clubRegIds = new Set(clubRegs.map((r) => r.id));

    const clubMatches = matches.filter(
      (m) =>
        (m.red_corner_registration_id && clubRegIds.has(m.red_corner_registration_id)) ||
        (m.blue_corner_registration_id && clubRegIds.has(m.blue_corner_registration_id))
    );

    const headers = [
      'Report Type',
      'Club Name',
      'Athlete Name',
      'Event Name',
      'Division',
      'Weight Class',
      'Lineup Role',
      'Weigh-In Status',
      'Total Bouts',
      'Wins',
      'Losses',
      'Medal Won',
    ];

    const rows = clubRegs.map((reg) => {
      const athleteName = reg.user_profile?.full_name || 'Athlete';
      const eventName = reg.event?.name || 'Event';
      const division = reg.event?.division || 'OPEN';
      const weightClass = reg.event?.weight_class || 'Open Weight';
      const lineup = reg.lineup_role || 'LINEUP';

      const athleteMatches = clubMatches.filter(
        (m) =>
          (m.red_corner_registration_id === reg.id || m.blue_corner_registration_id === reg.id) &&
          m.status === 'COMPLETED'
      );
      const totalBouts = athleteMatches.length;
      const wins = athleteMatches.filter((m) => m.winner_registration_id === reg.id).length;
      const losses = totalBouts - wins;

      // Find medals won by this athlete in podiums
      let medalWon = 'NONE';
      eventPodiums.forEach((pod) => {
        if (pod.gold_winner?.registration_id === reg.id) medalWon = 'GOLD';
        else if (pod.silver_winner?.registration_id === reg.id) medalWon = 'SILVER';
        else if (pod.bronze_winners?.some((b) => b.registration_id === reg.id)) medalWon = 'BRONZE';
      });

      let weighInStatus = 'PENDING';
      if (reg.weigh_in_weight !== null && reg.weigh_in_weight !== undefined) {
        if (reg.event?.min_weight && reg.weigh_in_weight < reg.event.min_weight) {
          weighInStatus = 'UNDERWEIGHT';
        } else if (reg.event?.max_weight && reg.weigh_in_weight > reg.event.max_weight) {
          weighInStatus = 'OVERWEIGHT';
        } else {
          weighInStatus = 'PASSED';
        }
      }

      return [
        'DELEGATION_ATHLETE_RECORD',
        `"${clubName.replace(/"/g, '""')}"`,
        `"${athleteName.replace(/"/g, '""')}"`,
        `"${eventName.replace(/"/g, '""')}"`,
        `"${division.replace(/"/g, '""')}"`,
        `"${weightClass.replace(/"/g, '""')}"`,
        lineup,
        weighInStatus,
        totalBouts,
        wins,
        losses,
        medalWon,
      ];
    });

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    this.triggerDownload(csvContent, `${this.sanitizeFilename(tournamentName)}_${this.sanitizeFilename(clubName)}_Summary.csv`);
  },

  triggerDownload(content: string, filename: string, mimeType = 'text/csv;charset=utf-8;') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  sanitizeFilename(name: string): string {
    return (name || 'Tournament').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  },
};
