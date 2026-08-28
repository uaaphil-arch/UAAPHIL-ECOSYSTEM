/**
 * Tournament Command Center Operational Sub-Role Taxonomy
 * 
 * STRICT INVARIANT:
 * These titles are functional/operational designations ONLY.
 * They represent tournament-day duty contexts and UI badges.
 * They MUST NOT grant, expand, bypass, or escalate backend database permissions.
 * Existing PostgreSQL RLS, SECURITY DEFINER RPCs, public.user_roles, and public.event_assignments
 * remain the sole authoritative permission sources.
 * 
 * Phase 23C-2
 */

export type OperationalTitle =
  | 'TECHNICAL_LEAD'
  | 'TOURNAMENT_DIRECTOR'
  | 'SCORING_LEAD'
  | 'COURT_OPERATIONS_LEAD'
  | 'REGISTRATION_WEIGHIN_LEAD'
  | 'INCIDENT_RECOVERY_LEAD';

export interface OperationalTitleMetadata {
  id: OperationalTitle;
  label: string;
  shortLabel: string;
  description: string;
  category: 'GOVERNANCE' | 'OPERATIONS' | 'SCORING' | 'REGISTRATION' | 'TECHNICAL' | 'EMERGENCY';
  displayOrder: number;
  badgeStyle: {
    bgClass: string;
    textClass: string;
    borderClass: string;
    iconName?: string;
  };
}

export const OPERATIONAL_TITLES_METADATA: Record<OperationalTitle, OperationalTitleMetadata> = {
  TECHNICAL_LEAD: {
    id: 'TECHNICAL_LEAD',
    label: 'Technical Lead',
    shortLabel: 'Tech Lead',
    description: 'System integrity, platform configuration, diagnostics, and technical recovery oversight',
    category: 'TECHNICAL',
    displayOrder: 1,
    badgeStyle: {
      bgClass: 'bg-purple-500/10 dark:bg-purple-500/20',
      textClass: 'text-purple-700 dark:text-purple-300',
      borderClass: 'border-purple-300 dark:border-purple-500/30',
    },
  },
  TOURNAMENT_DIRECTOR: {
    id: 'TOURNAMENT_DIRECTOR',
    label: 'Tournament Director',
    shortLabel: 'Director',
    description: 'Overall tournament governance, schedule decisions, protests, and finalization certification',
    category: 'GOVERNANCE',
    displayOrder: 2,
    badgeStyle: {
      bgClass: 'bg-amber-500/10 dark:bg-amber-500/20',
      textClass: 'text-amber-800 dark:text-amber-300',
      borderClass: 'border-amber-300 dark:border-amber-500/30',
    },
  },
  SCORING_LEAD: {
    id: 'SCORING_LEAD',
    label: 'Scoring Lead',
    shortLabel: 'Scoring Lead',
    description: 'Chief referee, score arbitration, tie-breaker reviews, and judge coordination',
    category: 'SCORING',
    displayOrder: 3,
    badgeStyle: {
      bgClass: 'bg-red-500/10 dark:bg-red-500/20',
      textClass: 'text-red-700 dark:text-red-300',
      borderClass: 'border-red-300 dark:border-red-500/30',
    },
  },
  COURT_OPERATIONS_LEAD: {
    id: 'COURT_OPERATIONS_LEAD',
    label: 'Court Operations Lead',
    shortLabel: 'Court Ops Lead',
    description: 'Arena flow, match queue sequencing, court dispatching, and ring delay resolution',
    category: 'OPERATIONS',
    displayOrder: 4,
    badgeStyle: {
      bgClass: 'bg-blue-500/10 dark:bg-blue-500/20',
      textClass: 'text-blue-700 dark:text-blue-300',
      borderClass: 'border-blue-300 dark:border-blue-500/30',
    },
  },
  REGISTRATION_WEIGHIN_LEAD: {
    id: 'REGISTRATION_WEIGHIN_LEAD',
    label: 'Registration / Weigh-In Lead',
    shortLabel: 'Weigh-In Lead',
    description: 'Athlete check-in, weight verification, division certification, and lineup validation',
    category: 'REGISTRATION',
    displayOrder: 5,
    badgeStyle: {
      bgClass: 'bg-emerald-500/10 dark:bg-emerald-500/20',
      textClass: 'text-emerald-700 dark:text-emerald-300',
      borderClass: 'border-emerald-300 dark:border-emerald-500/30',
    },
  },
  INCIDENT_RECOVERY_LEAD: {
    id: 'INCIDENT_RECOVERY_LEAD',
    label: 'Incident / Recovery Lead',
    shortLabel: 'Incident Lead',
    description: 'Dispute handling, bout resets, disqualification arbitration, and emergency recovery',
    category: 'EMERGENCY',
    displayOrder: 6,
    badgeStyle: {
      bgClass: 'bg-rose-500/10 dark:bg-rose-500/20',
      textClass: 'text-rose-700 dark:text-rose-300',
      borderClass: 'border-rose-300 dark:border-rose-500/30',
    },
  },
};

