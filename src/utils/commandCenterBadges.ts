/**
 * Pure Badge Derivation Utility for Tournament Command Center
 * 
 * STRICT INVARIANT:
 * This utility is PURE PRESENTATIONAL / DERIVED DISPLAY LOGIC ONLY.
 * It NEVER mutates state, calls Supabase, assigns database roles, or returns permissions.
 * All derivations are deterministically computed strictly from already-authoritative inputs:
 * - Permanent roles (AppRole[])
 * - Tournament ownership (organizer_id)
 * - Event operational assignments (EventAssignment[])
 * 
 * Phase 23C-2
 */

import { AppRole } from '../types/roles';
import { EventAssignment } from '../types/eventAssignment';
import {
  OperationalTitle,
  OperationalBadgeInfo,
  OPERATIONAL_TITLES_METADATA,
  OperationalStationId,
  OperationalStationInfo,
  OPERATIONAL_STATIONS_METADATA,
} from '../types/commandCenter';

export interface BadgeDerivationInput {
  userId?: string | null;
  permanentRoles?: AppRole[] | null;
  tournamentOrganizerId?: string | null;
  eventAssignments?: EventAssignment[] | null;
  currentEventId?: string | null;
}

/**
 * Pure helper to derive operational badges deterministically from authoritative context.
 * Returns an array of deduplicated, deterministically ordered OperationalBadgeInfo objects.
 */
export function deriveOperationalBadges(input: BadgeDerivationInput): OperationalBadgeInfo[] {
  const {
    userId,
    permanentRoles = [],
    tournamentOrganizerId,
    eventAssignments = [],
    currentEventId,
  } = input;

  if (!userId) {
    return [];
  }

  const safeRoles = permanentRoles || [];
  const safeAssignments = eventAssignments || [];

  const isSuperAdmin = safeRoles.includes('SUPER_ADMIN');
  const isAdmin = safeRoles.includes('ADMIN');
  const isGlobalAdmin = isSuperAdmin || isAdmin;

  const isTournamentOwner = Boolean(
    tournamentOrganizerId && tournamentOrganizerId === userId
  );

  // Active event assignments for the user
  const activeUserAssignments = safeAssignments.filter(
    (a) => a && a.user_id === userId && a.is_active
  );

  // Check for active COURT_MANAGER assignment (event-wide or current event scope)
  const hasActiveCourtManager = activeUserAssignments.some((a) => {
    if (a.role !== 'COURT_MANAGER') return false;
    if (currentEventId) {
      return a.event_id === currentEventId;
    }
    return true;
  });

  // Check for active TABLE_OFFICIAL assignment
  const hasActiveTableOfficial = activeUserAssignments.some((a) => {
    if (a.role !== 'TABLE_OFFICIAL') return false;
    if (currentEventId) {
      return a.event_id === currentEventId;
    }
    return true;
  });

  const matchedTitles = new Map<OperationalTitle, string>();

  // 1. TECHNICAL_LEAD: SUPER_ADMIN or ADMIN
  if (isSuperAdmin) {
    matchedTitles.set('TECHNICAL_LEAD', 'Authoritative Super Admin oversight');
  } else if (isAdmin) {
    matchedTitles.set('TECHNICAL_LEAD', 'Administrative platform authority');
  }

  // 2. TOURNAMENT_DIRECTOR: Tournament Owner or Super Admin / Admin
  if (isTournamentOwner) {
    matchedTitles.set('TOURNAMENT_DIRECTOR', 'Tournament Organizer & Primary Signatory');
  } else if (isSuperAdmin) {
    matchedTitles.set('TOURNAMENT_DIRECTOR', 'Executive Super Admin governance');
  } else if (isAdmin) {
    matchedTitles.set('TOURNAMENT_DIRECTOR', 'Administrative tournament oversight');
  }

  // 3. SCORING_LEAD: Global Admin, Tournament Owner, or Active Court Manager
  if (isGlobalAdmin) {
    matchedTitles.set('SCORING_LEAD', 'Administrative score arbitration & audit authority');
  } else if (isTournamentOwner) {
    matchedTitles.set('SCORING_LEAD', 'Organizer score & bracket supervision');
  } else if (hasActiveCourtManager) {
    matchedTitles.set('SCORING_LEAD', 'Assigned Court Manager scoring oversight');
  }

  // 4. COURT_OPERATIONS_LEAD: Active Court Manager or Global Admin / Tournament Owner
  if (hasActiveCourtManager) {
    matchedTitles.set('COURT_OPERATIONS_LEAD', 'Assigned Event Court Manager');
  } else if (isGlobalAdmin) {
    matchedTitles.set('COURT_OPERATIONS_LEAD', 'Administrative arena oversight');
  } else if (isTournamentOwner) {
    matchedTitles.set('COURT_OPERATIONS_LEAD', 'Organizer arena dispatch oversight');
  }

  // 5. REGISTRATION_WEIGHIN_LEAD: Global Admin or Tournament Owner
  if (isGlobalAdmin) {
    matchedTitles.set('REGISTRATION_WEIGHIN_LEAD', 'Administrative athlete check-in & weigh-in authority');
  } else if (isTournamentOwner) {
    matchedTitles.set('REGISTRATION_WEIGHIN_LEAD', 'Organizer athlete registration verification');
  }

  // 6. INCIDENT_RECOVERY_LEAD: Global Admin or Tournament Owner
  if (isGlobalAdmin) {
    matchedTitles.set('INCIDENT_RECOVERY_LEAD', 'Administrative dispute & emergency recovery authority');
  } else if (isTournamentOwner) {
    matchedTitles.set('INCIDENT_RECOVERY_LEAD', 'Organizer incident arbitration');
  }

  // Deterministically sort badges by displayOrder
  const result: OperationalBadgeInfo[] = [];
  for (const [titleId, reason] of matchedTitles.entries()) {
    const meta = OPERATIONAL_TITLES_METADATA[titleId];
    if (meta) {
      result.push({
        title: meta.id,
        label: meta.label,
        shortLabel: meta.shortLabel,
        description: meta.description,
        category: meta.category,
        displayOrder: meta.displayOrder,
        badgeStyle: meta.badgeStyle,
        qualifyingReason: reason,
      });
    }
  }

  return result.sort((a, b) => a.displayOrder - b.displayOrder);
}

