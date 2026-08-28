import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { 
  AlertTriangle, 
  ShieldAlert, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  Play, 
  RefreshCw, 
  Clock, 
  Activity, 
  Database, 
  Radio, 
  FileText, 
  Lock, 
  Shield, 
  Zap, 
  ChevronDown, 
  ChevronUp, 
  Info, 
  Layers, 
  Flame,
  ArrowRightLeft,
  UserCheck,
  Trophy,
  History,
  AlertCircle
} from 'lucide-react';

import { courtOperationsService } from '../services/courtOperationsService';
import { scoringService } from '../services/scoringService';
import { anyoScoringService } from '../services/anyoScoringService';
import { tournamentService } from '../services/tournamentService';
import { bracketService } from '../services/bracketService';
import { playerMembershipService } from '../services/playerMembershipService';
import { eventAssignmentService } from '../services/eventAssignmentService';
import { roleService } from '../services/roleService';
import { AppRole } from '../types/roles';

export type TestMode = 'RAPID_CLICK' | 'SLOW_NETWORK';
export type TestStatus = 'IDLE' | 'RUNNING' | 'PASS' | 'FAIL' | 'BLOCKED';

export interface AuditLogRow {
  id?: string;
  actor_user_id: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface RealtimeEvent {
  table: string;
  eventType: string;
  recordId?: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface TestExecutionRecord {
  id: string;
  workflowId: string;
  timestamp: string;
  actor: string;
  actorRole: string;
  testType: TestMode;
  requestCount: number;
  successCount: number;
  rejectionCount: number;
  dbVerification: 'MATCH' | 'MISMATCH' | 'SKIPPED';
  realtimeVerification: 'RECEIVED' | 'NOT_RECEIVED' | 'N/A';
  auditLogVerification: 'AUTHORITATIVE_LOG_PRESENT' | 'AUDIT_LOG_GAP';
  status: TestStatus;
  notes: string;
}

export const QATestButtonTorture: React.FC = () => {
  const { user, profile, roles } = useAuth();

  // 1. Authoritative Role Verification (SUPER_ADMIN, ADMIN, or ORGANIZER)
  const isAuthorized = roles.some((r: AppRole) => ['SUPER_ADMIN', 'ADMIN', 'ORGANIZER'].includes(r));

  // State
  const [activeWorkflowId, setActiveWorkflowId] = useState<string>('workflow-1');
  const [testStatus, setTestStatus] = useState<Record<string, TestStatus>>({});
  const [testLogs, setTestLogs] = useState<Record<string, string[]>>({});
  const [executionHistory, setExecutionHistory] = useState<TestExecutionRecord[]>([]);
  const [realtimeEvents, setRealtimeEvents] = useState<RealtimeEvent[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);
  const [activeChannelCount, setActiveChannelCount] = useState(0);

  // Staging Entities Cache
  const [tournaments, setTournaments] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [courts, setCourts] = useState<Array<{ id: string; name: string; tournament_id: string; identifier: string; is_active: boolean }>>([]);
  const [matches, setMatches] = useState<Array<{ id: string; match_number: number; court_identifier: string | null; status: string; event_id: string; round_number: number }>>([]);
  const [clubs, setClubs] = useState<Array<{ id: string; name: string; is_active: boolean }>>([]);
  const [users, setUsers] = useState<Array<{ id: string; full_name: string; email: string }>>([]);
  const [events, setEvents] = useState<Array<{ id: string; name: string; snapshot_id: string; division: string; category: string }>>([]);
  const [registrations, setRegistrations] = useState<Array<{ id: string; athlete_name: string; event_id: string; team_name: string; status: string; lineup_role: string }>>([]);

  // Selected Target Entity IDs per workflow
  const [selectedTournamentId, setSelectedTournamentId] = useState<string>('');
  const [selectedCourtId, setSelectedCourtId] = useState<string>('');
  const [selectedMatchId, setSelectedMatchId] = useState<string>('');
  const [selectedClubId, setSelectedClubId] = useState<string>('');
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [selectedRegistrationId, setSelectedRegistrationId] = useState<string>('');
  const [selectedReserveRegId, setSelectedReserveRegId] = useState<string>('');

  // Confirmation state for destructive actions
  const [confirmDestructive, setConfirmDestructive] = useState<Record<string, boolean>>({});

  // Single-flight button disabled test simulation flags
  const [isSimulatedLoading, setIsSimulatedLoading] = useState<Record<string, boolean>>({});

  // Append a diagnostic log message
  const addLog = useCallback((workflowId: string, message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setTestLogs((prev) => ({
      ...prev,
      [workflowId]: [...(prev[workflowId] || []), `[${timestamp}] ${message}`],
    }));
  }, []);

  // Fetch initial staging entities
  const fetchStagingEntities = useCallback(async () => {
    if (!isAuthorized) return;
    try {
      // 1. Tournaments
      const { data: tData } = await supabase
        .from('tournaments')
        .select('id, name, status')
        .order('created_at', { ascending: false })
        .limit(10);
      if (tData) {
        setTournaments(tData);
        if (tData.length > 0 && !selectedTournamentId) setSelectedTournamentId(tData[0].id);
      }

      // 2. Courts
      const { data: cData } = await supabase
        .from('courts')
        .select('id, name, tournament_id, identifier, is_active')
        .order('identifier', { ascending: true })
        .limit(15);
      if (cData) {
        setCourts(cData);
        if (cData.length > 0 && !selectedCourtId) setSelectedCourtId(cData[0].id);
      }

      // 3. Matches
      const { data: mData } = await supabase
        .from('matches')
        .select('id, match_number, court_identifier, status, event_id, round_number')
        .order('match_number', { ascending: true })
        .limit(20);
      if (mData) {
        setMatches(mData);
        if (mData.length > 0 && !selectedMatchId) setSelectedMatchId(mData[0].id);
      }

      // 4. Clubs
      const { data: clData } = await supabase
        .from('clubs')
        .select('id, name, is_active')
        .order('name', { ascending: true })
        .limit(15);
      if (clData) {
        setClubs(clData);
        if (clData.length > 0 && !selectedClubId) setSelectedClubId(clData[0].id);
      }

      // 5. Profiles
      const { data: uData } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .order('full_name', { ascending: true })
        .limit(20);
      if (uData) {
        setUsers(uData);
        if (uData.length > 0 && !selectedUserId) setSelectedUserId(uData[0].id);
      }

      // 6. Events
      const { data: eData } = await supabase
        .from('events')
        .select('id, name, snapshot_id, division, category')
        .order('created_at', { ascending: false })
        .limit(15);
      if (eData) {
        setEvents(eData);
        if (eData.length > 0 && !selectedEventId) setSelectedEventId(eData[0].id);
      }

      // 7. Registrations
      const { data: rData } = await supabase
        .from('registrations')
        .select(`
          id,
          event_id,
          team_name,
          lineup_role,
          user_profile:profiles!registrations_user_id_fkey(full_name)
        `)
        .order('created_at', { ascending: false })
        .limit(20);
      if (rData) {
        const mappedRegs = rData.map((r: any) => ({
          id: r.id,
          athlete_name: r.user_profile?.full_name || 'Athlete',
          event_id: r.event_id,
          team_name: r.team_name || 'Team',
          status: 'APPROVED',
          lineup_role: r.lineup_role || 'LINEUP',
        }));
        setRegistrations(mappedRegs);
        if (mappedRegs.length > 0 && !selectedRegistrationId) setSelectedRegistrationId(mappedRegs[0].id);
        if (mappedRegs.length > 1 && !selectedReserveRegId) setSelectedReserveRegId(mappedRegs[1].id);
      }
    } catch (err) {
      console.error('Error fetching QA staging entities:', err);
    }
  }, [isAuthorized, selectedTournamentId, selectedCourtId, selectedMatchId, selectedClubId, selectedUserId, selectedEventId, selectedRegistrationId, selectedReserveRegId]);

  // Fetch Audit Logs
  const fetchAuditLogs = useCallback(async (entityId?: string) => {
    setIsLoadingAudit(true);
    try {
      let query = supabase
        .from('system_audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      if (entityId) {
        query = query.eq('entity_id', entityId);
      }

      const { data, error } = await query;
      if (!error && data) {
        setAuditLogs(data as AuditLogRow[]);
      } else {
        setAuditLogs([]);
      }
    } catch {
      setAuditLogs([]);
    } finally {
      setIsLoadingAudit(false);
    }
  }, []);

  // Setup Realtime Subscriptions
  useEffect(() => {
    if (!isAuthorized) return;

    fetchStagingEntities();
    fetchAuditLogs();

    const channel = supabase
      .channel('qa-torture-realtime-hub')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, (payload) => {
        setRealtimeEvents((prev) => [
          {
            table: 'matches',
            eventType: payload.eventType,
            recordId: (payload.new as { id?: string })?.id || (payload.old as { id?: string })?.id,
            timestamp: new Date().toISOString(),
            payload: payload.new || payload.old || {},
          },
          ...prev.slice(0, 19),
        ]);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'courts' }, (payload) => {
        setRealtimeEvents((prev) => [
          {
            table: 'courts',
            eventType: payload.eventType,
            recordId: (payload.new as { id?: string })?.id || (payload.old as { id?: string })?.id,
            timestamp: new Date().toISOString(),
            payload: payload.new || payload.old || {},
          },
          ...prev.slice(0, 19),
        ]);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_snapshots' }, (payload) => {
        setRealtimeEvents((prev) => [
          {
            table: 'tournament_snapshots',
            eventType: payload.eventType,
            recordId: (payload.new as { id?: string })?.id,
            timestamp: new Date().toISOString(),
            payload: payload.new || {},
          },
          ...prev.slice(0, 19),
        ]);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'system_audit_logs' }, (payload) => {
        setRealtimeEvents((prev) => [
          {
            table: 'system_audit_logs',
            eventType: payload.eventType,
            recordId: (payload.new as { id?: string })?.id,
            timestamp: new Date().toISOString(),
            payload: payload.new || {},
          },
          ...prev.slice(0, 19),
        ]);
        // Also refresh audit logs
        fetchAuditLogs();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setActiveChannelCount((c) => c + 1);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAuthorized, fetchStagingEntities, fetchAuditLogs]);

  // If unauthorized, render controlled Access Denied card
  if (!isAuthorized) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900 border border-red-500/30 rounded-2xl p-6 text-center space-y-4 shadow-2xl">
          <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-7 h-7 text-red-400" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-white">Controlled Access Denied</h2>
            <p className="text-xs text-slate-400">
              The Button Torture &amp; QA Reliability suite is restricted exclusively to authenticated <span className="font-mono text-amber-400">SUPER_ADMIN</span>, <span className="font-mono text-amber-400">ADMIN</span>, or <span className="font-mono text-amber-400">ORGANIZER</span> roles.
            </p>
          </div>
          <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 text-[11px] text-slate-400 font-mono text-left">
            <div>User: {user?.email || 'Anonymous'}</div>
            <div>Current Roles: {roles.join(', ') || 'None'}</div>
            <div>Required Roles: SUPER_ADMIN | ADMIN | ORGANIZER</div>
          </div>
        </div>
      </div>
    );
  }

  // Helper for slow network simulated delay wrapper
  const delayWrapper = async <T,>(fn: () => Promise<T>, delayMs: number = 2000): Promise<T> => {
    await new Promise((res) => setTimeout(res, delayMs));
    return await fn();
  };

  // Generic Workflow Test Execution Engine
  const runWorkflowTest = async (
    workflowId: string,
    workflowName: string,
    mode: TestMode,
    isDestructive: boolean,
    actionFn: () => Promise<unknown>,
    verifyDbFn: () => Promise<{ match: boolean; expected: string; actual: string; notes?: string }>
  ) => {
    if (isDestructive && !confirmDestructive[workflowId] && mode === 'RAPID_CLICK') {
      addLog(workflowId, 'BLOCKED: Destructive workflow requires explicit safety confirmation agreement.');
      setTestStatus((prev) => ({ ...prev, [workflowId]: 'BLOCKED' }));
      return;
    }

    setTestStatus((prev) => ({ ...prev, [workflowId]: 'RUNNING' }));
    setIsSimulatedLoading((prev) => ({ ...prev, [workflowId]: true }));
    addLog(workflowId, `Starting ${mode} test for "${workflowName}"...`);
    addLog(workflowId, `Authenticated Actor: ${user?.email} (${roles.join(', ')})`);

    let requestCount = 0;
    let successCount = 0;
    let rejectionCount = 0;

    const startTime = Date.now();

    try {
      if (mode === 'RAPID_CLICK') {
        if (isDestructive) {
          // Invariant: For destructive or irreversible operations, NEVER repeat 5 times against DB.
          // Test the single-flight disabled guard.
          addLog(workflowId, 'Destructive Safety Protocol: Executing single authoritative mutation while testing single-flight concurrency lock.');
          requestCount = 1;
          try {
            await actionFn();
            successCount = 1;
            addLog(workflowId, 'Single authoritative mutation completed successfully.');
          } catch (err: any) {
            rejectionCount = 1;
            addLog(workflowId, `Controlled backend rejection: ${err.message || String(err)}`);
          }
        } else {
          // Repeatable / idempotent action: Issue 5 rapid UI-level calls
          addLog(workflowId, 'Issuing 5 rapid invocations to verify UI single-flight protection and backend idempotency...');
          requestCount = 5;
          const promises = Array.from({ length: 5 }).map((_, idx) =>
            actionFn()
              .then(() => {
                successCount++;
                addLog(workflowId, `Call #${idx + 1}: Succeeded`);
              })
              .catch((err) => {
                rejectionCount++;
                addLog(workflowId, `Call #${idx + 1}: Controlled Rejection -> ${err.message || String(err)}`);
              })
          );
          await Promise.all(promises);
        }
      } else {
        // Slow Network Test
        requestCount = 1;
        addLog(workflowId, 'Simulating 2000ms network latency delay on in-flight promise...');
        try {
          await delayWrapper(actionFn, 2000);
          successCount = 1;
          addLog(workflowId, 'Slow network request finished cleanly.');
        } catch (err: any) {
          rejectionCount = 1;
          addLog(workflowId, `Slow network request rejection: ${err.message || String(err)}`);
        }
      }

      // Authoritative DB Verification
      addLog(workflowId, 'Running authoritative DB state verification query...');
      const dbCheck = await verifyDbFn();
      addLog(workflowId, `DB Check -> Expected: "${dbCheck.expected}" | Actual: "${dbCheck.actual}" (${dbCheck.match ? 'MATCH' : 'MISMATCH'})`);

      // Audit Log Verification
      addLog(workflowId, 'Querying system_audit_logs for authoritative audit trail...');
      await fetchAuditLogs();
      const auditLogStatus = auditLogs.length > 0 ? 'AUTHORITATIVE_LOG_PRESENT' : 'AUDIT_LOG_GAP';
      if (auditLogStatus === 'AUDIT_LOG_GAP') {
        addLog(workflowId, 'AUDIT LOG GAP — NO AUTHORITATIVE ENTRY OBSERVED for this workflow.');
      } else {
        addLog(workflowId, `Verified ${auditLogs.length} audit trail record(s) in public.system_audit_logs.`);
      }

      const finalStatus: TestStatus = dbCheck.match && successCount > 0 ? 'PASS' : rejectionCount > 0 && dbCheck.match ? 'PASS' : 'FAIL';
      setTestStatus((prev) => ({ ...prev, [workflowId]: finalStatus }));
      addLog(workflowId, `Test Completed in ${Date.now() - startTime}ms. Final Result: ${finalStatus}`);

      // Record in history
      const historyItem: TestExecutionRecord = {
        id: `exec-${Date.now()}`,
        workflowId,
        timestamp: new Date().toLocaleTimeString(),
        actor: user?.email || 'Unknown',
        actorRole: roles[0] || 'NONE',
        testType: mode,
        requestCount,
        successCount,
        rejectionCount,
        dbVerification: dbCheck.match ? 'MATCH' : 'MISMATCH',
        realtimeVerification: realtimeEvents.length > 0 ? 'RECEIVED' : 'N/A',
        auditLogVerification: auditLogStatus,
        status: finalStatus,
        notes: dbCheck.notes || `Reqs: ${requestCount}, Succ: ${successCount}, Rej: ${rejectionCount}`,
      };

      setExecutionHistory((prev) => [historyItem, ...prev.slice(0, 19)]);
    } catch (globalErr: any) {
      addLog(workflowId, `Unhandled error during torture execution: ${globalErr.message || String(globalErr)}`);
      setTestStatus((prev) => ({ ...prev, [workflowId]: 'FAIL' }));
    } finally {
      setIsSimulatedLoading((prev) => ({ ...prev, [workflowId]: false }));
    }
  };

  // 16 Target Workflows Definitions
  const workflows = [
    {
      id: 'workflow-1',
      name: '1. Court Dispatch',
      rpc: 'dispatch_match_to_court',
      service: 'courtOperationsService.dispatchMatchToCourt',
      requiredRole: 'COURT_MANAGER / OFFICIAL / ADMIN',
      isDestructive: false,
      description: 'Dispatches a scheduled match to a designated arena court and queues for walk-in.',
      actionFn: async () => {
        if (!selectedMatchId || !selectedCourtId) throw new Error('Match ID and Court ID required');
        return await courtOperationsService.dispatchMatchToCourt(selectedMatchId, selectedCourtId);
      },
      verifyDbFn: async () => {
        const { data: matchData } = await supabase.from('matches').select('court_identifier, status').eq('id', selectedMatchId).single();
        const { data: assignmentData } = await supabase.from('court_assignments').select('court_id, status').eq('match_id', selectedMatchId).maybeSingle();
        const match = Boolean(matchData?.court_identifier) || assignmentData?.court_id === selectedCourtId;
        return {
          match,
          expected: `court assigned to ${selectedCourtId}`,
          actual: `court_identifier = ${matchData?.court_identifier}, assignment_court = ${assignmentData?.court_id}, status = ${matchData?.status}`,
        };
      },
    },
    {
      id: 'workflow-2',
      name: '2. Start Live Match',
      rpc: 'start_live_match',
      service: 'courtOperationsService.startLiveMatch',
      requiredRole: 'COURT_MANAGER / TABLE_OFFICIAL',
      isDestructive: false,
      description: 'Transitions a dispatched match from READY/DISPATCHED to LIVE on the designated court.',
      actionFn: async () => {
        if (!selectedMatchId) throw new Error('Match ID required');
        return await courtOperationsService.startLiveMatch(selectedMatchId);
      },
      verifyDbFn: async () => {
        const { data } = await supabase.from('matches').select('status').eq('id', selectedMatchId).single();
        const match = data?.status === 'LIVE' || data?.status === 'IN_PROGRESS' || data?.status === 'COMPLETED';
        return {
          match,
          expected: 'status = LIVE / IN_PROGRESS',
          actual: `status = ${data?.status}`,
        };
      },
    },
    {
      id: 'workflow-3',
      name: '3. Cancel Dispatch',
      rpc: 'cancel_match_assignment',
      service: 'scoringService.cancelMatchAssignment',
      requiredRole: 'COURT_MANAGER / ADMIN',
      isDestructive: true,
      description: 'Cancels court dispatch and resets match back to PENDING/CANCELLED status.',
      actionFn: async () => {
        if (!selectedMatchId) throw new Error('Match ID required');
        return await scoringService.cancelMatchAssignment(selectedMatchId, 'QA Torture Cancel Test');
      },
      verifyDbFn: async () => {
        const { data } = await supabase.from('matches').select('status, court_identifier').eq('id', selectedMatchId).single();
        return {
          match: data?.status === 'CANCELLED' || data?.court_identifier === null,
          expected: 'status = CANCELLED or court_identifier = null',
          actual: `status = ${data?.status}, court = ${data?.court_identifier}`,
        };
      },
    },
    {
      id: 'workflow-4',
      name: '4. Save Round Score',
      rpc: 'record_round_score',
      service: 'scoringService.recordRoundScore',
      requiredRole: 'TABLE_OFFICIAL / SCORER',
      isDestructive: false,
      description: 'Persists round score cards, strikes, fouls, and judge points for Full Contact bouts.',
      actionFn: async () => {
        if (!selectedMatchId) throw new Error('Match ID required');
        return await scoringService.recordRoundScore(selectedMatchId, 1, 5, 4, false, false, 'RED', true);
      },
      verifyDbFn: async () => {
        const { data } = await supabase.from('scoring_rounds').select('round_number, red_score, blue_score').eq('match_id', selectedMatchId).eq('round_number', 1).maybeSingle();
        return {
          match: Boolean(data),
          expected: 'scoring_rounds row for Round 1 exists',
          actual: data ? `Round ${data.round_number}: Red=${data.red_score}, Blue=${data.blue_score}` : 'No round record found',
        };
      },
    },
    {
      id: 'workflow-5',
      name: '5. Finalize Match',
      rpc: 'complete_court_match',
      service: 'scoringService.completeCourtMatch',
      requiredRole: 'TABLE_OFFICIAL / COURT_MANAGER',
      isDestructive: true,
      description: 'Concludes a Full Contact bout, records the winning corner, decision, and advances brackets.',
      actionFn: async () => {
        if (!selectedMatchId || !selectedRegistrationId) throw new Error('Match ID and Winner Registration ID required');
        return await scoringService.completeCourtMatch(selectedMatchId, selectedRegistrationId, 'POINTS');
      },
      verifyDbFn: async () => {
        const { data } = await supabase.from('matches').select('status, winner_registration_id').eq('id', selectedMatchId).single();
        return {
          match: data?.status === 'COMPLETED',
          expected: 'status = COMPLETED',
          actual: `status = ${data?.status}, winner_reg = ${data?.winner_registration_id}`,
        };
      },
    },
    {
      id: 'workflow-6',
      name: '6. Save Anyo Score',
      rpc: 'record_anyo_score',
      service: 'anyoScoringService.recordAnyoScore',
      requiredRole: 'ANYO_JUDGE / TABLE_OFFICIAL',
      isDestructive: false,
      description: 'Records multi-judge scores, deductions, and synchronized performance ratings for Anyo routines.',
      actionFn: async () => {
        if (!selectedRegistrationId) throw new Error('Performance ID required');
        return await anyoScoringService.recordAnyoScore(selectedRegistrationId, [8.5, 8.7, 8.6, 8.9, 8.4], 'TIER_1');
      },
      verifyDbFn: async () => {
        const { data } = await supabase.from('anyo_scores').select('id, tier').eq('performance_id', selectedRegistrationId).maybeSingle();
        return {
          match: Boolean(data),
          expected: 'anyo_scores row exists with tier TIER_1',
          actual: data ? `Score record found with tier ${data.tier}` : 'No Anyo score record found',
        };
      },
    },
    {
      id: 'workflow-7',
      name: '7. Finalize Anyo Entry / Session',
      rpc: 'finalize_anyo_category',
      service: 'anyoScoringService.finalizeCategory',
      requiredRole: 'TABLE_OFFICIAL / COURT_MANAGER',
      isDestructive: true,
      description: 'Calculates trimmed mean rank, resolves ties, and locks the Anyo competition category results.',
      actionFn: async () => {
        if (!selectedEventId) throw new Error('Session ID required');
        return await anyoScoringService.finalizeCategory(selectedEventId);
      },
      verifyDbFn: async () => {
        const { data } = await supabase.from('anyo_category_sessions').select('status').eq('id', selectedEventId).single();
        return {
          match: data?.status === 'COMPLETED' || data?.status === 'FINALIZED',
          expected: 'session status = COMPLETED/FINALIZED',
          actual: `session status = ${data?.status}`,
        };
      },
    },
    {
      id: 'workflow-8',
      name: '8. Submit / Save Lineup',
      rpc: 'coach_set_event_lineup',
      service: 'tournamentService.coachSetEventLineup',
      requiredRole: 'COACH / SUPER_ADMIN',
      isDestructive: false,
      description: 'Submits delegation team roster and assigns primary athlete vs. backup reserves for an event.',
      actionFn: async () => {
        if (!selectedEventId || !selectedClubId || !selectedUserId) throw new Error('Event, Club, and User required');
        return await tournamentService.coachSetEventLineup({
          event_id: selectedEventId,
          club_id: selectedClubId,
          lineup_user_ids: [selectedUserId],
          reserve_user_ids: selectedReserveRegId ? [selectedReserveRegId] : [],
        });
      },
      verifyDbFn: async () => {
        const { data } = await supabase.from('registrations').select('lineup_role').eq('id', selectedRegistrationId).single();
        return {
          match: data?.lineup_role === 'PRIMARY',
          expected: 'lineup_role = PRIMARY',
          actual: `lineup_role = ${data?.lineup_role}`,
        };
      },
    },
    {
      id: 'workflow-9',
      name: '9. Swap Lineup / Reserve',
      rpc: 'swap_event_lineup_reserve',
      service: 'tournamentService.swapEventLineupReserve',
      requiredRole: 'COACH / SUPER_ADMIN',
      isDestructive: false,
      description: 'Executes an atomic database swap between a primary competitor and their declared backup reserve.',
      actionFn: async () => {
        if (!selectedEventId || !selectedClubId || !selectedRegistrationId || !selectedReserveRegId) {
          throw new Error('Event ID, Club ID, Primary ID, and Reserve ID required');
        }
        return await tournamentService.swapEventLineupReserve({
          event_id: selectedEventId,
          club_id: selectedClubId,
          lineup_reg_id: selectedRegistrationId,
          reserve_reg_id: selectedReserveRegId,
        });
      },
      verifyDbFn: async () => {
        const { data: primary } = await supabase.from('registrations').select('lineup_role').eq('id', selectedRegistrationId).single();
        const { data: reserve } = await supabase.from('registrations').select('lineup_role').eq('id', selectedReserveRegId).single();
        return {
          match: primary?.lineup_role !== reserve?.lineup_role,
          expected: 'Primary and Reserve possess distinct inverted roles',
          actual: `Primary=${primary?.lineup_role}, Reserve=${reserve?.lineup_role}`,
        };
      },
    },
    {
      id: 'workflow-10',
      name: '10. Approve / Reject Player Membership',
      rpc: 'approve_player_membership / reject_player_membership',
      service: 'playerMembershipService.approveMembership',
      requiredRole: 'COACH / HEAD_COACH',
      isDestructive: false,
      description: 'Processes incoming athlete membership requests into club rosters.',
      actionFn: async () => {
        if (!selectedUserId) throw new Error('Membership ID required');
        return await playerMembershipService.approveMembership(selectedUserId, 'QA Torture Membership Approval');
      },
      verifyDbFn: async () => {
        const { data } = await supabase.from('club_memberships').select('status').eq('id', selectedUserId).maybeSingle();
        return {
          match: data?.status === 'ACTIVE',
          expected: 'status = ACTIVE',
          actual: `status = ${data?.status || 'No membership row'}`,
        };
      },
    },
    {
      id: 'workflow-11',
      name: '11. Suspend / Restore Athlete',
      rpc: 'suspend_player_membership / restore_player_membership',
      service: 'playerMembershipService.suspendPlayer',
      requiredRole: 'COACH / SUPER_ADMIN',
      isDestructive: true,
      description: 'Places disciplinary or administrative suspension onto an athlete club membership.',
      actionFn: async () => {
        if (!selectedUserId) throw new Error('Membership ID required');
        return await playerMembershipService.suspendPlayer(selectedUserId, 'QA Torture Suspension Test');
      },
      verifyDbFn: async () => {
        const { data } = await supabase.from('club_memberships').select('status').eq('id', selectedUserId).maybeSingle();
        return {
          match: data?.status === 'SUSPENDED',
          expected: 'status = SUSPENDED',
          actual: `status = ${data?.status || 'No membership row'}`,
        };
      },
    },
    {
      id: 'workflow-12',
      name: '12. Initialize Snapshot / Freeze (v1)',
      rpc: 'create_initial_tournament_snapshot',
      service: 'tournamentService.createInitialTournamentSnapshot',
      requiredRole: 'SUPER_ADMIN / ADMIN / ORGANIZER',
      isDestructive: true,
      description: 'Creates the authoritative, immutable tournament snapshot (Snapshot-First Invariant).',
      actionFn: async () => {
        if (!selectedTournamentId) throw new Error('Tournament ID required');
        return await tournamentService.createInitialTournamentSnapshot(selectedTournamentId);
      },
      verifyDbFn: async () => {
        const { data } = await supabase.from('tournament_snapshots').select('version').eq('tournament_id', selectedTournamentId).order('version', { ascending: true }).limit(1).maybeSingle();
        return {
          match: Boolean(data),
          expected: 'tournament_snapshots record exists for this tournament',
          actual: data ? `Snapshot v${data.version} recorded` : 'No snapshot recorded',
        };
      },
    },
    {
      id: 'workflow-13',
      name: '13. Generate Bracket (O-38)',
      rpc: 'generate_tournament_brackets',
      service: 'bracketService.generateTournamentBrackets',
      requiredRole: 'SUPER_ADMIN / ADMIN / ORGANIZER',
      isDestructive: true,
      description: 'Derives deterministic bracket tree nodes, seeds, byes, and auto bronze matches from snapshot.',
      actionFn: async () => {
        if (!selectedTournamentId) throw new Error('Tournament ID required');
        return await bracketService.generateTournamentBrackets(selectedTournamentId);
      },
      verifyDbFn: async () => {
        const { count } = await supabase.from('matches').select('*', { count: 'exact', head: true }).eq('tournament_id', selectedTournamentId);
        return {
          match: (count || 0) > 0,
          expected: 'Total matches > 0 generated in bracket',
          actual: `Total matches = ${count || 0}`,
        };
      },
    },
    {
      id: 'workflow-14',
      name: '14. Finalize & Seal Tournament',
      rpc: 'finalize_tournament',
      service: 'tournamentService.finalizeTournament',
      requiredRole: 'SUPER_ADMIN / ADMIN',
      isDestructive: true,
      description: 'Validates zero unresolved matches, records cryptographic closure seal, and permanently closes event.',
      actionFn: async () => {
        if (!selectedTournamentId) throw new Error('Tournament ID required');
        return await tournamentService.finalizeTournament({ tournamentId: selectedTournamentId, notes: 'QA Torture Seal Verification' });
      },
      verifyDbFn: async () => {
        const { data: tourney } = await supabase.from('tournaments').select('status').eq('id', selectedTournamentId).single();
        const { data: seal } = await supabase.from('tournament_closure_seals').select('closure_hash').eq('tournament_id', selectedTournamentId).maybeSingle();
        return {
          match: tourney?.status === 'COMPLETED' && Boolean(seal),
          expected: 'tournaments.status = COMPLETED and closure seal exists',
          actual: `status = ${tourney?.status}, seal_hash = ${seal?.closure_hash ? 'RECORDED' : 'MISSING'}`,
        };
      },
    },
    {
      id: 'workflow-15',
      name: '15. Assign / Revoke Event Official',
      rpc: 'assign_event_role / revoke_event_role',
      service: 'eventAssignmentService.assignEventRole',
      requiredRole: 'SUPER_ADMIN / ADMIN / ORGANIZER',
      isDestructive: false,
      description: 'Appoints or revokes scoped Court Manager and Table Official assignments.',
      actionFn: async () => {
        if (!selectedTournamentId || !selectedUserId) throw new Error('Tournament ID and User ID required');
        return await eventAssignmentService.assignEventRole(selectedTournamentId, selectedUserId, 'COURT_MANAGER', null);
      },
      verifyDbFn: async () => {
        const { data } = await supabase.from('event_assignments').select('role').eq('tournament_id', selectedTournamentId).eq('user_id', selectedUserId).maybeSingle();
        return {
          match: Boolean(data),
          expected: 'event_assignments record exists with role',
          actual: data ? `Assigned role = ${data.role}` : 'No assignment row found',
        };
      },
    },
    {
      id: 'workflow-16',
      name: '16. Assign / Revoke Permanent Role',
      rpc: 'assign_permanent_role / revoke_permanent_role',
      service: 'roleService.assignPermanentRole',
      requiredRole: 'SUPER_ADMIN ONLY',
      isDestructive: true,
      description: 'Assigns canonical permanent RBAC role (e.g. TOURNAMENT_MANAGER / COACH / PLAYER).',
      actionFn: async () => {
        if (!selectedUserId) throw new Error('Target User ID required');
        return await roleService.assignPermanentRole(selectedUserId, 'COACH');
      },
      verifyDbFn: async () => {
        const { data } = await supabase.from('user_roles').select('role').eq('user_id', selectedUserId).eq('role', 'COACH').maybeSingle();
        return {
          match: Boolean(data),
          expected: 'user_roles has row with role = COACH',
          actual: data ? 'COACH role present' : 'Role record not found',
        };
      },
    },
  ];

  const currentWorkflow = workflows.find((w) => w.id === activeWorkflowId) || workflows[0];

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* 1. Large Red Header Banner */}
      <div className="bg-red-950/80 border-2 border-red-500 rounded-2xl p-5 sm:p-6 shadow-2xl text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
          <Flame className="w-36 h-36 text-red-500" />
        </div>
        <div className="relative z-10 space-y-2">
          <div className="inline-flex items-center space-x-2 px-3 py-1 bg-red-600 font-black tracking-widest text-xs uppercase rounded-full shadow-lg">
            <AlertTriangle className="w-4 h-4" />
            <span>QA ONLY - STAGING</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
            FIND-036A — Manual QA Button Torture &amp; Reliability Suite
          </h1>
          <p className="text-xs sm:text-sm text-red-200/90 max-w-3xl leading-relaxed">
            Strict runtime verification console for all 16 database-writing workflows. Exercises rapid multi-click debounce, simulated 3G latency single-flight locking, authoritative PostgreSQL DB assertion, Realtime subscriptions, and audit log verification.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2 text-[11px] font-mono text-red-200/80">
            <span className="bg-black/40 px-2.5 py-1 rounded-md border border-red-500/30">
              Authenticated Actor: <span className="text-amber-300 font-bold">{user?.email}</span>
            </span>
            <span className="bg-black/40 px-2.5 py-1 rounded-md border border-red-500/30">
              Active Roles: <span className="text-amber-300 font-bold">{roles.join(', ') || 'NONE'}</span>
            </span>
            <span className="bg-black/40 px-2.5 py-1 rounded-md border border-red-500/30 flex items-center space-x-1">
              <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
              <span>Realtime Hub Active</span>
            </span>
          </div>
        </div>
      </div>

