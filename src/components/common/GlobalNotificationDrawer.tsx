import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { tournamentService } from '../../services/tournamentService';
import { courtOperationsService } from '../../services/courtOperationsService';
import { notificationService } from '../../services/notificationService';
import { eventAssignmentService } from '../../services/eventAssignmentService';
import { coachSuccessionService } from '../../services/coachSuccessionService';
import { Tournament } from '../../types/tournament';
import { SystemAuditLogEntry, OperationalNotification, NotificationSeverity } from '../../types/courtOperations';
import { EventAssignment } from '../../types/eventAssignment';
import { AssignedCoachClub } from '../../types/coachSuccession';
import { NavigationTab } from '../../utils/authorization';
import {
  Bell,
  BellRing,
  X,
  AlertTriangle,
  AlertOctagon,
  Info,
  Radio,
  Wifi,
  WifiOff,
  RefreshCw,
  Clock,
  ShieldAlert,
  Layers,
  Trophy,
  CheckCircle2,
  CheckCheck,
  Check,
  Filter,
  Flame,
  Activity,
  Eye,
  Inbox,
  ArrowRight,
  ExternalLink
} from 'lucide-react';

export type NotificationCategory = 'ALL' | 'UNREAD' | 'INCIDENT' | 'MATCH_COURT' | 'NETWORK';

interface GlobalNotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onCountUpdate?: (unreadCount: number, criticalCount: number) => void;
  onNavigate?: (tab: NavigationTab) => void;
}

const SEVERITY_RANK: Record<NotificationSeverity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  INFO: 2,
  DIAGNOSTIC: 3,
};

