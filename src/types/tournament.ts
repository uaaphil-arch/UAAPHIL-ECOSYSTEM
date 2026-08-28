export type TournamentStatus =
  | 'DRAFT'
  | 'REGISTRATION_OPEN'
  | 'REGISTRATION_CLOSED'
  | 'ONGOING'
  | 'COMPLETED'
  | 'CANCELLED';

export interface Tournament {
  id: string;
  organizer_id: string;
  name: string;
  slug: string;
  description: string | null;
  start_date: string;
  end_date: string;
  status: TournamentStatus;
  created_at: string;
  updated_at?: string;
}

export interface TournamentSnapshot {
  id: string;
  tournament_id: string;
  version: number;
  configuration: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
}

export interface EventWeightClassItem {
  id?: string;
  name: string;
  min_weight: number | null;
  max_weight: number | null;
  requires_weigh_in: boolean;
}

export interface TournamentEvent {
  id: string;
  snapshot_id: string;
  name: string;
  category: string;
  division: string;
  weight_class: string | null;
  gender: string | null;
  min_weight?: number | null;
  max_weight?: number | null;
  weight_classes?: EventWeightClassItem[];
  rules_override: Record<string, unknown>;
  created_at: string;
}

export type WeighInStatus =
  | 'PENDING'
  | 'PASSED'
  | 'OVERWEIGHT'
  | 'UNDERWEIGHT'
  | 'NOT_REQUIRED';

export type LineupRole =
  | 'LINEUP'
  | 'RESERVE'
  | 'WITHDRAWN';

export interface RegistrationFilterState {
  search: string;
  category: string;
  division: string;
  gender: string;
  approvalStatus: 'ALL' | 'APPROVED' | 'PENDING';
  weighInStatus: 'ALL' | 'PENDING' | 'PASSED' | 'OVERWEIGHT' | 'UNDERWEIGHT';
  lineupRole?: 'ALL' | LineupRole;
}

export interface Registration {
  id: string;
  event_id: string;
  user_id: string;
  club_id?: string | null;
  team_name: string | null;
  lineup_role?: LineupRole;
  weigh_in_weight: number | null;
  is_approved: boolean;
  approved_by?: string | null;
  created_at: string;
  updated_at?: string;
  // Joined fields for UI convenience
  event?: TournamentEvent;
  user_profile?: {
    full_name: string;
    email: string;
  };
}

export interface Court {
  id: string;
  tournament_id: string;
  name: string;
  identifier: string;
  is_active: boolean;
  created_at: string;
}

export type MatchStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export type CourtAssignmentStatus = 'ASSIGNED' | 'LIVE' | 'COMPLETED' | 'CANCELLED';

export type DecisionType = 'POINTS' | 'TKO' | 'DQ' | 'DEFAULT' | 'VOLUNTARY_DROP';

export type CornerColor = 'RED' | 'BLUE';

export interface Match {
  id: string;
  tournament_id: string;
  event_id: string;
  bracket_node_index?: number;
  round_name?: string;
  round_number?: number;
  match_number?: number;
  court_identifier?: string;
  red_corner_registration_id: string | null;
  blue_corner_registration_id: string | null;
  winner_registration_id?: string | null;
  status: MatchStatus;
  next_match_id?: string | null;
  next_match_corner?: CornerColor | null;
  created_at: string;
  updated_at?: string;
  // Joined fields for UI convenience
  event?: TournamentEvent;
  red_registration?: Registration;
  blue_registration?: Registration;
  winner_registration?: Registration;
}

export interface CourtAssignment {
  id: string;
  court_id: string;
  match_id: string;
  status: CourtAssignmentStatus;
  assigned_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  // Joined fields
  court?: Court;
  match?: Match;
}

export interface ScoringRound {
  id?: string;
  match_id: string;
  round_number: number;
  red_score: number;
  blue_score: number;
  red_advantage: boolean;
  blue_advantage: boolean;
  winner_corner?: CornerColor | null;
  judge_id?: string | null;
  is_confirmed?: boolean;
}

export interface MatchResult {
  id?: string;
  match_id: string;
  winner_registration_id: string;
  decision_type: DecisionType;
  rounds_won_red: number;
  rounds_won_blue: number;
  is_official: boolean;
  finalized_by: string;
  finalized_at?: string;
}

export interface CreateSnapshotResponse {
  id?: string;
  success: boolean;
  snapshot_id: string;
  version: number;
  tournament_id: string;
  is_active?: boolean;
}

export interface LockTournamentResponse {
  success: boolean;
  tournament_id: string;
  snapshot_id: string;
  version: number;
  status: TournamentStatus;
  events_count: number;
  registrations_count: number;
  courts_count: number;
}

