import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { coachSuccessionService } from '../../services/coachSuccessionService';
import { playerMembershipService } from '../../services/playerMembershipService';
import { playerTransferService } from '../../services/playerTransferService';
import { tournamentService } from '../../services/tournamentService';
import { AssignedCoachClub, Club, ActiveClubCoach, CoachRoleType, ClubCoachAssignment } from '../../types/coachSuccession';
import { ClubRosterMember, MembershipType, CoachAthleteSearchResult, MembershipStatus } from '../../types/playerMembership';
import { ClubPendingTransferItem } from '../../types/playerTransfer';
import { Tournament, TournamentEvent, Registration } from '../../types/tournament';
import { NavigationTab } from '../../utils/authorization';
import { CopyableId } from '../common/CopyableId';
import { CoachSuccessionManagement } from '../admin/CoachSuccessionManagement';
import {
  Shield,
  Users,
  Clock,
  ArrowRightLeft,
  Info,
  CheckCircle2,
  XCircle,
  UserMinus,
  RefreshCw,
  AlertTriangle,
  Send,
  Building2,
  Calendar,
  Award,
  ChevronRight,
  UserCheck,
  Search,
  Check,
  X,
  Plus,
  ShieldAlert,
  UserPlus,
  RotateCcw,
  Trophy,
  Lock,
  Unlock,
  ArrowUpDown,
  Layers,
} from 'lucide-react';

interface CoachTeamManagementViewProps {
  onNavigateTab?: (tab: NavigationTab) => void;
}

type SubTab = 'roster' | 'pending' | 'transfers' | 'club_info' | 'lineup';

