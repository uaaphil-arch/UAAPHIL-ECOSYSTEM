import { supabase } from '../lib/supabase';
import { scoringService } from './scoringService';
import {
  CourtTelemetry,
  CourtState,
  EnrichedQueueMatch,
  QueueItemState,
  CourtOperationsMetrics,
  CourtLiveMatchSummary,
  CourtQueuedMatchSummary,
  ParticipantSummary,
  IncidentSeverity,
  SystemAuditLogEntry
} from '../types/courtOperations';

export const courtOperationsService = {
  /**
   * Fetches real-time telemetry across all courts for a tournament.
   * Derives state from public.courts, public.court_assignments, public.matches, and public.scoring_rounds.
   */
  async fetchTournamentCourtsTelemetry(tournamentId: string): Promise<CourtTelemetry[]> {
    try {
      // 1. Fetch all courts for this tournament
      const { data: courtsData, error: courtsError } = await supabase
        .from('courts')
        .select('*')
        .eq('tournament_id', tournamentId)
        .order('identifier', { ascending: true });

      if (courtsError) {
        console.error('Error fetching courts for telemetry:', courtsError);
        throw courtsError;
      }

      if (!courtsData || courtsData.length === 0) {
        return [];
      }

      const courtIds = courtsData.map(c => c.id);

      // 2. Fetch court assignments for these courts
      const { data: assignmentsData, error: assignmentsError } = await supabase
        .from('court_assignments')
        .select(`
          id,
          court_id,
          match_id,
          status,
          assigned_at,
          match:matches (
            id,
            tournament_id,
            event_id,
            match_number,
            round_number,
            status,
            court_identifier,
            red_corner_registration_id,
            blue_corner_registration_id,
            winner_registration_id,
            event:events (
              id,
              name,
              category,
              division,
              gender,
              weight_class
            ),
            red_athlete:registrations!matches_red_corner_registration_id_fkey (
              id,
              user_id,
              team_name,
              user_profile:profiles!registrations_user_id_fkey (
                id,
                full_name
              )
            ),
            blue_athlete:registrations!matches_blue_corner_registration_id_fkey (
              id,
              user_id,
              team_name,
              user_profile:profiles!registrations_user_id_fkey (
                id,
                full_name
              )
            ),
            scoring_rounds (
              id,
              round_number,
              red_score,
              blue_score,
              red_advantage,
              blue_advantage,
              is_confirmed
            )
          )
        `)
        .in('court_id', courtIds)
        .in('status', ['ASSIGNED', 'LIVE', 'COMPLETED']);

      if (assignmentsError) {
        console.error('Error fetching court assignments:', assignmentsError);
        throw assignmentsError;
      }

      // 3. Fetch officials assigned to events for this tournament
      const { data: officialsData, error: officialsError } = await supabase
        .from('event_assignments')
        .select(`
          id,
          user_id,
          role,
          court_id,
          user:profiles!event_assignments_user_id_fkey (
            id,
            full_name
          )
        `)
        .eq('is_active', true);

      if (officialsError) {
        console.warn('Error fetching event assignments (non-blocking):', officialsError);
      }

      // 4. Map and compose telemetry for each court
      const telemetryList: CourtTelemetry[] = courtsData.map(court => {
        const courtAssignments = (assignmentsData || []).filter(a => a.court_id === court.id);
        const liveAssignment = courtAssignments.find(a => a.status === 'LIVE' && a.match);
        const assignedQueue = courtAssignments
          .filter(a => a.status === 'ASSIGNED' && a.match)
          .sort((a, b) => new Date(a.assigned_at).getTime() - new Date(b.assigned_at).getTime());
        const completedCount = courtAssignments.filter(a => a.status === 'COMPLETED').length;

        // Derive Court State
        let state: CourtState = 'AVAILABLE';
        if (!court.is_active) {
          state = 'OFFLINE';
        } else if (liveAssignment) {
          state = 'LIVE';
        } else if (assignedQueue.length > 0) {
          state = 'ASSIGNED';
        } else {
          state = 'AVAILABLE';
        }

        // Parse Live Match if present
        let activeMatch: CourtLiveMatchSummary | null = null;
        if (liveAssignment && liveAssignment.match) {
          const m: any = liveAssignment.match;
          const scoringRounds = m.scoring_rounds || [];
          const currentRoundNum = scoringRounds.length > 0 
            ? Math.max(...scoringRounds.map((r: any) => r.round_number)) 
            : 1;

          const totalRedScore = scoringRounds.reduce((acc: number, r: any) => acc + (r.red_score || 0), 0);
          const totalBlueScore = scoringRounds.reduce((acc: number, r: any) => acc + (r.blue_score || 0), 0);
          const totalRedAdv = scoringRounds.reduce((acc: number, r: any) => acc + (r.red_advantage || 0), 0);
          const totalBlueAdv = scoringRounds.reduce((acc: number, r: any) => acc + (r.blue_advantage || 0), 0);

          activeMatch = {
            assignmentId: liveAssignment.id,
            matchId: m.id,
            matchNumber: m.match_number || 0,
            eventId: m.event_id,
            eventName: m.event?.name || 'Tournament Match',
            divisionName: m.event?.division || m.event?.category,
            weightCategory: m.event?.weight_class,
            roundName: `Round ${m.round_number || 1}`,
            roundNumber: m.round_number || 1,
            matchStatus: m.status,
            currentRound: currentRoundNum,
            startedAt: liveAssignment.assigned_at,
            redAthlete: {
              registrationId: m.red_athlete?.id || m.red_corner_registration_id || '',
              athleteName: m.red_athlete?.user_profile?.full_name || 'Red Corner',
              teamName: m.red_athlete?.team_name || 'TBD',
              score: totalRedScore,
              advantageCount: totalRedAdv
            },
            blueAthlete: {
              registrationId: m.blue_athlete?.id || m.blue_corner_registration_id || '',
              athleteName: m.blue_athlete?.user_profile?.full_name || 'Blue Corner',
              teamName: m.blue_athlete?.team_name || 'TBD',
              score: totalBlueScore,
              advantageCount: totalBlueAdv
            }
          };
        }

        // Parse Queue
        const mappedQueue: CourtQueuedMatchSummary[] = assignedQueue.map(item => {
          const m: any = item.match;
          return {
            assignmentId: item.id,
            matchId: m.id,
            matchNumber: m.match_number || 0,
            eventName: m.event?.name || 'Tournament Match',
            roundName: `Round ${m.round_number || 1}`,
            assignedAt: item.assigned_at,
            redAthlete: {
              registrationId: m.red_athlete?.id || m.red_corner_registration_id || '',
              athleteName: m.red_athlete?.user_profile?.full_name || 'Red Corner',
              teamName: m.red_athlete?.team_name || 'TBD'
            },
            blueAthlete: {
              registrationId: m.blue_athlete?.id || m.blue_corner_registration_id || '',
              athleteName: m.blue_athlete?.user_profile?.full_name || 'Blue Corner',
              teamName: m.blue_athlete?.team_name || 'TBD'
            }
          };
        });

        // Filter Officials for this court or general event managers
        const courtOfficials = (officialsData || [])
          .filter(off => off.court_id === court.id || (off.court_id === null && off.role === 'COURT_MANAGER'))
          .map(off => ({
            userId: off.user_id,
            fullName: (off.user as any)?.full_name || 'Official',
            role: off.role,
            courtId: off.court_id
          }));

        return {
          courtId: court.id,
          courtName: court.name,
          courtIdentifier: court.identifier,
          isActive: court.is_active,
          state,
          activeMatch,
          assignedQueue: mappedQueue,
          queueCount: mappedQueue.length,
          assignedOfficials: courtOfficials,
          nextOnDeck: mappedQueue.length > 0 ? mappedQueue[0] : null,
          completedCount
        };
      });

      return telemetryList;
    } catch (err) {
      console.error('Failed to fetch tournament courts telemetry:', err);
      throw err;
    }
  },

  /**
   * Fetches enriched match queue with deterministic state calculation (READY, WAITING, BLOCKED, ASSIGNED, LIVE, COMPLETED).
   */
  async fetchEnrichedMatchQueue(tournamentId: string, eventIdFilter?: string): Promise<EnrichedQueueMatch[]> {
    try {
      let query = supabase
        .from('matches')
        .select(`
          id,
          tournament_id,
          event_id,
          bracket_node_index,
          round_number,
          match_number,
          court_identifier,
          red_corner_registration_id,
          blue_corner_registration_id,
          winner_registration_id,
          status,
          next_match_id,
          next_match_corner,
          event:events (
            id,
            name,
            category,
            division,
            gender,
            weight_class
          ),
          red_athlete:registrations!matches_red_corner_registration_id_fkey (
            id,
            user_id,
            team_name,
            user_profile:profiles!registrations_user_id_fkey (
              id,
              full_name
            )
          ),
          blue_athlete:registrations!matches_blue_corner_registration_id_fkey (
            id,
            user_id,
            team_name,
            user_profile:profiles!registrations_user_id_fkey (
              id,
              full_name
            )
          ),
          court_assignments (
            id,
            court_id,
            status,
            court:courts (
              id,
              name,
              identifier
            )
          )
        `)
        .eq('tournament_id', tournamentId)
        .order('match_number', { ascending: true });

      if (eventIdFilter && eventIdFilter !== 'ALL') {
        query = query.eq('event_id', eventIdFilter);
      }

      const { data: matches, error } = await query;
      if (error) {
        console.error('Error fetching match queue:', error);
        throw error;
      }

      if (!matches) return [];

      return matches.map((m: any) => {
        const activeAssignment = (m.court_assignments || []).find((a: any) => a.status === 'ASSIGNED' || a.status === 'LIVE');
        
        let queueState: QueueItemState = 'READY';
        let dependencyNote = '';

        if (m.status === 'COMPLETED') {
          queueState = 'COMPLETED';
          dependencyNote = 'Match completed';
        } else if (m.status === 'IN_PROGRESS' || activeAssignment?.status === 'LIVE') {
          queueState = 'LIVE';
          dependencyNote = `In progress on ${activeAssignment?.court?.name || m.court_identifier || 'Court'}`;
        } else if (activeAssignment?.status === 'ASSIGNED') {
          queueState = 'ASSIGNED';
          dependencyNote = `Assigned to ${activeAssignment?.court?.name || m.court_identifier || 'Court'}`;
        } else if (!m.red_corner_registration_id && !m.blue_corner_registration_id) {
          queueState = 'BLOCKED';
          dependencyNote = 'Awaiting participants from feeder matches';
        } else if (!m.red_corner_registration_id || !m.blue_corner_registration_id) {
          queueState = 'WAITING';
          dependencyNote = 'Awaiting opponent from preceding round';
        } else {
          queueState = 'READY';
          dependencyNote = 'Both participants confirmed. Ready for court dispatch.';
        }

        return {
          matchId: m.id,
          matchNumber: m.match_number || 0,
          tournamentId: m.tournament_id,
          eventId: m.event_id,
          eventName: m.event?.name || 'Full Contact Match',
          gender: m.event?.gender || 'OPEN',
          division: m.event?.division || m.event?.category || 'General',
          weightClass: m.event?.weight_class || 'Standard',
          roundName: `Round ${m.round_number || 1}`,
          roundNumber: m.round_number || 1,
          bracketNodeIndex: m.bracket_node_index || 0,
          redAthlete: m.red_corner_registration_id ? {
            registrationId: m.red_corner_registration_id,
            athleteName: m.red_athlete?.user_profile?.full_name || 'Red Athlete',
            teamName: m.red_athlete?.team_name || 'TBD'
          } : null,
          blueAthlete: m.blue_corner_registration_id ? {
            registrationId: m.blue_corner_registration_id,
            athleteName: m.blue_athlete?.user_profile?.full_name || 'Blue Athlete',
            teamName: m.blue_athlete?.team_name || 'TBD'
          } : null,
          queueState,
          assignedCourtIdentifier: activeAssignment?.court?.identifier || m.court_identifier,
          assignedCourtId: activeAssignment?.court_id,
          assignmentId: activeAssignment?.id,
          dependencyNote,
          winnerRegistrationId: m.winner_registration_id,
          nextMatchId: m.next_match_id,
          nextMatchCorner: m.next_match_corner
        };
      });
    } catch (err) {
      console.error('Failed to fetch enriched match queue:', err);
      throw err;
    }
  },

  /**
   * Calculates high-level court operations KPI metrics.
   */
  calculateMetrics(telemetry: CourtTelemetry[], queue: EnrichedQueueMatch[]): CourtOperationsMetrics {
    const totalCourts = telemetry.length;
    const activeCourts = telemetry.filter(c => c.isActive).length;
    const liveMatchesCount = telemetry.filter(c => c.state === 'LIVE').length;
    const readyQueueCount = queue.filter(q => q.queueState === 'READY').length;
    const waitingQueueCount = queue.filter(q => q.queueState === 'WAITING' || q.queueState === 'BLOCKED').length;
    const assignedQueueCount = queue.filter(q => q.queueState === 'ASSIGNED').length;
    const completedMatchesCount = queue.filter(q => q.queueState === 'COMPLETED').length;

    const courtUtilizationPercentage = activeCourts > 0
      ? Math.round((liveMatchesCount / activeCourts) * 100)
      : 0;

    return {
      totalCourts,
      activeCourts,
      liveMatchesCount,
      readyQueueCount,
      waitingQueueCount,
      assignedQueueCount,
      completedMatchesCount,
      courtUtilizationPercentage
    };
  },

  /**
   * Dispatches a match to a court using the existing backend assign_match_to_court RPC.
   */
  async dispatchMatchToCourt(matchId: string, courtId: string): Promise<{ success: boolean; assignment_id: string }> {
    return scoringService.assignMatchToCourt(matchId, courtId);
  },

  /**
   * Starts a court match using existing backend start_court_match RPC.
   */
  async startLiveMatch(assignmentId: string): Promise<{ success: boolean; match_id: string; court_id: string }> {
    return scoringService.startCourtMatch(assignmentId);
  },

  /**
   * Cancels a queued court assignment using existing backend cancel_match_assignment RPC.
   */
  async cancelDispatch(assignmentId: string, reason = 'Operator Queue Reordering'): Promise<{ success: boolean }> {
    return scoringService.cancelMatchAssignment(assignmentId, reason);
  },

  /**
   * Toggles court active status (Offline vs Online).
   */
  async setCourtActiveStatus(courtId: string, isActive: boolean): Promise<void> {
    const { error } = await supabase
      .from('courts')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', courtId);

    if (error) {
      console.error('Error updating court active status:', error);
      throw error;
    }
  },

  /**
   * Logs an operational incident report for a tournament (server-authorized).
   */
  async logTournamentIncident(params: {
    tournamentId: string;
    action: string;
    severity?: IncidentSeverity | 'LOW' | 'MEDIUM' | 'HIGH';
    entityType?: string;
    entityId?: string;
    details?: Record<string, any>;
  }): Promise<{ success: boolean; log_id: string; action: string; severity: string }> {
    const { data, error } = await supabase.rpc('log_tournament_incident', {
      p_tournament_id: params.tournamentId,
      p_action: params.action,
      p_severity: params.severity || 'WARNING',
      p_entity_type: params.entityType || 'INCIDENT',
      p_entity_id: params.entityId || null,
      p_details: params.details || {}
    });

    if (error) {
      console.error('Error logging tournament incident:', error);
      throw error;
    }

    return data;
  },

  /**
   * Fetches authoritative system audit logs for a tournament (append-only governance ledger).
   * First invokes the scoped get_tournament_incident_logs RPC (accessible to authorized tournament officials).
   * Falls back to direct SELECT on system_audit_logs if needed.
   */
  async fetchTournamentAuditLogs(tournamentId: string, limit = 50): Promise<SystemAuditLogEntry[]> {
    try {
      // 1. Authoritative tournament-scoped RPC
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_tournament_incident_logs', {
        p_tournament_id: tournamentId,
        p_limit: limit
      });

      if (!rpcError && rpcData) {
        return rpcData.map((row: any) => ({
          id: row.id,
          actor_user_id: row.actor_user_id,
          actor_role: row.actor_role,
          action: row.action,
          entity_type: row.entity_type,
          entity_id: row.entity_id,
          tournament_id: row.tournament_id,
          details: row.details,
          ip_address: row.ip_address,
          created_at: row.created_at,
          actor_profile: row.actor_name || row.actor_email ? {
            full_name: row.actor_name,
            email: row.actor_email
          } : null
        }));
      }

      // 2. Direct fallback (for direct Super Admin queries or backwards compatibility)
      const { data, error } = await supabase
        .from('system_audit_logs')
        .select(`
          id,
          actor_user_id,
          actor_role,
          action,
          entity_type,
          entity_id,
          tournament_id,
          details,
          ip_address,
          created_at,
          actor_profile:profiles!system_audit_logs_actor_user_id_fkey (
            full_name,
            email
          )
        `)
        .eq('tournament_id', tournamentId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.warn('System audit logs fallback warning:', error.message);
        return [];
      }

      return (data || []) as SystemAuditLogEntry[];
    } catch (err) {
      console.warn('Failed to fetch system audit logs:', err);
      return [];
    }
  },

  /**
   * Subscribes to realtime updates for courts, assignments, and matches.
   * Uses unique topic suffixes and debouncing to prevent channel reuse collisions.
   */
  subscribeToCourtOperations(tournamentId: string, onUpdate: () => void): () => void {
    let debounceTimer: NodeJS.Timeout | null = null;
    const debouncedRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        onUpdate();
      }, 250);
    };

    const channelTopic = `court_ops_${tournamentId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const channel = supabase
      .channel(channelTopic)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'court_assignments' },
        () => debouncedRefresh()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches', filter: `tournament_id=eq.${tournamentId}` },
        () => debouncedRefresh()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'courts', filter: `tournament_id=eq.${tournamentId}` },
        () => debouncedRefresh()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'scoring_rounds' },
        () => debouncedRefresh()
      )
      .subscribe((status) => {
        if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
          console.warn(`Realtime court_ops subscription status on topic ${channelTopic}: ${status}`);
        }
      });

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }
};
