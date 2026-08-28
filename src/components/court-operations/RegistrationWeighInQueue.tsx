import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Scale,
  UserCheck,
  Clock,
  XCircle,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Search,
  Filter,
  RefreshCw,
  Users,
  Check,
  Lock,
  Shield,
  Activity,
  ChevronRight,
  Info,
  RotateCcw,
  FileText,
  Layers,
  Award,
  Loader2,
  X
} from 'lucide-react';
import { tournamentService } from '../../services/tournamentService';
import {
  Tournament,
  TournamentSnapshot,
  TournamentEvent,
  Registration,
  WeighInStatus,
  LineupRole
} from '../../types/tournament';
import { getWeighInStatus, renderLineupRoleBadge } from '../registration/RegistrationManagementView';

interface RegistrationWeighInQueueProps {
  tournament: Tournament;
  snapshot: TournamentSnapshot | null;
  canManage: boolean;
  onRefresh?: () => void;
}

export type QueueWeighInFilter = 'ALL' | 'PASSED' | 'PENDING' | 'OVERWEIGHT' | 'UNDERWEIGHT' | 'NOT_REQUIRED';
export type QueueApprovalFilter = 'ALL' | 'APPROVED' | 'PENDING_APPROVAL';
export type QueueLineupFilter = 'ALL' | 'LINEUP' | 'RESERVE' | 'WITHDRAWN';

