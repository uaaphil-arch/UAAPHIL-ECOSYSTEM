import { Tournament, TournamentSnapshot, Registration, Match, AnyoCategorySession, Court, TournamentEvent } from './tournament';
import { EventPodium, TeamMedalTally, AthleteStanding, TournamentStandingsSummary } from './rankings';

export type MedalAwardType = 'GOLD' | 'SILVER' | 'BRONZE';

export type CertificateType = 'AWARD' | 'PARTICIPATION' | 'COACH_RECOGNITION';

export interface CertificateRecipient {
  id: string; // Unique certificate identifier
  registrationId?: string;
  athleteId?: string;
  recipientName: string;
  teamName: string;
  role: 'ATHLETE' | 'COACH';
  certificateType: CertificateType;
  medalType?: MedalAwardType;
  eventId?: string;
  eventName?: string;
  eventCategory?: string;
  eventGender?: string;
  eventDivision?: string;
  eventWeightClass?: string;
  finalScore?: number | string;
  tournamentId: string;
  tournamentName: string;
  tournamentDate: string;
  verificationHash: string;
  isProvisional: boolean;
  issuedAt: string;
}

export type ReportSubTab = 
  | 'RESULT_BOOK' 
  | 'BRACKETS'
  | 'WEIGH_IN_SHEET'
  | 'MATCH_SCHEDULE'
  | 'CLUB_SUMMARY'
  | 'CERTIFICATES' 
  | 'DELEGATION_ROSTER' 
  | 'CSV_EXPORT';

export interface ResultBookData {
  tournament: Tournament;
  snapshot: TournamentSnapshot | null;
  summary: TournamentStandingsSummary;
  teamTally: TeamMedalTally[];
  athleteStandings: AthleteStanding[];
  eventPodiums: EventPodium[];
  matches: Match[];
  anyoCategorySessions: AnyoCategorySession[];
  registrations: Registration[];
  courts: Court[];
  events: TournamentEvent[];
  generatedAt: string;
  isProvisional: boolean;
}

export type CSVExportType = 
  | 'MEDAL_TALLY' 
  | 'ATHLETE_STANDINGS' 
  | 'EVENT_PODIUMS' 
  | 'DELEGATION_ROSTER'
  | 'MATCH_RESULTS'
  | 'WEIGH_IN_RECORDS'
  | 'CLUB_SUMMARY';

