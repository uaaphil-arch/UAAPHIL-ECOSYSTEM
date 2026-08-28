import { Match, Court, TournamentEvent, Registration } from './tournament';

export type PublicMatchStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface PublicAthleteInfo {
  registration_id: string | null;
  full_name: string;
  school_club: string;
  team_name: string;
  gender?: string | null;
}

export interface PublicScheduledMatch {
  id: string;
  match_number: number;
  tournament_id: string;
  event_id: string;
  event_name: string;
  division_name: string;
  category_name: string;
  gender: string;
  weight_class: string;
  round_name: string;
  round_number: number;
  court_identifier: string;
  status: PublicMatchStatus;
  scheduled_time?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  red_athlete: PublicAthleteInfo;
  blue_athlete: PublicAthleteInfo;
  winner_registration_id?: string | null;
  winner_corner?: 'RED' | 'BLUE' | null;
  bracket_node_index?: number;
}

export interface PublicCourtOverview {
  court_id: string;
  court_name: string;
  court_identifier: string;
  is_active: boolean;
  now_playing: PublicScheduledMatch | null;
  on_deck: PublicScheduledMatch | null;
  in_queue_count: number;
  upcoming_matches: PublicScheduledMatch[];
  completed_matches_count: number;
}

export interface PublicTournamentScheduleSummary {
  tournament_id: string;
  tournament_name: string;
  total_matches: number;
  completed_matches: number;
  in_progress_matches: number;
  scheduled_matches: number;
  courts: PublicCourtOverview[];
  all_matches: PublicScheduledMatch[];
}

export interface AthleteSearchResultItem {
  match: PublicScheduledMatch;
  athlete: PublicAthleteInfo;
  corner: 'RED' | 'BLUE';
  is_winner: boolean;
}

export type RealtimeSyncState = 'CONNECTED' | 'RECONNECTING' | 'OFFLINE' | 'SYNCING';
