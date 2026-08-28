import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { eventAssignmentService, BatchRotationItem } from '../../services/eventAssignmentService';
import { tournamentService } from '../../services/tournamentService';
import { EventAssignment, EventRole } from '../../types/eventAssignment';
import { Tournament, Court } from '../../types/tournament';
import { getAssignmentOperationalContext } from '../../utils/commandCenterBadges';
import { formatRpcError } from '../../utils/rpcErrorFormatter';
import { 
  X, 
  ShieldCheck, 
  UserCheck, 
  Users, 
  UserX, 
  Layers, 
  AlertCircle, 
  CheckCircle2, 
  Search, 
  RefreshCw,
  Plus,
  Radio,
  ArrowRight,
  ShieldAlert,
  Clock,
  CheckSquare,
  Square,
  Sparkles
} from 'lucide-react';

interface EventOfficialAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  tournament?: Tournament;
  tournamentId?: string;
  events?: Array<{ id: string; name: string }>;
  courts?: Court[];
  isSuperOrOrganizer?: boolean;
  onAssignmentChanged?: () => void;
}

type DelegationMode = 'SINGLE' | 'BATCH_ROTATION' | 'SHIFT_LIFECYCLE';

export const EventOfficialAssignmentModal: React.FC<EventOfficialAssignmentModalProps> = ({
  isOpen,
  onClose,
  tournament: propTournament,
  tournamentId: propTournamentId,
  events: propEvents = [],
  courts: propCourts = [],
  isSuperOrOrganizer = false,
  onAssignmentChanged,
}) => {
  const modalContainerRef = React.useRef<HTMLDivElement>(null);
  const triggerElementRef = React.useRef<HTMLElement | null>(null);

  // Defensive local hydration state
  const [localEvents, setLocalEvents] = useState<Array<{ id: string; name: string }>>([]);
  const [localCourts, setLocalCourts] = useState<Court[]>([]);
  const [localTournament, setLocalTournament] = useState<Tournament | null>(null);
  const [isLoadingEvents, setIsLoadingEvents] = useState<boolean>(false);
  const [isLoadingCourts, setIsLoadingCourts] = useState<boolean>(false);

  const resolvedTournamentId = propTournament?.id || propTournamentId || '';

  // Determine effective authoritative data: Prefer valid parent props, fallback to defensive local hydration
  const effectiveEvents = useMemo(() => {
    if (propEvents && propEvents.length > 0) return propEvents;
    return localEvents;
  }, [propEvents, localEvents]);

  const effectiveCourts = useMemo(() => {
    if (propCourts && propCourts.length > 0) return propCourts;
    return localCourts;
  }, [propCourts, localCourts]);

  const effectiveTournament = useMemo(() => {
    if (propTournament) return propTournament;
    return localTournament;
  }, [propTournament, localTournament]);

  // Defensive self-hydration if parent did not provide events/courts/tournament
  useEffect(() => {
    let isMounted = true;

    if (!isOpen || !resolvedTournamentId) {
      if (!isOpen) {
        setLocalEvents([]);
        setLocalCourts([]);
        setLocalTournament(null);
      }
      return;
    }

    const hydrateDefensiveData = async () => {
      // 1. Hydrate Events if parent did not provide valid events
      if (!propEvents || propEvents.length === 0) {
        setIsLoadingEvents(true);
        try {
          const fetchedEvents = await tournamentService.getEventsByTournamentId(resolvedTournamentId);
          if (isMounted) {
            setLocalEvents(fetchedEvents.map(e => ({ id: e.id, name: e.name })));
          }
        } catch (err) {
          console.warn('Defensive event hydration error:', err);
          if (isMounted) setLocalEvents([]);
        } finally {
          if (isMounted) setIsLoadingEvents(false);
        }
      }

      // 2. Hydrate Courts if parent did not provide valid courts
      if (!propCourts || propCourts.length === 0) {
        setIsLoadingCourts(true);
        try {
          const fetchedCourts = await tournamentService.getCourts(resolvedTournamentId);
          if (isMounted) {
            setLocalCourts(fetchedCourts || []);
          }
        } catch (err) {
          console.warn('Defensive court hydration error:', err);
          if (isMounted) setLocalCourts([]);
        } finally {
          if (isMounted) setIsLoadingCourts(false);
        }
      }

      // 3. Hydrate Tournament Object if parent did not provide it
      if (!propTournament) {
        try {
          const tournaments = await tournamentService.getTournaments();
          const found = tournaments.find(t => t.id === resolvedTournamentId);
          if (isMounted && found) {
            setLocalTournament(found);
          }
        } catch (err) {
          console.warn('Defensive tournament hydration error:', err);
        }
      }
    };

    hydrateDefensiveData();

    return () => {
      isMounted = false;
    };
  }, [isOpen, resolvedTournamentId, propEvents, propCourts, propTournament]);

  // Accessible Focus Management & Escape key listener
  useEffect(() => {
    if (isOpen) {
      triggerElementRef.current = document.activeElement as HTMLElement | null;
      modalContainerRef.current?.focus();

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          onClose();
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        if (triggerElementRef.current && typeof triggerElementRef.current.focus === 'function') {
          triggerElementRef.current.focus();
        }
      };
    }
  }, [isOpen, onClose]);

  // Mode state
  const [delegationMode, setDelegationMode] = useState<DelegationMode>('SINGLE');

  // Selection states (Single mode)
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<EventRole>('TABLE_OFFICIAL');
  const [selectedCourtId, setSelectedCourtId] = useState<string>('');

  // Search & Candidates
  const [candidateQuery, setCandidateQuery] = useState<string>('');
  const [candidates, setCandidates] = useState<Array<{ id: string; full_name: string; email: string }>>([]);
  const [isLoadingCandidates, setIsLoadingCandidates] = useState<boolean>(false);

  // Active Assignments
  const [assignments, setAssignments] = useState<EventAssignment[]>([]);
  const [isLoadingAssignments, setIsLoadingAssignments] = useState<boolean>(false);

  // Batch Shift Rotation State
  const [rotationSelections, setRotationSelections] = useState<Record<string, { enabled: boolean; incomingUserId: string }>>({});
  const [isRotatingBatch, setIsRotatingBatch] = useState<boolean>(false);

  // Shift Lifecycle & Reconciliation State (P7-03D)
  const [selectedShiftEndIds, setSelectedShiftEndIds] = useState<string[]>([]);
  const [endingShiftId, setEndingShiftId] = useState<string | null>(null);
  const [isBatchEndingShifts, setIsBatchEndingShifts] = useState<boolean>(false);
  const [isReconciling, setIsReconciling] = useState<boolean>(false);

  // Operation state
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Sync selectedEventId whenever effectiveEvents change or load
  useEffect(() => {
    if (effectiveEvents.length > 0) {
      const exists = effectiveEvents.some(e => e.id === selectedEventId);
      if (!selectedEventId || !exists) {
        setSelectedEventId(effectiveEvents[0].id);
      }
    } else if (!isLoadingEvents) {
      setSelectedEventId('');
    }
  }, [effectiveEvents, selectedEventId, isLoadingEvents]);

  // Sync selectedCourtId whenever effectiveCourts change or load
  useEffect(() => {
    if (effectiveCourts.length > 0) {
      const exists = effectiveCourts.some(c => c.id === selectedCourtId);
      if (!selectedCourtId || !exists) {
        setSelectedCourtId(effectiveCourts[0].id);
      }
    } else if (!isLoadingCourts) {
      setSelectedCourtId('');
    }
  }, [effectiveCourts, selectedCourtId, isLoadingCourts]);

  // Load candidate users
  const loadCandidates = useCallback(async (query: string = '') => {
    setIsLoadingCandidates(true);
    try {
      const results = await eventAssignmentService.searchCandidateUsers(query);
      setCandidates(results);
    } catch (err) {
      console.warn('Failed to load candidate profiles:', err);
    } finally {
      setIsLoadingCandidates(false);
    }
  }, []);

  // Load active event assignments
  const loadAssignments = useCallback(async (eventId: string) => {
    if (!eventId) return;
    setIsLoadingAssignments(true);
    try {
      const data = await eventAssignmentService.fetchEventAssignments(eventId);
      setAssignments(data);
    } catch (err: any) {
      console.warn('Failed to load event assignments:', err);
    } finally {
      setIsLoadingAssignments(false);
    }
  }, []);

  // Hydrate on modal open / event change
  useEffect(() => {
    if (isOpen) {
      loadCandidates(candidateQuery);
      if (selectedEventId) {
        loadAssignments(selectedEventId);
      }
    }
  }, [isOpen, selectedEventId, loadCandidates, loadAssignments, candidateQuery]);

  // Active court assignments for batch rotation
  const activeCourtTableOfficials = useMemo(() => {
    return assignments.filter(a => a.is_active && a.role === 'TABLE_OFFICIAL' && a.court_id);
  }, [assignments]);

  const enabledRotations = useMemo(() => {
    return activeCourtTableOfficials
      .filter(asgn => asgn.court_id && rotationSelections[asgn.court_id]?.enabled)
      .map(asgn => {
        const courtId = asgn.court_id!;
        const courtObj = effectiveCourts.find(c => c.id === courtId);
        return {
          courtId,
          assignmentId: asgn.id,
          outgoingUserId: asgn.user_id,
          incomingUserId: rotationSelections[courtId]?.incomingUserId || '',
          courtName: courtObj?.name || asgn.court_name || `Court ${(courtObj as any)?.court_number || (courtObj as any)?.court_identifier || courtId.slice(0, 8)}`,
          outgoingName: asgn.user_full_name || asgn.user_email || 'Table Official',
          outgoingEmail: asgn.user_email || asgn.user_id,
        };
      });
  }, [activeCourtTableOfficials, rotationSelections, effectiveCourts]);

  const handleToggleCourtRotation = (courtId: string) => {
    setRotationSelections(prev => {
      const current = prev[courtId] || { enabled: false, incomingUserId: '' };
      return {
        ...prev,
        [courtId]: { ...current, enabled: !current.enabled }
      };
    });
  };

  const handleSelectAllCourts = (selectAll: boolean) => {
    setRotationSelections(prev => {
      const next: Record<string, { enabled: boolean; incomingUserId: string }> = {};
      activeCourtTableOfficials.forEach(asgn => {
        if (asgn.court_id) {
          next[asgn.court_id] = {
            enabled: selectAll,
            incomingUserId: prev[asgn.court_id]?.incomingUserId || ''
          };
        }
      });
      return next;
    });
  };

  const handleSetIncomingOfficial = (courtId: string, incomingUserId: string) => {
    setRotationSelections(prev => {
      const current = prev[courtId] || { enabled: true, incomingUserId: '' };
      return {
        ...prev,
        [courtId]: { ...current, incomingUserId, enabled: true }
      };
    });
  };

  const handleBatchRotateSubmit = async () => {
    if (isRotatingBatch || enabledRotations.length === 0) return;

    setErrorMessage(null);
    setSuccessMessage(null);

    // Validation
    const missingIncoming = enabledRotations.find(r => !r.incomingUserId);
    if (missingIncoming) {
      setErrorMessage(`Please select an incoming Table Official for ${missingIncoming.courtName}.`);
      return;
    }

    const selfRotation = enabledRotations.find(r => r.incomingUserId === r.outgoingUserId);
    if (selfRotation) {
      setErrorMessage(`Incoming official cannot be identical to the outgoing official on ${selfRotation.courtName}.`);
      return;
    }

    const incomingIds = enabledRotations.map(r => r.incomingUserId);
    const duplicates = incomingIds.filter((id, idx) => incomingIds.indexOf(id) !== idx);
    if (duplicates.length > 0) {
      setErrorMessage('Duplicate incoming official detected: An official cannot be assigned to multiple courts in the same batch.');
      return;
    }

    setIsRotatingBatch(true);
    try {
      const payload: BatchRotationItem[] = enabledRotations.map(r => ({
        court_id: r.courtId,
        outgoing_assignment_id: r.assignmentId,
        outgoing_user_id: r.outgoingUserId,
        incoming_user_id: r.incomingUserId,
      }));

      const res = await eventAssignmentService.batchRotateOfficials(selectedEventId, payload);
      setSuccessMessage(`Atomic Shift Rotation Successful: Rotated ${res.rotated_count} court table official${res.rotated_count > 1 ? 's' : ''} in a single atomic transaction.`);
      
      // Clear rotation selections
      setRotationSelections({});
      // Reload assignments
      await loadAssignments(selectedEventId);
      if (onAssignmentChanged) {
        onAssignmentChanged();
      }
    } catch (err: any) {
      setErrorMessage(formatRpcError(err));
    } finally {
      setIsRotatingBatch(false);
    }
  };

  // P7-03D Shift Lifecycle Handlers
  const handleToggleShiftEndSelection = (assignmentId: string) => {
    setSelectedShiftEndIds(prev =>
      prev.includes(assignmentId)
        ? prev.filter(id => id !== assignmentId)
        : [...prev, assignmentId]
    );
  };

  const handleSelectAllShiftsToEnd = (selectAll: boolean) => {
    if (selectAll) {
      const activeIds = assignments.filter(a => a.is_active).map(a => a.id);
      setSelectedShiftEndIds(activeIds);
    } else {
      setSelectedShiftEndIds([]);
    }
  };

  const handleEndShift = async (assignmentId: string) => {
    if (endingShiftId) return;
    if (!confirm('Conclude official shift for this operational duty block?')) return;

    setErrorMessage(null);
    setSuccessMessage(null);
    setEndingShiftId(assignmentId);

    try {
      const res = await eventAssignmentService.endOfficialShift(assignmentId);
      setSuccessMessage(`Shift ended successfully at ${new Date(res.ended_at).toLocaleTimeString()}.`);
      setSelectedShiftEndIds(prev => prev.filter(id => id !== assignmentId));
      await loadAssignments(selectedEventId);
      if (onAssignmentChanged) {
        onAssignmentChanged();
      }
    } catch (err: any) {
      setErrorMessage(formatRpcError(err));
    } finally {
      setEndingShiftId(null);
    }
  };

  const handleBatchEndShifts = async () => {
    if (isBatchEndingShifts || selectedShiftEndIds.length === 0) return;
    if (!confirm(`Are you sure you want to end ${selectedShiftEndIds.length} official shift(s) in an atomic batch?`)) return;

    setErrorMessage(null);
    setSuccessMessage(null);
    setIsBatchEndingShifts(true);

    try {
      const res = await eventAssignmentService.batchEndShifts(selectedEventId, selectedShiftEndIds);
      setSuccessMessage(`Atomic Shift Conclusion Successful: Ended ${res.ended_count} official shift${res.ended_count > 1 ? 's' : ''}.`);
      setSelectedShiftEndIds([]);
      await loadAssignments(selectedEventId);
      if (onAssignmentChanged) {
        onAssignmentChanged();
      }
    } catch (err: any) {
      setErrorMessage(formatRpcError(err));
    } finally {
      setIsBatchEndingShifts(false);
    }
  };

  const handleReconcileAssignments = async () => {
    if (isReconciling || !selectedEventId) return;

    setErrorMessage(null);
    setSuccessMessage(null);
    setIsReconciling(true);

    try {
      const res = await eventAssignmentService.reconcileEventAssignments(selectedEventId);
      if (res.reconciled_count > 0) {
        setSuccessMessage(`Reconciliation Complete: Reconciled ${res.reconciled_count} stale/orphan assignment(s).`);
      } else {
        setSuccessMessage('Reconciliation Complete: No stale assignments detected. Database is in perfect synchronization.');
      }
      setSelectedShiftEndIds([]);
      await loadAssignments(selectedEventId);
      if (onAssignmentChanged) {
        onAssignmentChanged();
      }
    } catch (err: any) {
      setErrorMessage(formatRpcError(err));
    } finally {
      setIsReconciling(false);
    }
  };

  if (!isOpen) return null;

  // Handle Role Assignment
  const handleAssignRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setErrorMessage(null);
    setSuccessMessage(null);

    if (!selectedEventId) {
      setErrorMessage('Please select a competition event.');
      return;
    }
    if (!selectedUserId) {
      setErrorMessage('Please select an official candidate from the list.');
      return;
    }
    if (selectedRole === 'TABLE_OFFICIAL' && !selectedCourtId) {
      setErrorMessage('Please select a court for Table Official assignment.');
      return;
    }

    setIsSubmitting(true);
    try {
      const targetCourtId = selectedRole === 'TABLE_OFFICIAL' ? selectedCourtId : null;
      await eventAssignmentService.assignEventRole(
        selectedEventId,
        selectedUserId,
        selectedRole,
        targetCourtId
      );

      setSuccessMessage('Official role assigned successfully.');
      setSelectedUserId('');
      await loadAssignments(selectedEventId);
      if (onAssignmentChanged) {
        onAssignmentChanged();
      }
    } catch (err: any) {
      setErrorMessage(formatRpcError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Assignment Revocation
  const handleRevokeAssignment = async (assignmentId: string) => {
    if (revokingId) return;
    if (!confirm('Are you sure you want to revoke this operational assignment?')) return;

    setErrorMessage(null);
    setSuccessMessage(null);
    setRevokingId(assignmentId);

    try {
      await eventAssignmentService.revokeEventRole(assignmentId);
      setSuccessMessage('Official assignment revoked.');
      await loadAssignments(selectedEventId);
      if (onAssignmentChanged) {
        onAssignmentChanged();
      }
    } catch (err: any) {
      setErrorMessage(formatRpcError(err));
    } finally {
      setRevokingId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
      <div
        ref={modalContainerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="official-assignment-modal-title"
        className="bg-slate-900 border border-slate-700/80 rounded-xl sm:rounded-2xl w-full max-w-4xl max-h-[92vh] sm:max-h-[90vh] flex flex-col shadow-2xl overflow-hidden focus:outline-hidden"
      >
        
        {/* Header */}
        <div className="flex items-center justify-between px-3.5 sm:px-6 py-3 sm:py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="p-1.5 sm:p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 shrink-0">
              <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div>
              <h3 id="official-assignment-modal-title" className="text-sm sm:text-base font-bold text-slate-100 flex items-center gap-2">
                Manage Court Officials &amp; Event Delegation
              </h3>
              <p className="text-[11px] sm:text-xs text-slate-400">
                Tournament: <span className="text-slate-200 font-medium">{effectiveTournament?.name || 'UAAPHIL Tournament'}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-3.5 sm:p-6 space-y-4 sm:space-y-6">
          
          {/* Status Banners */}
          {errorMessage && (
            <div className="p-3 sm:p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Assignment Error</p>
                <p>{errorMessage}</p>
              </div>
            </div>
          )}

          {successMessage && (
            <div className="p-3 sm:p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <p>{successMessage}</p>
            </div>
          )}

          {/* Event Selector */}
          <div className="bg-slate-800/40 border border-slate-700/60 p-3 sm:p-4 rounded-xl space-y-1.5 sm:space-y-2">
            <label className="block text-[11px] sm:text-xs font-semibold text-slate-300 uppercase tracking-wider">
              1. Select Target Competition Event
            </label>
            <select
              value={selectedEventId}
              onChange={(e) => setSelectedEventId(e.target.value)}
              disabled={isLoadingEvents}
              className="w-full px-3 sm:px-3.5 py-2 sm:py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 text-xs sm:text-sm font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:opacity-50 min-h-[40px]"
            >
              {isLoadingEvents ? (
                <option value="">Loading events...</option>
              ) : effectiveEvents.length === 0 ? (
                <option value="">No competition events available in this tournament</option>
              ) : (
                effectiveEvents.map((evt) => (
                  <option key={evt.id} value={evt.id}>
                    {evt.name}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Delegation Mode Tabs */}
          <div className="flex border-b border-slate-800 gap-1.5 sm:gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => {
                setDelegationMode('SINGLE');
                setErrorMessage(null);
                setSuccessMessage(null);
              }}
              className={`px-3 sm:px-4 py-2 sm:py-2.5 text-xs font-bold rounded-t-xl transition-colors flex items-center gap-1.5 sm:gap-2 border-b-2 whitespace-nowrap min-h-[38px] ${
                delegationMode === 'SINGLE'
                  ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <UserCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span>Single Delegation</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setDelegationMode('BATCH_ROTATION');
                setErrorMessage(null);
                setSuccessMessage(null);
              }}
              className={`px-3 sm:px-4 py-2 sm:py-2.5 text-xs font-bold rounded-t-xl transition-colors flex items-center gap-1.5 sm:gap-2 border-b-2 whitespace-nowrap min-h-[38px] ${
                delegationMode === 'BATCH_ROTATION'
                  ? 'border-amber-500 text-amber-400 bg-amber-500/10'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <RefreshCw className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span>Atomic Shift Rotation (Batch)</span>
              {activeCourtTableOfficials.length > 0 && (
                <span className="px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] bg-amber-500/20 text-amber-300 font-mono font-bold">
                  {activeCourtTableOfficials.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setDelegationMode('SHIFT_LIFECYCLE');
                setErrorMessage(null);
                setSuccessMessage(null);
              }}
              className={`px-3 sm:px-4 py-2 sm:py-2.5 text-xs font-bold rounded-t-xl transition-colors flex items-center gap-1.5 sm:gap-2 border-b-2 whitespace-nowrap min-h-[38px] ${
                delegationMode === 'SHIFT_LIFECYCLE'
                  ? 'border-sky-500 text-sky-400 bg-sky-500/10'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span>Shift Lifecycle &amp; Stand-down</span>
              {assignments.filter(a => a.is_active).length > 0 && (
                <span className="px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] bg-sky-500/20 text-sky-300 font-mono font-bold">
                  {assignments.filter(a => a.is_active).length}
                </span>
              )}
            </button>
          </div>

          {/* Panel: Single Delegation */}
          {delegationMode === 'SINGLE' && (
            <form onSubmit={handleAssignRole} className="bg-slate-800/40 border border-slate-700/60 p-3.5 sm:p-5 rounded-xl space-y-3.5 sm:space-y-4">
              <div className="flex items-center justify-between border-b border-slate-700/60 pb-3">
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-indigo-400" />
                  2. Assign New Operational Official
                </h4>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 sm:gap-4">
                
                {/* Candidate Search & Select */}
                <div className="md:col-span-1 space-y-2">
                  <label className="block text-xs font-medium text-slate-300">
                    Official Candidate *
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search candidate name / email..."
                      value={candidateQuery}
                      onChange={(e) => {
                        setCandidateQuery(e.target.value);
                        loadCandidates(e.target.value);
                      }}
                      className="w-full pl-8 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-3" />
                  </div>

                  <div className="max-h-36 overflow-y-auto border border-slate-700 rounded-lg bg-slate-900 divide-y divide-slate-800">
                    {isLoadingCandidates ? (
                      <div className="p-3 text-center text-xs text-slate-500">Searching candidates...</div>
                    ) : candidates.length === 0 ? (
                      <div className="p-3 text-center text-xs text-slate-500">No matching active profiles</div>
                    ) : (
                      candidates.map((cand) => (
                        <button
                          type="button"
                          key={cand.id}
                          onClick={() => setSelectedUserId(cand.id)}
                          className={`w-full text-left px-3 py-2 text-xs transition-colors flex flex-col ${
                            selectedUserId === cand.id
                              ? 'bg-indigo-600/30 text-indigo-200 border-l-2 border-indigo-500'
                              : 'hover:bg-slate-800 text-slate-300'
                          }`}
                        >
                          <span className="font-semibold truncate">{cand.full_name || 'Unnamed User'}</span>
                          <span className="text-[11px] text-slate-400 truncate">{cand.email}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                {/* Role Selection */}
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-slate-300">
                    Operational Role *
                  </label>
                  <div className="space-y-2">
                    <label
                      className={`flex items-center gap-2.5 p-3 rounded-lg border cursor-pointer text-xs transition-colors ${
                        selectedRole === 'TABLE_OFFICIAL'
                          ? 'bg-indigo-600/20 border-indigo-500 text-slate-100'
                          : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <input
                        type="radio"
                        name="role_choice"
                        value="TABLE_OFFICIAL"
                        checked={selectedRole === 'TABLE_OFFICIAL'}
                        onChange={() => setSelectedRole('TABLE_OFFICIAL')}
                        className="text-indigo-600 focus:ring-0"
                      />
                      <div>
                        <div className="font-semibold">Table Official</div>
                        <div className="text-[10px] text-slate-400">Scores & operates designated court</div>
                      </div>
                    </label>

                    <label
                      className={`flex items-center gap-2.5 p-3 rounded-lg border cursor-pointer text-xs transition-colors ${
                        !isSuperOrOrganizer
                          ? 'opacity-50 cursor-not-allowed bg-slate-900/50 border-slate-800 text-slate-500'
                          : selectedRole === 'COURT_MANAGER'
                          ? 'bg-indigo-600/20 border-indigo-500 text-slate-100'
                          : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <input
                        type="radio"
                        name="role_choice"
                        value="COURT_MANAGER"
                        disabled={!isSuperOrOrganizer}
                        checked={selectedRole === 'COURT_MANAGER'}
                        onChange={() => isSuperOrOrganizer && setSelectedRole('COURT_MANAGER')}
                        className="text-indigo-600 focus:ring-0"
                      />
                      <div>
                        <div className="font-semibold flex items-center gap-1.5">
                          Court Manager
                          {!isSuperOrOrganizer && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                              Admin Only
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400">Manages dispatch & table officials</div>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Court Selection (Only for Table Official) */}
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-slate-300">
                    Target Court {selectedRole === 'TABLE_OFFICIAL' ? '*' : '(Not required)'}
                  </label>
                  {selectedRole === 'COURT_MANAGER' ? (
                    <div className="p-3 bg-slate-900/60 border border-dashed border-slate-700 rounded-lg text-xs text-slate-400">
                      Court Managers have event-wide scope across all courts.
                    </div>
                  ) : (
                    <select
                      value={selectedCourtId}
                      onChange={(e) => setSelectedCourtId(e.target.value)}
                      disabled={isLoadingCourts}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:opacity-50"
                    >
                      {isLoadingCourts ? (
                        <option value="">Loading courts...</option>
                      ) : effectiveCourts.length === 0 ? (
                        <option value="">No courts configured</option>
                      ) : (
                        effectiveCourts.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name || `Court ${(c as any).court_number || (c as any).court_identifier || c.id.slice(0, 8)}`}
                          </option>
                        ))
                      )}
                    </select>
                  )}

                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={isSubmitting || !selectedUserId || (selectedRole === 'TABLE_OFFICIAL' && !selectedCourtId)}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow-sm transition-colors"
                    >
                      {isSubmitting ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          Assigning...
                        </>
                      ) : (
                        <>
                          <Plus className="w-3.5 h-3.5" />
                          Confirm Role Assignment
                        </>
                      )}
                    </button>
                  </div>
                </div>

              </div>
            </form>
          )}

          {/* Panel: Batch Shift Rotation */}
          {delegationMode === 'BATCH_ROTATION' && (
            <div className="bg-slate-800/40 border border-slate-700/60 p-3.5 sm:p-5 rounded-xl space-y-3.5 sm:space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-700/60 pb-3">
                <div>
                  <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 text-amber-400" />
                    Atomic Table Official Shift Rotation
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Atomically rotate Table Officials across multiple courts in a single authoritative transaction.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleSelectAllCourts(true)}
                    className="px-2.5 py-1 text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 rounded-lg transition-colors"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectAllCourts(false)}
                    className="px-2.5 py-1 text-[11px] font-semibold text-slate-400 hover:text-slate-300 bg-slate-800 border border-slate-700 rounded-lg transition-colors"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* Invariant & Safety Notice */}
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-2.5">
                <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">INV-08 Active Bout Concurrency Guard</p>
                  <p className="text-[11px] text-amber-300/80">
                    The rotation executes as an atomic all-or-nothing transaction. If ANY selected court has a match actively scoring (LIVE status), PostgreSQL will reject the entire batch to preserve scoring integrity.
                  </p>
                </div>
              </div>

              {/* Candidate Search / Filter bar */}
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <input
                    type="text"
                    placeholder="Filter candidate officials list..."
                    value={candidateQuery}
                    onChange={(e) => {
                      setCandidateQuery(e.target.value);
                      loadCandidates(e.target.value);
                    }}
                    className="w-full pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
                </div>
                <span className="text-[11px] text-slate-400 shrink-0">
                  {candidates.length} active candidate profile{candidates.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Active Courts Rotation Matrix */}
              {activeCourtTableOfficials.length === 0 ? (
                <div className="p-6 bg-slate-900/40 border border-dashed border-slate-700 rounded-xl text-center space-y-2">
                  <Users className="w-8 h-8 text-slate-600 mx-auto" />
                  <p className="text-xs font-semibold text-slate-300">No Active Table Officials on Courts</p>
                  <p className="text-[11px] text-slate-500 max-w-md mx-auto">
                    There are currently no active Table Officials assigned to individual courts for this event. Use Single Delegation mode above to create court assignments first before performing a shift rotation.
                  </p>
                </div>
              ) : (
                <div className="border border-slate-700/80 rounded-xl overflow-hidden bg-slate-900/60 divide-y divide-slate-800">
                  {activeCourtTableOfficials.map((asgn) => {
                    const courtId = asgn.court_id!;
                    const courtObj = effectiveCourts.find(c => c.id === courtId);
                    const isSelected = !!rotationSelections[courtId]?.enabled;
                    const incomingUserId = rotationSelections[courtId]?.incomingUserId || '';
                    const courtName = courtObj?.name || asgn.court_name || `Court ${(courtObj as any)?.court_number || (courtObj as any)?.court_identifier || courtId.slice(0, 8)}`;

                    return (
                      <div
                        key={asgn.id}
                        className={`p-3 sm:p-4 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4 ${
                          isSelected ? 'bg-amber-500/5' : 'hover:bg-slate-800/30'
                        }`}
                      >
                        {/* Checkbox and Court Info */}
                        <div className="flex items-center gap-3 min-w-[200px]">
                          <input
                            type="checkbox"
                            id={`court-rot-${courtId}`}
                            checked={isSelected}
                            onChange={() => handleToggleCourtRotation(courtId)}
                            className="w-4 h-4 rounded border-slate-700 text-amber-500 focus:ring-amber-500/20 bg-slate-900 cursor-pointer"
                          />
                          <label htmlFor={`court-rot-${courtId}`} className="cursor-pointer">
                            <div className="font-bold text-xs text-slate-100 flex items-center gap-1.5">
                              <Layers className="w-3.5 h-3.5 text-amber-400" />
                              {courtName}
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono">
                              ID: {courtId.slice(0, 8)}...
                            </div>
                          </label>
                        </div>

                        {/* Current Outgoing Official */}
                        <div className="flex-1 min-w-[220px] bg-slate-950/40 p-2.5 rounded-lg border border-slate-800/80">
                          <div className="text-[10px] font-semibold uppercase text-slate-500 flex items-center justify-between">
                            <span>Current Official (Outgoing)</span>
                            <span className="text-[9px] text-rose-400 font-mono font-medium">To be rotated</span>
                          </div>
                          <div className="font-semibold text-xs text-slate-200 truncate mt-0.5">
                            {asgn.user_full_name || 'Official Profile'}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono truncate">
                            {asgn.user_email || asgn.user_id}
                          </div>
                        </div>

                        {/* Arrow Indicator */}
                        <div className="hidden md:flex items-center justify-center text-slate-500">
                          <ArrowRight className="w-4 h-4" />
                        </div>

                        {/* Incoming Official Selection */}
                        <div className="flex-1 min-w-[240px]">
                          <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">
                            Incoming Official *
                          </label>
                          <select
                            value={incomingUserId}
                            disabled={!isSelected}
                            onChange={(e) => handleSetIncomingOfficial(courtId, e.target.value)}
                            className={`w-full px-3 py-2 bg-slate-900 border rounded-lg text-xs font-medium focus:ring-2 focus:ring-amber-500 focus:outline-none ${
                              !isSelected
                                ? 'opacity-40 border-slate-800 text-slate-500 cursor-not-allowed'
                                : !incomingUserId
                                ? 'border-amber-500/50 text-slate-300'
                                : 'border-emerald-500/50 text-emerald-200'
                            }`}
                          >
                            <option value="">-- Select Incoming Official --</option>
                            {candidates.map((cand) => {
                              const isSelf = cand.id === asgn.user_id;
                              const isSelectedElsewhere = enabledRotations.some(
                                r => r.courtId !== courtId && r.incomingUserId === cand.id
                              );

                              return (
                                <option
                                  key={cand.id}
                                  value={cand.id}
                                  disabled={isSelf || isSelectedElsewhere}
                                >
                                  {cand.full_name || cand.email} {isSelf ? '(Current Official)' : isSelectedElsewhere ? '(Selected on another court)' : `(${cand.email})`}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Batch Action Submit Bar */}
              {activeCourtTableOfficials.length > 0 && (
                <div className="p-3 sm:p-4 bg-slate-900 border border-slate-700/80 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
                  <div className="space-y-1">
                    <div className="text-xs font-bold text-slate-200 flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                      {enabledRotations.length} Court{enabledRotations.length !== 1 ? 's' : ''} Configured for Atomic Rotation
                    </div>
                    <p className="text-[11px] text-slate-400">
                      One atomic RPC call to <code className="text-amber-300 font-mono text-[10px]">public.batch_rotate_officials</code>
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleBatchRotateSubmit}
                    disabled={isRotatingBatch || enabledRotations.length === 0 || enabledRotations.some(r => !r.incomingUserId)}
                    className="inline-flex items-center justify-center gap-2 px-4 sm:px-5 py-2 sm:py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-slate-950 font-bold text-xs rounded-xl shadow-lg transition-all cursor-pointer disabled:cursor-not-allowed min-h-[38px]"
                  >
                    {isRotatingBatch ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
                        Executing Atomic Shift Rotation...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4 text-slate-950" />
                        Execute Batch Shift Rotation ({enabledRotations.length})
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Panel: Shift Lifecycle & Reconciliation (P7-03D) */}
          {delegationMode === 'SHIFT_LIFECYCLE' && (
            <div className="bg-slate-800/40 border border-slate-700/60 p-3.5 sm:p-5 rounded-xl space-y-3.5 sm:space-y-5">
              
              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-700/60 pb-3">
                <div>
                  <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                    <Clock className="w-4 h-4 text-sky-400" />
                    Shift Lifecycle & Stand-down Center
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Conclude official duty blocks, execute session stand-down, or reconcile stale lingering assignments.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleReconcileAssignments}
                    disabled={isReconciling || !selectedEventId}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <Sparkles className={`w-3.5 h-3.5 ${isReconciling ? 'animate-spin' : ''}`} />
                    {isReconciling ? 'Reconciling...' : 'Reconcile Stale Shifts'}
                  </button>
                </div>
              </div>

              {/* Safety banner */}
              <div className="p-3 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-200 text-xs flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">INV-08 Active Bout Guard & Non-Destructive Lifecycle</p>
                  <p className="text-[11px] text-sky-300/80">
                    Concluding shifts preserves complete audit logs in <code className="font-mono text-[10px] text-sky-200">system_audit_logs</code>. If a Table Official's court currently has an active LIVE match, PostgreSQL will fail closed to protect scoring integrity.
                  </p>
                </div>
              </div>

              {/* Multi-Select Session Stand-down Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-slate-200 flex items-center gap-2">
                    <span>Batch Session Stand-down</span>
                    {selectedShiftEndIds.length > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-sky-500/20 text-sky-300 font-mono font-bold">
                        {selectedShiftEndIds.length} selected
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleSelectAllShiftsToEnd(true)}
                      className="px-2.5 py-1 text-[11px] font-semibold text-sky-400 hover:text-sky-300 bg-sky-500/10 border border-sky-500/20 rounded-lg transition-colors"
                    >
                      Select All Active
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectAllShiftsToEnd(false)}
                      className="px-2.5 py-1 text-[11px] font-semibold text-slate-400 hover:text-slate-300 bg-slate-800 border border-slate-700 rounded-lg transition-colors"
                    >
                      Clear Selection
                    </button>
                  </div>
                </div>

                {assignments.filter(a => a.is_active).length === 0 ? (
                  <div className="p-6 bg-slate-900/40 border border-dashed border-slate-700 rounded-xl text-center space-y-2">
                    <Users className="w-8 h-8 text-slate-600 mx-auto" />
                    <p className="text-xs font-semibold text-slate-300">No Active Officials On Duty</p>
                    <p className="text-[11px] text-slate-500 max-w-md mx-auto">
                      All official shifts for this event have already concluded or no assignments have been created yet.
                    </p>
                  </div>
                ) : (
                  <div className="border border-slate-700/80 rounded-xl overflow-hidden bg-slate-900/60 divide-y divide-slate-800">
                    {assignments.filter(a => a.is_active).map((asgn) => {
                      const courtObj = effectiveCourts.find(c => c.id === asgn.court_id);
                      const isSelected = selectedShiftEndIds.includes(asgn.id);
                      const courtName = asgn.role === 'COURT_MANAGER'
                        ? 'Event-Wide (All Courts)'
                        : (courtObj?.name || asgn.court_name || `Court ${(courtObj as any)?.court_number || (courtObj as any)?.court_identifier || asgn.court_id?.slice(0, 8)}`);

                      return (
                        <div
                          key={asgn.id}
                          className={`p-3 sm:p-3.5 transition-colors flex items-center justify-between gap-2.5 sm:gap-4 ${
                            isSelected ? 'bg-sky-500/5' : 'hover:bg-slate-800/30'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              id={`shift-end-${asgn.id}`}
                              checked={isSelected}
                              onChange={() => handleToggleShiftEndSelection(asgn.id)}
                              className="w-4 h-4 rounded border-slate-700 text-sky-500 focus:ring-sky-500/20 bg-slate-900 cursor-pointer"
                            />
                            <label htmlFor={`shift-end-${asgn.id}`} className="cursor-pointer">
                              <div className="font-semibold text-xs text-slate-100">
                                {asgn.user_full_name || 'Official Profile'}
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono">
                                {asgn.user_email || asgn.user_id}
                              </div>
                            </label>
                          </div>

                          <div className="flex items-center gap-2 sm:gap-3">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                                asgn.role === 'COURT_MANAGER'
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                  : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                              }`}
                            >
                              {asgn.role === 'COURT_MANAGER' ? 'Court Manager' : 'Table Official'}
                            </span>
                            <span className="text-xs text-slate-300 font-medium hidden sm:inline">
                              {courtName}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleEndShift(asgn.id)}
                              disabled={endingShiftId === asgn.id}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-sky-400 hover:text-sky-200 hover:bg-sky-500/20 rounded border border-sky-500/30 transition-colors disabled:opacity-50"
                            >
                              <Clock className="w-3 h-3" />
                              {endingShiftId === asgn.id ? 'Ending...' : 'End Shift'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Batch End Submit */}
                {assignments.filter(a => a.is_active).length > 0 && (
                  <div className="p-3 sm:p-4 bg-slate-900 border border-slate-700/80 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
                    <div className="space-y-1">
                      <div className="text-xs font-bold text-slate-200 flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-sky-400" />
                        {selectedShiftEndIds.length} Official Shift{selectedShiftEndIds.length !== 1 ? 's' : ''} Selected for Conclusion
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Atomic transaction via <code className="text-sky-300 font-mono text-[10px]">public.batch_end_official_shifts</code>
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleBatchEndShifts}
                      disabled={isBatchEndingShifts || selectedShiftEndIds.length === 0}
                      className="inline-flex items-center justify-center gap-2 px-4 sm:px-5 py-2 sm:py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-lg transition-all cursor-pointer disabled:cursor-not-allowed min-h-[38px]"
                    >
                      {isBatchEndingShifts ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Concluding Shifts...
                        </>
                      ) : (
                        <>
                          <Clock className="w-4 h-4" />
                          Execute Batch Stand-down ({selectedShiftEndIds.length})
                        </>
                      )}
                    </button>
                  </div>
                )}

              </div>

            </div>
          )}

          {/* Active Assignments Table */}
          <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl overflow-hidden">
            <div className="px-3.5 sm:px-5 py-2.5 sm:py-3 border-b border-slate-700/60 flex items-center justify-between bg-slate-900/40">
              <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <Users className="w-4 h-4 text-slate-400" />
                Active Event Assignments ({assignments.filter(a => a.is_active).length})
              </h4>
              <button
                type="button"
                onClick={() => loadAssignments(selectedEventId)}
                disabled={isLoadingAssignments}
                className="p-1 text-slate-400 hover:text-slate-200 rounded"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingAssignments ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-900 text-[11px] uppercase text-slate-400 tracking-wider">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Official</th>
                    <th className="px-4 py-2.5 font-semibold">Role</th>
                    <th className="px-4 py-2.5 font-semibold">Court Scope</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {isLoadingAssignments ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                        Loading assignments...
                      </td>
                    </tr>
                  ) : assignments.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                        No officials assigned to this event yet.
                      </td>
                    </tr>
                  ) : (
                    assignments.map((asgn) => {
                      const courtObj = effectiveCourts.find(c => c.id === asgn.court_id);
                      const courtLabel = asgn.role === 'COURT_MANAGER' 
                        ? 'Event-Wide (All Courts)' 
                        : (courtObj?.name || asgn.court_name || 'Designated Court');
                      const opContext = getAssignmentOperationalContext(asgn);

                      return (
                        <tr key={asgn.id} className={!asgn.is_active ? 'opacity-50 bg-slate-950/20' : ''}>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-100">
                              {asgn.user_full_name || 'Official Profile'}
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono">
                              {asgn.user_email || asgn.user_id}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="space-y-1">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                                  asgn.role === 'COURT_MANAGER'
                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                    : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                                }`}
                              >
                                {asgn.role === 'COURT_MANAGER' ? 'Court Manager' : 'Table Official'}
                              </span>
                              <div className="text-[10px] text-slate-400 font-medium flex items-center gap-1">
                                <Radio className="w-2.5 h-2.5 text-slate-500 shrink-0" />
                                {opContext.primaryTitle}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 font-medium text-slate-200">
                            <span className="inline-flex items-center gap-1">
                              <Layers className="w-3 h-3 text-slate-400" />
                              {courtLabel}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {asgn.is_active ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-300">
                                Active
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-500">
                                Revoked
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {asgn.is_active && (
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleEndShift(asgn.id)}
                                  disabled={endingShiftId === asgn.id || revokingId === asgn.id}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-sky-400 hover:text-sky-200 hover:bg-sky-500/20 rounded border border-sky-500/30 transition-colors disabled:opacity-50"
                                >
                                  <Clock className="w-3 h-3" />
                                  {endingShiftId === asgn.id ? 'Ending...' : 'End Shift'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRevokeAssignment(asgn.id)}
                                  disabled={revokingId === asgn.id || endingShiftId === asgn.id}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-rose-400 hover:text-rose-200 hover:bg-rose-500/20 rounded border border-rose-500/30 transition-colors disabled:opacity-50"
                                >
                                  <UserX className="w-3 h-3" />
                                  {revokingId === asgn.id ? 'Revoking...' : 'Revoke'}
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-3.5 sm:px-6 py-2.5 sm:py-3.5 border-t border-slate-800 bg-slate-950/50 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
};