export const CoachTeamManagementView: React.FC<CoachTeamManagementViewProps> = ({ onNavigateTab }) => {
  const { user, roles } = useAuth();
  const isSuperAdmin = roles.includes('SUPER_ADMIN');
  const hasAdminAccess = roles.includes('SUPER_ADMIN') || roles.includes('ADMIN');

  // Top-level section for Admin users
  const [adminViewMode, setAdminViewMode] = useState<'roster' | 'governance'>('roster');

  // Multi-club selection state
  const [assignedClubs, setAssignedClubs] = useState<AssignedCoachClub[]>([]);
  const [allClubs, setAllClubs] = useState<Club[]>([]);
  const [selectedClubId, setSelectedClubId] = useState<string>('');
  const [loadingClubs, setLoadingClubs] = useState<boolean>(true);

  // Active sub-tab
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('roster');

  // Club Data
  const [activeRoster, setActiveRoster] = useState<ClubRosterMember[]>([]);
  const [suspendedRoster, setSuspendedRoster] = useState<ClubRosterMember[]>([]);
  const [relievedRoster, setRelievedRoster] = useState<ClubRosterMember[]>([]);
  const [pendingRequests, setPendingRequests] = useState<ClubRosterMember[]>([]);
  const [pendingTransfers, setPendingTransfers] = useState<ClubPendingTransferItem[]>([]);
  const [activeCoachInfo, setActiveCoachInfo] = useState<ActiveClubCoach | null>(null);
  const [coachHistory, setCoachHistory] = useState<ClubCoachAssignment[]>([]);
  const [loadingData, setLoadingData] = useState<boolean>(false);

  // Status feedback
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Modals / Action states (Relieve & Succession preserved)
  const [relieveModalMember, setRelieveModalMember] = useState<ClubRosterMember | null>(null);
  const [relieveReason, setRelieveReason] = useState<string>('');

  const [reviewNotes, setReviewNotes] = useState<{ [id: string]: string }>({});

  const [showSuccessionModal, setShowSuccessionModal] = useState<boolean>(false);
  const [incomingCoachUserId, setIncomingCoachUserId] = useState<string>('');
  const [successionRoleType, setSuccessionRoleType] = useState<CoachRoleType>('HEAD_COACH');
  const [successionReason, setSuccessionReason] = useState<string>('');

  // PHASE 3-F: Athlete Search & Add Modal states
  const [showAddAthleteModal, setShowAddAthleteModal] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<CoachAthleteSearchResult[]>([]);
  const [searchingAthletes, setSearchingAthletes] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedAthlete, setSelectedAthlete] = useState<CoachAthleteSearchResult | null>(null);
  const [addMembershipType, setAddMembershipType] = useState<MembershipType>('REGULAR');
  const [addNotes, setAddNotes] = useState<string>('');

  // PHASE 3-F: Suspend Modal states
  const [suspendModalMember, setSuspendModalMember] = useState<ClubRosterMember | null>(null);
  const [suspendReason, setSuspendReason] = useState<string>('');

  // PHASE 3-F: Restore Modal states (SUSPENDED -> ACTIVE)
  const [restoreModalMember, setRestoreModalMember] = useState<ClubRosterMember | null>(null);
  const [restoreNotes, setRestoreNotes] = useState<string>('');

  // FIND-010: Re-admit Modal states (RELIEVED -> ACTIVE via coachAddPlayer)
  const [readmitModalMember, setReadmitModalMember] = useState<ClubRosterMember | null>(null);
  const [readmitNotes, setReadmitNotes] = useState<string>('');

  // PHASE 3-G: Tournament Lineups state
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string>('');
  const [events, setEvents] = useState<TournamentEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [loadingTournaments, setLoadingTournaments] = useState<boolean>(false);
  const [loadingEvents, setLoadingEvents] = useState<boolean>(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [eventRegistrations, setEventRegistrations] = useState<Registration[]>([]);
  const [loadingRegistrations, setLoadingRegistrations] = useState<boolean>(false);
  const eventRequestIdRef = useRef<number>(0);
  const clubRequestIdRef = useRef<number>(0);

  // Staged lineup/reserve draft state for selected event
  const [lineupUserIds, setLineupUserIds] = useState<string[]>([]);
  const [reserveUserIds, setReserveUserIds] = useState<string[]>([]);
  const [isLineupDirty, setIsLineupDirty] = useState<boolean>(false);
  const [savingLineup, setSavingLineup] = useState<boolean>(false);

  // PHASE 3-G: Atomic Swap Modal states
  const [showSwapModal, setShowSwapModal] = useState<boolean>(false);
  const [swapLineupRegId, setSwapLineupRegId] = useState<string>('');
  const [swapReserveRegId, setSwapReserveRegId] = useState<string>('');
  const [swapping, setSwapping] = useState<boolean>(false);

  // 1. Fetch Clubs assigned to Coach
  const fetchClubs = useCallback(async () => {
    if (!user) return;
    setLoadingClubs(true);
    try {
      const myClubs = await coachSuccessionService.getMyAssignedClubs(user.id);
      setAssignedClubs(myClubs);

      if (hasAdminAccess) {
        const clubs = await coachSuccessionService.getClubs();
        setAllClubs(clubs);
      }

      if (myClubs.length > 0) {
        // Keep existing selected club if valid, or select first
        setSelectedClubId((prev) => {
          const exists = myClubs.some((c) => c.club_id === prev);
          return exists ? prev : myClubs[0].club_id;
        });
      } else if (hasAdminAccess) {
        const clubs = await coachSuccessionService.getClubs();
        if (clubs.length > 0) {
          setSelectedClubId((prev) => {
            const exists = clubs.some((c) => c.id === prev);
            return exists ? prev : clubs[0].id;
          });
        }
      }
    } catch (err: any) {
      console.error('Failed to load coach clubs:', err);
      setActionMessage({ type: 'error', text: 'Failed to fetch assigned club data.' });
    } finally {
      setLoadingClubs(false);
    }
  }, [user, hasAdminAccess]);

  useEffect(() => {
    fetchClubs();
  }, [fetchClubs]);

  // 2. Fetch Roster & Transfers for selected club (ALL roster members for active delegation, PENDING for queue)
  const fetchClubData = useCallback(async () => {
    const currentReqId = ++clubRequestIdRef.current;

    if (!selectedClubId) {
      setActiveRoster([]);
      setPendingRequests([]);
      setPendingTransfers([]);
      setActiveCoachInfo(null);
      setCoachHistory([]);
      return;
    }

    setLoadingData(true);
    try {
      const [allMembersRes, pendingRes, transfersRes, activeCoachRes, historyRes] = await Promise.allSettled([
        playerMembershipService.getClubRoster(selectedClubId, 'ALL'),
        playerMembershipService.getClubRoster(selectedClubId, 'PENDING'),
        playerTransferService.getPendingClubTransfers(selectedClubId),
        coachSuccessionService.getClubActiveCoach(selectedClubId),
        coachSuccessionService.getClubCoachHistory(selectedClubId),
      ]);

      if (currentReqId !== clubRequestIdRef.current) {
        return; // Discard stale response
      }

      const allMembers = allMembersRes.status === 'fulfilled' && Array.isArray(allMembersRes.value) ? allMembersRes.value : [];
      const pending = pendingRes.status === 'fulfilled' && Array.isArray(pendingRes.value) ? pendingRes.value : [];
      const transfers = transfersRes.status === 'fulfilled' && Array.isArray(transfersRes.value) ? transfersRes.value : [];
      const activeCoach = activeCoachRes.status === 'fulfilled' ? activeCoachRes.value : null;
      const history = historyRes.status === 'fulfilled' && Array.isArray(historyRes.value) ? historyRes.value : [];

      console.log('[FIND-004] ROSTER RESULT:', allMembers);

      // Deduplicate each list by player_user_id, taking the latest effective membership
      const deduplicateMembers = (membersList: ClubRosterMember[]): ClubRosterMember[] => {
        const seen = new Set<string>();
        const result: ClubRosterMember[] = [];
        for (const member of membersList) {
          if (!seen.has(member.player_user_id)) {
            seen.add(member.player_user_id);
            result.push(member);
          }
        }
        return result;
      };

      // FIND-049: Active delegation roster must contain ONLY athletes with status === 'ACTIVE'
      const activeMembers = deduplicateMembers(
        allMembers.filter((m) => m.status === 'ACTIVE')
      );

      // Suspended athletes separated from active roster
      const suspendedMembers = deduplicateMembers(
        allMembers.filter((m) => m.status === 'SUSPENDED')
      );

      // Relieved and transferred athletes separated into historical/inactive records
      // Filter out any athlete who is currently ACTIVE or SUSPENDED in the club to prevent duplicate representation
      const activeOrSuspendedUserIds = new Set([
        ...activeMembers.map((m) => m.player_user_id),
        ...suspendedMembers.map((m) => m.player_user_id),
      ]);
      const relievedMembers = deduplicateMembers(
        allMembers.filter(
          (m) =>
            (m.status === 'RELIEVED' || m.status === 'TRANSFERRED') &&
            !activeOrSuspendedUserIds.has(m.player_user_id)
        )
      );

      setActiveRoster(activeMembers);
      setSuspendedRoster(suspendedMembers);
      setRelievedRoster(relievedMembers);
      setPendingRequests(pending);
      setPendingTransfers(transfers);
      setActiveCoachInfo(activeCoach);
      setCoachHistory(history);

      if (transfersRes.status === 'rejected') {
        console.warn('[FIND-004] Non-blocking transfer fetch notice:', transfersRes.reason);
      }
      if (allMembersRes.status === 'rejected') {
        console.error('[FIND-004] Failed to load club roster:', allMembersRes.reason);
        setActionMessage({ type: 'error', text: 'Error loading club roster.' });
      }
    } catch (err: any) {
      if (currentReqId === clubRequestIdRef.current) {
        console.error('Failed to load club details:', err);
        setActionMessage({ type: 'error', text: 'Error loading team data.' });
      }
    } finally {
      if (currentReqId === clubRequestIdRef.current) {
        setLoadingData(false);
      }
    }
  }, [selectedClubId]);

  useEffect(() => {
    fetchClubData();
  }, [fetchClubData]);

  // PHASE 3-F: Debounced Athlete Search Effect (300ms, minimum 2 characters)
  useEffect(() => {
    if (!showAddAthleteModal) {
      setSearchQuery('');
      setSearchResults([]);
      setSelectedAthlete(null);
      setSearchError(null);
      setSearchingAthletes(false);
      return;
    }

    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setSearchError(null);
      setSearchingAthletes(false);
      return;
    }

    setSearchingAthletes(true);
    setSearchError(null);

    const timer = setTimeout(async () => {
      try {
        const results = await playerMembershipService.searchAthletesForCoach(trimmed);
        setSearchResults(results);
      } catch (err: any) {
        console.error('Athlete search error:', err);
        setSearchError(err.message || 'Failed to search athletes.');
      } finally {
        setSearchingAthletes(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, showAddAthleteModal]);

  // Dismiss action message after 5 seconds
  useEffect(() => {
    if (actionMessage) {
      const timer = setTimeout(() => setActionMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [actionMessage]);

  // Identify current selected club details
  const selectedClub = 
    assignedClubs.find((c) => c.club_id === selectedClubId)?.club ||
    allClubs.find((c) => c.id === selectedClubId);

  const selectedCoachAssignment = assignedClubs.find((c) => c.club_id === selectedClubId);

  // Action Handlers (Phase 3-F additions + preserved handlers)
  const handleConfirmAddPlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('[FIND-004] HANDLE ENTERED');
    const playerUserId = selectedAthlete?.user_id;

    console.log('[FIND-004] selectedAthlete:', selectedAthlete);
    console.log('[FIND-004] playerUserId:', playerUserId);
    console.log('[FIND-004] selectedClubId:', selectedClubId);
    console.log('[FIND-004] membershipType:', addMembershipType);

    if (!selectedClubId || !playerUserId) {
      setActionMessage({
        type: 'error',
        text: 'Please select an athlete with a valid profile ID.',
      });
      return;
    }

    setProcessingId('add_player_submit');
    try {
      const result = await playerMembershipService.coachAddPlayer(
        selectedClubId,
        playerUserId,
        addMembershipType,
        addNotes.trim() || undefined
      );

      if (result.success) {
        console.log('[FIND-004] RPC SUCCESS:', result);
        setActionMessage({
          type: 'success',
          text: result.message || `Athlete ${selectedAthlete?.full_name || 'selected'} added to club roster successfully.`,
        });
        setShowAddAthleteModal(false);
        setSelectedAthlete(null);
        setSearchQuery('');
        setAddNotes('');
        console.log('[FIND-004] FETCH CLUB DATA START');
        await fetchClubData();
      } else {
        setActionMessage({
          type: 'error',
          text: result.error || 'Failed to add athlete to club.',
        });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'An error occurred while adding athlete.' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleConfirmSuspendPlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suspendModalMember || !suspendReason.trim()) return;
    setProcessingId(suspendModalMember.membership_id);
    try {
      const result = await playerMembershipService.suspendPlayer(
        suspendModalMember.membership_id,
        suspendReason.trim()
      );

      if (result.success) {
        setActionMessage({
          type: 'success',
          text: result.message || `Athlete ${suspendModalMember.full_name} placed on suspension.`,
        });
        setSuspendModalMember(null);
        setSuspendReason('');
        await fetchClubData();
      } else {
        setActionMessage({
          type: 'error',
          text: result.error || 'Failed to suspend athlete.',
        });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'An error occurred while suspending athlete.' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleConfirmRestorePlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restoreModalMember) return;
    setProcessingId(restoreModalMember.membership_id);
    try {
      const result = await playerMembershipService.restorePlayer(
        restoreModalMember.membership_id,
        restoreNotes.trim() || undefined
      );

      if (result.success) {
        setActionMessage({
          type: 'success',
          text: result.message || `Athlete ${restoreModalMember.full_name} restored to active status.`,
        });
        setRestoreModalMember(null);
        setRestoreNotes('');
        await fetchClubData();
      } else {
        setActionMessage({
          type: 'error',
          text: result.error || 'Failed to restore athlete.',
        });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'An error occurred while restoring athlete.' });
    } finally {
      setProcessingId(null);
    }
  };

  // FIND-010: Re-admit RELIEVED athlete back to ACTIVE status using existing coachAddPlayer RPC
  const handleConfirmReadmitPlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!readmitModalMember || !selectedClubId) return;
    setProcessingId(readmitModalMember.membership_id);
    try {
      const result = await playerMembershipService.coachAddPlayer(
        selectedClubId,
        readmitModalMember.player_user_id,
        readmitModalMember.membership_type,
        readmitNotes.trim() || 'Re-admitted to active roster by Coach'
      );

      if (result.success) {
        setActionMessage({
          type: 'success',
          text: result.message || `Athlete ${readmitModalMember.full_name} successfully re-admitted to active roster.`,
        });
        setReadmitModalMember(null);
        setReadmitNotes('');
        await fetchClubData();
      } else {
        setActionMessage({
          type: 'error',
          text: result.error || 'Failed to re-admit athlete to active roster.',
        });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'An error occurred while re-admitting athlete.' });
    } finally {
      setProcessingId(null);
    }
  };
  const handleApproveMembership = async (membershipId: string) => {
    setProcessingId(membershipId);
    try {
      const notes = reviewNotes[membershipId] || '';
      const result = await playerMembershipService.approveMembership(membershipId, notes);
      if (result.success) {
        setActionMessage({ type: 'success', text: result.message || 'Membership approved successfully.' });
        await fetchClubData();
      } else {
        setActionMessage({ type: 'error', text: result.error || 'Failed to approve membership.' });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'An error occurred.' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleRejectMembership = async (membershipId: string) => {
    setProcessingId(membershipId);
    try {
      const notes = reviewNotes[membershipId] || '';
      const result = await playerMembershipService.rejectMembership(membershipId, notes);
      if (result.success) {
        setActionMessage({ type: 'success', text: result.message || 'Membership application rejected.' });
        await fetchClubData();
      } else {
        setActionMessage({ type: 'error', text: result.error || 'Failed to reject membership.' });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'An error occurred.' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleConfirmRelievePlayer = async () => {
    if (!relieveModalMember) return;
    setProcessingId(relieveModalMember.membership_id);
    try {
      const result = await playerMembershipService.relieveMembership(
        relieveModalMember.membership_id,
        relieveReason || 'Relieved by Coach'
      );
      if (result.success) {
        setActionMessage({ type: 'success', text: result.message || 'Player relieved from active roster.' });
        setRelieveModalMember(null);
        setRelieveReason('');
        await fetchClubData();
      } else {
        setActionMessage({ type: 'error', text: result.error || 'Failed to relieve player.' });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'An error occurred.' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleApproveOutgoingTransfer = async (transferId: string) => {
    setProcessingId(transferId);
    try {
      const result = await playerTransferService.approveOutgoingTransfer(transferId);
      if (result.success) {
        setActionMessage({ type: 'success', text: result.message || 'Outgoing transfer approved.' });
        await fetchClubData();
      } else {
        setActionMessage({ type: 'error', text: result.error || 'Failed to approve outgoing transfer.' });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'An error occurred.' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleApproveIncomingTransfer = async (transferId: string) => {
    setProcessingId(transferId);
    try {
      const result = await playerTransferService.approveIncomingTransfer(transferId);
      if (result.success) {
        setActionMessage({ type: 'success', text: result.message || 'Incoming transfer accepted.' });
        await fetchClubData();
      } else {
        setActionMessage({ type: 'error', text: result.error || 'Failed to accept incoming transfer.' });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'An error occurred.' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleRejectTransfer = async (transferId: string) => {
    setProcessingId(transferId);
    try {
      const reason = reviewNotes[transferId] || 'Rejected by Coach';
      const result = await playerTransferService.rejectTransfer(transferId, reason);
      if (result.success) {
        setActionMessage({ type: 'success', text: result.message || 'Transfer request rejected.' });
        await fetchClubData();
      } else {
        setActionMessage({ type: 'error', text: result.error || 'Failed to reject transfer.' });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'An error occurred.' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleRequestSuccession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClubId || !incomingCoachUserId.trim()) return;

    setProcessingId('succession_submit');
    try {
      const result = await coachSuccessionService.requestSuccession(
        selectedClubId,
        incomingCoachUserId.trim(),
        successionRoleType,
        successionReason.trim() || undefined
      );

      if (result.success) {
        setActionMessage({
          type: 'success',
          text: 'Coach succession request submitted to Super Admin for approval.',
        });
        setShowSuccessionModal(false);
        setIncomingCoachUserId('');
        setSuccessionReason('');
        await fetchClubData();
      } else {
        setActionMessage({
          type: 'error',
          text: result.error || 'Failed to submit coach succession request.',
        });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'An error occurred.' });
    } finally {
      setProcessingId(null);
    }
  };

  // Helper for Membership type badge
  const renderMembershipBadge = (type: MembershipType) => {
    switch (type) {
      case 'STUDENT_ATHLETE':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-950 text-blue-300 border border-blue-800">STUDENT ATHLETE</span>;
      case 'VARSITY':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-950 text-amber-300 border border-amber-800">VARSITY</span>;
      case 'ALUMNI':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-950 text-purple-300 border border-purple-800">ALUMNI</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-800 text-slate-300 border border-slate-700">REGULAR</span>;
    }
  };

  // PHASE 3-F: Helper for Roster Member Status badge
  const renderStatusBadge = (status: MembershipStatus) => {
    switch (status) {
      case 'ACTIVE':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 inline-flex items-center space-x-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            <span>ACTIVE</span>
          </span>
        );
      case 'SUSPENDED':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-950 text-amber-300 border border-amber-800 inline-flex items-center space-x-1">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            <span>SUSPENDED</span>
          </span>
        );
      case 'RELIEVED':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-800 text-slate-400 border border-slate-700 inline-flex items-center space-x-1">
            <UserMinus className="w-3 h-3 text-slate-400" />
            <span>RELIEVED</span>
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-800 text-slate-300 border border-slate-700">
            {status}
          </span>
        );
    }
  };

  // ====================================================================
  // PHASE 3-G: TOURNAMENT LINEUPS & RESERVES ENGINE
  // ====================================================================

  // Current selected tournament model & locking rule
  const selectedTournament = tournaments.find((t) => t.id === selectedTournamentId) || null;
  const isTournamentLocked =
    !selectedTournament ||
    ['ONGOING', 'COMPLETED', 'CANCELLED', 'DRAFT'].includes(selectedTournament.status);

  // Safely normalized pending transfers collection
  const safePendingTransfers = Array.isArray(pendingTransfers) ? pendingTransfers : [];

  // Active verified eligible athletes in this club
  const activeEligibleAthletes = activeRoster.filter((m) => m.status === 'ACTIVE');

  // Currently selected event model
  const selectedEvent = events.find((ev) => ev.id === selectedEventId) || null;

  // Unassigned eligible club athletes for the current event
  const unassignedAthletes = activeEligibleAthletes.filter(
    (m) => !lineupUserIds.includes(m.player_user_id) && !reserveUserIds.includes(m.player_user_id)
  );

  // Authoritative registered Lineup and Reserve lists from database
  const currentLineupRegistrations = eventRegistrations.filter(
    (r) => r.lineup_role === 'LINEUP' && r.club_id === selectedClubId
  );
  const currentReserveRegistrations = eventRegistrations.filter(
    (r) => r.lineup_role === 'RESERVE' && r.club_id === selectedClubId
  );

  // Authoritative approval counts
  const approvedLineupCount = currentLineupRegistrations.filter((r) => r.is_approved).length;
  const pendingLineupCount = currentLineupRegistrations.filter((r) => !r.is_approved).length;
  const approvedReserveCount = currentReserveRegistrations.filter((r) => r.is_approved).length;
  const pendingReserveCount = currentReserveRegistrations.filter((r) => !r.is_approved).length;
  const hasExistingSubmission = currentLineupRegistrations.length > 0 || currentReserveRegistrations.length > 0;

  // Fetch Tournaments when Lineup Tab is activated
  const fetchTournaments = useCallback(async () => {
    setLoadingTournaments(true);
    try {
      const list = await tournamentService.getTournaments();
      setTournaments(list);
      if (list.length > 0) {
        setSelectedTournamentId((prev) => {
          // 1. Preserve existing user selection if it still exists in the list
          const exists = list.some((t) => t.id === prev);
          if (exists) return prev;

          // 2. Deterministically select the active/registration-capable tournament (REGISTRATION_OPEN > ONGOING > REGISTRATION_CLOSED)
          const activeTournament =
            list.find((t) => t.status === 'REGISTRATION_OPEN') ||
            list.find((t) => t.status === 'ONGOING') ||
            list.find((t) => t.status === 'REGISTRATION_CLOSED');
          if (activeTournament) return activeTournament.id;

          // 3. Fallback to first tournament in list
          return list[0].id;
        });
      } else {
        setSelectedTournamentId('');
      }
    } catch (err: any) {
      console.error('Failed to load tournaments for lineups:', err);
      setActionMessage({ type: 'error', text: 'Failed to load tournaments.' });
    } finally {
      setLoadingTournaments(false);
    }
  }, []);

  useEffect(() => {
    if (activeSubTab === 'lineup') {
      fetchTournaments();
    }
  }, [activeSubTab, fetchTournaments]);

  // Fetch Events when Tournament is selected with request-generation race protection
  const fetchEvents = useCallback(async (targetTournamentId?: string) => {
    const tournamentIdToFetch = targetTournamentId || selectedTournamentId;
    if (!tournamentIdToFetch) {
      setEvents([]);
      setSelectedEventId('');
      setLoadingEvents(false);
      setEventsError(null);
      return;
    }

    const currentReqId = ++eventRequestIdRef.current;
    setLoadingEvents(true);
    setEventsError(null);

    try {
      const eventList = await tournamentService.getEventsByTournamentId(tournamentIdToFetch);
      // Ensure we only apply results if this is still the latest request for the active tournament
      if (currentReqId === eventRequestIdRef.current) {
        setEvents(eventList);
        if (eventList.length > 0) {
          setSelectedEventId((prev) => {
            const exists = eventList.some((e) => e.id === prev);
            return exists ? prev : eventList[0].id;
          });
        } else {
          setSelectedEventId('');
        }
      }
    } catch (err: any) {
      console.error('Failed to load tournament events:', err);
      if (currentReqId === eventRequestIdRef.current) {
        setEventsError('Unable to load competition events. Please refresh and try again.');
        setEvents([]);
        setSelectedEventId('');
      }
    } finally {
      if (currentReqId === eventRequestIdRef.current) {
        setLoadingEvents(false);
      }
    }
  }, [selectedTournamentId]);

  useEffect(() => {
    if (activeSubTab === 'lineup') {
      if (selectedTournamentId) {
        setLoadingEvents(true);
        fetchEvents(selectedTournamentId);
      } else if (!loadingTournaments) {
        setEvents([]);
        setSelectedEventId('');
        setLoadingEvents(false);
        setEventsError(null);
      }
    }
  }, [activeSubTab, selectedTournamentId, loadingTournaments, fetchEvents]);

  // Fetch Registrations & Initialize Lineup Draft when Event or Club changes
  const fetchEventRegistrations = useCallback(async () => {
    if (!selectedEventId || !selectedClubId) {
      setEventRegistrations([]);
      setLineupUserIds([]);
      setReserveUserIds([]);
      setIsLineupDirty(false);
      return;
    }
    setLoadingRegistrations(true);
    try {
      const regs = await tournamentService.getEventRegistrationsWithLineup(selectedEventId, selectedClubId);
      setEventRegistrations(regs);

      const dbLineup = regs
        .filter((r) => r.lineup_role === 'LINEUP' && r.club_id === selectedClubId)
        .map((r) => r.user_id);
      const dbReserve = regs
        .filter((r) => r.lineup_role === 'RESERVE' && r.club_id === selectedClubId)
        .map((r) => r.user_id);

      setLineupUserIds(dbLineup);
      setReserveUserIds(dbReserve);
      setIsLineupDirty(false);
    } catch (err: any) {
      console.error('Failed to load event registrations:', err);
      setActionMessage({ type: 'error', text: 'Failed to load event registrations.' });
    } finally {
      setLoadingRegistrations(false);
    }
  }, [selectedEventId, selectedClubId]);

  useEffect(() => {
    if (activeSubTab === 'lineup' && selectedEventId && selectedClubId) {
      fetchEventRegistrations();
    }
  }, [activeSubTab, selectedEventId, selectedClubId, fetchEventRegistrations]);

  // Staged allocation handlers
  const handleAddLineup = (userId: string) => {
    setReserveUserIds((prev) => prev.filter((id) => id !== userId));
    setLineupUserIds((prev) => (prev.includes(userId) ? prev : [...prev, userId]));
    setIsLineupDirty(true);
  };

  const handleAddReserve = (userId: string) => {
    setLineupUserIds((prev) => prev.filter((id) => id !== userId));
    setReserveUserIds((prev) => (prev.includes(userId) ? prev : [...prev, userId]));
    setIsLineupDirty(true);
  };

  const handleDemoteToReserve = (userId: string) => {
    setLineupUserIds((prev) => prev.filter((id) => id !== userId));
    setReserveUserIds((prev) => (prev.includes(userId) ? prev : [...prev, userId]));
    setIsLineupDirty(true);
  };

  const handlePromoteToLineup = (userId: string) => {
    setReserveUserIds((prev) => prev.filter((id) => id !== userId));
    setLineupUserIds((prev) => (prev.includes(userId) ? prev : [...prev, userId]));
    setIsLineupDirty(true);
  };

  const handleUnassign = (userId: string) => {
    setLineupUserIds((prev) => prev.filter((id) => id !== userId));
    setReserveUserIds((prev) => prev.filter((id) => id !== userId));
    setIsLineupDirty(true);
  };

  const handleDiscardChanges = () => {
    const dbLineup = eventRegistrations
      .filter((r) => r.lineup_role === 'LINEUP' && r.club_id === selectedClubId)
      .map((r) => r.user_id);
    const dbReserve = eventRegistrations
      .filter((r) => r.lineup_role === 'RESERVE' && r.club_id === selectedClubId)
      .map((r) => r.user_id);

    setLineupUserIds(dbLineup);
    setReserveUserIds(dbReserve);
    setIsLineupDirty(false);
  };

  // RPC: Save & Apply Lineup
  const handleSaveLineup = async () => {
    if (!selectedEventId || !selectedClubId) return;
    if (isTournamentLocked) {
      setActionMessage({ type: 'error', text: 'Lineups cannot be modified for this tournament state.' });
      return;
    }

    setSavingLineup(true);
    setActionMessage(null);
    try {
      const response = await tournamentService.coachSetEventLineup({
        event_id: selectedEventId,
        club_id: selectedClubId,
        lineup_user_ids: lineupUserIds,
        reserve_user_ids: reserveUserIds,
      });

      // Reload registrations from database to ensure local state reflects authoritative truth
      await fetchEventRegistrations();
      setIsLineupDirty(false);
      setActionMessage({
        type: 'success',
        text: `Lineup Submitted Successfully: Your team lineup (${lineupUserIds.length} Starting Lineup, ${reserveUserIds.length} Standby Reserves) has been submitted to the tournament registration ledger and is awaiting administrative approval.`,
      });
    } catch (err: any) {
      console.error('Failed to save lineup:', err);
      setActionMessage({ type: 'error', text: err.message || 'Failed to save lineup.' });
    } finally {
      setSavingLineup(false);
    }
  };

  // RPC: Atomic Lineup ↔ Reserve Swap
  const handleExecuteSwap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventId || !selectedClubId || !swapLineupRegId || !swapReserveRegId) return;
    if (isTournamentLocked) {
      setActionMessage({ type: 'error', text: 'Substitution is locked for this tournament state.' });
      return;
    }

    setSwapping(true);
    setActionMessage(null);
    try {
      const response = await tournamentService.swapEventLineupReserve({
        event_id: selectedEventId,
        club_id: selectedClubId,
        lineup_reg_id: swapLineupRegId,
        reserve_reg_id: swapReserveRegId,
      });

      // Reload registrations from database
      await fetchEventRegistrations();
      setShowSwapModal(false);
      setSwapLineupRegId('');
      setSwapReserveRegId('');
      setActionMessage({
        type: 'success',
        text: response.message || 'Athletes swapped successfully.',
      });
    } catch (err: any) {
      console.error('Failed to swap athletes:', err);
      setActionMessage({ type: 'error', text: err.message || 'Failed to swap athletes.' });
    } finally {
      setSwapping(false);
    }
  };

  // Loading State
  if (loadingClubs) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 flex flex-col items-center justify-center space-y-3">
          <RefreshCw className="w-8 h-8 animate-spin text-amber-400" />
          <p className="text-sm text-slate-400 font-mono">Loading assigned club &amp; team authority...</p>
        </div>
      </div>
    );
  }

  // No Assigned Club State (for Coach without Admin role)
  if (assignedClubs.length === 0 && !hasAdminAccess) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-10">
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-8 text-center space-y-6 shadow-xl">
          <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto text-amber-400">
            <Building2 className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-white tracking-tight">No Active Club Assignment</h2>
            <p className="text-sm text-slate-400 max-w-md mx-auto leading-relaxed">
              Your account possesses the <span className="text-amber-400 font-mono font-semibold">COACH</span> role, but is not yet associated with an active club in the tournament system.
            </p>
          </div>
          <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-xl text-xs text-slate-400 max-w-md mx-auto space-y-2 text-left">
            <div className="flex items-center space-x-2 text-slate-300 font-semibold">
              <Info className="w-4 h-4 text-amber-400" />
              <span>How to link your team:</span>
            </div>
            <p className="leading-relaxed">
              1. Contact a Tournament Administrator to register your club identity or appoint your account.
            </p>
            <p className="leading-relaxed">
              2. Once appointed as Head Coach or Assistant Coach, your club dashboard and athlete approval queue will activate automatically.
            </p>
          </div>
          <div className="pt-2">
            <button
              type="button"
              onClick={fetchClubs}
              className="inline-flex items-center space-x-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold border border-slate-700 transition-all"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Check for Updates</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Admin Mode Switcher (for SUPER_ADMIN and ADMIN) */}
      {hasAdminAccess && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-slate-900/90 border border-slate-800 rounded-xl p-3 shadow-md">
          <div className="flex items-center space-x-2 text-xs text-slate-300 font-semibold pl-1 shrink-0">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Administrative Scope:</span>
          </div>
          <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs overflow-x-auto max-w-full">
            <button
              type="button"
              onClick={() => setAdminViewMode('roster')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center space-x-1.5 shrink-0 whitespace-nowrap ${
                adminViewMode === 'roster'
                  ? 'bg-amber-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Users className="w-3.5 h-3.5 shrink-0" />
              <span>Team Delegation & Rosters</span>
            </button>
            <button
              type="button"
              onClick={() => setAdminViewMode('governance')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center space-x-1.5 shrink-0 whitespace-nowrap ${
                adminViewMode === 'governance'
                  ? 'bg-amber-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Building2 className="w-3.5 h-3.5 shrink-0" />
              <span>Club & Team Registry / Governance</span>
            </button>
          </div>
        </div>
      )}

      {/* If Admin selected Governance Mode, render CoachSuccessionManagement directly */}
      {hasAdminAccess && adminViewMode === 'governance' ? (
        <CoachSuccessionManagement />
      ) : (
        <>
          {/* Toast Feedback Alert */}
      {actionMessage && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between text-sm ${
            actionMessage.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-800 text-emerald-200'
              : 'bg-rose-950/80 border-rose-800 text-rose-200'
          }`}
        >
          <div className="flex items-center space-x-3">
            {actionMessage.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0" />
            )}
            <span className="font-medium">{actionMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionMessage(null)}
            className="p-1 hover:bg-white/10 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header & Multi-Club Selector */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Club Identity Header */}
          <div className="flex items-center space-x-4 min-w-0">
            <div className="w-14 h-14 rounded-2xl bg-slate-950 border border-amber-500/40 p-1 flex items-center justify-center shadow-lg overflow-hidden flex-shrink-0">
              {selectedClub?.logo_url ? (
                <img
                  src={selectedClub.logo_url}
                  alt={selectedClub.name}
                  className="w-full h-full object-contain rounded-xl"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <Building2 className="w-7 h-7 text-amber-400" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                <h1 className="text-xl font-bold text-white tracking-tight break-words">
                  {selectedClub?.name || 'Club Management'}
                </h1>
                {selectedClub?.code && (
                  <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-amber-950 text-amber-300 border border-amber-800 shrink-0">
                    {selectedClub.code}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span>UAAPHIL Official Team Delegation</span>
                <span>•</span>
                <span className="text-emerald-400 font-semibold">Active Delegation</span>
                {selectedCoachAssignment && (
                  <>
                    <span>•</span>
                    <span className="text-amber-300 font-mono font-bold">
                      {selectedCoachAssignment.role_type === 'HEAD_COACH' ? 'HEAD COACH' : 'ASSISTANT COACH'}
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Club Switcher (If multiple clubs) & Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto min-w-0">
            {assignedClubs.length > 1 && (
              <div className="flex items-center space-x-2 w-full sm:w-auto min-w-0">
                <span className="text-xs text-slate-400 shrink-0">Switch Club:</span>
                <select
                  value={selectedClubId}
                  onChange={(e) => setSelectedClubId(e.target.value)}
                  className="w-full sm:w-auto sm:max-w-xs px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500 truncate"
                >
                  {assignedClubs.map((ac) => (
                    <option key={ac.club_id} value={ac.club_id}>
                      {ac.club?.name} ({ac.role_type})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {isSuperAdmin && assignedClubs.length === 0 && allClubs.length > 0 && (
              <div className="flex items-center space-x-2 w-full sm:w-auto min-w-0">
                <span className="text-xs text-purple-400 font-mono font-semibold shrink-0">Super Admin Override:</span>
                <select
                  value={selectedClubId}
                  onChange={(e) => setSelectedClubId(e.target.value)}
                  className="w-full sm:w-auto sm:max-w-xs px-3 py-1.5 bg-slate-950 border border-purple-700 rounded-lg text-xs text-purple-200 focus:outline-none focus:ring-2 focus:ring-purple-500 truncate"
                >
                  {allClubs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.code || 'NO-CODE'})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="button"
              onClick={fetchClubData}
              disabled={loadingData}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-all text-xs flex items-center space-x-1.5 shrink-0 min-h-[38px]"
              title="Refresh Team Data"
            >
              <RefreshCw className={`w-4 h-4 ${loadingData ? 'animate-spin text-amber-400' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSubTab('lineup')}
              className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all flex items-center space-x-1.5 ${
                activeSubTab === 'lineup'
                  ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/20'
                  : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40'
              }`}
            >
              <Trophy className="w-4 h-4 text-amber-400" />
              <span>Manage Tournament Lineups</span>
            </button>

            {onNavigateTab && (
              <button
                type="button"
                onClick={() => onNavigateTab('registrations')}
                className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold transition-all flex items-center space-x-1.5"
              >
                <Award className="w-4 h-4" />
                <span>Tournament Registrations</span>
              </button>
            )}
          </div>
        </div>

        {/* Club Code Distribution Widget */}
        {selectedClub?.code && (
          <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div className="flex items-center space-x-2 text-slate-300">
              <UserCheck className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span>
                <span className="font-semibold text-white">Athlete Onboarding:</span> Share Club Code{' '}
                <span className="font-mono font-bold text-amber-300">{selectedClub.code}</span> with your athletes so they can request to join.
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <CopyableId id={selectedClub.code} label="Copy Club Code" />
            </div>
          </div>
        )}
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="flex items-center gap-1.5 sm:gap-2 border-b border-slate-800 pb-2 overflow-x-auto max-w-full">
        <button
          type="button"
          onClick={() => setActiveSubTab('roster')}
          className={`px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs font-semibold flex items-center space-x-2 transition-all shrink-0 whitespace-nowrap ${
            activeSubTab === 'roster'
              ? 'bg-amber-500 text-slate-950 shadow-lg font-bold'
              : 'bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-800'
          }`}
        >
          <Users className="w-4 h-4 shrink-0" />
          <span>Active Roster</span>
          <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
            activeSubTab === 'roster' ? 'bg-slate-950/30 text-slate-950' : 'bg-slate-800 text-slate-400'
          }`}>
            {activeRoster.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('pending')}
          className={`px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs font-semibold flex items-center space-x-2 transition-all shrink-0 whitespace-nowrap ${
            activeSubTab === 'pending'
              ? 'bg-amber-500 text-slate-950 shadow-lg font-bold'
              : 'bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-800'
          }`}
        >
          <Clock className="w-4 h-4 shrink-0" />
          <span className="hidden xl:inline">Pending Applications</span>
          <span className="xl:hidden">Pending Apps</span>
          {pendingRequests.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-rose-500 text-white font-bold animate-pulse">
              {pendingRequests.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('transfers')}
          className={`px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs font-semibold flex items-center space-x-2 transition-all shrink-0 whitespace-nowrap ${
            activeSubTab === 'transfers'
              ? 'bg-amber-500 text-slate-950 shadow-lg font-bold'
              : 'bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-800'
          }`}
        >
          <ArrowRightLeft className="w-4 h-4 shrink-0" />
          <span className="hidden xl:inline">Transfers &amp; Releases</span>
          <span className="xl:hidden">Transfers</span>
          {safePendingTransfers.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-amber-400 text-slate-950 font-bold">
              {safePendingTransfers.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('club_info')}
          className={`px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs font-semibold flex items-center space-x-2 transition-all shrink-0 whitespace-nowrap ${
            activeSubTab === 'club_info'
              ? 'bg-amber-500 text-slate-950 shadow-lg font-bold'
              : 'bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-800'
          }`}
        >
          <Info className="w-4 h-4 shrink-0" />
          <span className="hidden xl:inline">Club Info &amp; Succession</span>
          <span className="xl:hidden">Club Info</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('lineup')}
          className={`px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs font-semibold flex items-center space-x-2 transition-all shrink-0 whitespace-nowrap ${
            activeSubTab === 'lineup'
              ? 'bg-amber-500 text-slate-950 shadow-lg font-bold'
              : 'bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-800'
          }`}
        >
          <Trophy className="w-4 h-4 shrink-0" />
          <span>Tournament Lineups</span>
        </button>
      </div>

      {/* SUB-TAB 1: ACTIVE ROSTER */}
      {activeSubTab === 'roster' && (
        <div className="space-y-6">
          {/* Main Active Delegation Table */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="p-5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-bold text-white">Active Delegation Roster</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Athletes verified and eligible to represent {selectedClub?.name} in UAAPHIL tournaments.
                </p>
              </div>
              <div className="flex items-center space-x-3">
                <span className="text-xs font-mono text-slate-400">
                  Total: <span className="text-amber-400 font-bold">{activeRoster.length}</span> Athletes
                </span>
                {selectedClubId && (
                  <button
                    type="button"
                    onClick={() => setShowAddAthleteModal(true)}
                    className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg text-xs font-bold transition-all inline-flex items-center space-x-1.5 shadow-md shadow-amber-500/10"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Add Athlete</span>
                  </button>
                )}
              </div>
            </div>

            {activeRoster.length === 0 ? (
              <div className="p-12 text-center space-y-4">
                <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
                  <Users className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-white">No active athletes on this roster</p>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">
                    When athletes request to join using your Club Code or are added directly, their active records will appear here.
                  </p>
                </div>
                {selectedClubId && (
                  <button
                    type="button"
                    onClick={() => setShowAddAthleteModal(true)}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg text-xs font-bold transition-all inline-flex items-center space-x-1.5 mx-auto"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>Add Athlete to Roster</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800 font-mono uppercase text-[10px]">
                    <tr>
                      <th className="py-3 px-4">Athlete</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Membership Type</th>
                      <th className="py-3 px-4">Effective Date</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {activeRoster.map((member) => (
                      <tr key={member.membership_id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-white">{member.full_name}</div>
                          <div className="text-[10px] text-slate-500 font-mono">ID: {member.player_user_id.slice(0, 8)}...</div>
                        </td>
                        <td className="py-3 px-4">
                          {renderStatusBadge(member.status)}
                        </td>
                        <td className="py-3 px-4">
                          {renderMembershipBadge(member.membership_type)}
                        </td>
                        <td className="py-3 px-4 text-slate-400 font-mono">
                          {member.effective_from ? new Date(member.effective_from).toLocaleDateString() : 'N/A'}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end space-x-2">
                            <button
                              type="button"
                              onClick={() => {
                                setSuspendModalMember(member);
                                setSuspendReason('');
                              }}
                              className="px-2.5 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 rounded-lg text-xs font-semibold transition-all inline-flex items-center space-x-1"
                            >
                              <AlertTriangle className="w-3.5 h-3.5" />
                              <span>Suspend</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setRelieveModalMember(member)}
                              className="px-2.5 py-1.5 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 rounded-lg text-xs font-semibold transition-all inline-flex items-center space-x-1"
                            >
                              <UserMinus className="w-3.5 h-3.5" />
                              <span>Relieve</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Suspended Athletes Section (if any) */}
          {suspendedRoster.length > 0 && (
            <div className="bg-slate-900/80 border border-amber-900/40 rounded-2xl overflow-hidden shadow-lg">
              <div className="p-4 border-b border-slate-800 bg-amber-950/20 flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-amber-300 flex items-center space-x-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    <span>Suspended Athletes ({suspendedRoster.length})</span>
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Athletes temporarily on hold. Suspended athletes cannot be placed on tournament lineups.
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800 font-mono uppercase text-[10px]">
                    <tr>
                      <th className="py-2.5 px-4">Athlete</th>
                      <th className="py-2.5 px-4">Status</th>
                      <th className="py-2.5 px-4">Membership Type</th>
                      <th className="py-2.5 px-4">Effective Date</th>
                      <th className="py-2.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {suspendedRoster.map((member) => (
                      <tr key={member.membership_id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-2.5 px-4">
                          <div className="font-semibold text-white">{member.full_name}</div>
                          <div className="text-[10px] text-slate-500 font-mono">ID: {member.player_user_id.slice(0, 8)}...</div>
                        </td>
                        <td className="py-2.5 px-4">
                          {renderStatusBadge(member.status)}
                        </td>
                        <td className="py-2.5 px-4">
                          {renderMembershipBadge(member.membership_type)}
                        </td>
                        <td className="py-2.5 px-4 text-slate-400 font-mono">
                          {member.effective_from ? new Date(member.effective_from).toLocaleDateString() : 'N/A'}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <div className="flex items-center justify-end space-x-2">
                            <button
                              type="button"
                              onClick={() => {
                                setRestoreModalMember(member);
                                setRestoreNotes('');
                              }}
                              className="px-2.5 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-semibold transition-all inline-flex items-center space-x-1"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Restore</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setRelieveModalMember(member)}
                              className="px-2.5 py-1.5 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 rounded-lg text-xs font-semibold transition-all inline-flex items-center space-x-1"
                            >
                              <UserMinus className="w-3.5 h-3.5" />
                              <span>Relieve</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Past / Relieved Athletes Section (if any) */}
          {relievedRoster.length > 0 && (
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl overflow-hidden shadow-lg">
              <div className="p-4 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-slate-300 flex items-center space-x-2">
                    <Users className="w-4 h-4 text-slate-400" />
                    <span>Past &amp; Relieved Club Members ({relievedRoster.length})</span>
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Athletes previously released or transferred from {selectedClub?.name}. Coaches may re-admit athletes to active status.
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800 font-mono uppercase text-[10px]">
                    <tr>
                      <th className="py-2.5 px-4">Athlete</th>
                      <th className="py-2.5 px-4">Status</th>
                      <th className="py-2.5 px-4">Membership Type</th>
                      <th className="py-2.5 px-4">Effective To</th>
                      <th className="py-2.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {relievedRoster.map((member) => (
                      <tr key={member.membership_id} className="hover:bg-slate-800/30 transition-colors opacity-80 hover:opacity-100">
                        <td className="py-2.5 px-4">
                          <div className="font-semibold text-slate-200">{member.full_name}</div>
                          <div className="text-[10px] text-slate-500 font-mono">ID: {member.player_user_id.slice(0, 8)}...</div>
                        </td>
                        <td className="py-2.5 px-4">
                          {renderStatusBadge(member.status)}
                        </td>
                        <td className="py-2.5 px-4">
                          {renderMembershipBadge(member.membership_type)}
                        </td>
                        <td className="py-2.5 px-4 text-slate-400 font-mono">
                          {member.effective_to ? new Date(member.effective_to).toLocaleDateString() : (member.effective_from ? new Date(member.effective_from).toLocaleDateString() : 'N/A')}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setReadmitModalMember(member);
                              setReadmitNotes('Re-admitted to active roster by Coach');
                            }}
                            className="px-2.5 py-1.5 bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 rounded-lg text-xs font-semibold transition-all inline-flex items-center space-x-1"
                          >
                            <UserPlus className="w-3.5 h-3.5" />
                            <span>Re-admit</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 2: PENDING APPLICATIONS */}
      {activeSubTab === 'pending' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="p-5 border-b border-slate-800 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-white">Membership Application Queue</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Review and approve athletes requesting affiliation with {selectedClub?.name}.
              </p>
            </div>
            <span className="text-xs font-mono text-slate-400">
              Pending: <span className="text-rose-400 font-bold">{pendingRequests.length}</span>
            </span>
          </div>

          {pendingRequests.length === 0 ? (
            <div className="p-12 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mx-auto text-emerald-400">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-white">All applications processed</p>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  There are no pending athlete membership requests for this team at this time.
                </p>
              </div>
            </div>
          ) : (
            <div className="p-4 space-y-4">
              {pendingRequests.map((request) => (
                <div
                  key={request.membership_id}
                  className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-slate-700 transition-all"
                >
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-white text-sm">{request.full_name}</span>
                      {renderMembershipBadge(request.membership_type)}
                    </div>
                    <div className="text-xs text-slate-400 space-y-1">
                      {request.email && (
                        <p className="font-mono text-slate-300">Email: {request.email}</p>
                      )}
                      <p className="font-mono text-[11px] text-slate-500">
                        Requested: {new Date(request.created_at).toLocaleString()}
                      </p>
                      {request.review_notes && (
                        <p className="text-amber-300/90 italic">Notes: "{request.review_notes}"</p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2">
                    <input
                      type="text"
                      placeholder="Optional review notes..."
                      value={reviewNotes[request.membership_id] || ''}
                      onChange={(e) =>
                        setReviewNotes({ ...reviewNotes, [request.membership_id]: e.target.value })
                      }
                      className="px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500 w-full sm:w-48"
                    />

                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={() => handleRejectMembership(request.membership_id)}
                        disabled={processingId === request.membership_id}
                        className="px-3 py-1.5 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 rounded-lg text-xs font-semibold transition-all flex items-center space-x-1 disabled:opacity-50"
                      >
                        <X className="w-4 h-4" />
                        <span>Reject</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleApproveMembership(request.membership_id)}
                        disabled={processingId === request.membership_id}
                        className="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg text-xs font-bold transition-all flex items-center space-x-1 shadow-md disabled:opacity-50"
                      >
                        <Check className="w-4 h-4" />
                        <span>Approve</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 3: TRANSFERS & RELEASES */}
      {activeSubTab === 'transfers' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="p-5 border-b border-slate-800 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-white">Player Transfer Requests</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Two-way approval workflow for athletes transferring between UAAPHIL member clubs.
              </p>
            </div>
            <span className="text-xs font-mono text-slate-400">
              Active: <span className="text-amber-400 font-bold">{safePendingTransfers.length}</span>
            </span>
          </div>

          {safePendingTransfers.length === 0 ? (
            <div className="p-12 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
                <ArrowRightLeft className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-white">No active transfers</p>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  When players request to transfer to or from your club, the required coach releases will appear here.
                </p>
              </div>
            </div>
          ) : (
            <div className="p-4 space-y-4">
              {safePendingTransfers.map((transfer) => {
                const isOutgoing = transfer.transfer_direction === 'OUTGOING';
                return (
                  <div
                    key={transfer.id}
                    className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-white text-sm">{transfer.player_name}</span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                            isOutgoing
                              ? 'bg-rose-950 text-rose-300 border border-rose-800'
                              : 'bg-blue-950 text-blue-300 border border-blue-800'
                          }`}
                        >
                          {isOutgoing ? 'OUTGOING RELEASE' : 'INCOMING ACCEPTANCE'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 space-y-1">
                        <p>
                          From: <span className="font-semibold text-slate-200">{transfer.from_club_name}</span> → To:{' '}
                          <span className="font-semibold text-slate-200">{transfer.to_club_name}</span>
                        </p>
                        {transfer.reason && (
                          <p className="italic text-slate-400">Reason: "{transfer.reason}"</p>
                        )}
                        <p className="font-mono text-[11px] text-slate-500">
                          Initiated: {new Date(transfer.created_at).toLocaleString()}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={() => handleRejectTransfer(transfer.id)}
                        disabled={processingId === transfer.id}
                        className="px-3 py-1.5 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
                      >
                        Reject Transfer
                      </button>

                      {isOutgoing && (
                        <button
                          type="button"
                          onClick={() => handleApproveOutgoingTransfer(transfer.id)}
                          disabled={processingId === transfer.id}
                          className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg text-xs font-bold transition-all shadow-md disabled:opacity-50"
                        >
                          Approve Release
                        </button>
                      )}

                      {!isOutgoing && (
                        <button
                          type="button"
                          onClick={() => handleApproveIncomingTransfer(transfer.id)}
                          disabled={processingId === transfer.id}
                          className="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg text-xs font-bold transition-all shadow-md disabled:opacity-50"
                        >
                          Accept to Roster
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 4: CLUB DETAILS & SUCCESSION */}
      {activeSubTab === 'club_info' && (
        <div className="space-y-6">
          {/* Overview Card */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <h2 className="text-base font-bold text-white">Club Profile &amp; Governance</h2>
                <p className="text-xs text-slate-400 mt-0.5">Authoritative delegation credentials and coaching staff.</p>
              </div>

              {selectedCoachAssignment?.role_type === 'HEAD_COACH' && (
                <button
                  type="button"
                  onClick={() => setShowSuccessionModal(true)}
                  className="px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 shadow-md"
                >
                  <Send className="w-4 h-4" />
                  <span>Request Coach Succession</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
                <div className="text-[11px] text-slate-400 font-mono">CLUB ID</div>
                <div className="font-mono text-xs text-white truncate">{selectedClub?.id}</div>
              </div>
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
                <div className="text-[11px] text-slate-400 font-mono">CLUB CODE</div>
                <div className="font-mono text-xs font-bold text-amber-400">{selectedClub?.code || 'N/A'}</div>
              </div>
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
                <div className="text-[11px] text-slate-400 font-mono">HEAD COACH</div>
                <div className="text-xs font-bold text-white">
                  {activeCoachInfo?.full_name || 'Unassigned'}
                </div>
              </div>
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
                <div className="text-[11px] text-slate-400 font-mono">DELEGATION STATUS</div>
                <div className="text-xs font-bold text-emerald-400 flex items-center space-x-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Active Member Club</span>
                </div>
              </div>
            </div>

            {/* Coach History Log */}
            <div className="space-y-3 pt-2">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Historical Coach Appointments
              </h3>
              <div className="overflow-x-auto bg-slate-950 border border-slate-800 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900 text-slate-400 border-b border-slate-800 font-mono uppercase text-[10px]">
                    <tr>
                      <th className="py-2.5 px-4">Coach Name</th>
                      <th className="py-2.5 px-4">Role</th>
                      <th className="py-2.5 px-4">Status</th>
                      <th className="py-2.5 px-4">Effective From</th>
                      <th className="py-2.5 px-4">Effective To</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {coachHistory.map((h) => (
                      <tr key={h.id} className="hover:bg-slate-800/20">
                        <td className="py-2.5 px-4 font-semibold text-white">
                          {h.coach_name || 'Coach User'}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-amber-300">
                          {h.role_type}
                        </td>
                        <td className="py-2.5 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                              h.status === 'ACTIVE'
                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {h.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-slate-400 font-mono">
                          {new Date(h.effective_from).toLocaleDateString()}
                        </td>
                        <td className="py-2.5 px-4 text-slate-400 font-mono">
                          {h.effective_to ? new Date(h.effective_to).toLocaleDateString() : 'Present'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 5: TOURNAMENT LINEUPS & RESERVES */}
      {activeSubTab === 'lineup' && (
        <div className="space-y-6">
          {/* TOURNAMENT & EVENT SELECTION CARD */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
              <div>
                <h2 className="text-sm font-bold text-white flex items-center space-x-2">
                  <Trophy className="w-4 h-4 text-amber-400" />
                  <span>Tournament Lineup &amp; Reserve Manager</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Designate official starting competitors and standby reserves representing{' '}
                  <span className="font-semibold text-amber-300">{selectedClub?.name}</span>.
                </p>
              </div>

              {/* Tournament Status Badge */}
              {selectedTournament && (
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-slate-400 font-mono">Status:</span>
                  <span
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold flex items-center space-x-1.5 ${
                      selectedTournament.status === 'REGISTRATION_OPEN'
                        ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
                        : selectedTournament.status === 'REGISTRATION_CLOSED'
                        ? 'bg-amber-950/80 text-amber-300 border border-amber-800'
                        : selectedTournament.status === 'ONGOING'
                        ? 'bg-rose-950/80 text-rose-300 border border-rose-800 animate-pulse'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                  >
                    {isTournamentLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                    <span>{selectedTournament.status.replace(/_/g, ' ')}</span>
                  </span>
                </div>
              )}
            </div>

            {/* Representing Active Club Badge */}
            {selectedClub && (
              <div className="p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold flex-shrink-0">
                    <Shield className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block font-semibold">
                      Representing Team Delegation
                    </span>
                    <span className="font-bold text-white text-sm">{selectedClub.name}</span>
                    {selectedClub.code && (
                      <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-950 text-amber-300 border border-amber-800">
                        {selectedClub.code}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-800 flex items-center space-x-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span>Official Coach Authorization</span>
                  </span>
                  {selectedCoachAssignment && (
                    <span className="px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold bg-amber-950/80 text-amber-300 border border-amber-800">
                      {selectedCoachAssignment.role_type === 'HEAD_COACH' ? 'HEAD COACH' : 'ASSISTANT COACH'}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Selectors Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Tournament Selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                  <span>Select Tournament:</span>
                  {loadingTournaments && <RefreshCw className="w-3 h-3 text-amber-400 animate-spin" />}
                </label>
                <select
                  value={selectedTournamentId}
                  onChange={(e) => {
                    const newTournamentId = e.target.value;
                    setSelectedTournamentId(newTournamentId);
                    // Clear stale events & selected event immediately and set loadingEvents to prevent transient false-empty state
                    setEvents([]);
                    setSelectedEventId('');
                    setEventsError(null);
                    if (newTournamentId) {
                      setLoadingEvents(true);
                    } else {
                      setLoadingEvents(false);
                    }
                  }}
                  disabled={loadingTournaments || tournaments.length === 0}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500 font-medium disabled:opacity-50"
                >
                  {tournaments.length === 0 ? (
                    <option value="">No tournaments available</option>
                  ) : (
                    tournaments.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.status.replace(/_/g, ' ')})
                      </option>
                    ))
                  )}
                </select>
              </div>

              {/* Event Selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                  <span>Select Competition Event:</span>
                  {(loadingTournaments || loadingEvents) && <RefreshCw className="w-3 h-3 text-amber-400 animate-spin" />}
                </label>
                <select
                  value={selectedEventId}
                  onChange={(e) => setSelectedEventId(e.target.value)}
                  disabled={loadingTournaments || loadingEvents || !selectedTournamentId || !!eventsError || events.length === 0}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500 font-medium disabled:opacity-50"
                >
                  {loadingTournaments || loadingEvents ? (
                    <option value="">Loading competition events...</option>
                  ) : eventsError ? (
                    <option value="">{eventsError}</option>
                  ) : !selectedTournamentId ? (
                    <option value="">Select a tournament first</option>
                  ) : events.length === 0 ? (
                    <option value="">No competition events configured yet</option>
                  ) : (
                    events.map((ev) => (
                      <option key={ev.id} value={ev.id}>
                        {ev.name} • {ev.category} ({ev.division})
                      </option>
                    ))
                  )}
                </select>
                {eventsError && !loadingEvents && (
                  <p className="text-[11px] text-rose-400 font-medium">{eventsError}</p>
                )}
              </div>
            </div>

            {/* CLEAR INFORMATIVE EMPTY STATE FOR TOURNAMENTS WITH 0 EVENTS */}
            {!loadingTournaments && !loadingEvents && selectedTournamentId && events.length === 0 && !eventsError && (
              <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-xl flex items-start space-x-3 text-slate-300 text-xs">
                <Info className="w-4 h-4 text-sky-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-bold text-white">
                    No competition events are available for this tournament yet.
                  </div>
                  <p className="text-slate-400 leading-relaxed">
                    The tournament organizer has not yet completed event configuration/generation for{' '}
                    <span className="text-amber-300 font-medium">{selectedTournament?.name}</span>. Please check back after the event divisions have been configured by the tournament administration.
                  </p>
                </div>
              </div>
            )}

            {/* EMPTY EVENT SELECTION PROMPT */}
            {!loadingTournaments && !loadingEvents && selectedTournamentId && events.length > 0 && !selectedEventId && (
              <div className="p-3.5 bg-amber-950/20 border border-amber-900/40 rounded-xl flex items-center space-x-2.5 text-amber-300 text-xs">
                <Award className="w-4 h-4 text-amber-400 flex-shrink-0" />
                <span>
                  Please select a competition event above to manage your club's <span className="font-bold">Starting Lineup</span> and <span className="font-bold">Standby Reserves</span>.
                </span>
              </div>
            )}

            {/* LOCKED BANNER */}
            {isTournamentLocked && selectedTournament && (
              <div className="p-3.5 bg-rose-950/40 border border-rose-800/80 rounded-xl flex items-start space-x-3 text-rose-200 text-xs">
                <Lock className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="font-bold text-white flex items-center space-x-1">
                    <span>🔒 LINEUP LOCKED</span>
                    <span className="font-normal text-slate-300">— Tournament Status: {selectedTournament.status}</span>
                  </div>
                  <p className="text-slate-400">
                    {selectedTournament.status === 'ONGOING'
                      ? 'Live competition is ongoing. Tournament lineups and substitutions are strictly locked for bracket/scoring integrity.'
                      : selectedTournament.status === 'DRAFT'
                      ? 'Tournament is currently in DRAFT status. Lineup assignments will open once registration starts.'
                      : `Lineups cannot be modified while tournament is ${selectedTournament.status}.`}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* REGISTRATION & APPROVAL STATUS SUMMARY */}
          {selectedEventId && (
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl">
              <div className="flex items-start space-x-3">
                <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-amber-400 flex-shrink-0">
                  <Award className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-bold text-white uppercase tracking-wider font-mono flex items-center space-x-2">
                    <span>Registration & Approval Status</span>
                    {hasExistingSubmission ? (
                      <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 border border-slate-700 font-sans font-medium">
                        Authoritative Ledger
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] bg-sky-950 text-sky-300 border border-sky-800 font-sans font-medium">
                        Not Yet Submitted
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed max-w-xl">
                    Lineup submissions are recorded in the tournament registration ledger and reviewed by administrators before bracket seeding.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {/* Lineup Breakdown */}
                <div className="px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl space-y-0.5">
                  <div className="text-[10px] font-mono font-bold text-amber-400 uppercase">Starting Lineup</div>
                  <div className="flex items-center space-x-2 text-xs">
                    <span className="font-extrabold text-white">{currentLineupRegistrations.length} Total</span>
                    <span className="text-slate-700">•</span>
                    <span className="text-emerald-400 font-semibold flex items-center space-x-0.5">
                      <CheckCircle2 className="w-3 h-3 inline mr-0.5" />
                      {approvedLineupCount} Approved
                    </span>
                    <span className="text-slate-700">•</span>
                    <span className="text-amber-400 font-semibold flex items-center space-x-0.5">
                      <Clock className="w-3 h-3 inline mr-0.5" />
                      {pendingLineupCount} Pending
                    </span>
                  </div>
                </div>

                {/* Reserves Breakdown */}
                <div className="px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl space-y-0.5">
                  <div className="text-[10px] font-mono font-bold text-sky-400 uppercase">Standby Reserves</div>
                  <div className="flex items-center space-x-2 text-xs">
                    <span className="font-extrabold text-white">{currentReserveRegistrations.length} Total</span>
                    <span className="text-slate-700">•</span>
                    <span className="text-emerald-400 font-semibold flex items-center space-x-0.5">
                      <CheckCircle2 className="w-3 h-3 inline mr-0.5" />
                      {approvedReserveCount} Approved
                    </span>
                    <span className="text-slate-700">•</span>
                    <span className="text-amber-400 font-semibold flex items-center space-x-0.5">
                      <Clock className="w-3 h-3 inline mr-0.5" />
                      {pendingReserveCount} Pending
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* DYNAMIC COUNTERS & ACTION BAR */}
          {selectedEventId && (
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-xl">
              {/* Counters */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="px-3.5 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center space-x-2">
                  <span className="text-[10px] font-mono uppercase text-amber-400 font-bold">Draft Lineup:</span>
                  <span className="text-sm font-extrabold text-amber-300">{lineupUserIds.length}</span>
                </div>
                <div className="px-3.5 py-1.5 bg-sky-500/10 border border-sky-500/30 rounded-xl flex items-center space-x-2">
                  <span className="text-[10px] font-mono uppercase text-sky-400 font-bold">Draft Reserves:</span>
                  <span className="text-sm font-extrabold text-sky-300">{reserveUserIds.length}</span>
                </div>
                <div className="px-3.5 py-1.5 bg-slate-800/80 border border-slate-700/60 rounded-xl flex items-center space-x-2">
                  <span className="text-[10px] font-mono uppercase text-slate-400 font-bold">Unassigned:</span>
                  <span className="text-sm font-extrabold text-slate-200">{unassignedAthletes.length}</span>
                </div>
                <div className="text-xs text-slate-400 font-mono pl-1">
                  Active Club Delegation: <span className="font-bold text-white">{activeEligibleAthletes.length}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center space-x-2.5">
                {/* Atomic Swap Action */}
                <button
                  type="button"
                  onClick={() => {
                    setSwapLineupRegId(currentLineupRegistrations[0]?.id || '');
                    setSwapReserveRegId(currentReserveRegistrations[0]?.id || '');
                    setShowSwapModal(true);
                  }}
                  disabled={
                    isTournamentLocked ||
                    currentLineupRegistrations.length === 0 ||
                    currentReserveRegistrations.length === 0
                  }
                  title={
                    currentLineupRegistrations.length === 0 || currentReserveRegistrations.length === 0
                      ? 'Requires at least 1 Lineup and 1 Reserve athlete saved in database.'
                      : 'Atomically swap 1 Lineup athlete with 1 Reserve athlete.'
                  }
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center space-x-1.5"
                >
                  <ArrowUpDown className="w-3.5 h-3.5 text-amber-400" />
                  <span>Swap Lineup ↔ Reserve</span>
                </button>

                {/* Discard changes */}
                {isLineupDirty && (
                  <button
                    type="button"
                    onClick={handleDiscardChanges}
                    disabled={savingLineup}
                    className="px-3 py-2 bg-slate-800/60 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl text-xs font-semibold transition-all"
                  >
                    Reset Draft
                  </button>
                )}

                {/* Submit / Update Lineup */}
                <button
                  type="button"
                  onClick={handleSaveLineup}
                  disabled={isTournamentLocked || savingLineup || !isLineupDirty}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all inline-flex items-center space-x-1.5 ${
                    isLineupDirty
                      ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/20 animate-pulse'
                      : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                  }`}
                >
                  {savingLineup ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {savingLineup
                      ? hasExistingSubmission
                        ? 'Updating Lineup...'
                        : 'Submitting Lineup...'
                      : isLineupDirty
                      ? hasExistingSubmission
                        ? 'Update Submitted Lineup'
                        : 'Submit Lineup for Approval'
                      : hasExistingSubmission
                      ? 'Submitted Lineup In Sync'
                      : 'No Lineup Submitted'}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* THREE-TIER ALLOCATION PANELS */}
          {selectedEventId && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* TIER 1: STARTING LINEUP */}
              <div className="bg-slate-900/90 border border-amber-500/30 rounded-2xl overflow-hidden shadow-xl flex flex-col">
                <div className="p-4 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
                    <h3 className="text-xs font-bold text-amber-300 uppercase tracking-wider font-mono">
                      Starting Lineup ({lineupUserIds.length})
                    </h3>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-400 text-slate-950">
                    LINEUP
                  </span>
                </div>

                <div className="p-4 flex-1 space-y-2 overflow-y-auto max-h-[420px]">
                  {loadingRegistrations ? (
                    <div className="p-8 text-center text-slate-500 text-xs flex flex-col items-center space-y-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                      <span>Loading lineup registrations...</span>
                    </div>
                  ) : lineupUserIds.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 text-xs">
                      No athletes currently assigned to starting lineup.
                    </div>
                  ) : (
                    lineupUserIds.map((uid, index) => {
                      const athlete = activeRoster.find((m) => m.player_user_id === uid);
                      const reg = eventRegistrations.find((r) => r.user_id === uid);
                      const name = athlete?.full_name || reg?.user_profile?.full_name || 'Athlete ' + uid.slice(0, 8);
                      const isApproved = reg?.is_approved;
                      const hasReg = !!reg && reg.club_id === selectedClubId && reg.lineup_role !== 'WITHDRAWN';
                      return (
                        <div
                          key={uid}
                          className="p-3 bg-slate-950 border border-slate-800 hover:border-amber-500/40 rounded-xl flex items-center justify-between gap-2 transition-all"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center space-x-2">
                              <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-300 font-mono text-[10px] flex items-center justify-center font-bold flex-shrink-0">
                                {index + 1}
                              </span>
                              <span className="font-bold text-white text-xs truncate">{name}</span>
                            </div>
                            <div className="flex items-center space-x-2 mt-1.5 pl-7">
                              <span className="text-[10px] text-slate-500 font-mono">
                                ID: {uid.slice(0, 8)}...
                              </span>
                              {!hasReg ? (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-sky-950/80 text-sky-300 border border-sky-800/80 flex items-center space-x-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                                  <span>Draft (Unsaved)</span>
                                </span>
                              ) : isApproved ? (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 flex items-center space-x-1">
                                  <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                                  <span>Approved Entry</span>
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-950/80 text-amber-300 border border-amber-800/80 flex items-center space-x-1">
                                  <Clock className="w-2.5 h-2.5 text-amber-400" />
                                  <span>Pending Approval</span>
                                </span>
                              )}
                            </div>
                          </div>

                          {!isTournamentLocked && (
                            <div className="flex items-center space-x-1 flex-shrink-0">
                              <button
                                type="button"
                                onClick={() => handleDemoteToReserve(uid)}
                                title="Move to Reserve"
                                className="px-2 py-1 bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 rounded-lg text-[10px] font-semibold transition-all"
                              >
                                To Reserve
                              </button>
                              <button
                                type="button"
                                onClick={() => handleUnassign(uid)}
                                title="Unassign from event"
                                className="p-1 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 rounded-lg transition-all"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* TIER 2: STANDBY RESERVES */}
              <div className="bg-slate-900/90 border border-sky-500/30 rounded-2xl overflow-hidden shadow-xl flex flex-col">
                <div className="p-4 bg-sky-500/10 border-b border-sky-500/20 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-sky-400" />
                    <h3 className="text-xs font-bold text-sky-300 uppercase tracking-wider font-mono">
                      Standby Reserves ({reserveUserIds.length})
                    </h3>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-sky-400 text-slate-950">
                    RESERVE
                  </span>
                </div>

                <div className="p-4 flex-1 space-y-2 overflow-y-auto max-h-[420px]">
                  {loadingRegistrations ? (
                    <div className="p-8 text-center text-slate-500 text-xs flex flex-col items-center space-y-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-sky-400" />
                      <span>Loading reserve registrations...</span>
                    </div>
                  ) : reserveUserIds.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 text-xs">
                      No athletes currently assigned as standby reserves.
                    </div>
                  ) : (
                    reserveUserIds.map((uid, index) => {
                      const athlete = activeRoster.find((m) => m.player_user_id === uid);
                      const reg = eventRegistrations.find((r) => r.user_id === uid);
                      const name = athlete?.full_name || reg?.user_profile?.full_name || 'Athlete ' + uid.slice(0, 8);
                      const isApproved = reg?.is_approved;
                      const hasReg = !!reg && reg.club_id === selectedClubId && reg.lineup_role !== 'WITHDRAWN';
                      return (
                        <div
                          key={uid}
                          className="p-3 bg-slate-950 border border-slate-800 hover:border-sky-500/40 rounded-xl flex items-center justify-between gap-2 transition-all"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center space-x-2">
                              <span className="w-5 h-5 rounded-full bg-sky-500/20 text-sky-300 font-mono text-[10px] flex items-center justify-center font-bold flex-shrink-0">
                                R{index + 1}
                              </span>
                              <span className="font-bold text-white text-xs truncate">{name}</span>
                            </div>
                            <div className="flex items-center space-x-2 mt-1.5 pl-7">
                              <span className="text-[10px] text-slate-500 font-mono">
                                ID: {uid.slice(0, 8)}...
                              </span>
                              {!hasReg ? (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-sky-950/80 text-sky-300 border border-sky-800/80 flex items-center space-x-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                                  <span>Draft (Unsaved)</span>
                                </span>
                              ) : isApproved ? (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 flex items-center space-x-1">
                                  <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                                  <span>Approved Entry</span>
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-950/80 text-amber-300 border border-amber-800/80 flex items-center space-x-1">
                                  <Clock className="w-2.5 h-2.5 text-amber-400" />
                                  <span>Pending Approval</span>
                                </span>
                              )}
                            </div>
                          </div>

                          {!isTournamentLocked && (
                            <div className="flex items-center space-x-1 flex-shrink-0">
                              <button
                                type="button"
                                onClick={() => handlePromoteToLineup(uid)}
                                title="Promote to Starting Lineup"
                                className="px-2 py-1 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 rounded-lg text-[10px] font-semibold transition-all"
                              >
                                To Lineup
                              </button>
                              <button
                                type="button"
                                onClick={() => handleUnassign(uid)}
                                title="Unassign from event"
                                className="p-1 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 rounded-lg transition-all"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* TIER 3: UNASSIGNED ACTIVE CLUB ATHLETES */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-xl flex flex-col">
                <div className="p-4 bg-slate-950/60 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Users className="w-4 h-4 text-slate-400" />
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono">
                      Eligible Active Roster ({unassignedAthletes.length})
                    </h3>
                  </div>
                  <span className="text-[10px] font-mono text-slate-500">Unassigned</span>
                </div>

                <div className="p-4 flex-1 space-y-2 overflow-y-auto max-h-[420px]">
                  {loadingData ? (
                    <div className="p-8 text-center text-slate-500 text-xs flex flex-col items-center space-y-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                      <span>Loading active roster...</span>
                    </div>
                  ) : unassignedAthletes.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 text-xs">
                      {activeEligibleAthletes.length === 0
                        ? 'No active verified athletes in this club.'
                        : 'All active club athletes are currently designated as Lineup or Reserve.'}
                    </div>
                  ) : (
                    unassignedAthletes.map((athlete) => (
                      <div
                        key={athlete.player_user_id}
                        className="p-3 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl flex items-center justify-between gap-2 transition-all"
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-white text-xs truncate">{athlete.full_name}</div>
                          <span className="text-[10px] text-slate-500 font-mono block">
                            ID: {athlete.player_user_id.slice(0, 8)}...
                          </span>
                        </div>

                        {!isTournamentLocked && (
                          <div className="flex items-center space-x-1.5 flex-shrink-0">
                            <button
                              type="button"
                              onClick={() => handleAddLineup(athlete.player_user_id)}
                              className="px-2 py-1 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 rounded-lg text-[10px] font-semibold transition-all inline-flex items-center space-x-0.5"
                            >
                              <Plus className="w-3 h-3" />
                              <span>Lineup</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAddReserve(athlete.player_user_id)}
                              className="px-2 py-1 bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 rounded-lg text-[10px] font-semibold transition-all inline-flex items-center space-x-0.5"
                            >
                              <Plus className="w-3 h-3" />
                              <span>Reserve</span>
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* PHASE 3-F MODAL: ADD ATHLETE TO CLUB */}
      {showAddAthleteModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <UserPlus className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-white">Add Athlete to Club</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowAddAthleteModal(false);
                  setSelectedAthlete(null);
                  setSearchQuery('');
                  setAddNotes('');
                }}
                className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <p className="text-slate-400 leading-relaxed">
                Search verified athlete accounts to add directly to <span className="font-semibold text-white">{selectedClub?.name}</span>.
              </p>

              {/* Search Bar */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-semibold">Search Athlete Name:</label>
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Type athlete full name (min. 2 characters)..."
                    className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500 font-medium"
                  />
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  {searchingAthletes && (
                    <RefreshCw className="w-4 h-4 text-amber-400 animate-spin absolute right-3 top-2.5" />
                  )}
                </div>
              </div>

              {/* Search Errors / Hints */}
              {searchError && (
                <div className="p-2.5 bg-rose-950/50 border border-rose-800 rounded-lg text-rose-300 text-xs flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                  <span>{searchError}</span>
                </div>
              )}

              {searchQuery.trim().length > 0 && searchQuery.trim().length < 2 && (
                <p className="text-slate-500 text-[11px] font-mono">Please enter at least 2 characters to search.</p>
              )}

              {/* Search Results List */}
              {searchResults.length > 0 && !selectedAthlete && (
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-semibold">Search Results ({searchResults.length}):</label>
                  <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                    {searchResults.map((athlete) => {
                      const isAttachedToOther = athlete.affiliation_status === 'ACTIVE_MEMBER' && athlete.active_club_id !== selectedClubId;
                      const isAlreadyInThisClub = athlete.active_club_id === selectedClubId;

                      return (
                        <div
                          key={athlete.user_id}
                          className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                            isAlreadyInThisClub
                              ? 'bg-slate-950/50 border-slate-800 opacity-60'
                              : isAttachedToOther
                              ? 'bg-slate-950/60 border-amber-900/40'
                              : 'bg-slate-950 border-slate-800 hover:border-amber-500/50'
                          }`}
                        >
                          <div className="space-y-1 min-w-0">
                            <div className="font-bold text-white truncate">{athlete.full_name}</div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {athlete.affiliation_status === 'UNATTACHED' && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-slate-800 text-slate-300">
                                  UNATTACHED
                                </span>
                              )}
                              {athlete.affiliation_status === 'ACTIVE_MEMBER' && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-blue-950 text-blue-300 border border-blue-800">
                                  {isAlreadyInThisClub ? 'CURRENT MEMBER' : `ACTIVE: ${athlete.active_club_name || 'Other Club'}`}
                                </span>
                              )}
                              {athlete.affiliation_status === 'SUSPENDED_MEMBER' && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-950 text-amber-300 border border-amber-800">
                                  SUSPENDED
                                </span>
                              )}
                              {athlete.affiliation_status === 'PENDING_MEMBER' && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-slate-800 text-slate-400">
                                  PENDING
                                </span>
                              )}
                            </div>
                          </div>

                          <div>
                            {isAlreadyInThisClub ? (
                              <span className="text-[11px] text-slate-500 font-mono">Already in Club</span>
                            ) : isAttachedToOther ? (
                              <span className="text-[10px] text-amber-400/80 font-mono text-right block max-w-[120px] leading-tight">
                                Requires Transfer Request
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setSelectedAthlete(athlete)}
                                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg text-xs font-bold transition-all"
                              >
                                Select
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {searchQuery.trim().length >= 2 && !searchingAthletes && searchResults.length === 0 && (
                <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl text-center text-slate-400 text-xs">
                  No eligible athletes found matching &quot;{searchQuery}&quot;.
                </div>
              )}

              {/* Selected Athlete Configuration */}
              {selectedAthlete && (
                <form onSubmit={handleConfirmAddPlayer} className="space-y-3 pt-2 border-t border-slate-800">
                  <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center justify-between">
                    <div>
                      <span className="text-[10px] uppercase font-mono text-amber-400 font-semibold block">Selected Athlete</span>
                      <span className="text-sm font-bold text-white">{selectedAthlete.full_name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedAthlete(null)}
                      className="text-xs text-slate-400 hover:text-white underline font-mono"
                    >
                      Change
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-slate-300 font-semibold">Membership Type:</label>
                    <select
                      value={addMembershipType}
                      onChange={(e) => setAddMembershipType(e.target.value as MembershipType)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    >
                      <option value="REGULAR">REGULAR</option>
                      <option value="STUDENT_ATHLETE">STUDENT ATHLETE</option>
                      <option value="VARSITY">VARSITY</option>
                      <option value="ALUMNI">ALUMNI</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-slate-300 font-semibold">Onboarding Notes (optional):</label>
                    <textarea
                      rows={2}
                      value={addNotes}
                      onChange={(e) => setAddNotes(e.target.value)}
                      placeholder="e.g. Added directly by Head Coach for upcoming season..."
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>

                  <div className="flex items-center justify-end space-x-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setSelectedAthlete(null)}
                      className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-semibold transition-all"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={processingId === 'add_player_submit'}
                      className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg font-bold transition-all disabled:opacity-50 inline-flex items-center space-x-1.5"
                    >
                      {processingId === 'add_player_submit' && (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      )}
                      <span>Confirm Add to Club</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PHASE 3-F MODAL: SUSPEND ATHLETE CONFIRMATION */}
      {suspendModalMember && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center space-x-3 text-amber-400">
              <AlertTriangle className="w-6 h-6 flex-shrink-0" />
              <h3 className="text-base font-bold text-white">Suspend Athlete</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to suspend <span className="font-bold text-white">{suspendModalMember.full_name}</span> from active participation with{' '}
              <span className="font-bold text-amber-400">{selectedClub?.name}</span>?
            </p>
            <form onSubmit={handleConfirmSuspendPlayer} className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-300 font-semibold">
                  Suspension Reason <span className="text-rose-400">*</span>:
                </label>
                <textarea
                  rows={3}
                  required
                  value={suspendReason}
                  onChange={(e) => setSuspendReason(e.target.value)}
                  placeholder="e.g. Disciplinary suspension, academic standing, medical hold..."
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>
              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setSuspendModalMember(null);
                    setSuspendReason('');
                  }}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={processingId === suspendModalMember.membership_id || !suspendReason.trim()}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg text-xs font-bold transition-all disabled:opacity-50 inline-flex items-center space-x-1.5"
                >
                  {processingId === suspendModalMember.membership_id && (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  )}
                  <span>Confirm Suspension</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PHASE 3-F MODAL: RESTORE ATHLETE CONFIRMATION */}
      {restoreModalMember && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center space-x-3 text-emerald-400">
              <RotateCcw className="w-6 h-6 flex-shrink-0" />
              <h3 className="text-base font-bold text-white">Restore Athlete to Active</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to restore <span className="font-bold text-white">{restoreModalMember.full_name}</span> to active status with{' '}
              <span className="font-bold text-amber-400">{selectedClub?.name}</span>?
            </p>
            <form onSubmit={handleConfirmRestorePlayer} className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Restoration Notes (optional):</label>
                <textarea
                  rows={2}
                  value={restoreNotes}
                  onChange={(e) => setRestoreNotes(e.target.value)}
                  placeholder="e.g. Cleared disciplinary review, medical clearance received..."
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setRestoreModalMember(null);
                    setRestoreNotes('');
                  }}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={processingId === restoreModalMember.membership_id}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg text-xs font-bold transition-all disabled:opacity-50 inline-flex items-center space-x-1.5"
                >
                  {processingId === restoreModalMember.membership_id && (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  )}
                  <span>Confirm Restoration</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* FIND-010: RE-ADMIT RELIEVED ATHLETE CONFIRMATION MODAL */}
      {readmitModalMember && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center space-x-3 text-sky-400">
              <UserPlus className="w-6 h-6 flex-shrink-0" />
              <h3 className="text-base font-bold text-white">Re-admit Athlete to Active Roster</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to re-admit <span className="font-bold text-white">{readmitModalMember.full_name}</span> to the active roster of{' '}
              <span className="font-bold text-amber-400">{selectedClub?.name}</span>?
            </p>
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-[11px] text-slate-400 space-y-1">
              <div>
                <span className="text-slate-300 font-semibold">Membership Type:</span>{' '}
                <span className="font-mono text-amber-300">{readmitModalMember.membership_type}</span>
              </div>
              <div>
                This will re-activate the athlete's membership and clear their relief timestamp using the verified coach onboarding protocol.
              </div>
            </div>
            <form onSubmit={handleConfirmReadmitPlayer} className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Re-admission Notes / Audit trail (optional):</label>
                <textarea
                  rows={2}
                  value={readmitNotes}
                  onChange={(e) => setReadmitNotes(e.target.value)}
                  placeholder="e.g. Re-admitted to active roster by Coach"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setReadmitModalMember(null);
                    setReadmitNotes('');
                  }}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={processingId === readmitModalMember.membership_id}
                  className="px-4 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-lg text-xs font-bold transition-all disabled:opacity-50 inline-flex items-center space-x-1.5"
                >
                  {processingId === readmitModalMember.membership_id && (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  )}
                  <span>Confirm Re-admission</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 1: RELIEVE ATHLETE CONFIRMATION */}
      {relieveModalMember && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center space-x-3 text-rose-400">
              <AlertTriangle className="w-6 h-6 flex-shrink-0" />
              <h3 className="text-base font-bold text-white">Relieve Athlete from Active Roster</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to relieve <span className="font-bold text-white">{relieveModalMember.full_name}</span> from the active roster of{' '}
              <span className="font-bold text-amber-400">{selectedClub?.name}</span>?
            </p>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400">Reason for relief (optional):</label>
              <textarea
                rows={2}
                value={relieveReason}
                onChange={(e) => setRelieveReason(e.target.value)}
                placeholder="e.g. Inactive, graduation, medical leave..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
              />
            </div>
            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setRelieveModalMember(null)}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRelievePlayer}
                disabled={processingId === relieveModalMember.membership_id}
                className="px-4 py-2 bg-rose-500 hover:bg-rose-400 text-white rounded-lg text-xs font-bold transition-all disabled:opacity-50"
              >
                Confirm Relief
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: REQUEST COACH SUCCESSION */}
      {showSuccessionModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Send className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-white">Request Coach Succession</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSuccessionModal(false)}
                className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRequestSuccession} className="space-y-4 text-xs">
              <p className="text-slate-400 leading-relaxed">
                As Head Coach, you may propose an incoming coach succession for{' '}
                <span className="font-semibold text-white">{selectedClub?.name}</span>. This request will be submitted to the Super Admin for formal approval.
              </p>

              <div className="space-y-1.5">
                <label className="text-slate-300 font-semibold">Incoming Coach Account ID:</label>
                <input
                  type="text"
                  required
                  placeholder="Enter Incoming Coach Account ID (from Coach Profile)..."
                  value={incomingCoachUserId}
                  onChange={(e) => setIncomingCoachUserId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-300 font-semibold">Proposed Role Type:</label>
                <select
                  value={successionRoleType}
                  onChange={(e) => setSuccessionRoleType(e.target.value as CoachRoleType)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="HEAD_COACH">HEAD COACH (Successor)</option>
                  <option value="ASSISTANT_COACH">ASSISTANT COACH</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-300 font-semibold">Reason for Succession:</label>
                <textarea
                  rows={3}
                  value={successionReason}
                  onChange={(e) => setSuccessionReason(e.target.value)}
                  placeholder="e.g. Transition of coaching responsibilities for UAAPHIL Season..."
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowSuccessionModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-semibold transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={processingId === 'succession_submit'}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg font-bold transition-all disabled:opacity-50"
                >
                  Submit Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PHASE 3-G MODAL: ATOMIC LINEUP ↔ RESERVE SWAP */}
      {showSwapModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <ArrowUpDown className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-white">Substitute Competitor</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowSwapModal(false);
                  setSwapLineupRegId('');
                  setSwapReserveRegId('');
                }}
                className="p-1 text-slate-400 hover:text-white rounded-lg transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Atomically swap the starting lineup competitor and the standby reserve competitor in the database.
            </p>

            <form onSubmit={handleExecuteSwap} className="space-y-4">
              {/* Outgoing Lineup Athlete */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-amber-400 flex items-center space-x-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span>Outgoing Starting Lineup Competitor (Moves to Reserve):</span>
                </label>
                <select
                  value={swapLineupRegId}
                  onChange={(e) => setSwapLineupRegId(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500 font-medium"
                >
                  <option value="">-- Select Lineup Athlete --</option>
                  {currentLineupRegistrations.map((reg) => {
                    const athlete = activeRoster.find((m) => m.player_user_id === reg.user_id);
                    const name = athlete?.full_name || reg.user_profile?.full_name || 'Athlete ' + reg.user_id.slice(0, 8);
                    return (
                      <option key={reg.id} value={reg.id}>
                        {name} (Reg #{reg.id.slice(0, 8)})
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Incoming Reserve Athlete */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-sky-400 flex items-center space-x-1.5">
                  <span className="w-2 h-2 rounded-full bg-sky-400" />
                  <span>Incoming Standby Reserve Competitor (Promoted to Lineup):</span>
                </label>
                <select
                  value={swapReserveRegId}
                  onChange={(e) => setSwapReserveRegId(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500 font-medium"
                >
                  <option value="">-- Select Reserve Athlete --</option>
                  {currentReserveRegistrations.map((reg) => {
                    const athlete = activeRoster.find((m) => m.player_user_id === reg.user_id);
                    const name = athlete?.full_name || reg.user_profile?.full_name || 'Athlete ' + reg.user_id.slice(0, 8);
                    return (
                      <option key={reg.id} value={reg.id}>
                        {name} (Reg #{reg.id.slice(0, 8)})
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-[11px] text-slate-400 space-y-1">
                <div className="font-semibold text-slate-300">Transaction Guarantee:</div>
                <div>
                  This operation executes <span className="font-mono text-amber-300">swap_event_lineup_reserve</span> inside a single atomic database transaction.
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setShowSwapModal(false);
                    setSwapLineupRegId('');
                    setSwapReserveRegId('');
                  }}
                  disabled={swapping}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={swapping || !swapLineupRegId || !swapReserveRegId}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-bold transition-all disabled:opacity-50 inline-flex items-center space-x-1.5"
                >
                  {swapping ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ArrowUpDown className="w-3.5 h-3.5" />}
                  <span>{swapping ? 'Executing Swap...' : 'Confirm Atomic Swap'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
};
