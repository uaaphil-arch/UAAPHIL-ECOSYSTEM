import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Users,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Scale,
  Search,
  Filter,
  Plus,
  Lock,
  X,
  RotateCcw,
  Check,
  UserCheck,
  Clock,
  XCircle,
  Info,
} from 'lucide-react';
import { tournamentService } from '../../services/tournamentService';
import {
  Tournament,
  TournamentSnapshot,
  TournamentEvent,
  Registration,
  WeighInStatus,
  LineupRole,
} from '../../types/tournament';
import { useAuth } from '../../context/AuthContext';
import { NavigationTab } from '../../utils/authorization';
import { isIndividualSelfRegistrationEvent } from '../../constants/arnisRegistry';

/**
 * Deterministic Weigh-In Status Calculation
 * Invariant: Open Weight (null min & max) with numeric weight -> PASSED
 */
export const getWeighInStatus = (
  weight: number | null | undefined,
  minWeight?: number | null,
  maxWeight?: number | null,
  requiresWeighIn: boolean = true
): WeighInStatus => {
  if (!requiresWeighIn) {
    return 'NOT_REQUIRED';
  }
  if (weight === null || weight === undefined) {
    return 'PENDING';
  }
  if ((minWeight === null || minWeight === undefined) && (maxWeight === null || maxWeight === undefined)) {
    return 'PASSED';
  }
  if (minWeight !== null && minWeight !== undefined && weight < minWeight) {
    return 'UNDERWEIGHT';
  }
  if (maxWeight !== null && maxWeight !== undefined && weight > maxWeight) {
    return 'OVERWEIGHT';
  }
  return 'PASSED';
};

/**
 * Render Lineup Role Badge
 * Invariant: null / undefined defaults safely to 'LINEUP' for backwards compatibility
 */
export const renderLineupRoleBadge = (role?: LineupRole) => {
  const effectiveRole: LineupRole = role || 'LINEUP';

  if (effectiveRole === 'LINEUP') {
    return (
      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-950/70 text-amber-300 border border-amber-800/80 inline-flex items-center gap-1">
        <UserCheck className="w-3 h-3 text-amber-400" />
        LINEUP
      </span>
    );
  }

  if (effectiveRole === 'RESERVE') {
    return (
      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-sky-950/70 text-sky-300 border border-sky-800/80 inline-flex items-center gap-1">
        <Clock className="w-3 h-3 text-sky-400" />
        RESERVE
      </span>
    );
  }

  return (
    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-800 text-slate-400 border border-slate-700 inline-flex items-center gap-1">
      <XCircle className="w-3 h-3 text-slate-500" />
      WITHDRAWN
    </span>
  );
};

interface RegistrationManagementViewProps {
  onNavigateTab?: (tab: NavigationTab) => void;
}