// ============================================================================
// ANYO COMPETITION ENGINE TYPES (NORMATIVE UAAPHIL CANONICAL)
// ============================================================================

export type AnyoCanonicalCategory =
  | 'Anyo Solo Baston'
  | 'Anyo Doble Baston'
  | 'Anyo Espada y Daga'
  | 'Anyo Solo Espada'
  | 'Team Solo Baston'
  | 'Team Doble Baston'
  | 'Team Espada y Daga'
  | 'Team Espada';

export type AnyoPanelSize = '5_JUDGES' | '7_JUDGES';
export type AnyoCalcMethod = 'OLYMPIC_TRIM' | 'ARITHMETIC_MEAN' | 'STANDARD_MEAN';
export type AnyoPerformanceStatus =
  | 'WAITING'
  | 'CALLED'
  | 'PERFORMING'
  | 'SCORING'
  | 'COMPLETED'
  | 'DQ'
  | 'NO_SHOW';

export type AnyoSessionStatus =
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'TIE_TIER_2'
  | 'TIE_TIER_3'
  | 'FINALIZED';

export type AnyoTieTier = 'TIER_1' | 'TIER_2' | 'TIER_3_MAJORITY';

export type AnyoSeedTier = 1 | 2 | 3 | 4 | 5;

export type AnyoHistoricalClassification =
  | 'TOP_SEEDED_GOLD'
  | 'HIGH_SEEDED_SILVER'
  | 'SEEDED_BRONZE'
  | 'EXPERIENCED'
  | 'UNSEEDED';

export type AnyoDrawStatus = 'PENDING' | 'GENERATED' | 'CONFIRMED';

export interface AnyoCategorySession {
  id: string;
  tournament_id: string;
  event_id: string;
  court_id?: string | null;
  panel_size: AnyoPanelSize;
  calc_method: AnyoCalcMethod;
  status: AnyoSessionStatus;
  current_performance_id?: string | null;
  draw_status?: AnyoDrawStatus;
  draw_version?: number;
  draw_generated_at?: string | null;
  draw_confirmed_at?: string | null;
  draw_confirmed_by?: string | null;
  draw_metadata?: Record<string, unknown>;
  finalized_by?: string | null;
  finalized_at?: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  event?: TournamentEvent;
  court?: Court;
}

export interface AnyoPerformance {
  id: string;
  session_id: string;
  tournament_id: string;
  event_id: string;
  registration_id: string;
  order_number: number;
  status: AnyoPerformanceStatus;
  seed_tier?: AnyoSeedTier;
  historical_classification?: AnyoHistoricalClassification;
  draw_group?: string;
  seed_details?: Record<string, unknown>;
  seeding_cutoff_at?: string | null;
  final_score?: number | null;
  final_rank?: number | null;
  medal_awarded?: 'GOLD' | 'SILVER' | 'BRONZE' | null;
  called_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  registration?: Registration;
}

export interface AnyoScore {
  id: string;
  performance_id: string;
  session_id: string;
  tier: AnyoTieTier;
  judge_scores: number[];
  trimmed_scores?: number[] | null;
  calculated_score: number;
  table_official_id: string;
  is_confirmed: boolean;
  created_at: string;
  updated_at: string;
}

export interface AnyoTier3Tally {
  id: string;
  session_id: string;
  tied_performance_ids: string[];
  tallies: Record<string, number>;
  winning_performance_id: string;
  panel_size: number;
  submitted_by: string;
  reason: string;
  created_at: string;
}

// ============================================================================
// TOURNAMENT CLOSURE & SEAL TYPES (NORMATIVE UAAPHIL CANONICAL - MIGRATION 000016)
// ============================================================================

export interface TournamentSignatory {
  role: string;
  name: string;
  title?: string;
  signed_at?: string;
}

export interface StandingsSnapshotItem {
  school_club: string;
  gold_count: number;
  silver_count: number;
  bronze_count: number;
  total_medals: number;
  rank_position: number;
}

export interface TournamentClosureSeal {
  id: string;
  tournament_id: string;
  seal_number: string;
  closure_hash: string;
  finalized_by: string;
  finalized_at: string;
  weigh_in_required: boolean;
  total_bouts_completed: number;
  total_anyo_performances: number;
  total_participating_delegations: number;
  champion_team_name?: string | null;
  final_standings_snapshot: StandingsSnapshotItem[];
  eligibility_summary: Record<string, unknown>;
  signatories: TournamentSignatory[];
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface FinalizeTournamentResponse {
  success: boolean;
  tournament_id: string;
  seal_id: string;
  seal_number: string;
  closure_hash: string;
  finalized_at: string;
  weigh_in_required: boolean;
  total_bouts: number;
  total_anyo: number;
  champion_team: string;
  status: 'COMPLETED';
}

