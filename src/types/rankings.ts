export type MedalType = 'GOLD' | 'SILVER' | 'BRONZE';

export interface TeamMedalTally {
  team_id?: string;
  team_name: string;
  school_club: string;
  gold_count: number;
  silver_count: number;
  bronze_count: number;
  total_medals: number;
  rank: number;
  rank_display: string; // e.g. "1", "2", "T-3"
  is_tied: boolean;
}

export interface AthleteStanding {
  athlete_id: string;
  registration_id: string;
  athlete_name: string;
  team_name: string;
  gold_count: number;
  silver_count: number;
  bronze_count: number;
  total_medals: number;
  events_participated: number;
  events_won: number;
  rank: number;
  rank_display: string;
  is_tied: boolean;
}

export interface EventPodium {
  event_id: string;
  event_name: string;
  gender_category?: string;
  weight_category?: string;
  is_anyo: boolean;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FINALIZED';
  gold_winner?: {
    registration_id: string;
    athlete_name: string;
    team_name: string;
    final_score?: number;
  } | null;
  silver_winner?: {
    registration_id: string;
    athlete_name: string;
    team_name: string;
    final_score?: number;
  } | null;
  bronze_winners: Array<{
    registration_id: string;
    athlete_name: string;
    team_name: string;
    final_score?: number;
  }>;
}

export interface TournamentStandingsSummary {
  tournament_id: string;
  tournament_name: string;
  status: 'UPCOMING' | 'REGISTRATION' | 'SCHEDULED' | 'ONGOING' | 'COMPLETED' | 'CANCELLED';
  is_provisional: boolean;
  total_events: number;
  finalized_events: number;
  total_gold_awarded: number;
  total_silver_awarded: number;
  total_bronze_awarded: number;
  total_medals_awarded: number;
  teams_competing: number;
  athletes_competing: number;
}
