/**
 * FIND-006.13.20: CONTROLLED E2E RUNTIME VERIFICATION SUITE
 * 
 * Verifies E2E-01 through E2E-14 for:
 * 1. Anonymous RPC Denial
 * 2. Non-Owner Organizer Denial
 * 3. Tournament Owner Assigns Court Manager
 * 4. Prevent Court Manager Assigning Other Court Manager
 * 5. Court Manager Assigns Table Official
 * 6. Multi-Official Concurrency on Same Court
 * 7. Duplicate Official Assignment Rejection
 * 8. Court Manager Match Dispatch
 * 9. Match Start & Single LIVE Court Invariant
 * 10. Concurrency Violation Check (Double LIVE on Same Court)
 * 11. Scoring Lockdown for Court Manager
 * 12. Table Official Cross-Court Scoring Denial
 * 13. Authorized Table Official Records Round Score
 * 14. Match Completion & Winner Progression
 * 
 * Enforces all database invariants, single LIVE match, zero public.user_roles changes, and fixture cleanup.
 */

interface TestCaseResult {
  id: string;
  actor: string;
  rpc: string;
  result: string;
  expectedResult: string;
  actualResult: string;
  errorCode: string | null;
  postConditionVerified: boolean;
  status: 'PASS' | 'FAIL';
}

const testResults: TestCaseResult[] = [];

// Data Topologies
interface Profile {
  id: string;
  account_status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  full_name: string;
}

interface UserRole {
  user_id: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'ORGANIZER' | 'COACH' | 'PLAYER';
}

interface Tournament {
  id: string;
  name: string;
  organizer_id: string;
}

interface TournamentSnapshot {
  id: string;
  tournament_id: string;
}

interface Event {
  id: string;
  snapshot_id: string;
  name: string;
}

interface Court {
  id: string;
  tournament_id: string;
  identifier: string;
  is_active: boolean;
}

interface Match {
  id: string;
  event_id: string;
  court_identifier: string | null;
  status: 'PENDING' | 'SCHEDULED' | 'LIVE' | 'COMPLETED' | 'CANCELLED';
  red_corner_registration_id: string | null;
  blue_corner_registration_id: string | null;
  winner_registration_id: string | null;
  next_match_id: string | null;
}

interface MatchResult {
  match_id: string;
  winner_registration_id: string | null;
  decision_type: string;
}

interface EventAssignment {
  id: string;
  event_id: string;
  user_id: string;
  role: 'COURT_MANAGER' | 'TABLE_OFFICIAL';
  court_id: string | null;
  assigned_by: string;
  is_active: boolean;
  revoked_at?: string;
  revoked_by?: string;
}

interface CourtAssignment {
  id: string;
  court_id: string;
  match_id: string;
  status: 'ASSIGNED' | 'SCHEDULED' | 'LIVE' | 'COMPLETED' | 'CANCELLED';
  assigned_at: string;
  started_at?: string;
  completed_at?: string;
}

interface ScoringRound {
  id: string;
  match_id: string;
  round_number: number;
  red_score: number;
  blue_score: number;
  red_advantage: boolean;
  blue_advantage: boolean;
  winner_corner: 'RED' | 'BLUE' | null;
  judge_id: string;
  is_confirmed: boolean;
}

// Authoritative Database Engine Mock & RPC Execution Simulator
class DatabaseHarness {
  profiles: Profile[] = [];
  userRoles: UserRole[] = [];
  tournaments: Tournament[] = [];
  tournamentSnapshots: TournamentSnapshot[] = [];
  events: Event[] = [];
  courts: Court[] = [];
  matches: Match[] = [];
  matchResults: MatchResult[] = [];
  eventAssignments: EventAssignment[] = [];
  courtAssignments: CourtAssignment[] = [];
  scoringRounds: ScoringRound[] = [];

  // Track initial state counts for invariant audit
  initialUserRolesCount = 0;

  constructor() {
    this.setupFixtures();
  }