/**
 * Derives operational context for a single event assignment row in assignment tables / modals.
 * Allows UI tables to render human-readable functional station indicators.
 */
export function getAssignmentOperationalContext(assignment: EventAssignment): {
  primaryTitle: string;
  stationScope: string;
  badgeStyleClass: string;
} {
  if (assignment.role === 'COURT_MANAGER') {
    return {
      primaryTitle: 'Court Operations Lead',
      stationScope: 'Event-Wide Dispatch & Progression',
      badgeStyleClass: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
    };
  }

  return {
    primaryTitle: 'Table Official / Ring Operator',
    stationScope: assignment.court_name ? `Court ${assignment.court_name}` : 'Assigned Ring Station',
    badgeStyleClass: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
  };
}

/**
 * Pure helper to derive available presentation stations deterministically from operational badges.
 * 
 * STRICT INVARIANT:
 * - Pure function. Zero side effects.
 * - Does NOT perform authorization or grant permissions.
 * - Returns only the stations corresponding to active, qualified operational badges.
 * 
 * Phase 23D-2
 */
export function deriveAvailableStations(derivedBadges: OperationalBadgeInfo[]): OperationalStationInfo[] {
  if (!derivedBadges || derivedBadges.length === 0) {
    return [];
  }

  const badgeTitleSet = new Map<OperationalTitle, string>();
  for (const badge of derivedBadges) {
    badgeTitleSet.set(badge.title, badge.qualifyingReason);
  }

  const stations: OperationalStationInfo[] = [];

  for (const [stationId, meta] of Object.entries(OPERATIONAL_STATIONS_METADATA) as [OperationalStationId, (typeof OPERATIONAL_STATIONS_METADATA)[OperationalStationId]][]) {
    const qualifyingReason = badgeTitleSet.get(meta.associatedTitle);
    if (qualifyingReason) {
      stations.push({
        ...meta,
        qualifyingReason,
      });
    }
  }

  return stations.sort((a, b) => a.displayOrder - b.displayOrder);
}

/**
 * Pure helper to determine the default selected station from an available stations list.
 * 
 * Strategy:
 * 1. COURT_OPERATIONS if available in the user's active stations.
 * 2. Otherwise, the first available station in canonical order.
 * 3. If no station is available, returns null.
 */
export function getDefaultSelectedStation(availableStations: OperationalStationInfo[]): OperationalStationId | null {
  if (!availableStations || availableStations.length === 0) {
    return null;
  }
  const hasCourtOps = availableStations.find((s) => s.id === 'COURT_OPERATIONS');
  if (hasCourtOps) {
    return 'COURT_OPERATIONS';
  }
  return availableStations[0].id;
}