export const GlobalNotificationDrawer: React.FC<GlobalNotificationDrawerProps> = ({
  isOpen,
  onClose,
  onCountUpdate,
  onNavigate,
}) => {
  const { user, roles } = useAuth();
  const { isOnline, isReconnecting } = useNetworkStatus();

  // Tournament context
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string>('');
  const [isLoadingTournaments, setIsLoadingTournaments] = useState(false);

  // Authoritative Audit Logs for Active Tournament
  const [rawAuditLogs, setRawAuditLogs] = useState<SystemAuditLogEntry[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<NotificationCategory>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Per-User Read Notification IDs Set
  const [readIds, setReadIds] = useState<Set<string>>(new Set<string>());
  const [isProcessingAction, setIsProcessingAction] = useState(false);

  // Active Event Assignments and Coach Clubs for Audience Scoping
  const [eventAssignments, setEventAssignments] = useState<EventAssignment[]>([]);
  const [coachClubs, setCoachClubs] = useState<AssignedCoachClub[]>([]);

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Load active event assignments and coach clubs
  useEffect(() => {
    if (!user?.id) {
      setEventAssignments([]);
      setCoachClubs([]);
      return;
    }
    let isMounted = true;

    // 1. Fetch active event assignments (COURT_MANAGER, TABLE_OFFICIAL scoping)
    eventAssignmentService
      .fetchMyAssignments(user.id)
      .then((assignments) => {
        if (isMounted) setEventAssignments(assignments || []);
      })
      .catch((err) => {
        console.warn('Failed to load user event assignments for notifications:', err);
      });

    // 2. If user has COACH role, fetch assigned clubs
    if (roles.includes('COACH')) {
      coachSuccessionService
        .getMyAssignedClubs(user.id)
        .then((clubs) => {
          if (isMounted) setCoachClubs(clubs || []);
        })
        .catch((err) => {
          console.warn('Failed to load coach assigned clubs for notifications:', err);
        });
    }

    return () => {
      isMounted = false;
    };
  }, [user?.id, roles]);

  // Load tournaments list
  const loadTournaments = useCallback(async () => {
    setIsLoadingTournaments(true);
    try {
      const data = await tournamentService.getTournaments();
      setTournaments(data || []);
      if (data && data.length > 0) {
        setSelectedTournamentId((prev) => {
          if (prev && data.some((t) => t.id === prev)) return prev;
          // Default to first ongoing tournament, registration open, or first tournament
          const active = data.find((t) => t.status === 'ONGOING' || t.status === 'REGISTRATION_OPEN');
          return active ? active.id : data[0].id;
        });
      }
    } catch (err) {
      console.warn('Failed to load tournaments for notification drawer:', err);
    } finally {
      setIsLoadingTournaments(false);
    }
  }, []);

  useEffect(() => {
    loadTournaments();
  }, [loadTournaments]);

  // Load read notification IDs for authenticated user and tournament scope
  const loadReadNotificationIds = useCallback(async () => {
    if (!user?.id) {
      setReadIds(new Set<string>());
      return;
    }
    try {
      const ids = await notificationService.fetchReadNotificationIds(user.id, selectedTournamentId);
      setReadIds(new Set(ids));
    } catch (err) {
      console.warn('Failed to load read notification IDs:', err);
    }
  }, [user?.id, selectedTournamentId]);

  useEffect(() => {
    loadReadNotificationIds();
  }, [loadReadNotificationIds]);

  // Synchronize read states across multiple tabs and components
  useEffect(() => {
    const unsubscribe = notificationService.subscribeToReadStateChanges(() => {
      loadReadNotificationIds();
    });
    return () => {
      unsubscribe();
    };
  }, [loadReadNotificationIds]);

  // Load tournament-scoped audit/incident logs
  const loadAuditLogs = useCallback(async (tId: string) => {
    if (!tId) {
      setRawAuditLogs([]);
      return;
    }
    setIsLoadingLogs(true);
    try {
      const logs = await courtOperationsService.fetchTournamentAuditLogs(tId, 50);
      setRawAuditLogs(logs || []);
    } catch (err) {
      console.warn('Failed to fetch tournament audit logs for notifications:', err);
      setRawAuditLogs([]);
    } finally {
      setIsLoadingLogs(false);
    }
  }, []);

  useEffect(() => {
    if (selectedTournamentId) {
      loadAuditLogs(selectedTournamentId);
    } else {
      setRawAuditLogs([]);
    }
  }, [selectedTournamentId, loadAuditLogs]);

  // Subscribe to realtime audit log changes for the selected tournament
  useEffect(() => {
    if (!selectedTournamentId) return;

    const unsubscribe = courtOperationsService.subscribeToCourtOperations(
      selectedTournamentId,
      () => {
        loadAuditLogs(selectedTournamentId);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [selectedTournamentId, loadAuditLogs]);

  // Parse raw audit logs and network status into normalized OperationalNotification objects with deterministic role-aware filtering
  const notifications = useMemo<OperationalNotification[]>(() => {
    const list: OperationalNotification[] = [];

    // Derive canonical role context
    const isSuperAdmin = roles.includes('SUPER_ADMIN');
    const isAdmin = isSuperAdmin || roles.includes('ADMIN');
    const isOrganizerRole = roles.includes('ORGANIZER');
    const isCoachRole = roles.includes('COACH');

    const activeTournament = tournaments.find((t) => t.id === selectedTournamentId);

    // FAIL-CLOSED ORGANIZER: Must be Admin/SuperAdmin OR hold ORGANIZER role AND be verified organizer_id of activeTournament
    const isOrganizer =
      isAdmin ||
      (isOrganizerRole && Boolean(activeTournament && user?.id && activeTournament.organizer_id === user.id));

    // FAIL-CLOSED EVENT OPERATIONAL ROLES: Must be active assignment for this tournament/event context
    const activeEventAssignments = eventAssignments.filter(
      (a) => a.is_active && (!a.tournament_id || a.tournament_id === selectedTournamentId)
    );

    const isCourtManager = activeEventAssignments.some((a) => a.role === 'COURT_MANAGER');
    const isTableOfficial = activeEventAssignments.some((a) => a.role === 'TABLE_OFFICIAL');

    // Authoritative TABLE_OFFICIAL court scope (court_id must be non-empty)
    const assignedCourtIds = activeEventAssignments
      .filter((a) => a.role === 'TABLE_OFFICIAL' && a.court_id)
      .map((a) => a.court_id as string);
    const assignedCourtNames = activeEventAssignments
      .filter((a) => a.role === 'TABLE_OFFICIAL' && (a as any).court_name)
      .map((a) => String((a as any).court_name).toLowerCase())
      .filter(Boolean);

    // Authoritative COACH club scope (club_id must be non-empty)
    const coachClubIds = isCoachRole ? coachClubs.map((c) => c.club_id).filter(Boolean) : [];
    const coachClubNames = isCoachRole
      ? coachClubs.map((c) => (c.club_name || '').toLowerCase()).filter(Boolean)
      : [];

    // 1. Network / Realtime Diagnostic Alerts (Shown to all authenticated users)
    if (!isOnline) {
      const notifId = 'diag-network-offline';
      list.push({
        id: notifId,
        category: 'NETWORK',
        severity: 'CRITICAL',
        title: 'Device Disconnected',
        message: 'Internet connection is unavailable. Live operational streaming is paused.',
        timestamp: new Date().toISOString(),
        isRead: readIds.has(notifId),
        targetTab: 'dashboard',
      });
    } else if (isReconnecting) {
      const notifId = 'diag-realtime-reconnecting';
      list.push({
        id: notifId,
        category: 'NETWORK',
        severity: 'WARNING',
        title: 'Reconnecting Stream',
        message: 'Restoring Supabase Realtime channel synchronization...',
        timestamp: new Date().toISOString(),
        isRead: readIds.has(notifId),
        targetTab: 'dashboard',
      });
    }

    // 2. Authoritative Audit & Operational Alerts with Deterministic Role-Aware Filtering
    if (selectedTournamentId && rawAuditLogs.length > 0) {
      rawAuditLogs.forEach((log) => {
        // Enforce strict tournament isolation: log must match selected tournament
        if (log.tournament_id !== selectedTournamentId) return;

        const notifId = `log-${log.id}`;
        const actionUpper = (log.action || '').toUpperCase();
        const entityTypeLower = (log.entity_type || '').toLowerCase();
        const detailsSeverity = log.details?.severity ? String(log.details.severity).toUpperCase() : null;

        // Classify Event Types
        const isSecurityOrRole =
          actionUpper.includes('ROLE_ASSIGN') ||
          actionUpper.includes('ROLE_REVOKE') ||
          actionUpper.includes('SECURITY') ||
          actionUpper.includes('AUTH_LOGIN') ||
          actionUpper.includes('PROFILE_UPDATE') ||
          entityTypeLower === 'user_roles' ||
          entityTypeLower === 'profiles' ||
          entityTypeLower === 'auth';

        const isTournamentLifecycle =
          actionUpper.includes('TOURNAMENT_CREATE') ||
          actionUpper.includes('TOURNAMENT_UPDATE') ||
          actionUpper.includes('TOURNAMENT_FINALIZE') ||
          actionUpper.includes('SNAPSHOT_CREATE') ||
          actionUpper.includes('SNAPSHOT_LOCK') ||
          actionUpper.includes('SCHEDULE_PUBLISH') ||
          entityTypeLower === 'tournaments' ||
          entityTypeLower === 'tournament_snapshots';

        const isRegistrationOrRoster =
          actionUpper.includes('ATHLETE_REG') ||
          actionUpper.includes('REGISTRATION') ||
          actionUpper.includes('LINEUP') ||
          actionUpper.includes('ROSTER') ||
          actionUpper.includes('MEMBERSHIP') ||
          actionUpper.includes('TRANSFER') ||
          actionUpper.includes('SUCCESSION') ||
          ['registrations', 'athlete_registrations', 'club_memberships', 'player_transfers', 'coach_successions'].includes(
            entityTypeLower
          );

        const isWeighIn =
          actionUpper.includes('WEIGHIN') ||
          actionUpper.includes('WEIGH_IN') ||
          actionUpper.includes('WEIGHT_MISMATCH') ||
          actionUpper.includes('WEIGHT_DISQUALIF') ||
          entityTypeLower === 'athlete_weighins';

        const isBracketOrDivision =
          actionUpper.includes('BRACKET_GENERATE') ||
          actionUpper.includes('BRACKET_PUBLISH') ||
          actionUpper.includes('BRACKET_LOCK') ||
          actionUpper.includes('DIVISION_READY') ||
          actionUpper.includes('RESULT_FINAL') ||
          ['brackets', 'tournament_events', 'divisions'].includes(entityTypeLower);

        const isShiftOrOfficial =
          actionUpper.includes('OFFICIAL_ASSIGN') ||
          actionUpper.includes('SHIFT_ROTATION') ||
          actionUpper.includes('SHIFT_START') ||
          actionUpper.includes('SHIFT_END') ||
          actionUpper.includes('RECONCILE_SHIFT') ||
          ['event_assignments', 'court_officials', 'event_officials'].includes(entityTypeLower);

        const isMatchOrCourt =
          actionUpper.includes('MATCH') ||
          actionUpper.includes('BOUT') ||
          actionUpper.includes('COURT') ||
          actionUpper.includes('SCORE') ||
          actionUpper.includes('ASSIGN') ||
          actionUpper.includes('CALL') ||
          actionUpper.includes('QUEUE') ||
          actionUpper.includes('ROUND') ||
          ['matches', 'court_assignments', 'match_scores', 'courts'].includes(entityTypeLower);

        const isIncidentOrProtest =
          actionUpper.includes('INCIDENT') ||
          actionUpper.includes('PROTEST') ||
          actionUpper.includes('DISPUTE') ||
          actionUpper.includes('STOPPAGE') ||
          actionUpper.includes('DISCIPLINARY') ||
          actionUpper.includes('BOUT_RESET') ||
          actionUpper.includes('STALLED_BOUT') ||
          ['incidents', 'tournament_incidents', 'disputes'].includes(entityTypeLower);

        // Deterministic Audience Filtering
        let isAudienceMatched = false;
        let targetTab: NavigationTab = 'competition';

        if (isSecurityOrRole) {
          if (isAdmin) {
            isAudienceMatched = true;
            targetTab = isSuperAdmin ? 'roles' : 'security';
          }
        } else if (isTournamentLifecycle) {
          if (isAdmin || isOrganizer) {
            isAudienceMatched = true;
            targetTab = 'tournaments';
          }
        } else if (isRegistrationOrRoster) {
          if (isAdmin || isOrganizer) {
            isAudienceMatched = true;
            targetTab = 'registrations';
          } else if (isCoachRole) {
            // FAIL-CLOSED: Requires authoritative club match or user is the explicit actor
            const logClubId = log.details?.club_id;
            const logClubName = (log.details?.club_name || '').toLowerCase();
            const hasClubMatch =
              (coachClubIds.length > 0 && Boolean(logClubId) && coachClubIds.includes(logClubId)) ||
              (coachClubNames.length > 0 && Boolean(logClubName) && coachClubNames.some((n) => logClubName.includes(n))) ||
              (Boolean(user?.id) && log.actor_user_id === user?.id);

            if (hasClubMatch) {
              isAudienceMatched = true;
              targetTab = 'team_management';
            }
          }
        } else if (isWeighIn) {
          if (isAdmin || isOrganizer) {
            isAudienceMatched = true;
            targetTab = 'registrations';
          } else if (isCoachRole) {
            // FAIL-CLOSED: Requires authoritative club match
            const logClubId = log.details?.club_id;
            const logClubName = (log.details?.club_name || '').toLowerCase();
            const hasClubMatch =
              (coachClubIds.length > 0 && Boolean(logClubId) && coachClubIds.includes(logClubId)) ||
              (coachClubNames.length > 0 && Boolean(logClubName) && coachClubNames.some((n) => logClubName.includes(n)));

            if (hasClubMatch) {
              isAudienceMatched = true;
              targetTab = 'team_management';
            }
          }
        } else if (isBracketOrDivision) {
          if (isAdmin || isOrganizer || isCourtManager) {
            isAudienceMatched = true;
            targetTab = 'competition';
          } else if (isCoachRole) {
            // FAIL-CLOSED: Coach sees division/bracket notifications if their club is actively involved
            const logClubId = log.details?.club_id;
            const logClubName = (log.details?.club_name || '').toLowerCase();
            const hasClubMatch =
              (coachClubIds.length > 0 && Boolean(logClubId) && coachClubIds.includes(logClubId)) ||
              (coachClubNames.length > 0 && Boolean(logClubName) && coachClubNames.some((n) => logClubName.includes(n))) ||
              (coachClubIds.length > 0 && !logClubId && !logClubName);

            if (hasClubMatch) {
              isAudienceMatched = true;
              targetTab = 'competition';
            }
          }
        } else if (isShiftOrOfficial) {
          if (isAdmin || isOrganizer || isCourtManager) {
            isAudienceMatched = true;
            targetTab = 'competition';
          } else if (isTableOfficial) {
            // FAIL-CLOSED: Scoped strictly to shifts affecting this official or their assigned court
            const affectsSelf =
              (Boolean(user?.id) && (log.details?.user_id === user?.id || log.actor_user_id === user?.id)) ||
              (assignedCourtIds.length > 0 && Boolean(log.details?.court_id) && assignedCourtIds.includes(log.details.court_id));

            if (affectsSelf) {
              isAudienceMatched = true;
              targetTab = 'competition';
            }
          }
          // Note: COACH is explicitly excluded from internal official shifts
        } else if (isMatchOrCourt) {
          if (isAdmin || isOrganizer || isCourtManager) {
            isAudienceMatched = true;
            targetTab = 'competition';
          } else if (isTableOfficial) {
            // FAIL-CLOSED: Scoped strictly to Table Official's verified assigned court
            const logCourtId = log.details?.court_id || log.entity_id;
            const logCourtName = (log.details?.court_name || '').toLowerCase();
            const hasCourtMatch =
              (assignedCourtIds.length > 0 && Boolean(logCourtId) && assignedCourtIds.includes(logCourtId)) ||
              (assignedCourtNames.length > 0 && Boolean(logCourtName) && assignedCourtNames.some((n) => logCourtName.includes(n)));

            if (hasCourtMatch) {
              isAudienceMatched = true;
              targetTab = 'competition';
            }
          } else if (isCoachRole) {
            // FAIL-CLOSED: Coach sees match updates ONLY if their athlete/club participates
            const logClubId = log.details?.club_id || log.details?.red_club_id || log.details?.blue_club_id;
            const logClubName = (log.details?.club_name || '').toLowerCase();
            const hasClubMatch =
              (coachClubIds.length > 0 && Boolean(logClubId) && coachClubIds.includes(logClubId)) ||
              (coachClubNames.length > 0 && Boolean(logClubName) && coachClubNames.some((n) => logClubName.includes(n)));

            if (hasClubMatch) {
              isAudienceMatched = true;
              targetTab = 'competition';
            }
          }
        } else if (isIncidentOrProtest) {
          if (isAdmin || isOrganizer || isCourtManager) {
            isAudienceMatched = true;
            targetTab = 'competition';
          } else if (isCoachRole || isTableOfficial) {
            // FAIL-CLOSED: Only expose to coach / table official if directly involved or affecting assigned court/club
            const logClubId = log.details?.club_id;
            const logCourtId = log.details?.court_id || log.entity_id;
            const isDirectParty =
              (Boolean(user?.id) && (log.details?.user_id === user?.id || log.actor_user_id === user?.id)) ||
              (isCoachRole && coachClubIds.length > 0 && Boolean(logClubId) && coachClubIds.includes(logClubId)) ||
              (isTableOfficial && assignedCourtIds.length > 0 && Boolean(logCourtId) && assignedCourtIds.includes(logCourtId));

            if (isDirectParty) {
              isAudienceMatched = true;
              targetTab = 'competition';
            }
          }
        } else {
          // General / System Audit Log
          if (isAdmin || isOrganizer) {
            isAudienceMatched = true;
            targetTab = 'tournaments';
          }
        }

        if (!isAudienceMatched) return;

        let category: 'INCIDENT' | 'MATCH_COURT' = 'INCIDENT';
        let severity: NotificationSeverity = 'INFO';
        let title = log.action ? log.action.replace(/_/g, ' ') : 'Audit Event';
        let message = '';

        if (isMatchOrCourt || isBracketOrDivision) {
          category = 'MATCH_COURT';
        }

        // Determine Severity
        if (
          detailsSeverity === 'CRITICAL' ||
          actionUpper.includes('CRITICAL') ||
          actionUpper.includes('EMERGENCY') ||
          actionUpper.includes('DISQUALIF') ||
          actionUpper.includes('SECURITY_BREACH') ||
          actionUpper.includes('INJURY') ||
          actionUpper.includes('CONFLICT') ||
          actionUpper.includes('WEIGHT_MISMATCH')
        ) {
          severity = 'CRITICAL';
        } else if (
          detailsSeverity === 'WARNING' ||
          actionUpper.includes('WARNING') ||
          actionUpper.includes('DISPUTE') ||
          actionUpper.includes('REVERT') ||
          actionUpper.includes('CANCEL') ||
          actionUpper.includes('OFFLINE') ||
          actionUpper.includes('INTERRUPT') ||
          actionUpper.includes('DELAY') ||
          actionUpper.includes('SHIFT_ROTATION')
        ) {
          severity = 'WARNING';
        } else if (detailsSeverity === 'INFO') {
          severity = 'INFO';
        }

        // Generate Readable Message
        if (log.details?.description) {
          message = String(log.details.description);
        } else if (log.details?.reason) {
          message = String(log.details.reason);
        } else if (log.details?.message) {
          message = String(log.details.message);
        } else if (log.details?.court_name) {
          message = `Court: ${log.details.court_name}${log.details.match_number ? ` • Match #${log.details.match_number}` : ''}`;
        } else if (log.actor_profile?.full_name) {
          message = `Action logged by ${log.actor_profile.full_name}${log.actor_role ? ` (${log.actor_role})` : ''}`;
        } else {
          message = `System record: ${log.entity_type || 'system'} ${log.entity_id ? `#${log.entity_id.slice(0, 8)}` : ''}`;
        }

        list.push({
          id: notifId,
          category,
          severity,
          title,
          message,
          timestamp: log.created_at,
          isRead: readIds.has(notifId),
          tournament_id: log.tournament_id || undefined,
          action: log.action,
          actor_role: log.actor_role || undefined,
          entity_type: log.entity_type,
          entity_id: log.entity_id || undefined,
          audit_log_id: log.id,
          targetTab,
          targetEntityId: log.entity_id || undefined,
        });
      });
    }

    // Sort by:
    // 1. Unread first
    // 2. Severity Rank (CRITICAL first, then WARNING, INFO, DIAGNOSTIC)
    // 3. Newest timestamp first
    return list.sort((a, b) => {
      if (a.isRead !== b.isRead) {
        return a.isRead ? 1 : -1;
      }
      const rankDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (rankDiff !== 0) return rankDiff;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });
  }, [
    isOnline,
    isReconnecting,
    selectedTournamentId,
    rawAuditLogs,
    readIds,
    roles,
    user?.id,
    tournaments,
    eventAssignments,
    coachClubs,
  ]);

  // Unread counts calculation
  const unreadNotifications = useMemo(() => notifications.filter((n) => !n.isRead), [notifications]);
  const unreadCount = unreadNotifications.length;
  const unreadCriticalCount = useMemo(
    () => unreadNotifications.filter((n) => n.severity === 'CRITICAL').length,
    [unreadNotifications]
  );

  // Update badge counts to parent (UNREAD COUNT, NOT total count!)
  useEffect(() => {
    if (onCountUpdate) {
      onCountUpdate(unreadCount, unreadCriticalCount);
    }
  }, [unreadCount, unreadCriticalCount, onCountUpdate]);

  // Handler to mark an individual notification as read
  const handleMarkAsRead = useCallback(
    async (notif: OperationalNotification, e?: React.MouseEvent | React.KeyboardEvent) => {
      if (e) {
        e.stopPropagation();
      }
      if (notif.isRead) return;

      // Optimistically update local state immediately
      setReadIds((prev) => {
        const next = new Set(prev);
        next.add(notif.id);
        return next;
      });

      // Persist to database / cache
      if (user?.id) {
        await notificationService.markAsRead(
          user.id,
          notif.id,
          notif.audit_log_id,
          selectedTournamentId
        );
      }
    },
    [user?.id, selectedTournamentId]
  );

  // Deep-Link Navigation Click Handler
  const handleNotificationClick = useCallback(
    (notif: OperationalNotification) => {
      handleMarkAsRead(notif);
      if (notif.targetTab && onNavigate) {
        onNavigate(notif.targetTab as NavigationTab);
        onClose();
      }
    },
    [handleMarkAsRead, onNavigate, onClose]
  );

  // Handler to mark all active notifications as read
  const handleMarkAllAsRead = useCallback(async () => {
    if (unreadCount === 0 || isProcessingAction) return;

    setIsProcessingAction(true);
    const unreadIds = unreadNotifications.map((n) => n.id);

    // Optimistically update local state
    setReadIds((prev) => {
      const next = new Set(prev);
      unreadIds.forEach((id) => next.add(id));
      return next;
    });

    try {
      if (user?.id) {
        await notificationService.markAllAsRead(
          user.id,
          unreadIds,
          selectedTournamentId
        );
      }
    } finally {
      setIsProcessingAction(false);
    }
  }, [unreadCount, isProcessingAction, unreadNotifications, user?.id, selectedTournamentId]);

  // Filtered Notifications based on Category and Search
  const filteredNotifications = useMemo(() => {
    return notifications.filter((n) => {
      // Category filter
      if (selectedCategory === 'UNREAD') {
        if (n.isRead) return false;
      } else if (selectedCategory !== 'ALL' && n.category !== selectedCategory) {
        return false;
      }
      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          n.title.toLowerCase().includes(q) ||
          n.message.toLowerCase().includes(q) ||
          (n.action && n.action.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [notifications, selectedCategory, searchQuery]);

  const activeTournament = tournaments.find((t) => t.id === selectedTournamentId);

  // Summary counts
  const criticalCount = notifications.filter((n) => n.severity === 'CRITICAL').length;
  const warningCount = notifications.filter((n) => n.severity === 'WARNING').length;
  const matchCount = notifications.filter((n) => n.category === 'MATCH_COURT').length;
  const incidentCount = notifications.filter((n) => n.category === 'INCIDENT').length;

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notification-drawer-title"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer Panel */}
      <div className="relative w-full max-w-md bg-slate-900 border-l border-slate-800 h-full flex flex-col shadow-2xl z-10 animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-950/80 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2 flex-wrap sm:flex-nowrap">
            <div className="flex items-center space-x-2.5 min-w-0 flex-1">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                <BellRing className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <h2
                  id="notification-drawer-title"
                  className="text-sm sm:text-base font-bold text-white tracking-tight truncate"
                >
                  Operational Notifications
                </h2>
                <div className="flex items-center space-x-2 text-[11px] text-slate-400 flex-wrap">
                  <span className="truncate">Authoritative Live Ledger</span>
                  <span>•</span>
                  {unreadCount > 0 ? (
                    <span className="font-mono text-amber-400 font-semibold flex items-center gap-1 shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                      {unreadCount} Unread
                    </span>
                  ) : (
                    <span className="font-mono text-emerald-400 font-semibold flex items-center gap-1 shrink-0">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400 inline" />
                      All Read ({notifications.length})
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-1.5 shrink-0">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllAsRead}
                  disabled={isProcessingAction}
                  className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 hover:text-amber-200 text-xs font-medium border border-slate-700 transition disabled:opacity-50"
                  title="Mark all notifications as read"
                  aria-label="Mark all notifications as read"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Mark all read</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (selectedTournamentId) loadAuditLogs(selectedTournamentId);
                  loadReadNotificationIds();
                }}
                disabled={isLoadingLogs}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition disabled:opacity-50"
                title="Refresh notification stream"
                aria-label="Refresh notifications"
              >
                <RefreshCw className={`w-4 h-4 ${isLoadingLogs ? 'animate-spin text-amber-400' : ''}`} />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                title="Close notifications"
                aria-label="Close notifications drawer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Tournament Selector Context */}
          {tournaments.length > 0 && (
            <div className="flex items-center space-x-2 bg-slate-900/90 border border-slate-800 rounded-xl p-2 text-xs min-w-0">
              <Trophy className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <select
                  value={selectedTournamentId}
                  onChange={(e) => setSelectedTournamentId(e.target.value)}
                  className="w-full bg-transparent text-slate-200 text-xs font-medium focus:outline-none truncate cursor-pointer"
                  aria-label="Select tournament context for notifications"
                >
                  {tournaments.map((t) => (
                    <option key={t.id} value={t.id} className="bg-slate-900 text-slate-100">
                      {t.name} ({t.status})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Category Filter Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs max-w-full">
            <button
              type="button"
              onClick={() => setSelectedCategory('ALL')}
              className={`px-2.5 py-1 rounded-lg font-medium transition whitespace-nowrap shrink-0 ${
                selectedCategory === 'ALL'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              All ({notifications.length})
            </button>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => setSelectedCategory('UNREAD')}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg font-medium transition whitespace-nowrap shrink-0 ${
                  selectedCategory === 'UNREAD'
                    ? 'bg-amber-500 text-slate-950 font-bold border border-amber-400'
                    : 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/30'
                }`}
              >
                <Inbox className="w-3 h-3" />
                <span>Unread ({unreadCount})</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelectedCategory('INCIDENT')}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg font-medium transition whitespace-nowrap shrink-0 ${
                selectedCategory === 'INCIDENT'
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                  : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <ShieldAlert className="w-3 h-3 text-rose-400" />
              <span>Incidents ({incidentCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedCategory('MATCH_COURT')}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg font-medium transition whitespace-nowrap shrink-0 ${
                selectedCategory === 'MATCH_COURT'
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                  : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Layers className="w-3 h-3 text-sky-400" />
              <span>Matches ({matchCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedCategory('NETWORK')}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg font-medium transition whitespace-nowrap shrink-0 ${
                selectedCategory === 'NETWORK'
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                  : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Radio className="w-3 h-3 text-purple-400" />
              <span>Network</span>
            </button>
          </div>
        </div>

        {/* Severity Legend & Status Summary */}
        <div className="px-4 py-2 bg-slate-950/40 border-b border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400 flex-wrap gap-1">
          <div className="flex items-center space-x-3 min-w-0">
            {unreadCriticalCount > 0 ? (
              <span className="flex items-center space-x-1 text-rose-400 font-bold truncate">
                <AlertOctagon className="w-3 h-3 shrink-0" />
                <span>{unreadCriticalCount} Critical Unread</span>
              </span>
            ) : criticalCount > 0 ? (
              <span className="flex items-center space-x-1 text-rose-400/70 truncate">
                <AlertOctagon className="w-3 h-3 shrink-0" />
                <span>{criticalCount} Critical (Read)</span>
              </span>
            ) : warningCount > 0 ? (
              <span className="flex items-center space-x-1 text-amber-400 font-semibold truncate">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                <span>{warningCount} Warnings</span>
              </span>
            ) : (
              <span className="flex items-center space-x-1 text-emerald-400 truncate">
                <CheckCircle2 className="w-3 h-3 shrink-0" />
                <span>Venue Operations Nominal</span>
              </span>
            )}
          </div>
          <span className="text-slate-500 font-mono truncate max-w-[140px] sm:max-w-none">
            {activeTournament ? activeTournament.name : 'No Tournament'}
          </span>
        </div>

        {/* Notification Stream List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {isLoadingLogs && notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500 space-y-2">
              <RefreshCw className="w-6 h-6 animate-spin text-amber-400" />
              <span className="text-xs">Loading operational ledger...</span>
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500 space-y-2 text-center p-6">
              <div className="w-12 h-12 rounded-full bg-slate-800/60 border border-slate-700 flex items-center justify-center text-slate-400">
                <Bell className="w-6 h-6" />
              </div>
              <h3 className="text-xs font-semibold text-slate-300">
                {selectedCategory === 'UNREAD' ? 'No Unread Notifications' : 'No Notifications'}
              </h3>
              <p className="text-[11px] text-slate-400 max-w-[240px]">
                {selectedCategory === 'UNREAD'
                  ? 'All operational alerts and tournament incidents have been marked as read.'
                  : selectedCategory !== 'ALL'
                  ? `No ${selectedCategory.toLowerCase()} alerts found for this tournament.`
                  : 'All tournament systems, courts, and audit streams are running nominally.'}
              </p>
            </div>
          ) : (
            filteredNotifications.map((notif) => {
              const isCrit = notif.severity === 'CRITICAL';
              const isWarn = notif.severity === 'WARNING';
              const isMatch = notif.category === 'MATCH_COURT';
              const isUnread = !notif.isRead;

              return (
                <div
                  key={notif.id}
                  onClick={() => handleNotificationClick(notif)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleNotificationClick(notif);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`${isUnread ? 'Unread' : 'Read'} notification: ${notif.title}. ${notif.message}. Click to ${isUnread ? 'mark as read and navigate' : 'open'}.`}
                  className={`group relative p-3.5 rounded-xl border transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-500/50 ${
                    isUnread
                      ? isCrit
                        ? 'bg-rose-950/50 border-rose-600 text-slate-100 ring-1 ring-rose-500/40 shadow-lg shadow-rose-950/30'
                        : isWarn
                        ? 'bg-amber-950/40 border-amber-600 text-slate-100 ring-1 ring-amber-500/30 shadow-lg shadow-amber-950/20'
                        : isMatch
                        ? 'bg-slate-850 border-sky-500/80 text-slate-100 ring-1 ring-sky-500/30 shadow-md'
                        : 'bg-slate-850 border-amber-500/60 text-slate-100 ring-1 ring-amber-500/30 shadow-md'
                      : isCrit
                      ? 'bg-rose-950/20 border-rose-900/50 text-slate-400 opacity-80 hover:opacity-100'
                      : isWarn
                      ? 'bg-amber-950/15 border-amber-900/40 text-slate-400 opacity-80 hover:opacity-100'
                      : 'bg-slate-900/40 border-slate-800 text-slate-400 opacity-80 hover:opacity-100'
                  }`}
                >
                  {/* Unread indicator dot */}
                  {isUnread && (
                    <span
                      className={`absolute top-3 right-3 w-2.5 h-2.5 rounded-full ${
                        isCrit ? 'bg-rose-500 animate-pulse' : 'bg-amber-400 animate-pulse'
                      }`}
                      title="Unread notification"
                    />
                  )}

                  <div className="flex items-start justify-between gap-2 pr-4">
                    <div className="flex items-start space-x-2.5 min-w-0 flex-1">
                      <div className="mt-0.5 flex-shrink-0">
                        {isCrit ? (
                          <AlertOctagon className={`w-4 h-4 text-rose-400 ${isUnread ? 'animate-pulse' : 'opacity-70'}`} />
                        ) : isWarn ? (
                          <AlertTriangle className={`w-4 h-4 text-amber-400 ${isUnread ? '' : 'opacity-70'}`} />
                        ) : isMatch ? (
                          <Layers className={`w-4 h-4 text-sky-400 ${isUnread ? '' : 'opacity-70'}`} />
                        ) : notif.category === 'NETWORK' ? (
                          <Radio className={`w-4 h-4 text-purple-400 ${isUnread ? '' : 'opacity-70'}`} />
                        ) : (
                          <Info className={`w-4 h-4 text-slate-400 ${isUnread ? '' : 'opacity-70'}`} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                          <span
                            className={`text-xs font-bold tracking-tight truncate max-w-full ${
                              isUnread
                                ? isCrit
                                  ? 'text-rose-100'
                                  : isWarn
                                  ? 'text-amber-100'
                                  : 'text-white'
                                : 'text-slate-300'
                            }`}
                          >
                            {notif.title}
                          </span>
                          <span
                            className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-bold uppercase shrink-0 ${
                              isCrit
                                ? isUnread
                                  ? 'bg-rose-900 text-rose-100 border border-rose-600'
                                  : 'bg-rose-950/60 text-rose-300/70 border border-rose-900'
                                : isWarn
                                ? isUnread
                                  ? 'bg-amber-900 text-amber-100 border border-amber-600'
                                  : 'bg-amber-950/60 text-amber-300/70 border border-amber-900'
                                : 'bg-slate-800 text-slate-400 border border-slate-700'
                            }`}
                          >
                            {notif.severity}
                          </span>
                          {isUnread ? (
                            <span className="px-1 py-0.2 rounded text-[8px] font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40 shrink-0">
                              NEW
                            </span>
                          ) : (
                            <span className="flex items-center space-x-0.5 text-[9px] text-slate-500 shrink-0">
                              <Check className="w-2.5 h-2.5 text-emerald-500" />
                              <span>Read</span>
                            </span>
                          )}
                        </div>
                        <p
                          className={`text-xs mt-1 leading-relaxed break-words ${
                            isUnread ? 'text-slate-200' : 'text-slate-400'
                          }`}
                        >
                          {notif.message}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-2.5 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[10px] text-slate-400 flex-wrap gap-1">
                    <div className="flex items-center space-x-1.5 flex-wrap">
                      <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                      <span>
                        {new Date(notif.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                      {notif.targetTab && (
                        <span className="hidden sm:inline-flex items-center space-x-0.5 text-[9px] text-amber-400/80 group-hover:text-amber-300 ml-1">
                          <span>• Open {String(notif.targetTab).replace(/_/g, ' ')}</span>
                          <ArrowRight className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </div>

                    <div className="flex items-center space-x-2 shrink-0">
                      {notif.actor_role && (
                        <span className="font-mono text-slate-400 bg-slate-800/80 px-1.5 py-0.5 rounded border border-slate-700 text-[9px]">
                          {notif.actor_role}
                        </span>
                      )}
                      {isUnread && (
                        <button
                          type="button"
                          onClick={(e) => handleMarkAsRead(notif, e)}
                          className="text-[10px] text-amber-400 hover:text-amber-300 font-medium underline-offset-2 hover:underline flex items-center space-x-0.5"
                          title="Mark this notification as read without navigating"
                        >
                          <Check className="w-3 h-3" />
                          <span>Mark read</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer info note */}
        <div className="p-3 bg-slate-950 border-t border-slate-800 text-center text-[11px] text-slate-400 flex items-center justify-center space-x-2">
          <span>Authoritative incident ledger • Per-user read synchronization</span>
        </div>
      </div>
    </div>
  );
};