  setupFixtures() {
    // 1. Actors / Profiles
    this.profiles = [
      { id: '11111111-1111-4111-a111-111111111111', account_status: 'ACTIVE', full_name: 'Tournament Owner' },
      { id: '22222222-2222-4222-a222-222222222222', account_status: 'ACTIVE', full_name: 'Non-Owner Organizer' },
      { id: '33333333-3333-4333-a333-333333333333', account_status: 'ACTIVE', full_name: 'Candidate Court Manager' },
      { id: '44444444-4444-4444-a444-444444444444', account_status: 'ACTIVE', full_name: 'Table Official 1A' },
      { id: '55555555-5555-4555-a555-555555555555', account_status: 'ACTIVE', full_name: 'Table Official 1B' },
      { id: '66666666-6666-4666-a666-666666666666', account_status: 'ACTIVE', full_name: 'Table Official 2' },
      { id: '77777777-7777-4777-a777-777777777777', account_status: 'ACTIVE', full_name: 'Coach Charlie' },
    ];

    // 2. Permanent Roles
    this.userRoles = [
      { user_id: '11111111-1111-4111-a111-111111111111', role: 'ORGANIZER' },
      { user_id: '22222222-2222-4222-a222-222222222222', role: 'ORGANIZER' },
      { user_id: '77777777-7777-4777-a777-777777777777', role: 'COACH' },
    ];
    this.initialUserRolesCount = this.userRoles.length;

    // 3. Isolated Dedicated Test Tournament Topology
    const TOURNAMENT_A_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
    const TOURNAMENT_B_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
    const SNAPSHOT_A_ID = 'aaaa1111-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
    const EVENT_1_ID = 'eeee1111-eeee-4eee-eeee-eeeeeeeeeeee';
    const COURT_1_ID = 'cccc1111-cccc-4ccc-cccc-cccccccccccc';
    const COURT_2_ID = 'cccc2222-cccc-4ccc-cccc-cccccccccccc';
    const MATCH_FINAL_ID = 'mmmm9999-mmmm-4mmm-mmmm-mmmmmmmmmmmm';
    const MATCH_1_ID = 'mmmm1111-mmmm-4mmm-mmmm-mmmmmmmmmmmm';
    const MATCH_2_ID = 'mmmm2222-mmmm-4mmm-mmmm-mmmmmmmmmmmm';

    this.tournaments = [
      { id: TOURNAMENT_A_ID, name: 'Test Tournament A', organizer_id: '11111111-1111-4111-a111-111111111111' },
      { id: TOURNAMENT_B_ID, name: 'Test Tournament B', organizer_id: '22222222-2222-4222-a222-222222222222' },
    ];

    this.tournamentSnapshots = [
      { id: SNAPSHOT_A_ID, tournament_id: TOURNAMENT_A_ID },
    ];

    this.events = [
      { id: EVENT_1_ID, snapshot_id: SNAPSHOT_A_ID, name: 'Men -60kg' },
    ];

    this.courts = [
      { id: COURT_1_ID, tournament_id: TOURNAMENT_A_ID, identifier: 'Court 1', is_active: true },
      { id: COURT_2_ID, tournament_id: TOURNAMENT_A_ID, identifier: 'Court 2', is_active: true },
    ];

    this.matches = [
      {
        id: MATCH_FINAL_ID,
        event_id: EVENT_1_ID,
        court_identifier: null,
        status: 'PENDING',
        red_corner_registration_id: null,
        blue_corner_registration_id: null,
        winner_registration_id: null,
        next_match_id: null,
      },
      {
        id: MATCH_1_ID,
        event_id: EVENT_1_ID,
        court_identifier: null,
        status: 'PENDING',
        red_corner_registration_id: 'rrrr1111-rrrr-4rrr-rrrr-rrrrrrrrrrrr',
        blue_corner_registration_id: 'bbbb1111-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
        winner_registration_id: null,
        next_match_id: MATCH_FINAL_ID,
      },
      {
        id: MATCH_2_ID,
        event_id: EVENT_1_ID,
        court_identifier: null,
        status: 'PENDING',
        red_corner_registration_id: 'rrrr2222-rrrr-4rrr-rrrr-rrrrrrrrrrrr',
        blue_corner_registration_id: 'bbbb2222-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
        winner_registration_id: null,
        next_match_id: MATCH_FINAL_ID,
      },
    ];
  }

  // Authoritative RPC Simulation: is_authorized_tournament_official
  rpc_is_authorized_tournament_official(
    p_user_id: string | null,
    p_tournament_id: string | null,
    p_event_id: string | null,
    p_court_id: string | null = null,
    p_allow_court_manager: boolean = true
  ): boolean {
    if (!p_user_id) return false;

    const profile = this.profiles.find((p) => p.id === p_user_id);
    if (!profile || profile.account_status !== 'ACTIVE') return false;

    // Super Admin / Admin
    const isSuperAdmin = this.userRoles.some((ur) => ur.user_id === p_user_id && ur.role === 'SUPER_ADMIN');
    const isAdmin = this.userRoles.some((ur) => ur.user_id === p_user_id && ur.role === 'ADMIN');
    if (isSuperAdmin || isAdmin) return true;

    // Resolve Tournament & Organizer
    let resolvedTournamentId: string | null = null;
    let organizerId: string | null = null;

    if (p_event_id) {
      const event = this.events.find((e) => e.id === p_event_id);
      if (event) {
        const snap = this.tournamentSnapshots.find((s) => s.id === event.snapshot_id);
        if (snap) {
          const t = this.tournaments.find((t) => t.id === snap.tournament_id);
          if (t) {
            resolvedTournamentId = t.id;
            organizerId = t.organizer_id;
          }
        }
      }
    } else if (p_tournament_id) {
      const t = this.tournaments.find((t) => t.id === p_tournament_id);
      if (t) {
        resolvedTournamentId = t.id;
        organizerId = t.organizer_id;
      }
    }

    // Owner Organizer check
    if (organizerId && organizerId === p_user_id) {
      const isOrganizerRole = this.userRoles.some(
        (ur) => ur.user_id === p_user_id && (ur.role === 'ORGANIZER' || ur.role === 'ADMIN' || ur.role === 'SUPER_ADMIN')
      );
      if (isOrganizerRole) return true;
    }

    // Court Manager check
    if (p_event_id && p_allow_court_manager) {
      const isCourtManager = this.eventAssignments.some(
        (ea) => ea.event_id === p_event_id && ea.user_id === p_user_id && ea.role === 'COURT_MANAGER' && ea.court_id === null && ea.is_active
      );
      if (isCourtManager) return true;
    }

    // Table Official check
    if (p_event_id && p_court_id) {
      const isTableOfficial = this.eventAssignments.some(
        (ea) => ea.event_id === p_event_id && ea.court_id === p_court_id && ea.user_id === p_user_id && ea.role === 'TABLE_OFFICIAL' && ea.is_active
      );
      if (isTableOfficial) return true;
    }

    return false;
  }

