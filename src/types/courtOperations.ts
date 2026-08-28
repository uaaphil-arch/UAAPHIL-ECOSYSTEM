import { Match } from './tournament';

export type CourtState = 'AVAILABLE' | 'ASSIGNED' | 'LIVE' | 'OFFLINE';

export type QueueItemState = 'READY' | 'WAITING' | 'BLOCKED' | 'ASSIGNED' | 'LIVE' | 'COMPLETED';

export interface ParticipantSummary {
  registrationId: string;
  athleteName: string;
  teamName: string;
  score?: number;
  foulCount?: number;
  advantageCount?: number;
}

export interface CourtLiveMatchSummary {
  assignmentId: string;
  matchId: string;
  matchNumber: number;
  eventId: string;
  eventName: string;
  divisionName?: string;
  weightCategory?: string;
  roundName: string;
  roundNumber: number;
  matchStatus: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED';
  redAthlete: ParticipantSummary;
  blueAthlete: ParticipantSummary;
  currentRound: number;
  startedAt?: string;
}

export interface CourtQueuedMatchSummary {
  assignmentId: string;
  matchId: string;
  matchNumber: number;
  eventName: string;
  roundName: string;
  redAthlete: ParticipantSummary;
  blueAthlete: ParticipantSummary;
  assignedAt: string;
}

export interface CourtTelemetry {
  courtId: string;
  courtName: string;
  courtIdentifier: string;
  isActive: boolean;
  state: CourtState;
  activeMatch: CourtLiveMatchSummary | null;
  assignedQueue: CourtQueuedMatchSummary[];
  queueCount: number;
  assignedOfficials: Array<{
    userId: string;
    fullName: string;
    role: string;
    courtId: string | null;
  }>;
  nextOnDeck: CourtQueuedMatchSummary | null;
  completedCount: number;
}

export interface EnrichedQueueMatch {
  matchId: string;
  matchNumber: number;
  tournamentId: string;
  eventId: string;
  eventName: string;
  gender: string;
  division: string;
  weightClass: string;
  roundName: string;
  roundNumber: number;
  bracketNodeIndex: number;
  redAthlete: ParticipantSummary | null;
  blueAthlete: ParticipantSummary | null;
  queueState: QueueItemState;
  assignedCourtIdentifier?: string;
  assignedCourtId?: string;
  assignmentId?: string;
  dependencyNote?: string;
  winnerRegistrationId?: string | null;
  nextMatchId?: string | null;
  nextMatchCorner?: 'RED' | 'BLUE' | null;
}

export interface CourtOperationsMetrics {
  totalCourts: number;
  activeCourts: number;
  liveMatchesCount: number;
  readyQueueCount: number;
  waitingQueueCount: number;
  assignedQueueCount: number;
  completedMatchesCount: number;
  courtUtilizationPercentage: number;
}

export type IncidentSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

export type IncidentCategory =
  | 'COURT_OFFLINE'
  | 'SCORE_TIE_STALEMATE'
  | 'STALLED_BOUT'
  | 'DISPATCH_ANOMALY'
  | 'QUEUE_BLOCKED'
  | 'WALKOVER_FORFEIT'
  | 'DISQUALIFICATION'
  | 'AUDIT_EVENT';

export interface IncidentItem {
  id: string;
  category: IncidentCategory;
  severity: IncidentSeverity;
  title: string;
  description: string;
  courtId?: string;
  courtName?: string;
  courtIdentifier?: string;
  matchId?: string;
  matchNumber?: number;
  assignmentId?: string;
  eventId?: string;
  eventName?: string;
  redAthleteName?: string;
  blueAthleteName?: string;
  timestamp: string;
  actionRequired?: string;
  isResolved?: boolean;
}

export interface SystemAuditLogEntry {
  id: string;
  actor_user_id: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  tournament_id: string | null;
  details: Record<string, any> | null;
  ip_address: string | null;
  created_at: string;
  actor_profile?: {
    full_name?: string;
    email?: string;
  } | null;
}

export type NotificationSeverity = 'CRITICAL' | 'WARNING' | 'INFO' | 'DIAGNOSTIC';

export interface OperationalNotification {
  id: string;
  category: 'INCIDENT' | 'MATCH_COURT' | 'NETWORK';
  severity: NotificationSeverity;
  title: string;
  message: string;
  timestamp: string;
  isRead: boolean;
  tournament_id?: string;
  action?: string;
  actor_role?: string;
  entity_type?: string;
  entity_id?: string;
  audit_log_id?: string;
  targetTab?: string;
  targetEntityId?: string;
}
