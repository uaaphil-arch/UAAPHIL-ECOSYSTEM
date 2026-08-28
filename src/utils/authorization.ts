import { AppRole } from '../types/roles';
import { EventAssignment } from '../types/eventAssignment';

export type NavigationTab = 
  | 'dashboard' 
  | 'athlete_hub'
  | 'arena_schedule'
  | 'rankings'
  | 'reports'
  | 'team_management'
  | 'chat'
  | 'auth' 
  | 'profile' 
  | 'roles' 
  | 'branding'
  | 'tournaments' 
  | 'competition'
  | 'registrations' 
  | 'security' 
  | 'diagnostics'
  | 'qa_torture';

/**
 * Authoritative Navigation & Route Authorization Matrix
 * Maps each NavigationTab to the minimal allowed permanent roles.
 * If allowedRoles is null, the section is accessible to any authenticated user.
 */
export const TAB_AUTHORIZATION_RULES: Record<
  NavigationTab,
  {
    allowedRoles: AppRole[] | null;
    superAdminOnly?: boolean;
    description: string;
  }
> = {
  dashboard: {
    allowedRoles: null,
    description: 'User dashboard and activity overview',
  },
  athlete_hub: {
    allowedRoles: null,
    description: 'Personal athlete hub, club membership, tournament entries, weigh-in, and career achievements',
  },
  arena_schedule: {
    allowedRoles: null,
    description: 'Public real-time arena match schedules, multi-ring matrix, and athlete schedule finder',
  },
  rankings: {
    allowedRoles: null,
    description: 'Official tournament rankings, athlete standings, and team medal tally',
  },
  reports: {
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ORGANIZER', 'COACH'],
    description: 'Official tournament result books, printable certificates, and delegation rosters',
  },
  team_management: {
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'COACH'],
    description: 'Coach team management, club active roster, membership requests, and transfers',
  },
  chat: {
    allowedRoles: null,
    description: 'Live realtime communication channels, global forum, and tournament rooms',
  },
  auth: {
    allowedRoles: null,
    description: 'Google OAuth session details and sign out',
  },
  profile: {
    allowedRoles: null,
    description: 'Personal profile management (public.profiles)',
  },
  roles: {
    allowedRoles: ['SUPER_ADMIN'],
    superAdminOnly: true,
    description: 'Permanent RBAC assignment and revocation via SECURITY DEFINER RPCs',
  },
  branding: {
    allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
    description: 'Centralized logo asset upload and brand configuration',
  },
  tournaments: {
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ORGANIZER'],
    description: 'Competition configuration and immutable tournament snapshots',
  },
  competition: {
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ORGANIZER', 'COACH'],
    description: 'Live court assignment, queue oversight, and Full Contact scoring operator console',
  },
  registrations: {
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ORGANIZER', 'COACH'],
    description: 'Delegation athlete rosters, weight classes, and event registrations',
  },
  security: {
    allowedRoles: ['SUPER_ADMIN'],
    superAdminOnly: true,
    description: 'Technical security invariants, RLS policies, and RPC enforcement details',
  },
  diagnostics: {
    allowedRoles: ['SUPER_ADMIN'],
    superAdminOnly: true,
    description: 'Internal database introspection, token inspection, and schema verification',
  },
  qa_torture: {
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ORGANIZER'],
    description: 'FIND-036A Manual QA Button Torture and Reliability Dashboard (STAGING ONLY)',
  },
};

/**
 * Validates whether the QA console is enabled in the current environment.
 * Active in development mode or when explicitly enabled via VITE_ENABLE_QA_CONSOLE.
 */
export function isQaConsoleEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_ENABLE_QA_CONSOLE === 'true';
}

/**
  * Resolves the primary operational assignment deterministically when multiple exist.
  * Priority:
  * 1. Active TABLE_OFFICIAL with a non-null court_id
  * 2. Active COURT_MANAGER (event-wide)
  * 3. Most recently created active assignment
  */
export function resolvePrimaryAssignment(assignments: EventAssignment[]): EventAssignment | null {
  if (!assignments || assignments.length === 0) return null;
  const activeList = assignments.filter((a) => a.is_active);
  if (activeList.length === 0) return null;
  if (activeList.length === 1) return activeList[0];

  // Priority 1: Active Table Official with specific court assignment
  const tableOfficialWithCourt = activeList.find(
    (a) => a.role === 'TABLE_OFFICIAL' && Boolean(a.court_id)
  );
  if (tableOfficialWithCourt) return tableOfficialWithCourt;

  // Priority 2: Active Court Manager
  const courtManager = activeList.find((a) => a.role === 'COURT_MANAGER');
  if (courtManager) return courtManager;

  // Priority 3: Most recently created active assignment
  return [...activeList].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )[0];
}

/**
 * Validates whether the user holding the given permanent roles or operational assignment is authorized to access a tab.
 */
export function isTabAuthorized(
  tab: NavigationTab,
  userRoles: AppRole[],
  hasActiveOperationalAssignment: boolean = false
): boolean {
  // FIND-055: Environment guard for QA-only staging tab in production UI
  if (tab === 'qa_torture' && !isQaConsoleEnabled()) {
    return false;
  }

  // Dual-Authority: Operational access to competition tab for active event officials
  if (tab === 'competition' && hasActiveOperationalAssignment) {
    return true;
  }

  const rule = TAB_AUTHORIZATION_RULES[tab];
  if (!rule) return false;

  // Unrestricted tab (all authenticated users)
  if (rule.allowedRoles === null) {
    return true;
  }

  // Super Admin can access all authorized sections
  if (userRoles.includes('SUPER_ADMIN')) {
    return true;
  }

  // Check if user has at least one of the allowed roles
  return rule.allowedRoles.some((role) => userRoles.includes(role));
}