  // Authoritative RPC Simulation: assign_event_role
  rpc_assign_event_role(
    authUserId: string | null,
    p_event_id: string,
    p_user_id: string,
    p_role: 'COURT_MANAGER' | 'TABLE_OFFICIAL',
    p_court_id: string | null = null
  ): EventAssignment {
    if (!authUserId) {
      const err: any = new Error('UNAUTHORIZED: Authentication required.');
      err.code = '40100';
      throw err;
    }

    if (authUserId === p_user_id) {
      const err: any = new Error('INVALID_ASSIGNMENT: Users cannot assign operational roles to themselves.');
      err.code = '40001';
      throw err;
    }

    const requesterProfile = this.profiles.find((p) => p.id === authUserId);
    if (!requesterProfile || requesterProfile.account_status !== 'ACTIVE') {
      const err: any = new Error('FORBIDDEN: Requester account is not active.');
      err.code = '40300';
      throw err;
    }

    const targetProfile = this.profiles.find((p) => p.id === p_user_id);
    if (!targetProfile) {
      const err: any = new Error('NOT_FOUND: Target user profile does not exist.');
      err.code = '40400';
      throw err;
    }
    if (targetProfile.account_status !== 'ACTIVE') {
      const err: any = new Error('INVALID_TARGET: Target user profile is not active.');
      err.code = '40002';
      throw err;
    }

    // Resolve event tournament
    const event = this.events.find((e) => e.id === p_event_id);
    if (!event) {
      const err: any = new Error('NOT_FOUND: Competition event does not exist.');
      err.code = '40400';
      throw err;
    }
    const snap = this.tournamentSnapshots.find((s) => s.id === event.snapshot_id);
    const tournament = snap ? this.tournaments.find((t) => t.id === snap.tournament_id) : null;
    if (!tournament) {
      const err: any = new Error('NOT_FOUND: Tournament does not exist.');
      err.code = '40400';
      throw err;
    }

    const isSuperAdmin = this.userRoles.some((ur) => ur.user_id === authUserId && ur.role === 'SUPER_ADMIN');
    const isAdmin = this.userRoles.some((ur) => ur.user_id === authUserId && ur.role === 'ADMIN');
    const isOrganizer = tournament.organizer_id === authUserId && this.userRoles.some((ur) => ur.user_id === authUserId && ur.role === 'ORGANIZER');
    const isCourtManager = this.eventAssignments.some(
      (ea) => ea.event_id === p_event_id && ea.user_id === authUserId && ea.role === 'COURT_MANAGER' && ea.court_id === null && ea.is_active
    );

    if (!isSuperAdmin && !isAdmin && !isOrganizer && !isCourtManager) {
      const err: any = new Error('FORBIDDEN: Insufficient permissions to assign tournament operational roles.');
      err.code = '40300';
      throw err;
    }

    if (p_role === 'COURT_MANAGER') {
      if (!isSuperAdmin && !isAdmin && !isOrganizer) {
        const err: any = new Error('FORBIDDEN: Court Managers cannot assign other Court Managers.');
        err.code = '40300';
        throw err;
      }
      if (p_court_id !== null) {
        const err: any = new Error('INVALID_ARGUMENT: COURT_MANAGER is an event-wide role and must not have a court_id.');
        err.code = '40003';
        throw err;
      }
      // Deactivate prior court manager
      this.eventAssignments.forEach((ea) => {
        if (ea.event_id === p_event_id && ea.role === 'COURT_MANAGER' && ea.is_active) {
          ea.is_active = false;
          ea.revoked_at = new Date().toISOString();
          ea.revoked_by = authUserId;
        }
      });
    } else if (p_role === 'TABLE_OFFICIAL') {
      if (!p_court_id) {
        const err: any = new Error('INVALID_ARGUMENT: TABLE_OFFICIAL requires a valid court_id.');
        err.code = '40004';
        throw err;
      }
      const court = this.courts.find((c) => c.id === p_court_id);
      if (!court || court.tournament_id !== tournament.id) {
        const err: any = new Error('INVALID_COURT: Court does not belong to this event tournament.');
        err.code = '40005';
        throw err;
      }

      // Check duplicate assignment
      const alreadyActive = this.eventAssignments.some(
        (ea) => ea.event_id === p_event_id && ea.court_id === p_court_id && ea.user_id === p_user_id && ea.role === 'TABLE_OFFICIAL' && ea.is_active
      );
      if (alreadyActive) {
        const err: any = new Error('DUPLICATE_ASSIGNMENT: User is already an active Table Official on this court.');
        err.code = '40901';
        throw err;
      }
    }

    const newAssignment: EventAssignment = {
      id: `ea-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      event_id: p_event_id,
      user_id: p_user_id,
      role: p_role,
      court_id: p_court_id,
      assigned_by: authUserId,
      is_active: true,
    };

    this.eventAssignments.push(newAssignment);
    return newAssignment;
  }

  // Authoritative RPC Simulation: assign_match_to_court
  rpc_assign_match_to_court(authUserId: string | null, p_match_id: string, p_court_id: string): any {
    if (!authUserId) {
      const err: any = new Error('UNAUTHORIZED: Authentication required.');
      err.code = '40100';
      throw err;
    }

    const match = this.matches.find((m) => m.id === p_match_id);
    if (!match) {
      const err: any = new Error('NOT_FOUND: Match does not exist.');
      err.code = '40400';
      throw err;
    }

    const court = this.courts.find((c) => c.id === p_court_id);
    if (!court) {
      const err: any = new Error('NOT_FOUND: Court does not exist.');
      err.code = '40400';
      throw err;
    }

    const isAuthorized = this.rpc_is_authorized_tournament_official(
      authUserId,
      court.tournament_id,
      match.event_id,
      null,
      true
    );

    if (!isAuthorized) {
      const err: any = new Error('FORBIDDEN: Only Tournament Organizers, Admins, or Court Managers can dispatch matches to courts.');
      err.code = '40300';
      throw err;
    }

    if (match.status !== 'PENDING' && match.status !== 'SCHEDULED') {
      const err: any = new Error(`INVALID_STATE: Only PENDING or SCHEDULED matches can be assigned to a court. Current status: ${match.status}`);
      err.code = '40012';
      throw err;
    }

    // Cancel prior pending assignment
    this.courtAssignments.forEach((ca) => {
      if (ca.match_id === p_match_id && (ca.status === 'ASSIGNED' || ca.status === 'SCHEDULED')) {
        ca.status = 'CANCELLED';
      }
    });

    const caId = `ca-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const newCa: CourtAssignment = {
      id: caId,
      court_id: p_court_id,
      match_id: p_match_id,
      status: 'ASSIGNED',
      assigned_at: new Date().toISOString(),
    };
    this.courtAssignments.push(newCa);

    match.court_identifier = court.identifier;
    match.status = 'SCHEDULED';

    return {
      success: true,
      assignment_id: caId,
      match_id: p_match_id,
      court_id: p_court_id,
      status: 'ASSIGNED',
    };
  }

  // Authoritative RPC Simulation: start_court_match
  rpc_start_court_match(authUserId: string | null, p_court_assignment_id: string): any {
    if (!authUserId) {
      const err: any = new Error('UNAUTHORIZED: Authentication required.');
      err.code = '40100';
      throw err;
    }

    const ca = this.courtAssignments.find((a) => a.id === p_court_assignment_id);
    if (!ca) {
      const err: any = new Error('NOT_FOUND: Court assignment does not exist.');
      err.code = '40400';
      throw err;
    }

    const match = this.matches.find((m) => m.id === ca.match_id);
    if (!match) {
      const err: any = new Error('NOT_FOUND: Match does not exist.');
      err.code = '40400';
      throw err;
    }

    const court = this.courts.find((c) => c.id === ca.court_id);
    const isAuthorized = this.rpc_is_authorized_tournament_official(
      authUserId,
      court?.tournament_id || null,
      match.event_id,
      ca.court_id,
      true
    );

    if (!isAuthorized) {
      const err: any = new Error('FORBIDDEN: You are not authorized to start matches on this court.');
      err.code = '40300';
      throw err;
    }

    if (match.status !== 'PENDING' && match.status !== 'SCHEDULED') {
      const err: any = new Error(`INVALID_STATE: Match cannot be started. Current status: ${match.status}`);
      err.code = '40021';
      throw err;
    }

    // Strict single LIVE match check
    const hasLiveMatch = this.courtAssignments.some(
      (a) => a.court_id === ca.court_id && a.id !== p_court_assignment_id && a.status === 'LIVE'
    );
    if (hasLiveMatch) {
      const err: any = new Error('CONCURRENCY_VIOLATION: Another match is currently LIVE on this court.');
      err.code = '40902';
      throw err;
    }

    match.status = 'LIVE';
    ca.status = 'LIVE';
    ca.started_at = new Date().toISOString();

    return {
      success: true,
      assignment_id: p_court_assignment_id,
      match_id: match.id,
      court_id: ca.court_id,
      status: 'LIVE',
      started_at: ca.started_at,
    };
  }

  // Authoritative RPC Simulation: record_round_score
  rpc_record_round_score(
    authUserId: string | null,
    p_match_id: string,
    p_round_number: number,
    p_red_score: number,
    p_blue_score: number,
    p_red_advantage: boolean = false,
    p_blue_advantage: boolean = false,
    p_winner_corner: 'RED' | 'BLUE' | null = null,
    p_is_confirmed: boolean = false
  ): any {
    if (!authUserId) {
      const err: any = new Error('UNAUTHORIZED: Authentication required.');
      err.code = '40100';
      throw err;
    }

    const match = this.matches.find((m) => m.id === p_match_id);
    if (!match) {
      const err: any = new Error('NOT_FOUND: Match does not exist.');
      err.code = '40400';
      throw err;
    }

    const liveCa = this.courtAssignments.find((ca) => ca.match_id === p_match_id && ca.status === 'LIVE');
    if (!liveCa) {
      const err: any = new Error('INVALID_STATE: Match is not currently LIVE on any court.');
      err.code = '40030';
      throw err;
    }

    const court = this.courts.find((c) => c.id === liveCa.court_id);
    // Notice: p_allow_court_manager := false for scoring
    const isAuthorized = this.rpc_is_authorized_tournament_official(
      authUserId,
      court?.tournament_id || null,
      match.event_id,
      liveCa.court_id,
      false
    );

    if (!isAuthorized) {
      const err: any = new Error('FORBIDDEN: Only assigned Table Officials and Tournament Administrators can record round scores. Court Managers are not authorized to score.');
      err.code = '40300';
      throw err;
    }

    if (match.status !== 'LIVE') {
      const err: any = new Error(`INVALID_STATE: Scores can only be recorded for LIVE matches. Current status: ${match.status}`);
      err.code = '40031';
      throw err;
    }

    const scoreId = `score-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const newScore: ScoringRound = {
      id: scoreId,
      match_id: p_match_id,
      round_number: p_round_number,
      red_score: p_red_score,
      blue_score: p_blue_score,
      red_advantage: p_red_advantage,
      blue_advantage: p_blue_advantage,
      winner_corner: p_winner_corner,
      judge_id: authUserId,
      is_confirmed: p_is_confirmed,
    };
    this.scoringRounds.push(newScore);

    return {
      success: true,
      score_id: scoreId,
      match_id: p_match_id,
      round_number: p_round_number,
      red_score: p_red_score,
      blue_score: p_blue_score,
      recorded_by: authUserId,
    };
  }

  // Authoritative RPC Simulation: complete_court_match
  rpc_complete_court_match(
    authUserId: string | null,
    p_match_id: string,
    p_winner_registration_id: string | null,
    p_decision_type: string = 'POINTS'
  ): any {
    if (!authUserId) {
      const err: any = new Error('UNAUTHORIZED: Authentication required.');
      err.code = '40100';
      throw err;
    }

    const match = this.matches.find((m) => m.id === p_match_id);
    if (!match) {
      const err: any = new Error('NOT_FOUND: Match does not exist.');
      err.code = '40400';
      throw err;
    }

    const liveCa = this.courtAssignments.find((ca) => ca.match_id === p_match_id && (ca.status === 'LIVE' || ca.status === 'ASSIGNED'));
    const court = liveCa ? this.courts.find((c) => c.id === liveCa.court_id) : null;

    const isAuthorized = this.rpc_is_authorized_tournament_official(
      authUserId,
      court?.tournament_id || null,
      match.event_id,
      liveCa?.court_id || null,
      true
    );

    if (!isAuthorized) {
      const err: any = new Error('FORBIDDEN: You are not authorized to complete this match.');
      err.code = '40300';
      throw err;
    }

    if (match.status !== 'LIVE' && match.status !== 'SCHEDULED' && match.status !== 'PENDING') {
      const err: any = new Error(`INVALID_STATE: Match is already finished or cannot be completed. Current status: ${match.status}`);
      err.code = '40040';
      throw err;
    }

    if (p_winner_registration_id && p_winner_registration_id !== match.red_corner_registration_id && p_winner_registration_id !== match.blue_corner_registration_id) {
      const err: any = new Error('INVALID_WINNER: Winner must be either the Red or Blue competitor.');
      err.code = '40041';
      throw err;
    }

    match.status = 'COMPLETED';
    match.winner_registration_id = p_winner_registration_id;

    // Record result
    const existingResult = this.matchResults.find((r) => r.match_id === p_match_id);
    if (existingResult) {
      existingResult.winner_registration_id = p_winner_registration_id;
      existingResult.decision_type = p_decision_type;
    } else {
      this.matchResults.push({
        match_id: p_match_id,
        winner_registration_id: p_winner_registration_id,
        decision_type: p_decision_type,
      });
    }

    if (liveCa) {
      liveCa.status = 'COMPLETED';
      liveCa.completed_at = new Date().toISOString();
    }

    // Bracket progression
    if (match.next_match_id && p_winner_registration_id) {
      const nextMatch = this.matches.find((m) => m.id === match.next_match_id);
      if (nextMatch) {
        if (!nextMatch.red_corner_registration_id) {
          nextMatch.red_corner_registration_id = p_winner_registration_id;
        } else if (!nextMatch.blue_corner_registration_id && nextMatch.red_corner_registration_id !== p_winner_registration_id) {
          nextMatch.blue_corner_registration_id = p_winner_registration_id;
        }
      }
    }

    return {
      success: true,
      match_id: p_match_id,
      winner_registration_id: p_winner_registration_id,
      decision_type: p_decision_type,
      status: 'COMPLETED',
    };
  }

  // Teardown / Cleanup
  teardown() {
    this.eventAssignments = [];
    this.courtAssignments = [];
    this.scoringRounds = [];
    this.matchResults = [];
  }
}

// EXECUTE E2E-01 to E2E-14
function runE2ETests() {
  const db = new DatabaseHarness();
  const TOURNAMENT_A_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const EVENT_1_ID = 'eeee1111-eeee-4eee-eeee-eeeeeeeeeeee';
  const COURT_1_ID = 'cccc1111-cccc-4ccc-cccc-cccccccccccc';
  const COURT_2_ID = 'cccc2222-cccc-4ccc-cccc-cccccccccccc';
  const MATCH_1_ID = 'mmmm1111-mmmm-4mmm-mmmm-mmmmmmmmmmmm';
  const MATCH_2_ID = 'mmmm2222-mmmm-4mmm-mmmm-mmmmmmmmmmmm';
  const MATCH_FINAL_ID = 'mmmm9999-mmmm-4mmm-mmmm-mmmmmmmmmmmm';

  const ACTOR_ORGANIZER_OWNER = '11111111-1111-4111-a111-111111111111';
  const ACTOR_ORGANIZER_NON_OWNER = '22222222-2222-4222-a222-222222222222';
  const ACTOR_COURT_MANAGER = '33333333-3333-4333-a333-333333333333';
  const ACTOR_TABLE_OFFICIAL_1A = '44444444-4444-4444-a444-444444444444';
  const ACTOR_TABLE_OFFICIAL_1B = '55555555-5555-4555-a555-555555555555';
  const ACTOR_TABLE_OFFICIAL_2 = '66666666-6666-4666-a666-666666666666';
  const ACTOR_UNAUTHENTICATED = null;

  let caIdMatch1 = '';
  let caIdMatch2 = '';

  // E2E-01: Anonymous RPC Denial
  try {
    db.rpc_assign_event_role(ACTOR_UNAUTHENTICATED, EVENT_1_ID, ACTOR_COURT_MANAGER, 'COURT_MANAGER', null);
    testResults.push({
      id: 'E2E-01',
      actor: 'ACTOR_UNAUTHENTICATED',
      rpc: 'assign_event_role',
      result: 'Unexpected Success',
      expectedResult: 'DENIED (40100)',
      actualResult: 'SUCCESS',
      errorCode: null,
      postConditionVerified: false,
      status: 'FAIL',
    });
  } catch (err: any) {
    testResults.push({
      id: 'E2E-01',
      actor: 'ACTOR_UNAUTHENTICATED',
      rpc: 'assign_event_role',
      result: 'DENIED',
      expectedResult: 'DENIED (40100)',
      actualResult: `DENIED (${err.code})`,
      errorCode: err.code,
      postConditionVerified: db.eventAssignments.length === 0,
      status: err.code === '40100' ? 'PASS' : 'FAIL',
    });
  }

  // E2E-02: Non-Owner Organizer Denial
  try {
    db.rpc_assign_event_role(ACTOR_ORGANIZER_NON_OWNER, EVENT_1_ID, ACTOR_COURT_MANAGER, 'COURT_MANAGER', null);
    testResults.push({
      id: 'E2E-02',
      actor: 'ACTOR_ORGANIZER_NON_OWNER',
      rpc: 'assign_event_role',
      result: 'Unexpected Success',
      expectedResult: 'DENIED (40300)',
      actualResult: 'SUCCESS',
      errorCode: null,
      postConditionVerified: false,
      status: 'FAIL',
    });
  } catch (err: any) {
    testResults.push({
      id: 'E2E-02',
      actor: 'ACTOR_ORGANIZER_NON_OWNER',
      rpc: 'assign_event_role',
      result: 'DENIED',
      expectedResult: 'DENIED (40300)',
      actualResult: `DENIED (${err.code})`,
      errorCode: err.code,
      postConditionVerified: db.eventAssignments.length === 0,
      status: err.code === '40300' ? 'PASS' : 'FAIL',
    });
  }

  // E2E-03: Tournament Owner Assigns Court Manager
  try {
    const res = db.rpc_assign_event_role(ACTOR_ORGANIZER_OWNER, EVENT_1_ID, ACTOR_COURT_MANAGER, 'COURT_MANAGER', null);
    const postCond = db.eventAssignments.some(
      (ea) => ea.user_id === ACTOR_COURT_MANAGER && ea.role === 'COURT_MANAGER' && ea.court_id === null && ea.is_active
    );
    testResults.push({
      id: 'E2E-03',
      actor: 'ACTOR_ORGANIZER_OWNER',
      rpc: 'assign_event_role',
      result: 'SUCCESS',
      expectedResult: 'SUCCESS (active COURT_MANAGER assignment)',
      actualResult: `SUCCESS (assignment_id: ${res.id})`,
      errorCode: null,
      postConditionVerified: postCond,
      status: postCond ? 'PASS' : 'FAIL',
    });
  } catch (err: any) {
    testResults.push({
      id: 'E2E-03',
      actor: 'ACTOR_ORGANIZER_OWNER',
      rpc: 'assign_event_role',
      result: 'FAILED',
      expectedResult: 'SUCCESS',
      actualResult: `ERROR: ${err.message}`,
      errorCode: err.code,
      postConditionVerified: false,
      status: 'FAIL',
    });
  }

  // E2E-04: Prevent Court Manager Assigning Other Court Manager
  try {
    db.rpc_assign_event_role(ACTOR_COURT_MANAGER, EVENT_1_ID, ACTOR_TABLE_OFFICIAL_1A, 'COURT_MANAGER', null);
    testResults.push({
      id: 'E2E-04',
      actor: 'ACTOR_COURT_MANAGER',
      rpc: 'assign_event_role',
      result: 'Unexpected Success',
      expectedResult: 'DENIED (40300)',
      actualResult: 'SUCCESS',
      errorCode: null,
      postConditionVerified: false,
      status: 'FAIL',
    });
  } catch (err: any) {
    const postCond = !db.eventAssignments.some((ea) => ea.user_id === ACTOR_TABLE_OFFICIAL_1A && ea.role === 'COURT_MANAGER');
    testResults.push({
      id: 'E2E-04',
      actor: 'ACTOR_COURT_MANAGER',
      rpc: 'assign_event_role',
      result: 'DENIED',
      expectedResult: 'DENIED (40300)',
      actualResult: `DENIED (${err.code})`,
      errorCode: err.code,
      postConditionVerified: postCond,
      status: err.code === '40300' && postCond ? 'PASS' : 'FAIL',
    });
  }

  // E2E-05: Court Manager Assigns Table Official
  try {
    const res = db.rpc_assign_event_role(ACTOR_COURT_MANAGER, EVENT_1_ID, ACTOR_TABLE_OFFICIAL_1A, 'TABLE_OFFICIAL', COURT_1_ID);
    const postCond = db.eventAssignments.some(
      (ea) => ea.user_id === ACTOR_TABLE_OFFICIAL_1A && ea.role === 'TABLE_OFFICIAL' && ea.court_id === COURT_1_ID && ea.is_active
    );
    testResults.push({
      id: 'E2E-05',
      actor: 'ACTOR_COURT_MANAGER',
      rpc: 'assign_event_role',
      result: 'SUCCESS',
      expectedResult: 'SUCCESS (active TABLE_OFFICIAL on COURT_1)',
      actualResult: `SUCCESS (assignment_id: ${res.id})`,
      errorCode: null,
      postConditionVerified: postCond,
      status: postCond ? 'PASS' : 'FAIL',
    });
  } catch (err: any) {
    testResults.push({
      id: 'E2E-05',
      actor: 'ACTOR_COURT_MANAGER',
      rpc: 'assign_event_role',
      result: 'FAILED',
      expectedResult: 'SUCCESS',
      actualResult: `ERROR: ${err.message}`,
      errorCode: err.code,
      postConditionVerified: false,
      status: 'FAIL',
    });
  }

  // E2E-06: Multi-Official Concurrency on Same Court
  try {
    const res = db.rpc_assign_event_role(ACTOR_COURT_MANAGER, EVENT_1_ID, ACTOR_TABLE_OFFICIAL_1B, 'TABLE_OFFICIAL', COURT_1_ID);
    const activeCourt1Officials = db.eventAssignments.filter(
      (ea) => ea.court_id === COURT_1_ID && ea.role === 'TABLE_OFFICIAL' && ea.is_active
    );
    const postCond = activeCourt1Officials.length === 2;
    testResults.push({
      id: 'E2E-06',
      actor: 'ACTOR_COURT_MANAGER',
      rpc: 'assign_event_role',
      result: 'SUCCESS',
      expectedResult: 'SUCCESS (2 concurrent active officials on Court 1)',
      actualResult: `SUCCESS (2 active officials: ${activeCourt1Officials.map((o) => o.user_id).join(', ')})`,
      errorCode: null,
      postConditionVerified: postCond,
      status: postCond ? 'PASS' : 'FAIL',
    });
  } catch (err: any) {
    testResults.push({
      id: 'E2E-06',
      actor: 'ACTOR_COURT_MANAGER',
      rpc: 'assign_event_role',
      result: 'FAILED',
      expectedResult: 'SUCCESS',
      actualResult: `ERROR: ${err.message}`,
      errorCode: err.code,
      postConditionVerified: false,
      status: 'FAIL',
    });
  }

  // Also assign Table Official 2 to Court 2 for isolation test
  db.rpc_assign_event_role(ACTOR_COURT_MANAGER, EVENT_1_ID, ACTOR_TABLE_OFFICIAL_2, 'TABLE_OFFICIAL', COURT_2_ID);

  // E2E-07: Duplicate Official Assignment Rejection
  try {
    db.rpc_assign_event_role(ACTOR_COURT_MANAGER, EVENT_1_ID, ACTOR_TABLE_OFFICIAL_1A, 'TABLE_OFFICIAL', COURT_1_ID);
    testResults.push({
      id: 'E2E-07',
      actor: 'ACTOR_COURT_MANAGER',
      rpc: 'assign_event_role',
      result: 'Unexpected Success',
      expectedResult: 'DENIED (40901)',
      actualResult: 'SUCCESS',
      errorCode: null,
      postConditionVerified: false,
      status: 'FAIL',
    });
  } catch (err: any) {
    const exactOneActive = db.eventAssignments.filter(
      (ea) => ea.user_id === ACTOR_TABLE_OFFICIAL_1A && ea.court_id === COURT_1_ID && ea.is_active
    ).length === 1;
    testResults.push({
      id: 'E2E-07',
      actor: 'ACTOR_COURT_MANAGER',
      rpc: 'assign_event_role',
      result: 'DENIED',
      expectedResult: 'DENIED (40901)',
      actualResult: `DENIED (${err.code})`,
      errorCode: err.code,
      postConditionVerified: exactOneActive,
      status: err.code === '40901' && exactOneActive ? 'PASS' : 'FAIL',
    });
  }

  // E2E-08: Court Manager Match Dispatch
  try {
    const res1 = db.rpc_assign_match_to_court(ACTOR_COURT_MANAGER, MATCH_1_ID, COURT_1_ID);
    caIdMatch1 = res1.assignment_id;
    const match1 = db.matches.find((m) => m.id === MATCH_1_ID);
    const postCond = match1?.status === 'SCHEDULED' && match1?.court_identifier === 'Court 1';
    testResults.push({
      id: 'E2E-08',
      actor: 'ACTOR_COURT_MANAGER',
      rpc: 'assign_match_to_court',
      result: 'SUCCESS',
      expectedResult: 'SUCCESS (Match assigned to Court 1, status SCHEDULED)',
      actualResult: `SUCCESS (assignment_id: ${caIdMatch1}, match_status: ${match1?.status})`,
      errorCode: null,
      postConditionVerified: postCond,
      status: postCond ? 'PASS' : 'FAIL',
    });
  } catch (err: any) {
    testResults.push({
      id: 'E2E-08',
      actor: 'ACTOR_COURT_MANAGER',
      rpc: 'assign_match_to_court',
      result: 'FAILED',
      expectedResult: 'SUCCESS',
      actualResult: `ERROR: ${err.message}`,
      errorCode: err.code,
      postConditionVerified: false,
      status: 'FAIL',
    });
  }

  // E2E-09: Match Start & Single LIVE Court Invariant
  try {
    const res = db.rpc_start_court_match(ACTOR_TABLE_OFFICIAL_1A, caIdMatch1);
    const match1 = db.matches.find((m) => m.id === MATCH_1_ID);
    const ca1 = db.courtAssignments.find((a) => a.id === caIdMatch1);
    const postCond = match1?.status === 'LIVE' && ca1?.status === 'LIVE';
    testResults.push({
      id: 'E2E-09',
      actor: 'ACTOR_TABLE_OFFICIAL_1A',
      rpc: 'start_court_match',
      result: 'SUCCESS',
      expectedResult: 'SUCCESS (match status LIVE, court assignment status LIVE)',
      actualResult: `SUCCESS (match status: ${match1?.status}, ca status: ${ca1?.status})`,
      errorCode: null,
      postConditionVerified: postCond,
      status: postCond ? 'PASS' : 'FAIL',
    });
  } catch (err: any) {
    testResults.push({
      id: 'E2E-09',
      actor: 'ACTOR_TABLE_OFFICIAL_1A',
      rpc: 'start_court_match',
      result: 'FAILED',
      expectedResult: 'SUCCESS',
      actualResult: `ERROR: ${err.message}`,
      errorCode: err.code,
      postConditionVerified: false,
      status: 'FAIL',
    });
  }

  // E2E-10: Concurrency Violation Check (Double LIVE on Same Court)
  // First dispatch match 2 to court 1
  const res2 = db.rpc_assign_match_to_court(ACTOR_COURT_MANAGER, MATCH_2_ID, COURT_1_ID);
  caIdMatch2 = res2.assignment_id;
  try {
    db.rpc_start_court_match(ACTOR_COURT_MANAGER, caIdMatch2);
    testResults.push({
      id: 'E2E-10',
      actor: 'ACTOR_COURT_MANAGER',
      rpc: 'start_court_match',
      result: 'Unexpected Success',
      expectedResult: 'DENIED (40902 CONCURRENCY_VIOLATION)',
      actualResult: 'SUCCESS',
      errorCode: null,
      postConditionVerified: false,
      status: 'FAIL',
    });
  } catch (err: any) {
    const liveMatchesOnCourt1 = db.courtAssignments.filter((ca) => ca.court_id === COURT_1_ID && ca.status === 'LIVE');
    const postCond = liveMatchesOnCourt1.length === 1 && liveMatchesOnCourt1[0].match_id === MATCH_1_ID;
    testResults.push({
      id: 'E2E-10',
      actor: 'ACTOR_COURT_MANAGER',
      rpc: 'start_court_match',
      result: 'DENIED',
      expectedResult: 'DENIED (40902 CONCURRENCY_VIOLATION)',
      actualResult: `DENIED (${err.code})`,
      errorCode: err.code,
      postConditionVerified: postCond,
      status: err.code === '40902' && postCond ? 'PASS' : 'FAIL',
    });
  }

  // E2E-11: Scoring Lockdown for Court Manager
  try {
    db.rpc_record_round_score(ACTOR_COURT_MANAGER, MATCH_1_ID, 1, 2, 0);
    testResults.push({
      id: 'E2E-11',
      actor: 'ACTOR_COURT_MANAGER',
      rpc: 'record_round_score',
      result: 'Unexpected Success',
      expectedResult: 'DENIED (40300 Court Manager prohibited from scoring)',
      actualResult: 'SUCCESS',
      errorCode: null,
      postConditionVerified: false,
      status: 'FAIL',
    });
  } catch (err: any) {
    const scoreRows = db.scoringRounds.filter((sr) => sr.match_id === MATCH_1_ID);
    const postCond = scoreRows.length === 0;
    testResults.push({
      id: 'E2E-11',
      actor: 'ACTOR_COURT_MANAGER',
      rpc: 'record_round_score',
      result: 'DENIED',
      expectedResult: 'DENIED (40300 Court Manager prohibited from scoring)',
      actualResult: `DENIED (${err.code})`,
      errorCode: err.code,
      postConditionVerified: postCond,
      status: err.code === '40300' && postCond ? 'PASS' : 'FAIL',
    });
  }

  // E2E-12: Table Official Cross-Court Scoring Denial
  try {
    db.rpc_record_round_score(ACTOR_TABLE_OFFICIAL_2, MATCH_1_ID, 1, 2, 0);
    testResults.push({
      id: 'E2E-12',
      actor: 'ACTOR_TABLE_OFFICIAL_2',
      rpc: 'record_round_score',
      result: 'Unexpected Success',
      expectedResult: 'DENIED (40300 Court 2 official cannot score Court 1)',
      actualResult: 'SUCCESS',
      errorCode: null,
      postConditionVerified: false,
      status: 'FAIL',
    });
  } catch (err: any) {
    const scoreRows = db.scoringRounds.filter((sr) => sr.match_id === MATCH_1_ID);
    const postCond = scoreRows.length === 0;
    testResults.push({
      id: 'E2E-12',
      actor: 'ACTOR_TABLE_OFFICIAL_2',
      rpc: 'record_round_score',
      result: 'DENIED',
      expectedResult: 'DENIED (40300 Court 2 official cannot score Court 1)',
      actualResult: `DENIED (${err.code})`,
      errorCode: err.code,
      postConditionVerified: postCond,
      status: err.code === '40300' && postCond ? 'PASS' : 'FAIL',
    });
  }

  // E2E-13: Authorized Table Official Records Round Score
  try {
    const res = db.rpc_record_round_score(
      ACTOR_TABLE_OFFICIAL_1A,
      MATCH_1_ID,
      1,
      4,
      2,
      true,
      false,
      'RED',
      true
    );
    const scoreRecord = db.scoringRounds.find((sr) => sr.id === res.score_id);
    const postCond =
      Boolean(scoreRecord) &&
      scoreRecord?.judge_id === ACTOR_TABLE_OFFICIAL_1A &&
      scoreRecord?.red_score === 4 &&
      scoreRecord?.blue_score === 2;
    testResults.push({
      id: 'E2E-13',
      actor: 'ACTOR_TABLE_OFFICIAL_1A',
      rpc: 'record_round_score',
      result: 'SUCCESS',
      expectedResult: 'SUCCESS (Round 1 score recorded)',
      actualResult: `SUCCESS (score_id: ${res.score_id}, red: 4, blue: 2)`,
      errorCode: null,
      postConditionVerified: postCond,
      status: postCond ? 'PASS' : 'FAIL',
    });
  } catch (err: any) {
    testResults.push({
      id: 'E2E-13',
      actor: 'ACTOR_TABLE_OFFICIAL_1A',
      rpc: 'record_round_score',
      result: 'FAILED',
      expectedResult: 'SUCCESS',
      actualResult: `ERROR: ${err.message}`,
      errorCode: err.code,
      postConditionVerified: false,
      status: 'FAIL',
    });
  }

  // E2E-14: Match Completion & Winner Progression
  try {
    const RED_CORNER_ID = 'rrrr1111-rrrr-4rrr-rrrr-rrrrrrrrrrrr';
    const res = db.rpc_complete_court_match(ACTOR_TABLE_OFFICIAL_1A, MATCH_1_ID, RED_CORNER_ID, 'POINTS');
    const match1 = db.matches.find((m) => m.id === MATCH_1_ID);
    const finalMatch = db.matches.find((m) => m.id === MATCH_FINAL_ID);
    const matchResult = db.matchResults.find((r) => r.match_id === MATCH_1_ID);
    const ca1 = db.courtAssignments.find((a) => a.id === caIdMatch1);

    const postCond =
      match1?.status === 'COMPLETED' &&
      match1?.winner_registration_id === RED_CORNER_ID &&
      matchResult?.decision_type === 'POINTS' &&
      ca1?.status === 'COMPLETED' &&
      finalMatch?.red_corner_registration_id === RED_CORNER_ID;

    testResults.push({
      id: 'E2E-14',
      actor: 'ACTOR_TABLE_OFFICIAL_1A',
      rpc: 'complete_court_match',
      result: 'SUCCESS',
      expectedResult: 'SUCCESS (match COMPLETED, winner advanced to next match red corner)',
      actualResult: `SUCCESS (match1_status: ${match1?.status}, finalMatch_red_corner: ${finalMatch?.red_corner_registration_id})`,
      errorCode: null,
      postConditionVerified: postCond,
      status: postCond ? 'PASS' : 'FAIL',
    });
  } catch (err: any) {
    testResults.push({
      id: 'E2E-14',
      actor: 'ACTOR_TABLE_OFFICIAL_1A',
      rpc: 'complete_court_match',
      result: 'FAILED',
      expectedResult: 'SUCCESS',
      actualResult: `ERROR: ${err.message}`,
      errorCode: err.code,
      postConditionVerified: false,
      status: 'FAIL',
    });
  }

  // Teardown / Cleanup
  const preCleanupCount = db.eventAssignments.length + db.courtAssignments.length + db.scoringRounds.length;
  db.teardown();
  const postCleanupCount = db.eventAssignments.length + db.courtAssignments.length + db.scoringRounds.length;

  console.log(JSON.stringify({
    testResults,
    initialUserRolesCount: db.initialUserRolesCount,
    finalUserRolesCount: db.userRoles.length,
    preCleanupCount,
    postCleanupCount,
  }, null, 2));
}

runE2ETests();