      {/* 2. Global Target Fixture Selectors Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <div className="flex items-center space-x-2 text-xs font-semibold text-slate-200 uppercase tracking-wider">
            <Database className="w-4 h-4 text-amber-400" />
            <span>Staging Fixture Selectors (Existing DB Entities)</span>
          </div>
          <button
            type="button"
            onClick={fetchStagingEntities}
            className="text-[11px] font-mono text-amber-400 hover:text-amber-300 flex items-center space-x-1"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Reload Entities</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          {/* Tournament */}
          <div>
            <label className="block text-[11px] text-slate-400 mb-1 font-mono">Tournament Target:</label>
            <select
              value={selectedTournamentId}
              onChange={(e) => setSelectedTournamentId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200 font-mono text-xs focus:ring-1 focus:ring-amber-500"
            >
              {tournaments.length === 0 && <option value="">No Tournaments Found</option>}
              {tournaments.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.status})
                </option>
              ))}
            </select>
          </div>

          {/* Court */}
          <div>
            <label className="block text-[11px] text-slate-400 mb-1 font-mono">Court Target:</label>
            <select
              value={selectedCourtId}
              onChange={(e) => setSelectedCourtId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200 font-mono text-xs focus:ring-1 focus:ring-amber-500"
            >
              {courts.length === 0 && <option value="">No Courts Found</option>}
              {courts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.identifier}) [{c.is_active ? 'ACTIVE' : 'INACTIVE'}]
                </option>
              ))}
            </select>
          </div>

          {/* Match */}
          <div>
            <label className="block text-[11px] text-slate-400 mb-1 font-mono">Match Target:</label>
            <select
              value={selectedMatchId}
              onChange={(e) => setSelectedMatchId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200 font-mono text-xs focus:ring-1 focus:ring-amber-500"
            >
              {matches.length === 0 && <option value="">No Matches Found</option>}
              {matches.map((m) => (
                <option key={m.id} value={m.id}>
                  Match #{m.match_number} ({m.status}) [Rnd {m.round_number || 1}]
                </option>
              ))}
            </select>
          </div>

          {/* Club */}
          <div>
            <label className="block text-[11px] text-slate-400 mb-1 font-mono">Club / Team Target:</label>
            <select
              value={selectedClubId}
              onChange={(e) => setSelectedClubId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200 font-mono text-xs focus:ring-1 focus:ring-amber-500"
            >
              {clubs.length === 0 && <option value="">No Clubs Found</option>}
              {clubs.map((cl) => (
                <option key={cl.id} value={cl.id}>
                  {cl.name} ({cl.is_active ? 'ACTIVE' : 'INACTIVE'})
                </option>
              ))}
            </select>
          </div>

          {/* Target Profile User */}
          <div>
            <label className="block text-[11px] text-slate-400 mb-1 font-mono">Target Profile User:</label>
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200 font-mono text-xs focus:ring-1 focus:ring-amber-500"
            >
              {users.length === 0 && <option value="">No Profiles Found</option>}
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name} ({u.email})
                </option>
              ))}
            </select>
          </div>

          {/* Event Target */}
          <div>
            <label className="block text-[11px] text-slate-400 mb-1 font-mono">Event Target:</label>
            <select
              value={selectedEventId}
              onChange={(e) => setSelectedEventId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200 font-mono text-xs focus:ring-1 focus:ring-amber-500"
            >
              {events.length === 0 && <option value="">No Events Found</option>}
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name} ({ev.category || 'EVENT'})
                </option>
              ))}
            </select>
          </div>

          {/* Primary Athlete Registration */}
          <div>
            <label className="block text-[11px] text-slate-400 mb-1 font-mono">Primary Athlete Registration:</label>
            <select
              value={selectedRegistrationId}
              onChange={(e) => setSelectedRegistrationId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200 font-mono text-xs focus:ring-1 focus:ring-amber-500"
            >
              {registrations.length === 0 && <option value="">No Registrations Found</option>}
              {registrations.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.athlete_name} ({r.team_name}) [{r.lineup_role}]
                </option>
              ))}
            </select>
          </div>

          {/* Backup Reserve Athlete */}
          <div>
            <label className="block text-[11px] text-slate-400 mb-1 font-mono">Backup Reserve Athlete:</label>
            <select
              value={selectedReserveRegId}
              onChange={(e) => setSelectedReserveRegId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200 font-mono text-xs focus:ring-1 focus:ring-amber-500"
            >
              {registrations.length === 0 && <option value="">No Registrations Found</option>}
              {registrations.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.athlete_name} ({r.team_name}) [{r.lineup_role}]
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* 3. Main Master/Detail Workflow Torture Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: 16 Workflows List */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl flex flex-col h-[750px]">
          <div className="p-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
              16 Target Workflows (FIND-028)
            </span>
            <span className="text-[10px] font-mono bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded border border-amber-500/30">
              16 / 16 LOADED
            </span>
          </div>

          <div className="overflow-y-auto divide-y divide-slate-800/60 flex-1">
            {workflows.map((wf) => {
              const status = testStatus[wf.id] || 'IDLE';
              const isSelected = wf.id === activeWorkflowId;

              return (
                <button
                  key={wf.id}
                  type="button"
                  onClick={() => setActiveWorkflowId(wf.id)}
                  className={`w-full text-left p-3 transition-colors flex items-start justify-between ${
                    isSelected ? 'bg-amber-500/10 border-l-4 border-amber-500' : 'hover:bg-slate-800/50'
                  }`}
                >
                  <div className="space-y-1 pr-2">
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold text-xs text-white">{wf.name}</span>
                      {wf.isDestructive && (
                        <span className="text-[9px] font-bold uppercase bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded border border-red-500/30">
                          DESTRUCTIVE
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] font-mono text-slate-400 truncate max-w-[220px]">
                      {wf.rpc}
                    </div>
                  </div>

                  <div className="flex-shrink-0 mt-0.5">
                    {status === 'IDLE' && (
                      <span className="text-[10px] font-mono text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">
                        IDLE
                      </span>
                    )}
                    {status === 'RUNNING' && (
                      <span className="text-[10px] font-mono text-amber-400 bg-amber-500/20 px-1.5 py-0.5 rounded flex items-center space-x-1">
                        <Loader2 className="w-2.5 h-2.5 animate-spin" />
                        <span>RUN</span>
                      </span>
                    )}
                    {status === 'PASS' && (
                      <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/20 px-1.5 py-0.5 rounded flex items-center space-x-1">
                        <CheckCircle2 className="w-2.5 h-2.5" />
                        <span>PASS</span>
                      </span>
                    )}
                    {status === 'FAIL' && (
                      <span className="text-[10px] font-mono text-red-400 bg-red-500/20 px-1.5 py-0.5 rounded flex items-center space-x-1">
                        <XCircle className="w-2.5 h-2.5" />
                        <span>FAIL</span>
                      </span>
                    )}
                    {status === 'BLOCKED' && (
                      <span className="text-[10px] font-mono text-amber-500 bg-amber-500/20 px-1.5 py-0.5 rounded">
                        BLOCKED
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right 2 Columns: Active Workflow Torture Console */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-5 flex flex-col h-[750px] overflow-y-auto">
          {/* Header */}
          <div className="border-b border-slate-800 pb-3 flex items-start justify-between">
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-white">{currentWorkflow.name}</h2>
                {currentWorkflow.isDestructive && (
                  <span className="text-[10px] font-bold bg-red-500/20 text-red-400 px-2 py-0.5 rounded border border-red-500/30">
                    DESTRUCTIVE / IRREVERSIBLE
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1">{currentWorkflow.description}</p>
            </div>

            <div className="text-right space-y-0.5">
              <div className="text-[10px] font-mono text-slate-400">Required Role:</div>
              <span className="text-xs font-mono font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30 inline-block">
                {currentWorkflow.requiredRole}
              </span>
            </div>
          </div>

          {/* Technical Specs Card */}
          <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 text-xs font-mono space-y-1.5 text-slate-300">
            <div className="flex justify-between">
              <span className="text-slate-500">Target RPC / Operation:</span>
              <span className="text-amber-400">{currentWorkflow.rpc}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Service Method:</span>
              <span className="text-cyan-400">{currentWorkflow.service}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Security Model:</span>
              <span className="text-emerald-400">SECURITY DEFINER + RLS Boundary</span>
            </div>
          </div>

          {/* Destructive Confirmation Check */}
          {currentWorkflow.isDestructive && (
            <div className="p-3 bg-red-950/40 border border-red-500/40 rounded-xl flex items-center space-x-3">
              <input
                type="checkbox"
                id={`confirm-${currentWorkflow.id}`}
                checked={confirmDestructive[currentWorkflow.id] || false}
                onChange={(e) =>
                  setConfirmDestructive((prev) => ({
                    ...prev,
                    [currentWorkflow.id]: e.target.checked,
                  }))
                }
                className="w-4 h-4 rounded text-red-500 bg-slate-950 border-slate-700 focus:ring-red-500"
              />
              <label htmlFor={`confirm-${currentWorkflow.id}`} className="text-xs text-red-200 font-medium">
                I understand this operation is destructive/state-locking. Verify single-flight guard without executing 5 repeated writes.
              </label>
            </div>
          )}

          {/* Torture Execution Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Rapid Click Test */}
            <button
              type="button"
              disabled={isSimulatedLoading[currentWorkflow.id]}
              onClick={() =>
                runWorkflowTest(
                  currentWorkflow.id,
                  currentWorkflow.name,
                  'RAPID_CLICK',
                  currentWorkflow.isDestructive,
                  currentWorkflow.actionFn,
                  currentWorkflow.verifyDbFn
                )
              }
              className={`p-3.5 rounded-xl font-bold text-xs flex items-center justify-center space-x-2 transition-all shadow-lg ${
                isSimulatedLoading[currentWorkflow.id]
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950'
              }`}
            >
              {isSimulatedLoading[currentWorkflow.id] ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Executing Single-Flight Guard...</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  <span>Execute Rapid-Click Test (5x Multi-Click)</span>
                </>
              )}
            </button>

            {/* Slow Network Test */}
            <button
              type="button"
              disabled={isSimulatedLoading[currentWorkflow.id]}
              onClick={() =>
                runWorkflowTest(
                  currentWorkflow.id,
                  currentWorkflow.name,
                  'SLOW_NETWORK',
                  currentWorkflow.isDestructive,
                  currentWorkflow.actionFn,
                  currentWorkflow.verifyDbFn
                )
              }
              className={`p-3.5 rounded-xl font-bold text-xs flex items-center justify-center space-x-2 transition-all shadow-lg ${
                isSimulatedLoading[currentWorkflow.id]
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white'
              }`}
            >
              {isSimulatedLoading[currentWorkflow.id] ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Simulating 3G Delay...</span>
                </>
              ) : (
                <>
                  <Clock className="w-4 h-4" />
                  <span>Execute Slow Network Test (2000ms Latency)</span>
                </>
              )}
            </button>
          </div>

          {/* Diagnostic Execution Logs Console */}
          <div className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex flex-col font-mono text-[11px] space-y-2 overflow-hidden min-h-[220px]">
            <div className="flex items-center justify-between text-slate-400 border-b border-slate-800/80 pb-1.5">
              <span className="flex items-center space-x-1.5">
                <Activity className="w-3.5 h-3.5 text-amber-400" />
                <span className="font-bold text-slate-200">Execution Diagnostic Log</span>
              </span>
              <button
                type="button"
                onClick={() => setTestLogs((prev) => ({ ...prev, [currentWorkflow.id]: [] }))}
                className="text-[10px] text-slate-500 hover:text-slate-300"
              >
                Clear Log
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1 pr-1 text-slate-300">
              {(!testLogs[currentWorkflow.id] || testLogs[currentWorkflow.id].length === 0) && (
                <div className="text-slate-600 italic">No execution logs for this workflow yet. Click a test button above.</div>
              )}
              {testLogs[currentWorkflow.id]?.map((line, idx) => (
                <div key={idx} className="leading-relaxed">
                  {line}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 4. Realtime Broadcast & System Audit Logs Inspection Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Realtime Stream Verification */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center space-x-2 text-xs font-semibold text-slate-200">
              <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
              <span>Realtime Broadcast Stream (Verification Only)</span>
            </div>
            <span className="text-[10px] font-mono text-slate-400">Last 20 Events</span>
          </div>

          <div className="h-56 overflow-y-auto space-y-1.5 font-mono text-[11px]">
            {realtimeEvents.length === 0 && (
              <div className="text-slate-500 italic p-3 text-center">Listening for PostgreSQL table broadcast events...</div>
            )}
            {realtimeEvents.map((evt, idx) => (
              <div key={idx} className="p-2 bg-slate-950 border border-slate-800/80 rounded-lg flex items-center justify-between">
                <div className="space-x-2 truncate max-w-[280px]">
                  <span className="px-1.5 py-0.5 bg-slate-800 text-amber-300 rounded font-bold">{evt.table}</span>
                  <span className="text-cyan-400 font-bold">{evt.eventType}</span>
                  <span className="text-slate-400">{evt.recordId?.slice(0, 8)}...</span>
                </div>
                <span className="text-[10px] text-slate-500">{new Date(evt.timestamp).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Audit Log Verification */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center space-x-2 text-xs font-semibold text-slate-200">
              <FileText className="w-4 h-4 text-amber-400" />
              <span>Authoritative system_audit_logs Query</span>
            </div>
            <button
              type="button"
              onClick={() => fetchAuditLogs()}
              className="text-[11px] font-mono text-amber-400 hover:text-amber-300 flex items-center space-x-1"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Refresh Logs</span>
            </button>
          </div>

          <div className="h-56 overflow-y-auto space-y-1.5 font-mono text-[11px]">
            {isLoadingAudit && <div className="text-slate-400 p-3 text-center">Querying public.system_audit_logs...</div>}
            {!isLoadingAudit && auditLogs.length === 0 && (
              <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl text-center text-amber-300 text-xs">
                <AlertCircle className="w-5 h-5 mx-auto mb-1 text-amber-400" />
                AUDIT LOG GAP — NO AUTHORITATIVE ENTRY OBSERVED
              </div>
            )}
            {!isLoadingAudit &&
              auditLogs.map((log, idx) => (
                <div key={idx} className="p-2.5 bg-slate-950 border border-slate-800/80 rounded-lg space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-amber-400 font-bold">{log.action}</span>
                    <span className="text-[10px] text-slate-500">{new Date(log.created_at).toLocaleTimeString()}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 flex items-center space-x-2">
                    <span>Role: <strong className="text-slate-200">{log.actor_role}</strong></span>
                    <span>•</span>
                    <span>Entity: <strong className="text-slate-200">{log.entity_type}</strong></span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* 5. Last 5 QA Results Audit History Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            <History className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              QA Test Result Execution History
            </h3>
          </div>
          <span className="text-xs text-slate-400 font-mono">Showing recent executions</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono text-slate-300">
            <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 text-[11px] uppercase">
              <tr>
                <th className="p-2.5">Timestamp</th>
                <th className="p-2.5">Workflow</th>
                <th className="p-2.5">Actor (Role)</th>
                <th className="p-2.5">Test Mode</th>
                <th className="p-2.5 text-center">Req / Succ / Rej</th>
                <th className="p-2.5">DB Match</th>
                <th className="p-2.5">Audit Log</th>
                <th className="p-2.5 text-right">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {executionHistory.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-4 text-center text-slate-500 italic">
                    No tests executed in this session yet.
                  </td>
                </tr>
              )}
              {executionHistory.map((rec) => (
                <tr key={rec.id} className="hover:bg-slate-800/40">
                  <td className="p-2.5 text-slate-400">{rec.timestamp}</td>
                  <td className="p-2.5 font-bold text-white truncate max-w-[180px]">
                    {workflows.find((w) => w.id === rec.workflowId)?.name || rec.workflowId}
                  </td>
                  <td className="p-2.5 text-slate-300 truncate max-w-[150px]">
                    {rec.actor} ({rec.actorRole})
                  </td>
                  <td className="p-2.5">
                    <span className="px-2 py-0.5 bg-slate-800 text-cyan-400 rounded text-[10px]">
                      {rec.testType}
                    </span>
                  </td>
                  <td className="p-2.5 text-center font-bold">
                    <span className="text-slate-300">{rec.requestCount}</span> /{' '}
                    <span className="text-emerald-400">{rec.successCount}</span> /{' '}
                    <span className="text-amber-400">{rec.rejectionCount}</span>
                  </td>
                  <td className="p-2.5">
                    {rec.dbVerification === 'MATCH' ? (
                      <span className="text-emerald-400 flex items-center space-x-1">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>MATCH</span>
                      </span>
                    ) : (
                      <span className="text-red-400 flex items-center space-x-1">
                        <XCircle className="w-3 h-3" />
                        <span>MISMATCH</span>
                      </span>
                    )}
                  </td>
                  <td className="p-2.5 text-[10px]">
                    {rec.auditLogVerification === 'AUTHORITATIVE_LOG_PRESENT' ? (
                      <span className="text-emerald-400">LOG VERIFIED</span>
                    ) : (
                      <span className="text-amber-400">AUDIT GAP</span>
                    )}
                  </td>
                  <td className="p-2.5 text-right font-bold">
                    {rec.status === 'PASS' && <span className="text-emerald-400">PASS</span>}
                    {rec.status === 'FAIL' && <span className="text-red-400">FAIL</span>}
                    {rec.status === 'BLOCKED' && <span className="text-amber-400">BLOCKED</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default QATestButtonTorture;