export const RegistrationWeighInQueue: React.FC<RegistrationWeighInQueueProps> = ({
  tournament,
  snapshot,
  canManage,
  onRefresh
}) => {
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [events, setEvents] = useState<TournamentEvent[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isActionLoading, setIsActionLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Search & Filter States
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [eventFilter, setEventFilter] = useState<string>('ALL');
  const [clubFilter, setClubFilter] = useState<string>('ALL');
  const [weighInStatusFilter, setWeighInStatusFilter] = useState<QueueWeighInFilter>('ALL');
  const [approvalFilter, setApprovalFilter] = useState<QueueApprovalFilter>('ALL');
  const [lineupFilter, setLineupFilter] = useState<QueueLineupFilter>('ALL');
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState<boolean>(false);

  // Weigh-In Edit Modal State
  const [weighInModalRegistration, setWeighInModalRegistration] = useState<Registration | null>(null);
  const [weighInWeightInput, setWeighInWeightInput] = useState<string>('');

  // Approval Warning Modal State (for out-of-bracket athletes)
  const [approvalWarningRegistration, setApprovalWarningRegistration] = useState<Registration | null>(null);

  // Load Registrations & Events
  const loadData = useCallback(async (silent = false) => {
    if (!snapshot?.id) {
      setIsLoading(false);
      return;
    }

    if (!silent) {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setErrorMessage(null);

    try {
      const [regsData, evtsData] = await Promise.all([
        tournamentService.getRegistrationsBySnapshot(snapshot.id),
        tournamentService.getEventsBySnapshotId(snapshot.id)
      ]);

      setRegistrations(regsData);
      setEvents(evtsData);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load registration queue data.';
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [snapshot?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle Manual Refresh
  const handleRefreshClick = () => {
    loadData(true);
    if (onRefresh) onRefresh();
  };

  // Map of events by ID for quick access to rules and weight limits
  const eventsMap = useMemo(() => {
    const map = new Map<string, TournamentEvent>();
    events.forEach(e => map.set(e.id, e));
    return map;
  }, [events]);

  // Helper to compute weigh-in status for a registration
  const computeRegistrationWeighInStatus = useCallback((reg: Registration): WeighInStatus => {
    const event = reg.event || eventsMap.get(reg.event_id);
    const requiresWeighIn = event?.category !== 'ANYO';
    return getWeighInStatus(
      reg.weigh_in_weight,
      event?.min_weight,
      event?.max_weight,
      requiresWeighIn
    );
  }, [eventsMap]);

  // Derived telemetry metrics across the entire loaded dataset
  const telemetry = useMemo(() => {
    let total = registrations.length;
    let weighedIn = 0;
    let pendingWeighIn = 0;
    let weightAttention = 0;
    let approved = 0;
    let pendingApproval = 0;
    let startingLineup = 0;
    let reserveStandby = 0;
    let totalAttention = 0;

    registrations.forEach((reg) => {
      const event = reg.event || eventsMap.get(reg.event_id);
      const requiresWeighIn = event?.category !== 'ANYO';
      const status = getWeighInStatus(
        reg.weigh_in_weight,
        event?.min_weight,
        event?.max_weight,
        requiresWeighIn
      );

      if (reg.weigh_in_weight !== null && reg.weigh_in_weight !== undefined) {
        weighedIn++;
      } else if (requiresWeighIn) {
        pendingWeighIn++;
      }

      if (status === 'OVERWEIGHT' || status === 'UNDERWEIGHT') {
        weightAttention++;
      }

      if (reg.is_approved) {
        approved++;
      } else {
        pendingApproval++;
      }

      const role = reg.lineup_role || 'LINEUP';
      if (role === 'LINEUP') {
        startingLineup++;
      } else if (role === 'RESERVE') {
        reserveStandby++;
      }

      // Attention trigger conditions
      const hasAttentionNeed =
        status === 'OVERWEIGHT' ||
        status === 'UNDERWEIGHT' ||
        (requiresWeighIn && (reg.weigh_in_weight === null || reg.weigh_in_weight === undefined)) ||
        !reg.is_approved ||
        role === 'WITHDRAWN';

      if (hasAttentionNeed) {
        totalAttention++;
      }
    });

    return {
      total,
      weighedIn,
      pendingWeighIn,
      weightAttention,
      approved,
      pendingApproval,
      startingLineup,
      reserveStandby,
      totalAttention
    };
  }, [registrations, eventsMap]);

  // Extract unique clubs/teams for the filter dropdown
  const uniqueClubs = useMemo(() => {
    const clubs = new Set<string>();
    registrations.forEach((reg) => {
      if (reg.team_name && reg.team_name.trim().length > 0) {
        clubs.add(reg.team_name.trim());
      }
    });
    return Array.from(clubs).sort();
  }, [registrations]);

  // Filtered registrations list using in-memory search and multi-faceted filters
  const filteredRegistrations = useMemo(() => {
    return registrations.filter((reg) => {
      const event = reg.event || eventsMap.get(reg.event_id);
      const requiresWeighIn = event?.category !== 'ANYO';
      const weighInStatus = getWeighInStatus(
        reg.weigh_in_weight,
        event?.min_weight,
        event?.max_weight,
        requiresWeighIn
      );
      const effectiveRole = reg.lineup_role || 'LINEUP';

      // 1. Needs Attention Quick Filter
      if (needsAttentionOnly) {
        const isAttention =
          weighInStatus === 'OVERWEIGHT' ||
          weighInStatus === 'UNDERWEIGHT' ||
          (requiresWeighIn && (reg.weigh_in_weight === null || reg.weigh_in_weight === undefined)) ||
          !reg.is_approved ||
          effectiveRole === 'WITHDRAWN';
        if (!isAttention) return false;
      }

      // 2. Event Filter
      if (eventFilter !== 'ALL' && reg.event_id !== eventFilter) {
        return false;
      }

      // 3. Club / Team Filter
      if (clubFilter !== 'ALL') {
        const team = reg.team_name ? reg.team_name.trim() : '';
        if (team !== clubFilter) return false;
      }

      // 4. Weigh-In Status Filter
      if (weighInStatusFilter !== 'ALL' && weighInStatus !== weighInStatusFilter) {
        return false;
      }

      // 5. Approval Filter
      if (approvalFilter === 'APPROVED' && !reg.is_approved) return false;
      if (approvalFilter === 'PENDING_APPROVAL' && reg.is_approved) return false;

      // 6. Lineup Role Filter
      if (lineupFilter !== 'ALL' && effectiveRole !== lineupFilter) return false;

      // 7. Search Query across athlete name, email, team, event name, division, category, weight class
      if (searchQuery.trim().length > 0) {
        const q = searchQuery.toLowerCase().trim();
        const athleteName = reg.user_profile?.full_name?.toLowerCase() || '';
        const athleteEmail = reg.user_profile?.email?.toLowerCase() || '';
        const teamName = reg.team_name?.toLowerCase() || '';
        const eventName = event?.name?.toLowerCase() || '';
        const division = event?.division?.toLowerCase() || '';
        const category = event?.category?.toLowerCase() || '';
        const weightClass = event?.weight_class?.toLowerCase() || '';

        const matches =
          athleteName.includes(q) ||
          athleteEmail.includes(q) ||
          teamName.includes(q) ||
          eventName.includes(q) ||
          division.includes(q) ||
          category.includes(q) ||
          weightClass.includes(q);

        if (!matches) return false;
      }

      return true;
    });
  }, [
    registrations,
    eventsMap,
    needsAttentionOnly,
    eventFilter,
    clubFilter,
    weighInStatusFilter,
    approvalFilter,
    lineupFilter,
    searchQuery
  ]);

  // Quick Action: Save Weigh-In Weight
  const handleSaveWeighIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!weighInModalRegistration) return;

    const parsedWeight = weighInWeightInput.trim() === '' ? null : parseFloat(weighInWeightInput);
    if (parsedWeight !== null && (isNaN(parsedWeight) || parsedWeight <= 0 || parsedWeight > 300)) {
      setErrorMessage('Please enter a valid official weight between 1.0 and 300.0 kg.');
      return;
    }

    setIsActionLoading(true);
    setErrorMessage(null);

    try {
      const updated = await tournamentService.updateRegistration(weighInModalRegistration.id, {
        weigh_in_weight: parsedWeight
      });

      setRegistrations((prev) =>
        prev.map((r) => (r.id === updated.id ? { ...r, weigh_in_weight: updated.weigh_in_weight } : r))
      );

      setSuccessMessage(
        parsedWeight !== null
          ? `Recorded official weight of ${parsedWeight.toFixed(2)} kg for ${
              weighInModalRegistration.user_profile?.full_name || 'athlete'
            }.`
          : `Cleared weigh-in weight for ${
              weighInModalRegistration.user_profile?.full_name || 'athlete'
            }.`
      );

      setWeighInModalRegistration(null);
      setWeighInWeightInput('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update official weigh-in weight.';
      setErrorMessage(message);
    } finally {
      setIsActionLoading(false);
    }
  };

  // Quick Action: Toggle Approval
  const handleToggleApproval = async (reg: Registration) => {
    const event = reg.event || eventsMap.get(reg.event_id);
    const requiresWeighIn = event?.category !== 'ANYO';
    const weighInStatus = getWeighInStatus(
      reg.weigh_in_weight,
      event?.min_weight,
      event?.max_weight,
      requiresWeighIn
    );

    // If approving an out-of-bracket athlete, show warning modal first
    if (!reg.is_approved && (weighInStatus === 'OVERWEIGHT' || weighInStatus === 'UNDERWEIGHT')) {
      setApprovalWarningRegistration(reg);
      return;
    }

    await executeApprovalUpdate(reg, !reg.is_approved);
  };

  const executeApprovalUpdate = async (reg: Registration, newApprovalState: boolean) => {
    setIsActionLoading(true);
    setErrorMessage(null);

    try {
      const updated = await tournamentService.updateRegistration(reg.id, {
        is_approved: newApprovalState
      });

      setRegistrations((prev) =>
        prev.map((r) =>
          r.id === updated.id
            ? { ...r, is_approved: updated.is_approved, approved_by: updated.approved_by }
            : r
        )
      );

      setSuccessMessage(
        newApprovalState
          ? `Approved tournament credential for ${reg.user_profile?.full_name || 'athlete'}.`
          : `Revoked tournament credential for ${reg.user_profile?.full_name || 'athlete'}.`
      );

      setApprovalWarningRegistration(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update registration approval status.';
      setErrorMessage(message);
    } finally {
      setIsActionLoading(false);
    }
  };

  // Render Status Badges
  const renderWeighInBadge = (status: WeighInStatus, weight?: number | null) => {
    switch (status) {
      case 'PASSED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
            <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
            PASSED {weight !== null && weight !== undefined ? `(${weight.toFixed(2)} kg)` : ''}
          </span>
        );
      case 'OVERWEIGHT':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 dark:bg-rose-950/80 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-700">
            <AlertTriangle className="w-3 h-3 text-rose-600 dark:text-rose-400" />
            OVERWEIGHT {weight !== null && weight !== undefined ? `(${weight.toFixed(2)} kg)` : ''}
          </span>
        );
      case 'UNDERWEIGHT':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
            <AlertCircle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
            UNDERWEIGHT {weight !== null && weight !== undefined ? `(${weight.toFixed(2)} kg)` : ''}
          </span>
        );
      case 'NOT_REQUIRED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
            NOT REQUIRED
          </span>
        );
      case 'PENDING':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
            <Clock className="w-3 h-3 text-slate-500" />
            PENDING SCALE
          </span>
        );
    }
  };

  const renderApprovalBadge = (isApproved: boolean) => {
    if (isApproved) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
          <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
          APPROVED
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
        <Clock className="w-3 h-3 text-amber-600 dark:text-amber-400" />
        PENDING APPROVAL
      </span>
    );
  };

  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    eventFilter !== 'ALL' ||
    clubFilter !== 'ALL' ||
    weighInStatusFilter !== 'ALL' ||
    approvalFilter !== 'ALL' ||
    lineupFilter !== 'ALL' ||
    needsAttentionOnly;

  const resetAllFilters = () => {
    setSearchQuery('');
    setEventFilter('ALL');
    setClubFilter('ALL');
    setWeighInStatusFilter('ALL');
    setApprovalFilter('ALL');
    setLineupFilter('ALL');
    setNeedsAttentionOnly(false);
  };

  if (!snapshot) {
    return (
      <div className="p-8 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl space-y-3">
        <Scale className="w-10 h-10 text-slate-400 mx-auto" />
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Pre-Competition Snapshot Required</h3>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          Official registration and weigh-in telemetry are bound to an active sealed snapshot. Initialize snapshot in Tournament Management to activate this station.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 1. Header Banner */}
      <div className="p-4 bg-linear-to-r from-emerald-500/10 via-emerald-500/5 to-transparent border border-emerald-300 dark:border-emerald-500/30 rounded-xl space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/20 rounded-lg text-emerald-600 dark:text-emerald-400">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Registration &amp; Weigh-In Station
                </h3>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                  OPERATIONAL ROSTER &amp; WEIGH-IN DESK
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Live tournament-day roster certification, official weigh-in scales, and credential verification queue.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="px-2.5 py-1 rounded-lg text-[11px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 flex items-center gap-1.5">
              <Lock className="w-3 h-3 text-slate-500" />
              Snapshot v{snapshot.version} Sealed
            </span>
            <button
              type="button"
              onClick={handleRefreshClick}
              disabled={isLoading || isRefreshing}
              className="p-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors shadow-xs"
              title="Refresh registration queue data"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-emerald-500' : ''}`} />
            </button>
          </div>
        </div>

        {!canManage && (
          <div className="p-2.5 bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg text-[11px] text-slate-600 dark:text-slate-400 flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>
              <strong>Read-Only Official Inspection:</strong> You have full visibility into competitor statuses. Weigh-in modifications and approval toggles require Tournament Director or Administrator authority.
            </span>
          </div>
        )}
      </div>

      {/* Notifications */}
      {errorMessage && (
        <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 rounded-xl text-xs text-rose-800 dark:text-rose-300 flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button type="button" onClick={() => setErrorMessage(null)} className="text-rose-500 hover:text-rose-700">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {successMessage && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-xl text-xs text-emerald-800 dark:text-emerald-300 flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button type="button" onClick={() => setSuccessMessage(null)} className="text-emerald-500 hover:text-emerald-700">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 2. Telemetry KPI Grid (8 Operational Metrics) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {/* Total Registrations */}
        <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1">
          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider block">
            Total Roster
          </span>
          <div className="text-lg font-bold text-slate-900 dark:text-white flex items-baseline gap-1">
            {telemetry.total}
            <span className="text-[10px] font-normal text-slate-400">Athletes</span>
          </div>
        </div>

        {/* Weighed In */}
        <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1">
          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider block">
            Weighed In
          </span>
          <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400 flex items-baseline gap-1">
            {telemetry.weighedIn}
            <span className="text-[10px] font-normal text-slate-400">Scaled</span>
          </div>
        </div>

        {/* Pending Weigh-In */}
        <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1">
          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider block">
            Pending Scale
          </span>
          <div className="text-lg font-bold text-slate-700 dark:text-slate-300 flex items-baseline gap-1">
            {telemetry.pendingWeighIn}
            <span className="text-[10px] font-normal text-slate-400">Awaiting</span>
          </div>
        </div>

        {/* Weight Attention Required */}
        <div
          className={`p-3 border rounded-xl space-y-1 transition-colors ${
            telemetry.weightAttention > 0
              ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-300 dark:border-rose-800/80 cursor-pointer'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
          }`}
          onClick={() => {
            if (telemetry.weightAttention > 0) {
              setWeighInStatusFilter(weighInStatusFilter === 'OVERWEIGHT' ? 'ALL' : 'OVERWEIGHT');
            }
          }}
        >
          <span className="text-[10px] text-rose-600 dark:text-rose-400 font-bold uppercase tracking-wider block flex items-center gap-1">
            <AlertTriangle className="w-2.5 h-2.5" />
            Weight Violations
          </span>
          <div className="text-lg font-bold text-rose-600 dark:text-rose-400 flex items-baseline gap-1">
            {telemetry.weightAttention}
            <span className="text-[10px] font-normal text-rose-500/80">Out of Brk</span>
          </div>
        </div>

        {/* Approved */}
        <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1">
          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider block">
            Approved
          </span>
          <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400 flex items-baseline gap-1">
            {telemetry.approved}
            <span className="text-[10px] font-normal text-slate-400">Certified</span>
          </div>
        </div>

        {/* Pending Approval */}
        <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1">
          <span className="text-[10px] text-amber-600 dark:text-amber-400 font-bold uppercase tracking-wider block">
            Pending Apprv
          </span>
          <div className="text-lg font-bold text-amber-600 dark:text-amber-400 flex items-baseline gap-1">
            {telemetry.pendingApproval}
            <span className="text-[10px] font-normal text-slate-400">Uncertified</span>
          </div>
        </div>

        {/* Starting Lineup */}
        <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1">
          <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold uppercase tracking-wider block">
            Lineup Starters
          </span>
          <div className="text-lg font-bold text-indigo-600 dark:text-indigo-400 flex items-baseline gap-1">
            {telemetry.startingLineup}
            <span className="text-[10px] font-normal text-slate-400">Active</span>
          </div>
        </div>

        {/* Reserve Standby */}
        <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1">
          <span className="text-[10px] text-sky-600 dark:text-sky-400 font-bold uppercase tracking-wider block">
            Reserves
          </span>
          <div className="text-lg font-bold text-sky-600 dark:text-sky-400 flex items-baseline gap-1">
            {telemetry.reserveStandby}
            <span className="text-[10px] font-normal text-slate-400">Standby</span>
          </div>
        </div>
      </div>

      {/* 3. Search & Filter Bar */}
      <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3 shadow-xs">
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2.5">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search athlete, club/team, event, division, or weight..."
              className="w-full pl-9 pr-8 py-2 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Needs Attention Quick Toggle */}
          <button
            type="button"
            onClick={() => setNeedsAttentionOnly(!needsAttentionOnly)}
            className={`flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
              needsAttentionOnly
                ? 'bg-amber-600 text-white shadow-xs'
                : 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/50'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Attention Required ({telemetry.totalAttention})</span>
          </button>

          {/* Reset All Filters Button */}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetAllFilters}
              className="flex items-center justify-center gap-1 px-3 py-2 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          )}
        </div>

        {/* Multi-faceted Dropdowns */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 pt-1 border-t border-slate-100 dark:border-slate-800/80">
          {/* Event Filter */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
              Event
            </label>
            <select
              value={eventFilter}
              onChange={(e) => setEventFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-emerald-500"
            >
              <option value="ALL">All Events ({events.length})</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>

          {/* Club / Team Filter */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
              Club / Team
            </label>
            <select
              value={clubFilter}
              onChange={(e) => setClubFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-emerald-500"
            >
              <option value="ALL">All Clubs / Teams ({uniqueClubs.length})</option>
              {uniqueClubs.map((club) => (
                <option key={club} value={club}>
                  {club}
                </option>
              ))}
            </select>
          </div>

          {/* Weigh-In Status Filter */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
              Weigh-In Status
            </label>
            <select
              value={weighInStatusFilter}
              onChange={(e) => setWeighInStatusFilter(e.target.value as QueueWeighInFilter)}
              className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-emerald-500"
            >
              <option value="ALL">All Weigh-In Statuses</option>
              <option value="PASSED">Passed ({telemetry.weighedIn})</option>
              <option value="PENDING">Pending Scale ({telemetry.pendingWeighIn})</option>
              <option value="OVERWEIGHT">Overweight ({telemetry.weightAttention})</option>
              <option value="UNDERWEIGHT">Underweight</option>
              <option value="NOT_REQUIRED">Not Required (Anyo)</option>
            </select>
          </div>

          {/* Approval Filter */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
              Approval
            </label>
            <select
              value={approvalFilter}
              onChange={(e) => setApprovalFilter(e.target.value as QueueApprovalFilter)}
              className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-emerald-500"
            >
              <option value="ALL">All Approvals</option>
              <option value="APPROVED">Approved ({telemetry.approved})</option>
              <option value="PENDING_APPROVAL">Pending Approval ({telemetry.pendingApproval})</option>
            </select>
          </div>

          {/* Lineup Role Filter */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
              Lineup Role
            </label>
            <select
              value={lineupFilter}
              onChange={(e) => setLineupFilter(e.target.value as QueueLineupFilter)}
              className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-emerald-500"
            >
              <option value="ALL">All Roles</option>
              <option value="LINEUP">Starting Lineup ({telemetry.startingLineup})</option>
              <option value="RESERVE">Reserve Standby ({telemetry.reserveStandby})</option>
              <option value="WITHDRAWN">Withdrawn</option>
            </select>
          </div>
        </div>
      </div>

      {/* 4. Queue Roster Header & Count */}
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 px-1">
        <div className="flex items-center gap-2 font-medium">
          <Users className="w-3.5 h-3.5 text-emerald-500" />
          <span>
            Showing <strong>{filteredRegistrations.length}</strong> of <strong>{registrations.length}</strong> competitors
          </span>
          {hasActiveFilters && (
            <span className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold">
              (Filtered)
            </span>
          )}
        </div>
      </div>

      {/* 5. Queue Roster Cards */}
      {isLoading ? (
        <div className="p-12 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl space-y-3">
          <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mx-auto" />
          <p className="text-xs text-slate-500">Loading authoritative registration and weigh-in records...</p>
        </div>
      ) : filteredRegistrations.length === 0 ? (
        <div className="p-12 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl space-y-3">
          <Users className="w-10 h-10 text-slate-400 mx-auto" />
          <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">No Registrations Found</h4>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {hasActiveFilters
              ? 'No competitors match the active filter criteria. Try clearing search or status filters.'
              : 'No athletes registered under this snapshot.'}
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetAllFilters}
              className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              Clear All Filters
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredRegistrations.map((reg) => {
            const event = reg.event || eventsMap.get(reg.event_id);
            const requiresWeighIn = event?.category !== 'ANYO';
            const weighInStatus = getWeighInStatus(
              reg.weigh_in_weight,
              event?.min_weight,
              event?.max_weight,
              requiresWeighIn
            );
            const isAttention =
              weighInStatus === 'OVERWEIGHT' ||
              weighInStatus === 'UNDERWEIGHT' ||
              (requiresWeighIn && (reg.weigh_in_weight === null || reg.weigh_in_weight === undefined)) ||
              !reg.is_approved ||
              reg.lineup_role === 'WITHDRAWN';

            return (
              <div
                key={reg.id}
                className={`p-4 bg-white dark:bg-slate-900 border rounded-xl transition-all shadow-xs space-y-3 ${
                  isAttention
                    ? 'border-amber-300/80 dark:border-amber-800/80 bg-linear-to-r from-amber-500/5 via-transparent to-transparent'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  {/* Competitor Identity & Team */}
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-950/80 border border-emerald-300 dark:border-emerald-700 flex items-center justify-center text-emerald-800 dark:text-emerald-300 font-bold text-xs shrink-0">
                      {reg.user_profile?.full_name?.charAt(0).toUpperCase() || 'A'}
                    </div>
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900 dark:text-white text-sm truncate">
                          {reg.user_profile?.full_name || 'Athlete Name Unavailable'}
                        </span>
                        {renderLineupRoleBadge(reg.lineup_role)}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          {reg.team_name || 'Independent / Unattached'}
                        </span>
                        <span>&bull;</span>
                        <span className="text-[11px] font-mono text-slate-400">
                          {reg.user_profile?.email || reg.user_id.slice(0, 8)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Event & Category */}
                  <div className="text-xs space-y-0.5 min-w-[200px]">
                    <div className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                      {event?.name || 'Event Assignment'}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {event?.division || 'Open Division'} &bull; {event?.category || 'Category'}
                    </div>
                    {event?.weight_class && (
                      <div className="text-[10px] font-mono text-amber-600 dark:text-amber-400 font-bold">
                        Target Bracket: {event.weight_class}
                        {event.min_weight !== null && event.max_weight !== null && (
                          <span className="text-slate-400 font-normal">
                            {' '}({event.min_weight ?? 0} - {event.max_weight ?? 0} kg)
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Telemetry Status Badges */}
                  <div className="flex items-center gap-2 flex-wrap shrink-0">
                    {renderWeighInBadge(weighInStatus, reg.weigh_in_weight)}
                    {renderApprovalBadge(reg.is_approved)}
                  </div>

                  {/* Quick Action Controls (Management Only) */}
                  {canManage && (
                    <div className="flex items-center gap-1.5 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-100 dark:border-slate-800">
                      {/* Record / Edit Weigh-in */}
                      {requiresWeighIn && (
                        <button
                          type="button"
                          onClick={() => {
                            setWeighInModalRegistration(reg);
                            setWeighInWeightInput(
                              reg.weigh_in_weight !== null && reg.weigh_in_weight !== undefined
                                ? String(reg.weigh_in_weight)
                                : ''
                            );
                          }}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 hover:text-emerald-700 dark:hover:text-emerald-300 border border-slate-300 dark:border-slate-700 transition-colors flex items-center gap-1.5 shadow-xs"
                          title="Record official scale weigh-in"
                        >
                          <Scale className="w-3.5 h-3.5 text-emerald-500" />
                          <span>{reg.weigh_in_weight !== null ? 'Edit Scale' : 'Record Scale'}</span>
                        </button>
                      )}

                      {/* Toggle Approval */}
                      <button
                        type="button"
                        onClick={() => handleToggleApproval(reg)}
                        disabled={isActionLoading}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors flex items-center gap-1.5 shadow-xs ${
                          reg.is_approved
                            ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800 hover:bg-rose-100'
                            : 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-500'
                        }`}
                        title={reg.is_approved ? 'Revoke credential approval' : 'Approve credential for competition'}
                      >
                        {reg.is_approved ? (
                          <>
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Revoke</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Approve</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>

                {/* Attention Detail Callout */}
                {isAttention && (
                  <div className="p-2.5 bg-amber-500/10 border border-amber-300 dark:border-amber-500/30 rounded-lg text-xs text-amber-800 dark:text-amber-300 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                      <span>
                        <strong>Operational Attention:</strong>{' '}
                        {weighInStatus === 'OVERWEIGHT' &&
                          `Official weight (${reg.weigh_in_weight} kg) exceeds event ceiling (${event?.max_weight} kg).`}
                        {weighInStatus === 'UNDERWEIGHT' &&
                          `Official weight (${reg.weigh_in_weight} kg) is below event minimum (${event?.min_weight} kg).`}
                        {weighInStatus === 'PENDING' && requiresWeighIn && 'Awaiting official scale weigh-in.'}
                        {!reg.is_approved && ' Credential verification pending tournament official sign-off.'}
                        {reg.lineup_role === 'WITHDRAWN' && ' Competitor marked WITHDRAWN by coaching staff.'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 6. Weigh-In Entry Modal */}
      {weighInModalRegistration && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Scale className="w-5 h-5 text-emerald-500" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Record Official Weigh-In Scale
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setWeighInModalRegistration(null);
                  setWeighInWeightInput('');
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Athlete & Target info */}
            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl text-xs space-y-1">
              <div className="font-bold text-slate-900 dark:text-white">
                {weighInModalRegistration.user_profile?.full_name || 'Athlete'}
              </div>
              <div className="text-slate-500 dark:text-slate-400">
                {weighInModalRegistration.team_name || 'Independent'} &bull;{' '}
                {weighInModalRegistration.event?.name || 'Event'}
              </div>
              {weighInModalRegistration.event?.weight_class && (
                <div className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 font-bold pt-1">
                  Target Bracket: {weighInModalRegistration.event.weight_class} (
                  {weighInModalRegistration.event.min_weight ?? 0} -{' '}
                  {weighInModalRegistration.event.max_weight ?? 0} kg)
                </div>
              )}
            </div>

            {/* Scale Input Form */}
            <form onSubmit={handleSaveWeighIn} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1.5">
                  Official Scale Reading (kg)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="300"
                    value={weighInWeightInput}
                    onChange={(e) => setWeighInWeightInput(e.target.value)}
                    placeholder="e.g. 58.20"
                    autoFocus
                    className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono font-bold text-slate-400">
                    KG
                  </span>
                </div>
              </div>

              {/* Real-time Preview Status */}
              {weighInWeightInput.trim() !== '' && (
                <div className="p-2.5 bg-slate-50 dark:bg-slate-800/80 rounded-lg flex items-center justify-between text-xs">
                  <span className="text-slate-500">Live Status Evaluation:</span>
                  <div>
                    {renderWeighInBadge(
                      getWeighInStatus(
                        parseFloat(weighInWeightInput),
                        weighInModalRegistration.event?.min_weight,
                        weighInModalRegistration.event?.max_weight,
                        true
                      ),
                      parseFloat(weighInWeightInput)
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                {weighInModalRegistration.weigh_in_weight !== null && (
                  <button
                    type="button"
                    onClick={() => {
                      setWeighInWeightInput('');
                    }}
                    className="text-xs text-rose-600 dark:text-rose-400 hover:underline font-medium"
                  >
                    Clear Weight
                  </button>
                )}
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={() => {
                      setWeighInModalRegistration(null);
                      setWeighInWeightInput('');
                    }}
                    className="px-3.5 py-2 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isActionLoading}
                    className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-500 transition-colors flex items-center gap-1.5 shadow-xs"
                  >
                    {isActionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    <span>Save Official Weight</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 7. Approval Warning Confirmation Modal (Out-of-bracket athletes) */}
      {approvalWarningRegistration && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-amber-100 dark:bg-amber-950/80 rounded-xl text-amber-600 dark:text-amber-400">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Weight Bracket Non-Compliance Warning
                </h3>
                <p className="text-xs text-slate-500">Official Certification Notice</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Athlete <strong>{approvalWarningRegistration.user_profile?.full_name || 'Athlete'}</strong> has a recorded weight of{' '}
              <strong>{approvalWarningRegistration.weigh_in_weight ?? 'N/A'} kg</strong>, which falls outside the bracket limits (
              {approvalWarningRegistration.event?.min_weight ?? 0} - {approvalWarningRegistration.event?.max_weight ?? 0} kg).
            </p>

            <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/80 rounded-xl text-xs text-amber-800 dark:text-amber-300 space-y-1">
              <div className="font-bold">Administrative Override Required:</div>
              <div>Are you sure you wish to officially approve this competitor for bracket seeding?</div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setApprovalWarningRegistration(null)}
                className="px-3.5 py-2 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isActionLoading}
                onClick={() => executeApprovalUpdate(approvalWarningRegistration, true)}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-amber-600 text-white hover:bg-amber-500 transition-colors flex items-center gap-1.5 shadow-xs"
              >
                {isActionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                <span>Confirm Official Approval</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