export interface OperationalBadgeInfo {
  title: OperationalTitle;
  label: string;
  shortLabel: string;
  description: string;
  category: string;
  displayOrder: number;
  badgeStyle: {
    bgClass: string;
    textClass: string;
    borderClass: string;
  };
  qualifyingReason: string;
}

/**
 * Tournament Command Center Operational Stations
 * 
 * STRICT INVARIANT:
 * Stations are purely presentation/navigation workspaces.
 * They represent contextual lenses into existing tournament-day operations.
 * Station selection is client-side only and NEVER grants or alters database authority.
 * 
 * Phase 23D-2
 */

export type OperationalStationId =
  | 'DIRECTOR_HUB'
  | 'COURT_OPERATIONS'
  | 'SCORING_DESK'
  | 'REGISTRATION_WEIGHIN'
  | 'TECH_AUDIT'
  | 'INCIDENT_RECOVERY';

export interface OperationalStationMetadata {
  id: OperationalStationId;
  label: string;
  shortLabel: string;
  description: string;
  associatedTitle: OperationalTitle;
  displayOrder: number;
  iconName: string;
  accentColor: string;
}

export const OPERATIONAL_STATIONS_METADATA: Record<OperationalStationId, OperationalStationMetadata> = {
  DIRECTOR_HUB: {
    id: 'DIRECTOR_HUB',
    label: 'Tournament Director Hub',
    shortLabel: 'Director Hub',
    description: 'Executive governance, lifecycle advancement, and tournament closure status',
    associatedTitle: 'TOURNAMENT_DIRECTOR',
    displayOrder: 1,
    iconName: 'Crown',
    accentColor: 'amber',
  },
  COURT_OPERATIONS: {
    id: 'COURT_OPERATIONS',
    label: 'Court Operations Center',
    shortLabel: 'Court Ops',
    description: 'Real-time arena rings, bout dispatching, projector scoreboards, and queue control',
    associatedTitle: 'COURT_OPERATIONS_LEAD',
    displayOrder: 2,
    iconName: 'Layers',
    accentColor: 'blue',
  },
  SCORING_DESK: {
    id: 'SCORING_DESK',
    label: 'Scoring Supervision Desk',
    shortLabel: 'Scoring Desk',
    description: 'Chief referee arbitration, live round telemetry, and table official supervision',
    associatedTitle: 'SCORING_LEAD',
    displayOrder: 3,
    iconName: 'Award',
    accentColor: 'red',
  },
  REGISTRATION_WEIGHIN: {
    id: 'REGISTRATION_WEIGHIN',
    label: 'Registration & Weigh-In Desk',
    shortLabel: 'Weigh-In Desk',
    description: 'Athlete certification status, weigh-in compliance, and division lineup roster',
    associatedTitle: 'REGISTRATION_WEIGHIN_LEAD',
    displayOrder: 4,
    iconName: 'Scale',
    accentColor: 'emerald',
  },
  TECH_AUDIT: {
    id: 'TECH_AUDIT',
    label: 'Tech & Platform Diagnostics',
    shortLabel: 'Tech & Audit',
    description: 'Platform health, system telemetry, database sync invariants, and technical integrity',
    associatedTitle: 'TECHNICAL_LEAD',
    displayOrder: 5,
    iconName: 'Cpu',
    accentColor: 'purple',
  },
  INCIDENT_RECOVERY: {
    id: 'INCIDENT_RECOVERY',
    label: 'Incident & Recovery Station',
    shortLabel: 'Incident Desk',
    description: 'Dispute arbitration logs, ring status oversight, and recovery protocol references',
    associatedTitle: 'INCIDENT_RECOVERY_LEAD',
    displayOrder: 6,
    iconName: 'ShieldAlert',
    accentColor: 'rose',
  },
};

export interface OperationalStationInfo {
  id: OperationalStationId;
  label: string;
  shortLabel: string;
  description: string;
  associatedTitle: OperationalTitle;
  displayOrder: number;
  iconName: string;
  accentColor: string;
  qualifyingReason: string;
}