export const RegistrationManagementView: React.FC<RegistrationManagementViewProps> = ({
  onNavigateTab,
}) => {
  const { user, roles } = useAuth();
  const isSuperAdmin = roles.includes('SUPER_ADMIN');
  const isAdminOrOrganizer = isSuperAdmin || roles.includes('ADMIN') || roles.includes('ORGANIZER');
  const isCoach = roles.includes('COACH') && !isAdminOrOrganizer;
  const isAthleteOnly = (roles as string[]).includes('PLAYER') && !isAdminOrOrganizer && !roles.includes('COACH');
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string>('');
  const [activeSnapshot, setActiveSnapshot] = useState<TournamentSnapshot | null>(null);
  const [events, setEvents] = useState<TournamentEvent[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Self-registration modal/form states
  const [selectedEventId, setSelectedEventId] = useState('');
  const [teamName, setTeamName] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);

  // Weigh-in editing modal/state
  const [weighInModalRegistration, setWeighInModalRegistration] = useState<Registration | null>(null);
  const [weighInWeight, setWeighInWeight] = useState<string>('');

  // Approval warning modal state for weight violations
  const [approvalWarningRegistration, setApprovalWarningRegistration] = useState<Registration | null>(null);

  // Advanced Filtering States
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [divisionFilter, setDivisionFilter] = useState('ALL');
  const [genderFilter, setGenderFilter] = useState('ALL');
  const [approvalFilter, setApprovalFilter] = useState<'ALL' | 'APPROVED' | 'PENDING'>('ALL');
  const [lineupRoleFilter, setLineupRoleFilter] = useState<'ALL' | LineupRole>('ALL');
  const [weighInFilter, setWeighInFilter] = useState<'ALL' | 'PENDING' | 'PASSED' | 'OVERWEIGHT' | 'UNDERWEIGHT'>('ALL');

  const selectedTournament = tournaments.find((t) => t.id === selectedTournamentId) || null;
  const isReadOnly =
    selectedTournament?.status === 'ONGOING' ||
    selectedTournament?.status === 'COMPLETED' ||
    selectedTournament?.status === 'CANCELLED';

  // Filter individual self-registration eligible events for PLAYER workflow
  const eligibleSelfRegEvents = useMemo(() => {
    return events.filter(isIndividualSelfRegistrationEvent);
  }, [events]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const tourns = await tournamentService.getTournaments();
      setTournaments(tourns);

      if (tourns.length > 0) {
        const existingSelection = tourns.find((t) => t.id === selectedTournamentId);
        let activeId: string;

        if (existingSelection) {
          activeId = existingSelection.id;
        } else {
          const prioritized =
            tourns.find((t) => t.status === 'REGISTRATION_OPEN') ||
            tourns.find((t) => t.status === 'ONGOING') ||
            tourns.find((t) => t.status === 'REGISTRATION_CLOSED') ||
            tourns.find((t) => t.status === 'DRAFT') ||
            tourns[0];
          activeId = prioritized.id;
        }

        setSelectedTournamentId(activeId);

        const snapshot = await tournamentService.getActiveSnapshot(activeId);
        setActiveSnapshot(snapshot);

        if (snapshot) {
          const [evts, regs] = await Promise.all([
            tournamentService.getEventsBySnapshotId(snapshot.id),
            tournamentService.getRegistrationsBySnapshot(snapshot.id),
          ]);
          setEvents(evts);
          setRegistrations(regs);
        } else {
          setEvents([]);
          setRegistrations([]);
        }
      } else {
        setSelectedTournamentId('');
        setActiveSnapshot(null);
        setEvents([]);
        setRegistrations([]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load registration data.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedTournamentId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleTournamentSelect = async (id: string) => {
    setSelectedTournamentId(id);
    setIsLoading(true);
    setError(null);
    try {
      const snapshot = await tournamentService.getActiveSnapshot(id);
      setActiveSnapshot(snapshot);
      if (snapshot) {
        const [evts, regs] = await Promise.all([
          tournamentService.getEventsBySnapshotId(snapshot.id),
          tournamentService.getRegistrationsBySnapshot(snapshot.id),
        ]);
        setEvents(evts);
        setRegistrations(regs);
      } else {
        setEvents([]);
        setRegistrations([]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error switching tournament.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelfRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventId) return;

    // Strict role invariant: Organizers, Admins, Super Admins, and Coaches are forbidden from legacy self-registration
    if (isAdminOrOrganizer || isCoach || !isAthleteOnly) {
      setError('Tournament entries for official events must be submitted through Club Event Lineups.');
      return;
    }

    // Strict event mode invariant: Only Individual/Open events are eligible for athlete self-registration
    const selectedEvent = events.find((evt) => evt.id === selectedEventId);
    if (!selectedEvent || !isIndividualSelfRegistrationEvent(selectedEvent)) {
      setError('This event is managed through Club Event Lineups.');
      return;
    }

    setError(null);
    setSuccessMessage(null);
    setIsActionLoading(true);

    try {
      await tournamentService.registerAthlete(selectedEventId, teamName.trim() || undefined);
      setSuccessMessage('Registration submitted successfully (Pending Approval).');
      setSelectedEventId('');
      setTeamName('');
      setIsRegistering(false);
      if (activeSnapshot) {
        const regs = await tournamentService.getRegistrationsBySnapshot(activeSnapshot.id);
        setRegistrations(regs);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setIsActionLoading(false);
    }
  };

  const executeToggleApproval = async (reg: Registration) => {
    if (isReadOnly) return;
    setError(null);
    setSuccessMessage(null);
    try {
      const updated = await tournamentService.updateRegistration(reg.id, {
        is_approved: !reg.is_approved,
      });
      setRegistrations((prev) =>
        prev.map((r) => (r.id === reg.id ? { ...r, is_approved: updated.is_approved } : r))
      );
      setSuccessMessage(`Athlete registration ${updated.is_approved ? 'APPROVED' : 'UNAPPROVED'}.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update approval status.');
    } finally {
      setApprovalWarningRegistration(null);
    }
  };

  const handleInitiateApprovalToggle = (reg: Registration) => {
    if (isReadOnly) return;
    // If approving an unapproved athlete with weight out of range, show warning prompt
    if (!reg.is_approved) {
      const requiresWeighIn = reg.event?.rules_override?.requires_weigh_in !== false;
      const status = getWeighInStatus(
        reg.weigh_in_weight,
        reg.event?.min_weight,
        reg.event?.max_weight,
        requiresWeighIn
      );
      if (status === 'OVERWEIGHT' || status === 'UNDERWEIGHT') {
        setApprovalWarningRegistration(reg);
        return;
      }
    }
    executeToggleApproval(reg);
  };

  const handleSaveWeighIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!weighInModalRegistration || isReadOnly) return;
    setError(null);
    try {
      const weightNum = parseFloat(weighInWeight);
      if (isNaN(weightNum) || weightNum <= 0) {
        setError('Please enter a valid numeric weight.');
        return;
      }

      await tournamentService.updateRegistration(weighInModalRegistration.id, {
        weigh_in_weight: weightNum,
      });

      setRegistrations((prev) =>
        prev.map((r) =>
          r.id === weighInModalRegistration.id ? { ...r, weigh_in_weight: weightNum } : r
        )
      );
      setWeighInModalRegistration(null);
      setWeighInWeight('');
      setSuccessMessage('Weigh-in weight successfully recorded.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to record weigh-in weight.');
    }
  };

  // Distinct filter options extracted from existing events
  const categories = useMemo(
    () => Array.from(new Set(events.map((e) => e.category).filter(Boolean))).sort(),
    [events]
  );
  const divisions = useMemo(
    () => Array.from(new Set(events.map((e) => e.division).filter(Boolean))).sort(),
    [events]
  );
  const genders = useMemo(
    () => Array.from(new Set(events.map((e) => e.gender).filter(Boolean) as string[])).sort(),
    [events]
  );

  // Filtered dataset evaluation
  const filteredRegistrations = useMemo(() => {
    return registrations.filter((reg) => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const name = (reg.user_profile?.full_name || '').toLowerCase();
        const email = (reg.user_profile?.email || '').toLowerCase();
        const team = (reg.team_name || '').toLowerCase();
        if (!name.includes(q) && !email.includes(q) && !team.includes(q)) {
          return false;
        }
      }

      // 2. Category Filter
      if (categoryFilter !== 'ALL') {
        if (reg.event?.category !== categoryFilter) return false;
      }

      // 3. Division Filter
      if (divisionFilter !== 'ALL') {
        if (reg.event?.division !== divisionFilter) return false;
      }

      // 4. Gender Filter
      if (genderFilter !== 'ALL') {
        if (reg.event?.gender !== genderFilter) return false;
      }

      // 5. Approval Filter
      if (approvalFilter === 'APPROVED' && !reg.is_approved) return false;
      if (approvalFilter === 'PENDING' && reg.is_approved) return false;

      // 6. Lineup Role Filter
      if (lineupRoleFilter !== 'ALL') {
        const effectiveRole = reg.lineup_role || 'LINEUP';
        if (effectiveRole !== lineupRoleFilter) return false;
      }

      // 7. Weigh-In Filter
      if (weighInFilter !== 'ALL') {
        const requiresWeighIn = reg.event?.rules_override?.requires_weigh_in !== false;
        const status = getWeighInStatus(
          reg.weigh_in_weight,
          reg.event?.min_weight,
          reg.event?.max_weight,
          requiresWeighIn
        );
        if (status !== weighInFilter) return false;
      }

      return true;
    });
  }, [
    registrations,
    searchQuery,
    categoryFilter,
    divisionFilter,
    genderFilter,
    approvalFilter,
    lineupRoleFilter,
    weighInFilter,
  ]);

  const hasActiveFilters = Boolean(
    searchQuery.trim() ||
      categoryFilter !== 'ALL' ||
      divisionFilter !== 'ALL' ||
      genderFilter !== 'ALL' ||
      approvalFilter !== 'ALL' ||
      lineupRoleFilter !== 'ALL' ||
      weighInFilter !== 'ALL'
  );

  const handleResetFilters = () => {
    setSearchQuery('');
    setCategoryFilter('ALL');
    setDivisionFilter('ALL');
    setGenderFilter('ALL');
    setApprovalFilter('ALL');
    setLineupRoleFilter('ALL');
    setWeighInFilter('ALL');
  };

  // Authoritative Metrics (calculated across entire dataset)
  const metrics = useMemo(() => {
    let approved = 0;
    let pendingApproval = 0;
    let weighed = 0;
    let pendingWeighIn = 0;
    let passed = 0;
    let weightAlerts = 0;

    for (const r of registrations) {
      if (r.is_approved) approved++;
      else pendingApproval++;

      const requiresWeighIn = r.event?.rules_override?.requires_weigh_in !== false;
      if (!requiresWeighIn) {
        // Exempt / not required
        passed++;
      } else if (r.weigh_in_weight !== null && r.weigh_in_weight !== undefined) {
        weighed++;
        const s = getWeighInStatus(r.weigh_in_weight, r.event?.min_weight, r.event?.max_weight, true);
        if (s === 'PASSED') passed++;
        else if (s === 'OVERWEIGHT' || s === 'UNDERWEIGHT') weightAlerts++;
      } else {
        pendingWeighIn++;
      }
    }

    return {
      total: registrations.length,
      approved,
      pendingApproval,
      weighed,
      pendingWeighIn,
      passed,
      weightAlerts,
    };
  }, [registrations]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Users className="w-6 h-6 text-emerald-400 shrink-0" />
            <h1 className="text-xl sm:text-2xl font-bold text-slate-100 break-words">Athlete Registrations & Rosters</h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Verification, Approval, and Official Weigh-In Management
          </p>
        </div>

        {/* Tournament Selector */}
        {tournaments.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto min-w-0">
            <span className="text-xs text-slate-400 font-semibold uppercase shrink-0">Tournament:</span>
            <select
              value={selectedTournamentId}
              onChange={(e) => handleTournamentSelect(e.target.value)}
              className="w-full sm:w-auto sm:max-w-xs md:max-w-sm px-3.5 py-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-100 text-xs font-semibold focus:outline-hidden focus:border-emerald-400 truncate"
            >
              {tournaments.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.status})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Messages */}
      {error && (
        <div className="p-4 bg-red-950/50 border border-red-800 rounded-xl flex items-start gap-3 text-red-200 text-sm">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 break-words">{error}</div>
        </div>
      )}

      {successMessage && (
        <div className="p-4 bg-emerald-950/50 border border-emerald-800 rounded-xl flex items-start gap-3 text-emerald-200 text-sm">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 break-words">{successMessage}</div>
        </div>
      )}

      {/* Main Roster Panel */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-400 mb-3" />
          <span>Loading registrations...</span>
        </div>
      ) : !selectedTournament ? (
        <div className="text-center py-20 text-slate-500 border border-dashed border-slate-800 rounded-2xl">
          No tournament selected or available.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Status & Entry Banner */}
          <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-200 break-words">
                  {selectedTournament.name}
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono shrink-0">
                  {selectedTournament.status}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {registrations.length} Total Registrations • {metrics.approved} Approved & Verified
              </p>
            </div>

            {selectedTournament.status === 'REGISTRATION_OPEN' && (
              <>
                {isCoach ? (
                  <button
                    onClick={() => {
                      if (onNavigateTab) {
                        onNavigateTab('team_management');
                      }
                    }}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg transition-colors flex items-center gap-1.5 shrink-0 shadow-sm"
                  >
                    <UserCheck className="w-4 h-4" />
                    <span>Manage Event Lineups</span>
                  </button>
                ) : isAthleteOnly ? (
                  <button
                    onClick={() => setIsRegistering(!isRegistering)}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors flex items-center gap-1.5 shrink-0"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{isRegistering ? 'Cancel Entry Form' : 'Register Athlete'}</span>
                  </button>
                ) : null}
              </>
            )}

            {isReadOnly && (
              <div className="flex items-center gap-1.5 text-xs text-amber-300 bg-amber-950/40 px-3 py-1.5 rounded-lg border border-amber-800/60">
                <Lock className="w-3.5 h-3.5" />
                <span>Tournament is {selectedTournament.status}. Registrations are locked.</span>
              </div>
            )}
          </div>

          {/* Coach Guidance Panel */}
          {isCoach && selectedTournament.status === 'REGISTRATION_OPEN' && (
            <div className="p-5 bg-amber-950/30 border border-amber-800/60 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
                  <UserCheck className="w-4 h-4" />
                  <span>Coach Athlete Registration &amp; Event Lineups</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed max-w-2xl">
                  Athlete registration for Coaches is managed through official Club Event Lineups. Select your affiliated club and assign verified active athletes to Starting Lineup or Reserve positions.
                </p>
              </div>
              {onNavigateTab && (
                <button
                  onClick={() => onNavigateTab('team_management')}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg transition-colors shrink-0 flex items-center gap-1.5 shadow-lg shadow-amber-950/40"
                >
                  <UserCheck className="w-4 h-4" />
                  <span>Go to Event Lineups</span>
                </button>
              )}
            </div>
          )}

          {/* Empty Snapshot Events Notification */}
          {activeSnapshot && events.length === 0 && (
            <div className="p-4 bg-slate-900/90 border border-amber-900/50 rounded-2xl flex items-start gap-3 text-amber-200 text-xs">
              <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span className="leading-relaxed">
                No events have been configured for this tournament&apos;s active snapshot yet. Event categories must be set up during the Draft phase by tournament administrators.
              </span>
            </div>
          )}

          {/* Registration Summary Metrics Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
            <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
              <div className="text-[11px] font-semibold text-slate-400 uppercase">Total</div>
              <div className="text-lg font-bold text-slate-100 mt-0.5 font-mono">{metrics.total}</div>
            </div>
            <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
              <div className="text-[11px] font-semibold text-emerald-400 uppercase">Approved</div>
              <div className="text-lg font-bold text-emerald-300 mt-0.5 font-mono">{metrics.approved}</div>
            </div>
            <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
              <div className="text-[11px] font-semibold text-amber-400 uppercase">Pending Appr.</div>
              <div className="text-lg font-bold text-amber-300 mt-0.5 font-mono">{metrics.pendingApproval}</div>
            </div>
            <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
              <div className="text-[11px] font-semibold text-blue-400 uppercase">Weighed</div>
              <div className="text-lg font-bold text-blue-300 mt-0.5 font-mono">{metrics.weighed}</div>
            </div>
            <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
              <div className="text-[11px] font-semibold text-slate-400 uppercase">Pending W/I</div>
              <div className="text-lg font-bold text-slate-300 mt-0.5 font-mono">{metrics.pendingWeighIn}</div>
            </div>
            <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
              <div className="text-[11px] font-semibold text-emerald-400 uppercase">Weight Passed</div>
              <div className="text-lg font-bold text-emerald-300 mt-0.5 font-mono">{metrics.passed}</div>
            </div>
            <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
              <div className="text-[11px] font-semibold text-rose-400 uppercase">Weight Alerts</div>
              <div className="text-lg font-bold text-rose-400 mt-0.5 font-mono">{metrics.weightAlerts}</div>
            </div>
          </div>

          {/* Self-Registration Form Drawer (For Athletes / Individual Competitors) */}
          {isAthleteOnly && isRegistering && selectedTournament.status === 'REGISTRATION_OPEN' && (
            <form
              onSubmit={handleSelfRegister}
              className="p-6 bg-slate-900 border border-slate-800 rounded-2xl space-y-4"
            >
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Plus className="w-4 h-4 text-emerald-400" />
                <span>Athlete Event Entry Form (REGISTRATION_OPEN)</span>
              </h3>

              {events.length === 0 && (
                <div className="p-3 bg-amber-950/40 border border-amber-800/60 rounded-xl text-amber-200 text-xs flex items-center gap-2">
                  <Info className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>No events have been configured for this tournament&apos;s active snapshot yet. Event categories must be set up during the Draft phase by tournament administrators.</span>
                </div>
              )}

              {events.length > 0 && eligibleSelfRegEvents.length === 0 && (
                <div className="p-3 bg-amber-950/40 border border-amber-800/60 rounded-xl text-amber-200 text-xs flex items-center gap-2">
                  <Info className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>All events in this tournament are Club-Managed. Athlete entries must be submitted by your Club Coach through Event Lineups.</span>
                </div>
              )}

              {eligibleSelfRegEvents.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                      Select Target Event *
                    </label>
                    <select
                      required
                      value={selectedEventId}
                      onChange={(e) => setSelectedEventId(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-hidden focus:border-emerald-400"
                    >
                      <option value="">-- Choose an Individual Event --</option>
                      {eligibleSelfRegEvents.map((evt) => (
                        <option key={evt.id} value={evt.id}>
                          {evt.name} ({evt.category} - {evt.division}
                          {evt.weight_class ? ` • ${evt.weight_class}` : ''})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                      Team / Affiliation (Optional)
                    </label>
                    <input
                      type="text"
                      value={teamName}
                      onChange={(e) => setTeamName(e.target.value)}
                      placeholder="e.g., UST Tiger Arnis Club"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-hidden focus:border-emerald-400"
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsRegistering(false)}
                  className="px-4 py-1.5 text-xs text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                {eligibleSelfRegEvents.length > 0 && (
                  <button
                    type="submit"
                    disabled={isActionLoading || !selectedEventId}
                    className="px-5 py-1.5 bg-emerald-400 text-slate-950 font-semibold text-xs rounded-lg hover:bg-emerald-300 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {isActionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    <span>Submit Entry</span>
                  </button>
                )}
              </div>
            </form>
          )}

          {/* Search and Advanced Filter Toolbar */}
          <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
            <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
              {/* Search Bar */}
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by athlete name, email, or team..."
                  className="w-full pl-9 pr-8 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-hidden focus:border-emerald-400 placeholder:text-slate-500"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Reset Filters */}
              {hasActiveFilters && (
                <button
                  onClick={handleResetFilters}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 shrink-0 justify-center"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset Filters</span>
                </button>
              )}
            </div>

            {/* Filter Dropdowns Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-1">
              {/* Category */}
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Category
                </label>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-hidden focus:border-emerald-400"
                >
                  <option value="ALL">All Categories</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {/* Division */}
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Division
                </label>
                <select
                  value={divisionFilter}
                  onChange={(e) => setDivisionFilter(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-hidden focus:border-emerald-400"
                >
                  <option value="ALL">All Divisions</option>
                  {divisions.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              {/* Gender */}
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Gender
                </label>
                <select
                  value={genderFilter}
                  onChange={(e) => setGenderFilter(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-hidden focus:border-emerald-400"
                >
                  <option value="ALL">All Genders</option>
                  {genders.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>

              {/* Approval Status */}
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Approval
                </label>
                <select
                  value={approvalFilter}
                  onChange={(e) => setApprovalFilter(e.target.value as 'ALL' | 'APPROVED' | 'PENDING')}
                  className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-hidden focus:border-emerald-400"
                >
                  <option value="ALL">All Status</option>
                  <option value="APPROVED">Approved</option>
                  <option value="PENDING">Pending Approval</option>
                </select>
              </div>

              {/* Lineup Role */}
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Lineup Role
                </label>
                <select
                  value={lineupRoleFilter}
                  onChange={(e) => setLineupRoleFilter(e.target.value as 'ALL' | LineupRole)}
                  className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-hidden focus:border-emerald-400"
                >
                  <option value="ALL">All Lineup Roles</option>
                  <option value="LINEUP">Starting Lineup</option>
                  <option value="RESERVE">Reserves</option>
                  <option value="WITHDRAWN">Withdrawn</option>
                </select>
              </div>

              {/* Weigh-In Status */}
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Weigh-In
                </label>
                <select
                  value={weighInFilter}
                  onChange={(e) =>
                    setWeighInFilter(
                      e.target.value as 'ALL' | 'PENDING' | 'PASSED' | 'OVERWEIGHT' | 'UNDERWEIGHT' | 'NOT_REQUIRED'
                    )
                  }
                  className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-hidden focus:border-emerald-400"
                >
                  <option value="ALL">All Weigh-In</option>
                  <option value="PASSED">Passed</option>
                  <option value="PENDING">Pending Weigh-In</option>
                  <option value="OVERWEIGHT">Overweight</option>
                  <option value="UNDERWEIGHT">Underweight</option>
                  <option value="NOT_REQUIRED">Not Required / Exempt</option>
                </select>
              </div>
            </div>
          </div>

          {/* Registrations Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Roster Entries ({filteredRegistrations.length} of {registrations.length})
              </h3>
              {hasActiveFilters && (
                <span className="text-[11px] text-emerald-400 font-medium">
                  Active filters applied
                </span>
              )}
            </div>

            {registrations.length === 0 ? (
              <div className="text-center py-16 text-slate-500 text-xs">
                No athletes registered for this tournament yet.
              </div>
            ) : filteredRegistrations.length === 0 ? (
              <div className="text-center py-16 text-slate-500 text-xs space-y-2">
                <p>No athletes match the selected filter criteria.</p>
                <button
                  onClick={handleResetFilters}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg transition-colors inline-flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Clear Filters</span>
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider border-b border-slate-800">
                    <tr>
                      <th className="px-6 py-3">Athlete</th>
                      <th className="px-6 py-3">Event & Division</th>
                      <th className="px-6 py-3">Team</th>
                      <th className="px-6 py-3">Lineup Role</th>
                      <th className="px-6 py-3">Weigh-In Status</th>
                      <th className="px-6 py-3">Approval</th>
                      {!isReadOnly && <th className="px-6 py-3 text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-200">
                    {filteredRegistrations.map((reg) => {
                      const requiresWeighIn = reg.event?.rules_override?.requires_weigh_in !== false;
                      const weighStatus = getWeighInStatus(
                        reg.weigh_in_weight,
                        reg.event?.min_weight,
                        reg.event?.max_weight,
                        requiresWeighIn
                      );

                      return (
                        <tr key={reg.id} className="hover:bg-slate-800/30 transition-colors">
                          {/* Athlete */}
                          <td className="px-6 py-3.5">
                            <div className="font-semibold text-slate-100">
                              {reg.user_profile?.full_name || 'Athlete User'}
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono">
                              {reg.user_profile?.email || reg.user_id.slice(0, 8)}
                            </div>
                          </td>

                          {/* Event */}
                          <td className="px-6 py-3.5">
                            <div className="font-medium">{reg.event?.name || 'Assigned Event'}</div>
                            <div className="text-[11px] text-slate-500">
                              {reg.event?.category} • {reg.event?.division}
                              {reg.event?.weight_class ? ` • ${reg.event.weight_class}` : ''}
                            </div>
                          </td>

                          {/* Team */}
                          <td className="px-6 py-3.5 text-slate-400">
                            {reg.team_name || '—'}
                          </td>

                          {/* Lineup Role */}
                          <td className="px-6 py-3.5">
                            {renderLineupRoleBadge(reg.lineup_role)}
                          </td>

                          {/* Weigh-In Details & Badge */}
                          <td className="px-6 py-3.5">
                            {!requiresWeighIn ? (
                              <div className="space-y-1">
                                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800 inline-flex items-center gap-1">
                                  <Check className="w-3 h-3" />
                                  NOT REQUIRED
                                </span>
                                <div className="text-[11px] text-slate-500 italic">Official weigh-in exempt</div>
                              </div>
                            ) : (
                              <div className="space-y-1">
                                {weighStatus === 'PASSED' && (
                                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800 inline-flex items-center gap-1">
                                    <Check className="w-3 h-3" />
                                    PASSED
                                  </span>
                                )}
                                {weighStatus === 'OVERWEIGHT' && (
                                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-950 text-rose-300 border border-rose-800 inline-flex items-center gap-1">
                                    <AlertCircle className="w-3 h-3" />
                                    OVERWEIGHT
                                  </span>
                                )}
                                {weighStatus === 'UNDERWEIGHT' && (
                                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-950 text-rose-300 border border-rose-800 inline-flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3" />
                                    UNDERWEIGHT
                                  </span>
                                )}
                                {weighStatus === 'PENDING' && (
                                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-800 text-slate-400 border border-slate-700 inline-flex items-center gap-1">
                                    PENDING
                                  </span>
                                )}

                                {/* Weight Details */}
                                {reg.weigh_in_weight !== null && reg.weigh_in_weight !== undefined ? (
                                  <div className="text-[11px] text-slate-400 font-mono">
                                    <span className="font-semibold text-slate-200">
                                      {reg.weigh_in_weight.toFixed(2)} kg
                                    </span>
                                    {reg.event?.min_weight || reg.event?.max_weight ? (
                                      <span className="text-slate-500 ml-1">
                                        (Target: {reg.event?.min_weight ?? 0}–{reg.event?.max_weight ?? '∞'} kg)
                                      </span>
                                    ) : (
                                      <span className="text-slate-500 ml-1">(Open Weight)</span>
                                    )}
                                    {weighStatus === 'OVERWEIGHT' && reg.event?.max_weight && (
                                      <div className="text-[10px] text-rose-400">
                                        +{(reg.weigh_in_weight - reg.event.max_weight).toFixed(2)} kg over limit
                                      </div>
                                    )}
                                    {weighStatus === 'UNDERWEIGHT' && reg.event?.min_weight && (
                                      <div className="text-[10px] text-rose-400">
                                        -{(reg.event.min_weight - reg.weigh_in_weight).toFixed(2)} kg under limit
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="text-[11px] text-slate-500 italic">No weight recorded</div>
                                )}
                              </div>
                            )}
                          </td>

                          {/* Approval Status */}
                          <td className="px-6 py-3.5">
                            {reg.is_approved ? (
                              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800 inline-flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" />
                                Approved
                              </span>
                            ) : (
                              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-950 text-amber-300 border border-amber-800">
                                Pending Approval
                              </span>
                            )}
                          </td>

                          {/* Actions */}
                          {!isReadOnly && (
                            <td className="px-6 py-3.5 text-right space-x-2">
                              {isAdminOrOrganizer ? (
                                <>
                                  <button
                                    onClick={() => {
                                      setWeighInModalRegistration(reg);
                                      setWeighInWeight(reg.weigh_in_weight ? reg.weigh_in_weight.toString() : '');
                                    }}
                                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px] font-medium transition-colors"
                                  >
                                    Weigh-In
                                  </button>
                                  <button
                                    onClick={() => handleInitiateApprovalToggle(reg)}
                                    className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                                      reg.is_approved
                                        ? 'bg-amber-950/60 hover:bg-amber-900/80 text-amber-200 border border-amber-800'
                                        : 'bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-200 border border-emerald-800'
                                    }`}
                                  >
                                    {reg.is_approved ? 'Revoke' : 'Approve'}
                                  </button>
                                </>
                              ) : (
                                <span className="text-[11px] text-slate-500 font-mono italic">
                                  Read-Only
                                </span>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Weigh-In Modal */}
      {weighInModalRegistration && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Scale className="w-5 h-5 text-emerald-400" />
                <h3 className="text-sm font-semibold text-slate-100">Record Official Weigh-In</h3>
              </div>
              <button
                onClick={() => setWeighInModalRegistration(null)}
                className="text-slate-400 hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveWeighIn} className="p-6 space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Athlete & Event</label>
                <div className="text-sm font-medium text-slate-200">
                  {weighInModalRegistration.user_profile?.full_name || 'Athlete'}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {weighInModalRegistration.event?.name} ({weighInModalRegistration.event?.category} •{' '}
                  {weighInModalRegistration.event?.division})
                </div>
                {weighInModalRegistration.event?.min_weight || weighInModalRegistration.event?.max_weight ? (
                  <div className="text-[11px] text-emerald-400 font-mono mt-1">
                    Allowed Range: {weighInModalRegistration.event?.min_weight ?? 0} kg –{' '}
                    {weighInModalRegistration.event?.max_weight ?? '∞'} kg
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-400 font-mono mt-1">
                    Event Class: Open Weight (No Limit)
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                  Official Weight (kg) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  autoFocus
                  value={weighInWeight}
                  onKeyDown={(e) => {
                    if (['-', '+', 'e', 'E'].includes(e.key)) {
                      e.preventDefault();
                    }
                  }}
                  onChange={(e) => {
                    const sanitized = e.target.value.replace(/[^0-9.]/g, '');
                    setWeighInWeight(sanitized);
                  }}
                  placeholder="e.g., 57.85"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm focus:outline-hidden focus:border-emerald-400 font-mono"
                />
              </div>

              {/* Dynamic status preview inside modal */}
              {weighInWeight && !isNaN(parseFloat(weighInWeight)) && (
                (() => {
                  const previewWeight = parseFloat(weighInWeight);
                  const requiresWeighIn = weighInModalRegistration.event?.rules_override?.requires_weigh_in !== false;
                  const previewStatus = getWeighInStatus(
                    previewWeight,
                    weighInModalRegistration.event?.min_weight,
                    weighInModalRegistration.event?.max_weight,
                    requiresWeighIn
                  );

                  return (
                    <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs flex items-center justify-between">
                      <span className="text-slate-400 font-medium">Validation Status:</span>
                      {previewStatus === 'NOT_REQUIRED' && (
                        <span className="font-semibold text-emerald-400 flex items-center gap-1">
                          <Check className="w-3.5 h-3.5" /> NOT REQUIRED
                        </span>
                      )}
                      {previewStatus === 'PASSED' && (
                        <span className="font-semibold text-emerald-400 flex items-center gap-1">
                          <Check className="w-3.5 h-3.5" /> PASSED
                        </span>
                      )}
                      {previewStatus === 'OVERWEIGHT' && (
                        <span className="font-semibold text-rose-400 flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5" /> OVERWEIGHT
                        </span>
                      )}
                      {previewStatus === 'UNDERWEIGHT' && (
                        <span className="font-semibold text-rose-400 flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" /> UNDERWEIGHT
                        </span>
                      )}
                    </div>
                  );
                })()
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setWeighInModalRegistration(null)}
                  className="px-4 py-2 text-xs text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-semibold text-xs rounded-lg transition-colors"
                >
                  Save Weigh-In
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Approval Weight Violation Warning Modal */}
      {approvalWarningRegistration && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-slate-900 border border-rose-900/60 rounded-xl shadow-2xl overflow-hidden">
            <div className="px-6 py-4 bg-rose-950/40 border-b border-rose-900/50 flex items-center justify-between">
              <div className="flex items-center gap-2 text-rose-400">
                <AlertTriangle className="w-5 h-5" />
                <h3 className="text-sm font-semibold text-rose-200">Weight Violation Warning</h3>
              </div>
              <button
                onClick={() => setApprovalWarningRegistration(null)}
                className="text-slate-400 hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-200">
                Weight is outside the event&apos;s allowed range. Are you sure you want to approve this athlete?
              </p>

              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg text-xs space-y-1.5 font-mono">
                <div className="flex justify-between text-slate-300">
                  <span className="text-slate-400">Athlete:</span>
                  <span className="font-semibold text-slate-100">
                    {approvalWarningRegistration.user_profile?.full_name || 'Athlete'}
                  </span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span className="text-slate-400">Event:</span>
                  <span>{approvalWarningRegistration.event?.name}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span className="text-slate-400">Recorded Weight:</span>
                  <span className="text-rose-400 font-bold">
                    {approvalWarningRegistration.weigh_in_weight?.toFixed(2)} kg
                  </span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span className="text-slate-400">Allowed Range:</span>
                  <span className="text-slate-200">
                    {approvalWarningRegistration.event?.min_weight ?? 0} kg –{' '}
                    {approvalWarningRegistration.event?.max_weight ?? '∞'} kg
                  </span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setApprovalWarningRegistration(null)}
                  className="px-4 py-2 text-xs text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => executeToggleApproval(approvalWarningRegistration)}
                  className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs rounded-lg transition-colors"
                >
                  Proceed & Approve Anyway
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
