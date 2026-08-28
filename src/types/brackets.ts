import { Match, MatchStatus, CornerColor, TournamentEvent, Registration } from './tournament';

export interface BracketGenerationResult {
  success: boolean;
  tournament_id: string;
  events_processed: number;
  matches_generated: number;
  byes_generated: number;
  generated_at: string;
}

export interface BracketParticipant {
  registration_id: string | null;
  athlete_name: string;
  club_or_school: string;
  seed?: number;
  corner: CornerColor;
  is_bye?: boolean;
  score?: number;
}

export interface BracketNode {
  match_id: string;
  event_id: string;
  tournament_id: string;
  bracket_node_index: number;
  round_number: number;
  round_name: string;
  match_number: number;
  court_identifier?: string | null;
  status: MatchStatus;
  red_participant: BracketParticipant;
  blue_participant: BracketParticipant;
  winner_registration_id?: string | null;
  winner_corner?: CornerColor | null;
  next_match_id?: string | null;
  next_match_corner?: CornerColor | null;
  is_bye_node: boolean;
  is_live: boolean;
  is_completed: boolean;
  raw_match: Match;
}

export interface BracketRound {
  round_number: number;
  round_name: string;
  nodes: BracketNode[];
}

export interface EventBracket {
  event: TournamentEvent;
  is_anyo: boolean;
  rounds: BracketRound[];
  total_matches: number;
  completed_matches: number;
  live_matches: number;
  scheduled_matches: number;
  byes_count: number;
}

export interface BracketSummary {
  tournament_id: string;
  total_events: number;
  total_bracket_nodes: number;
  total_byes: number;
  completed_matches: number;
  live_matches: number;
  scheduled_matches: number;
  has_active_or_completed_matches: boolean;
}
