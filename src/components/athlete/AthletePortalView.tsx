import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { playerMembershipService } from '../../services/playerMembershipService';
import { profileService } from '../../services/profileService';
import {
  ActivePlayerMembership,
  PlayerMembershipHistoryItem,
  MembershipType,
} from '../../types/playerMembership';
import {
  Tournament,
  TournamentEvent,
  Registration,
  Match,
  LineupRole,
} from '../../types/tournament';
import { getWeighInStatus, renderLineupRoleBadge } from '../registration/RegistrationManagementView';
import { CopyableId } from '../common/CopyableId';
import {
  User,
  Shield,
  Trophy,
  Medal,
  Calendar,
  Clock,
  MapPin,
  Scale,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ArrowRight,
  RefreshCw,
  Layers,
  Activity,
  Award,
  TrendingUp,
  Globe,
  Building2,
  Mail,
  Phone,
  Edit3,
  Save,
  Loader2,
  ExternalLink,
  ChevronRight,
  Info,
  Flame,
  Swords,
} from 'lucide-react';

type PortalTab = 'PROFILE_CLUB' | 'REGISTRATIONS' | 'WEIGH_IN' | 'MATCHES' | 'CAREER_RANKING';

interface EnrichedRegistration {
  id: string;
  tournamentId: string;
  tournamentName: string;
  tournamentStatus: string;
  event: TournamentEvent;
  isApproved: boolean;
  lineupRole: LineupRole;
  weighInWeight: number | null;
  seedNumber: number | null;
  createdAt: string;
}

interface EnrichedMatch {
  id: string;
  tournamentName: string;
  eventName: string;
  roundName: string;
  roundNumber: number;
  matchNumber: number;
  courtName: string | null;
  scheduledTime: string | null;
  status: string;
  corner: 'RED' | 'BLUE';
  opponentName: string;
  opponentClub: string;
  isWinner: boolean | null; // true if athlete won, false if lost, null if ongoing/scheduled
  winnerRegistrationId: string | null;
  athleteRegistrationId: string;
}

interface CareerStats {
  tournamentsParticipated: number;
  eventsEntered: number;
  matchesPlayed: number;
  matchesWon: number;
  matchesLost: number;
  winRate: number | null;
  goldCount: number;
  silverCount: number;
  bronzeCount: number;
  totalMedals: number;
}

interface AchievementItem {
  id: string;
  date: string;
  tournamentName: string;
  eventName: string;
  type: 'GOLD' | 'SILVER' | 'BRONZE' | 'FINALIST' | 'PARTICIPATION';
  detail: string;
}

export const AthletePortalView: React.FC = () => {
  const { user, profile, refreshProfile } = useAuth();

  const [activeTab, setActiveTab] = useState<PortalTab>('PROFILE_CLUB');
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Profile Edit State
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editFullName, setEditFullName] = useState(profile?.full_name || '');
  const [editPhoneNumber, setEditPhoneNumber] = useState(profile?.phone_number || '');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Membership State
  const [activeMembership, setActiveMembership] = useState<ActivePlayerMembership | null>(null);
  const [membershipHistory, setMembershipHistory] = useState<PlayerMembershipHistoryItem[]>([]);
  const [clubsList, setClubsList] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [clubSearchQuery, setClubSearchQuery] = useState('');
  const [debouncedClubQuery, setDebouncedClubQuery] = useState('');
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [selectedClubId, setSelectedClubId] = useState('');
  const [joinNotes, setJoinNotes] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [showResignModal, setShowResignModal] = useState(false);
  const [resignReason, setResignReason] = useState('');
  const [isResigning, setIsResigning] = useState(false);

  // Debounce club search query (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedClubQuery(clubSearchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [clubSearchQuery]);

  const filteredClubsList = useMemo(() => {
    if (!debouncedClubQuery.trim()) return clubsList;
    const q = debouncedClubQuery.toLowerCase().trim();
    return clubsList.filter(
      (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
    );
  }, [clubsList, debouncedClubQuery]);

  // Registrations & Competitions State
  const [registrations, setRegistrations] = useState<EnrichedRegistration[]>([]);
  const [matches, setMatches] = useState<EnrichedMatch[]>([]);
  const [matchFilter, setMatchFilter] = useState<'ALL' | 'UPCOMING' | 'COMPLETED'>('ALL');

  // Load all athlete data scoped to auth.uid()
  const loadAthleteData = useCallback(async () => {
    if (!user) return;

    try {
      setError(null);

      // 1. Fetch Active Membership and Membership History
      const [activeMem, memHist, { data: allClubs }] = await Promise.all([
        playerMembershipService.getPlayerActiveMembership(user.id),
        playerMembershipService.getPlayerMembershipHistory(user.id),
        supabase.from('clubs').select('id, name, code').eq('status', 'ACTIVE').order('name'),
      ]);

      setActiveMembership(activeMem);
      setMembershipHistory(memHist);
      setClubsList(allClubs || []);

      // 2. Fetch Athlete's Registrations across all tournaments
      const { data: rawRegs, error: regsError } = await supabase
        .from('registrations')
        .select(`
          id,
          event_id,
          user_id,
          team_name,
          is_approved,
          lineup_role,
          weigh_in_weight,
          created_at,
          event:events(
            id,
            snapshot_id,
            name,
            category,
            division,
            weight_class,
            gender,
            rules_override,
            created_at
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (regsError) {
        console.error('Error fetching athlete registrations:', regsError);
      }

      // Fetch tournament names for snapshots
      const regList: EnrichedRegistration[] = [];
      const userRegIds: string[] = [];

      if (rawRegs && rawRegs.length > 0) {
        // Collect all snapshot IDs to resolve tournament names
        const snapshotIds = Array.from(
          new Set(
            rawRegs
              .map((r: any) => r.event?.snapshot_id)
              .filter((id: string | undefined) => Boolean(id))
          )
        );

        let snapshotTourneyMap = new Map<string, { id: string; name: string; status: string }>();

        if (snapshotIds.length > 0) {
          const { data: snapshots } = await supabase
            .from('tournament_snapshots')
            .select(`
              id,
              tournament:tournaments(id, name, status)
            `)
            .in('id', snapshotIds);

          snapshots?.forEach((s: any) => {
            if (s.tournament) {
              snapshotTourneyMap.set(s.id, {
                id: s.tournament.id,
                name: s.tournament.name,
                status: s.tournament.status,
              });
            }
          });
        }

        rawRegs.forEach((r: any) => {
          if (!r.event) return;
          userRegIds.push(r.id);

          const tourneyInfo = snapshotTourneyMap.get(r.event.snapshot_id);

          regList.push({
            id: r.id,
            tournamentId: tourneyInfo?.id || 'unknown',
            tournamentName: tourneyInfo?.name || 'UAAPHIL Tournament',
            tournamentStatus: tourneyInfo?.status || 'UNKNOWN',
            event: r.event as TournamentEvent,
            isApproved: Boolean(r.is_approved),
            lineupRole: (r.lineup_role as LineupRole) || 'LINEUP',
            weighInWeight: r.weigh_in_weight !== null ? Number(r.weigh_in_weight) : null,
            seedNumber: null,
            createdAt: r.created_at,
          });
        });
      }

      setRegistrations(regList);

      // 3. Fetch Matches where the athlete is in RED or BLUE corner
      if (userRegIds.length > 0) {
        const { data: redMatches, error: redErr } = await supabase
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
            scheduled_time,
            tournament:tournaments(name),
            event:events(name),
            blue_registration:registrations!matches_blue_corner_registration_id_fkey(
              id,
              team_name,
              user_profile:profiles!registrations_user_id_fkey(full_name)
            )
          `)
          .in('red_corner_registration_id', userRegIds);

        const { data: blueMatches, error: blueErr } = await supabase
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
            scheduled_time,
            tournament:tournaments(name),
            event:events(name),
            red_registration:registrations!matches_red_corner_registration_id_fkey(
              id,
              team_name,
              user_profile:profiles!registrations_user_id_fkey(full_name)
            )
          `)
          .in('blue_corner_registration_id', userRegIds);

        const enrichedList: EnrichedMatch[] = [];

        redMatches?.forEach((m: any) => {
          const isWinner = m.status === 'COMPLETED' ? m.winner_registration_id === m.red_corner_registration_id : null;
          const oppProfile = (m.blue_registration as any)?.user_profile;
          const oppClub = (m.blue_registration as any)?.team_name;
          const courtDisplay = m.court_identifier
            ? (m.court_identifier.startsWith('Court') ? m.court_identifier : `Court ${m.court_identifier}`)
            : null;

          enrichedList.push({
            id: m.id,
            tournamentName: m.tournament?.name || 'UAAPHIL Tournament',
            eventName: m.event?.name || 'Event Match',
            roundName: `Round ${m.round_number || 1}`,
            roundNumber: m.round_number,
            matchNumber: m.match_number,
            courtName: courtDisplay,
            scheduledTime: m.scheduled_time,
            status: m.status || 'SCHEDULED',
            corner: 'RED',
            opponentName: oppProfile?.full_name || 'Standby / BYE',
            opponentClub: oppClub || 'Opponent Club',
            isWinner,
            winnerRegistrationId: m.winner_registration_id,
            athleteRegistrationId: m.red_corner_registration_id,
          });
        });

        blueMatches?.forEach((m: any) => {
          const isWinner = m.status === 'COMPLETED' ? m.winner_registration_id === m.blue_corner_registration_id : null;
          const oppProfile = (m.red_registration as any)?.user_profile;
          const oppClub = (m.red_registration as any)?.team_name;
          const courtDisplay = m.court_identifier
            ? (m.court_identifier.startsWith('Court') ? m.court_identifier : `Court ${m.court_identifier}`)
            : null;

          enrichedList.push({
            id: m.id,
            tournamentName: m.tournament?.name || 'UAAPHIL Tournament',
            eventName: m.event?.name || 'Event Match',
            roundName: `Round ${m.round_number || 1}`,
            roundNumber: m.round_number,
            matchNumber: m.match_number,
            courtName: courtDisplay,
            scheduledTime: m.scheduled_time,
            status: m.status || 'SCHEDULED',
            corner: 'BLUE',
            opponentName: oppProfile?.full_name || 'Standby / BYE',
            opponentClub: oppClub || 'Opponent Club',
            isWinner,
            winnerRegistrationId: m.winner_registration_id,
            athleteRegistrationId: m.blue_corner_registration_id,
          });
        });

        // Deduplicate & sort matches
        const uniqueMatchesMap = new Map<string, EnrichedMatch>();
        enrichedList.forEach((m) => uniqueMatchesMap.set(m.id, m));
        setMatches(Array.from(uniqueMatchesMap.values()).sort((a, b) => b.roundNumber - a.roundNumber));
      } else {
        setMatches([]);
      }
    } catch (err: any) {
      console.error('Error loading athlete portal data:', err);
      setError(err.message || 'Failed to load athlete information');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    loadAthleteData();
  }, [loadAthleteData]);

  // Sync profile state
  useEffect(() => {
    if (profile) {
      setEditFullName(profile.full_name || '');
      setEditPhoneNumber(profile.phone_number || '');
    }
  }, [profile]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadAthleteData();
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    try {
      setIsSavingProfile(true);
      setProfileMsg(null);

      await profileService.updateMyProfile(user.id, {
        full_name: editFullName.trim() || undefined,
        phone: editPhoneNumber.trim() || undefined,
        phone_number: editPhoneNumber.trim() || undefined,
      });

      await refreshProfile();
      setIsEditingProfile(false);
      setProfileMsg({ type: 'success', text: 'Personal profile updated successfully.' });
    } catch (err: any) {
      setProfileMsg({ type: 'error', text: err.message || 'Failed to update profile.' });
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleJoinClub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClubId) return;

    try {
      setIsJoining(true);
      setError(null);

      await playerMembershipService.requestMembership(selectedClubId, joinNotes.trim() || undefined);
      setShowJoinModal(false);
      setSelectedClubId('');
      setJoinNotes('');
      await loadAthleteData();
    } catch (err: any) {
      setError(err.message || 'Failed to submit club membership request');
    } finally {
      setIsJoining(false);
    }
  };

  const handleResignClub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeMembership) return;

    try {
      setIsResigning(true);
      setError(null);

      await playerMembershipService.relieveMembership(activeMembership.membership_id, resignReason.trim() || undefined);
      setShowResignModal(false);
      setResignReason('');
      await loadAthleteData();
    } catch (err: any) {
      setError(err.message || 'Failed to resign from club');
    } finally {
      setIsResigning(false);
    }
  };

  // Compute Career & Performance Statistics based on authoritative data
  const careerStats = useMemo<CareerStats>(() => {
    const tourneySet = new Set(registrations.map((r) => r.tournamentId));
    const completedMatches = matches.filter((m) => m.status === 'COMPLETED' && m.isWinner !== null);
    const wins = completedMatches.filter((m) => m.isWinner === true).length;
    const losses = completedMatches.filter((m) => m.isWinner === false).length;

    // Medals derived strictly from Finals & Bronze wins in completed matches
    let gold = 0;
    let silver = 0;
    let bronze = 0;

    matches.forEach((m) => {
      if (m.status === 'COMPLETED') {
        const isFinal = m.roundName.toLowerCase().includes('final') && !m.roundName.toLowerCase().includes('semi');
        const isBronzeMatch = m.roundName.toLowerCase().includes('bronze');

        if (isFinal) {
          if (m.isWinner === true) gold++;
          else if (m.isWinner === false) silver++;
        } else if (isBronzeMatch && m.isWinner === true) {
          bronze++;
        }
      }
    });

    const totalMatchesCount = wins + losses;
    const winRate = totalMatchesCount > 0 ? Math.round((wins / totalMatchesCount) * 100) : null;

    return {
      tournamentsParticipated: tourneySet.size,
      eventsEntered: registrations.length,
      matchesPlayed: completedMatches.length,
      matchesWon: wins,
      matchesLost: losses,
      winRate,
      goldCount: gold,
      silverCount: silver,
      bronzeCount: bronze,
      totalMedals: gold + silver + bronze,
    };
  }, [registrations, matches]);

  // Compute Achievement Timeline
  const achievements = useMemo<AchievementItem[]>(() => {
    const list: AchievementItem[] = [];

    matches.forEach((m) => {
      if (m.status === 'COMPLETED') {
        const isFinal = m.roundName.toLowerCase().includes('final') && !m.roundName.toLowerCase().includes('semi');
        const isBronzeMatch = m.roundName.toLowerCase().includes('bronze');

        if (isFinal && m.isWinner === true) {
          list.push({
            id: `ach-gold-${m.id}`,
            date: m.scheduledTime ? new Date(m.scheduledTime).toLocaleDateString() : 'Official Event',
            tournamentName: m.tournamentName,
            eventName: m.eventName,
            type: 'GOLD',
            detail: `Tournament Champion (Final Victory vs ${m.opponentName})`,
          });
        } else if (isFinal && m.isWinner === false) {
          list.push({
            id: `ach-silver-${m.id}`,
            date: m.scheduledTime ? new Date(m.scheduledTime).toLocaleDateString() : 'Official Event',
            tournamentName: m.tournamentName,
            eventName: m.eventName,
            type: 'SILVER',
            detail: `Tournament Finalist / Silver Medalist (Final vs ${m.opponentName})`,
          });
        } else if (isBronzeMatch && m.isWinner === true) {
          list.push({
            id: `ach-bronze-${m.id}`,
            date: m.scheduledTime ? new Date(m.scheduledTime).toLocaleDateString() : 'Official Event',
            tournamentName: m.tournamentName,
            eventName: m.eventName,
            type: 'BRONZE',
            detail: `Bronze Medalist (Bout Victory vs ${m.opponentName})`,
          });
        }
      }
    });

    // Add confirmed tournament participations if no match medals yet
    if (list.length === 0 && registrations.length > 0) {
      registrations.slice(0, 3).forEach((r) => {
        list.push({
          id: `ach-reg-${r.id}`,
          date: new Date(r.createdAt).toLocaleDateString(),
          tournamentName: r.tournamentName,
          eventName: r.event.name,
          type: 'PARTICIPATION',
          detail: `Official Delegation Entry (${r.lineupRole})`,
        });
      });
    }

    return list;
  }, [matches, registrations]);

  // Filtered matches list
  const filteredMatches = useMemo(() => {
    if (matchFilter === 'UPCOMING') {
      return matches.filter((m) => m.status === 'SCHEDULED' || m.status === 'CALLED' || m.status === 'IN_PROGRESS');
    }
    if (matchFilter === 'COMPLETED') {
      return matches.filter((m) => m.status === 'COMPLETED');
    }
    return matches;
  }, [matches, matchFilter]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[420px] space-y-3 text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin text-amber-400" />
        <span className="text-xs font-mono">Loading Athlete Hub &amp; Competition Records...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Welcome & Summary Header */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-900/90 to-slate-950 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div className="flex items-start sm:items-center gap-4">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-xl overflow-hidden shrink-0">
              {activeMembership?.club_logo_url ? (
                <img
                  src={activeMembership.club_logo_url}
                  alt={activeMembership.club_name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="w-8 h-8 sm:w-10 sm:h-10" />
              )}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] font-bold tracking-wide uppercase">
                  Verified Competitor
                </span>
                {activeMembership && (
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[11px] font-semibold flex items-center gap-1">
                    <Building2 className="w-3 h-3" />
                    {activeMembership.club_name}
                  </span>
                )}
              </div>
              <h1 className="text-2xl sm:text-3xl font-black text-slate-100 tracking-tight">
                {profile?.full_name || user?.email || 'Athlete Competitor'}
              </h1>
              <p className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                <span>UAAPHIL Official Athlete Portal</span>
                <span>•</span>
                <span className="font-mono text-slate-500">{user?.email}</span>
              </p>
            </div>
          </div>

          {/* Quick Stat Badges Header */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="bg-slate-950/80 border border-slate-800 px-3.5 py-2 rounded-2xl flex items-center gap-2.5 shadow-sm">
              <Trophy className="w-4 h-4 text-amber-400" />
              <div>
                <div className="text-[10px] text-slate-400 font-semibold uppercase">Tournaments</div>
                <div className="text-sm font-bold text-white">{careerStats.tournamentsParticipated}</div>
              </div>
            </div>
            <div className="bg-slate-950/80 border border-slate-800 px-3.5 py-2 rounded-2xl flex items-center gap-2.5 shadow-sm">
              <Swords className="w-4 h-4 text-blue-400" />
              <div>
                <div className="text-[10px] text-slate-400 font-semibold uppercase">Matches</div>
                <div className="text-sm font-bold text-white">{careerStats.matchesPlayed}</div>
              </div>
            </div>
            <div className="bg-slate-950/80 border border-slate-800 px-3.5 py-2 rounded-2xl flex items-center gap-2.5 shadow-sm">
              <Medal className="w-4 h-4 text-emerald-400" />
              <div>
                <div className="text-[10px] text-slate-400 font-semibold uppercase">Medals</div>
                <div className="text-sm font-bold text-white">{careerStats.totalMedals}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-2xl border border-slate-700 transition-colors disabled:opacity-50"
              title="Refresh Athlete Data"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-amber-400' : ''}`} />
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-xs text-rose-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex overflow-x-auto no-scrollbar gap-1.5 sm:gap-2 p-1.5 bg-slate-900/90 border border-slate-800 rounded-2xl backdrop-blur-md">
        <button
          type="button"
          onClick={() => setActiveTab('PROFILE_CLUB')}
          className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0 ${
            activeTab === 'PROFILE_CLUB'
              ? 'bg-amber-400 text-slate-950 shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <User className="w-4 h-4 shrink-0" />
          <span className="hidden xl:inline">My Profile &amp; Club</span>
          <span className="xl:hidden">Profile &amp; Club</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('REGISTRATIONS')}
          className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0 ${
            activeTab === 'REGISTRATIONS'
              ? 'bg-amber-400 text-slate-950 shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Layers className="w-4 h-4 shrink-0" />
          <span className="hidden xl:inline">My Tournament Entries</span>
          <span className="xl:hidden">Entries</span>
          {registrations.length > 0 && (
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
              activeTab === 'REGISTRATIONS' ? 'bg-slate-900 text-amber-300' : 'bg-slate-800 text-slate-300'
            }`}>
              {registrations.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('WEIGH_IN')}
          className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0 ${
            activeTab === 'WEIGH_IN'
              ? 'bg-amber-400 text-slate-950 shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Scale className="w-4 h-4 shrink-0" />
          <span className="hidden xl:inline">My Weigh-In &amp; Eligibility</span>
          <span className="xl:hidden">Weigh-In</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('MATCHES')}
          className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0 ${
            activeTab === 'MATCHES'
              ? 'bg-amber-400 text-slate-950 shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Swords className="w-4 h-4 shrink-0" />
          <span className="hidden xl:inline">My Schedule &amp; Matches</span>
          <span className="xl:hidden">Matches</span>
          {matches.length > 0 && (
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
              activeTab === 'MATCHES' ? 'bg-slate-900 text-amber-300' : 'bg-slate-800 text-slate-300'
            }`}>
              {matches.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('CAREER_RANKING')}
          className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0 ${
            activeTab === 'CAREER_RANKING'
              ? 'bg-amber-400 text-slate-950 shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Trophy className="w-4 h-4 shrink-0" />
          <span className="hidden xl:inline">Career &amp; Achievements</span>
          <span className="xl:hidden">Career Stats</span>
        </button>
      </div>

      {/* ==================================================================== */}
      {/* TAB 1: MY PROFILE & CLUB */}
      {/* ==================================================================== */}
      {activeTab === 'PROFILE_CLUB' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Profile Card */}
          <div className="lg:col-span-1 bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2.5 text-white font-bold text-base">
                <User className="w-5 h-5 text-amber-400" />
                Personal Profile
              </div>
              <button
                type="button"
                onClick={() => setIsEditingProfile(!isEditingProfile)}
                className="text-xs font-semibold text-amber-400 hover:text-amber-300 flex items-center gap-1.5"
              >
                <Edit3 className="w-3.5 h-3.5" />
                {isEditingProfile ? 'Cancel' : 'Edit'}
              </button>
            </div>

            {profileMsg && (
              <div className={`p-3 rounded-xl text-xs ${
                profileMsg.type === 'success' ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/10 text-rose-300 border border-rose-500/30'
              }`}>
                {profileMsg.text}
              </div>
            )}

            {!isEditingProfile ? (
              <div className="space-y-4">
                <div>
                  <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Full Name</div>
                  <div className="text-base font-bold text-white mt-0.5">{profile?.full_name || 'No Name Set'}</div>
                </div>

                <div>
                  <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Email Address</div>
                  <div className="text-xs font-mono text-slate-300 mt-0.5 flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-slate-500" />
                    <span>{user?.email}</span>
                  </div>
                </div>

                <div>
                  <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Contact Phone</div>
                  <div className="text-xs font-mono text-slate-300 mt-0.5 flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-slate-500" />
                    <span>{profile?.phone || profile?.phone_number || 'Not provided'}</span>
                  </div>
                </div>

                <div>
                  <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Account Status</div>
                  <span className={`inline-block mt-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold border ${
                    (profile?.status || profile?.account_status) === 'ACTIVE'
                      ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                      : 'bg-amber-950 text-amber-300 border-amber-800'
                  }`}>
                    {profile?.status || profile?.account_status || 'ACTIVE'}
                  </span>
                </div>

                <div className="pt-2">
                  <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider mb-1">Account UUID</div>
                  {user && <CopyableId id={user.id} label="Athlete ID" />}
                </div>
              </div>
            ) : (
              <form onSubmit={handleSaveProfile} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Full Legal Name</label>
                  <input
                    type="text"
                    value={editFullName}
                    onChange={(e) => setEditFullName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    placeholder="Enter full name"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Phone Number</label>
                  <input
                    type="tel"
                    value={editPhoneNumber}
                    onChange={(e) => setEditPhoneNumber(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    placeholder="e.g. +63 912 345 6789"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSavingProfile}
                  className="w-full py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold rounded-xl text-xs transition-colors flex items-center justify-center gap-2"
                >
                  {isSavingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save Profile Changes
                </button>
              </form>
            )}
          </div>

          {/* Club Affiliation Card & History */}
          <div className="lg:col-span-2 space-y-6">
            {/* Active Club Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-7 shadow-xl space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-2xl">
                    <Building2 className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">Current Club Affiliation</h3>
                    <p className="text-xs text-slate-400">Official club and delegation authority</p>
                  </div>
                </div>

                {activeMembership ? (
                  <button
                    type="button"
                    onClick={() => setShowResignModal(true)}
                    className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-rose-950/40 text-slate-300 hover:text-rose-300 border border-slate-700 text-xs font-semibold transition-colors"
                  >
                    Self-Resign / Leave Club
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowJoinModal(true)}
                    className="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold transition-colors flex items-center gap-2"
                  >
                    <Building2 className="w-4 h-4" />
                    Request Club Membership
                  </button>
                )}
              </div>

              {activeMembership ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-4 space-y-2">
                    <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Club Name</div>
                    <div className="text-base font-bold text-white flex items-center gap-2">
                      <span>{activeMembership.club_name}</span>
                      {activeMembership.club_code && (
                        <span className="px-2 py-0.5 bg-slate-800 text-slate-300 text-[10px] font-mono rounded">
                          {activeMembership.club_code}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-4 space-y-2">
                    <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Membership Type</div>
                    <div className="text-sm font-bold text-amber-300">{activeMembership.membership_type}</div>
                  </div>

                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-4 space-y-2">
                    <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Status</div>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {activeMembership.status}
                    </span>
                  </div>

                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-4 space-y-2">
                    <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Effective Since</div>
                    <div className="text-xs font-mono text-slate-300 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-slate-500" />
                      <span>{new Date(activeMembership.effective_from || activeMembership.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center bg-slate-950/50 border border-slate-800/60 rounded-2xl space-y-3">
                  <Info className="w-8 h-8 text-amber-400 mx-auto" />
                  <div className="text-sm font-bold text-slate-200">No Active Club Affiliation</div>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    You are currently an independent athlete. You can request membership with an active official club to represent them in upcoming tournaments.
                  </p>
                </div>
              )}
            </div>

            {/* Membership History */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-7 shadow-xl space-y-4">
              <div className="flex items-center gap-2 text-white font-bold text-base pb-3 border-b border-slate-800">
                <Clock className="w-4 h-4 text-slate-400" />
                Membership History &amp; Transfers
              </div>

              {membershipHistory.length > 0 ? (
                <div className="space-y-3">
                  {membershipHistory.map((item) => (
                    <div
                      key={item.membership_id}
                      className="bg-slate-950/60 border border-slate-800/70 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div>
                        <div className="text-sm font-bold text-slate-200">{item.club_name}</div>
                        <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                          <span>{item.membership_type}</span>
                          <span>•</span>
                          <span>{new Date(item.effective_from || item.created_at).toLocaleDateString()}</span>
                          {item.effective_to && (
                            <>
                              <span>to</span>
                              <span>{new Date(item.effective_to).toLocaleDateString()}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border self-start sm:self-auto ${
                        item.status === 'ACTIVE'
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          : item.status === 'TRANSFERRED'
                          ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                          : item.status === 'RELIEVED'
                          ? 'bg-slate-800 text-slate-300 border-slate-700'
                          : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                      }`}>
                        {item.status}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-500 italic py-2">No historical membership records on file.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 2: MY TOURNAMENT ENTRIES */}
      {/* ==================================================================== */}
      {activeTab === 'REGISTRATIONS' && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-7 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
              <div>
                <h3 className="text-xl font-bold text-white">Registered Tournament Events</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Authoritative delegation entries, official approval status, and coach lineup roles.
                </p>
              </div>
              <div className="text-xs text-slate-400 bg-slate-950 px-3.5 py-1.5 rounded-xl border border-slate-800">
                Total Registrations: <strong className="text-amber-400">{registrations.length}</strong>
              </div>
            </div>

            {registrations.length > 0 ? (
              <div className="divide-y divide-slate-800/80 mt-2">
                {registrations.map((reg) => (
                  <div key={reg.id} className="py-5 first:pt-4 last:pb-2 space-y-4">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <div>
                        <div className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                          {reg.tournamentName}
                        </div>
                        <h4 className="text-lg font-bold text-white mt-0.5">{reg.event.name}</h4>
                        <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-slate-400">
                          <span className="px-2 py-0.5 bg-slate-800 rounded text-slate-300 font-semibold">
                            {reg.event.category}
                          </span>
                          <span>•</span>
                          <span>Division: <strong className="text-slate-200">{reg.event.division}</strong></span>
                          <span>•</span>
                          <span>Weight: <strong className="text-slate-200">{reg.event.weight_class || 'Open Weight / Anyo'}</strong></span>
                        </div>
                      </div>

                      {/* Status Badges */}
                      <div className="flex flex-wrap items-center gap-3">
                        {/* Lineup Role */}
                        <div className="flex flex-col items-start sm:items-end">
                          <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-0.5">Lineup Role</span>
                          {renderLineupRoleBadge(reg.lineupRole)}
                        </div>

                        {/* Approval Status */}
                        <div className="flex flex-col items-start sm:items-end">
                          <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-0.5">Approval Status</span>
                          <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold border ${
                            reg.isApproved
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                          }`}>
                            {reg.isApproved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                            {reg.isApproved ? 'Approved' : 'Pending Review'}
                          </span>
                        </div>

                        {/* Seed Number if Available */}
                        {reg.seedNumber && (
                          <div className="flex flex-col items-start sm:items-end">
                            <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-0.5">Seed</span>
                            <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-purple-500/10 text-purple-300 border border-purple-500/30">
                              #{reg.seedNumber}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/60 flex flex-col sm:flex-row sm:items-center justify-between text-xs text-slate-400 gap-2">
                      <span>Registration ID: <code className="text-slate-500">{reg.id.slice(0, 13)}...</code></span>
                      <span className="italic">Lineup and approval roles are managed exclusively by authorized Coaches and Administrators.</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-10 text-center space-y-3">
                <Layers className="w-10 h-10 text-slate-600 mx-auto" />
                <div className="text-base font-bold text-slate-300">No Tournament Registrations Found</div>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  You are not currently registered for any tournament events. Contact your club coach to include you in upcoming tournament delegation rosters.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 3: MY WEIGH-IN & ELIGIBILITY */}
      {/* ==================================================================== */}
      {activeTab === 'WEIGH_IN' && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-7 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
              <div>
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  <Scale className="w-5 h-5 text-amber-400" />
                  Official Weigh-In &amp; Competition Eligibility
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Official weight records and eligibility verification for Full Contact &amp; Sparring events.
                </p>
              </div>
            </div>

            {registrations.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {registrations.map((reg) => {
                  const weighStatus = getWeighInStatus(
                    reg.weighInWeight,
                    reg.event.min_weight,
                    reg.event.max_weight
                  );

                  return (
                    <div
                      key={reg.id}
                      className="bg-slate-950/70 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs font-bold text-amber-400 uppercase tracking-wide">
                            {reg.tournamentName}
                          </div>
                          <h4 className="text-base font-bold text-white mt-0.5">{reg.event.name}</h4>
                          <div className="text-xs text-slate-400 mt-0.5">{reg.event.division}</div>
                        </div>

                        {/* Weigh-In Status Badge */}
                        <span className={`px-3 py-1 rounded-full text-xs font-bold border flex items-center gap-1.5 shrink-0 ${
                          weighStatus === 'PASSED'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : weighStatus === 'OVERWEIGHT'
                            ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                            : weighStatus === 'UNDERWEIGHT'
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                            : 'bg-slate-800 text-slate-300 border-slate-700'
                        }`}>
                          {weighStatus === 'PASSED' && <CheckCircle2 className="w-3.5 h-3.5" />}
                          {weighStatus === 'OVERWEIGHT' && <XCircle className="w-3.5 h-3.5" />}
                          {weighStatus === 'UNDERWEIGHT' && <AlertTriangle className="w-3.5 h-3.5" />}
                          {weighStatus === 'PENDING' && <Clock className="w-3.5 h-3.5" />}
                          {weighStatus}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800/80">
                        <div className="bg-slate-900 p-3 rounded-xl border border-slate-800">
                          <div className="text-[10px] text-slate-400 font-semibold uppercase">Official Weight</div>
                          <div className="text-base font-black text-white mt-0.5">
                            {reg.weighInWeight !== null ? `${reg.weighInWeight.toFixed(1)} kg` : 'Unrecorded'}
                          </div>
                        </div>

                        <div className="bg-slate-900 p-3 rounded-xl border border-slate-800">
                          <div className="text-[10px] text-slate-400 font-semibold uppercase">Allowed Range / Class</div>
                          <div className="text-xs font-mono font-bold text-slate-300 mt-1">
                            {reg.event.min_weight !== null && reg.event.min_weight !== undefined
                              ? `${reg.event.min_weight ?? 0} – ${reg.event.max_weight ?? '∞'} kg`
                              : reg.event.weight_class || 'Open / N/A'}
                          </div>
                        </div>
                      </div>

                      {/* Eligibility Advice Banner */}
                      <div className="text-[11px] leading-relaxed p-3 rounded-xl bg-slate-900/60 border border-slate-800/60 text-slate-400">
                        {weighStatus === 'PASSED' ? (
                          <span className="text-emerald-400 font-medium">
                            ✓ Official weigh-in passed. You are fully eligible for bracket seeding and court staging.
                          </span>
                        ) : weighStatus === 'OVERWEIGHT' ? (
                          <span className="text-rose-400 font-medium">
                            ⚠ Recorded weight exceeds division maximum. Re-weigh required during the official weigh-in window.
                          </span>
                        ) : weighStatus === 'UNDERWEIGHT' ? (
                          <span className="text-amber-400 font-medium">
                            ⚠ Recorded weight is below division minimum. Re-weigh required during official window.
                          </span>
                        ) : (
                          <span>
                            Official weigh-in pending. Please report to the tournament weigh-in station with your coach.
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-8 text-center text-xs text-slate-500">
                No active event entries available for weigh-in inspection.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 4: MY MATCH SCHEDULE & RESULTS */}
      {/* ==================================================================== */}
      {activeTab === 'MATCHES' && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-7 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
              <div>
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  <Swords className="w-5 h-5 text-amber-400" />
                  My Arena Schedule &amp; Match Results
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Live court queues, upcoming bouts, opponent assignments, and completed match results.
                </p>
              </div>

              {/* Match Filter Tabs */}
              <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1">
                <button
                  type="button"
                  onClick={() => setMatchFilter('ALL')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    matchFilter === 'ALL' ? 'bg-amber-400 text-slate-950 shadow' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  All ({matches.length})
                </button>
                <button
                  type="button"
                  onClick={() => setMatchFilter('UPCOMING')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    matchFilter === 'UPCOMING' ? 'bg-amber-400 text-slate-950 shadow' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Upcoming
                </button>
                <button
                  type="button"
                  onClick={() => setMatchFilter('COMPLETED')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    matchFilter === 'COMPLETED' ? 'bg-amber-400 text-slate-950 shadow' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Completed
                </button>
              </div>
            </div>

            {filteredMatches.length > 0 ? (
              <div className="space-y-4">
                {filteredMatches.map((m) => (
                  <div
                    key={m.id}
                    className={`bg-slate-950/70 border rounded-2xl p-5 transition-all ${
                      m.status === 'IN_PROGRESS' || m.status === 'CALLED'
                        ? 'border-amber-500/50 shadow-lg shadow-amber-500/5'
                        : 'border-slate-800'
                    }`}
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 text-xs font-bold text-amber-400 uppercase tracking-wide">
                          <span>{m.tournamentName}</span>
                          <span>•</span>
                          <span>{m.roundName}</span>
                        </div>
                        <h4 className="text-base font-bold text-white mt-0.5">{m.eventName}</h4>

                        {/* Match & Court Information */}
                        <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-400">
                          {m.courtName && (
                            <span className="px-2.5 py-0.5 bg-blue-500/10 text-blue-300 border border-blue-500/20 rounded-md font-semibold flex items-center gap-1">
                              <MapPin className="w-3 h-3" />
                              {m.courtName}
                            </span>
                          )}
                          <span>Match #{m.matchNumber}</span>
                          {m.scheduledTime && (
                            <span className="flex items-center gap-1 text-slate-300">
                              <Clock className="w-3 h-3 text-slate-500" />
                              {new Date(m.scheduledTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            m.corner === 'RED' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                          }`}>
                            {m.corner} CORNER
                          </span>
                        </div>
                      </div>

                      {/* Opponent & Result Outcome */}
                      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                        <div className="bg-slate-900/90 border border-slate-800 px-4 py-2.5 rounded-xl">
                          <div className="text-[10px] text-slate-400 font-semibold uppercase">Opponent</div>
                          <div className="text-sm font-bold text-white">{m.opponentName}</div>
                          <div className="text-xs text-slate-400">{m.opponentClub}</div>
                        </div>

                        {/* Match Outcome Badge */}
                        <div className="flex flex-col items-start sm:items-end">
                          <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Status / Result</span>
                          {m.status === 'COMPLETED' ? (
                            <span className={`px-3.5 py-1.5 rounded-xl text-xs font-black border flex items-center gap-1.5 ${
                              m.isWinner === true
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm'
                                : 'bg-slate-800 text-slate-400 border-slate-700'
                            }`}>
                              {m.isWinner === true ? <Trophy className="w-3.5 h-3.5 text-amber-400" /> : <XCircle className="w-3.5 h-3.5" />}
                              {m.isWinner === true ? 'VICTORY (WIN)' : 'DEFEAT'}
                            </span>
                          ) : (
                            <span className={`px-3.5 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 ${
                              m.status === 'IN_PROGRESS'
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse'
                                : m.status === 'CALLED'
                                ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                                : 'bg-slate-800 text-slate-300 border-slate-700'
                            }`}>
                              <Activity className="w-3.5 h-3.5" />
                              {m.status}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-10 text-center space-y-3">
                <Swords className="w-10 h-10 text-slate-600 mx-auto" />
                <div className="text-base font-bold text-slate-300">No Match Records Found</div>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Matches are populated once tournament brackets are generated and scheduled by tournament organizers.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 5: CAREER & ACHIEVEMENTS */}
      {/* ==================================================================== */}
      {activeTab === 'CAREER_RANKING' && (
        <div className="space-y-6">
          {/* Prominent Global Ranking Section */}
          <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl relative overflow-hidden">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-400 uppercase tracking-wider">
                  <Globe className="w-4 h-4" />
                  Official Global Standing
                </div>
                <h3 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                  RANKING STATUS: <span className="text-slate-400 font-bold">Not Yet Established</span>
                </h3>
                <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
                  Global ranking calculation requires a separately approved ranking methodology and is not implemented in this phase. Verified tournament statistics and historical placements are logged below.
                </p>
              </div>

              {/* Verified Baseline Stats Badge */}
              <div className="flex flex-wrap items-center gap-3 bg-slate-950/80 border border-slate-800/90 p-4 rounded-2xl">
                <div className="text-center px-3 border-r border-slate-800">
                  <div className="text-[10px] text-slate-500 font-semibold uppercase">Win Rate</div>
                  <div className="text-lg font-black text-emerald-400">
                    {careerStats.winRate !== null ? `${careerStats.winRate}%` : 'N/A'}
                  </div>
                </div>
                <div className="text-center px-3 border-r border-slate-800">
                  <div className="text-[10px] text-slate-500 font-semibold uppercase">Completed Bouts</div>
                  <div className="text-lg font-black text-white">{careerStats.matchesPlayed}</div>
                </div>
                <div className="text-center px-3">
                  <div className="text-[10px] text-slate-500 font-semibold uppercase">Tournaments</div>
                  <div className="text-lg font-black text-amber-400">{careerStats.tournamentsParticipated}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Career Summary & Medal Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Gold Medals Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2 relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-semibold uppercase">Gold Medals</span>
                <span className="text-2xl">🥇</span>
              </div>
              <div className="text-3xl font-black text-amber-400">{careerStats.goldCount}</div>
              <div className="text-[11px] text-slate-500">Tournament Championships</div>
            </div>

            {/* Silver Medals Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2 relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-semibold uppercase">Silver Medals</span>
                <span className="text-2xl">🥈</span>
              </div>
              <div className="text-3xl font-black text-slate-200">{careerStats.silverCount}</div>
              <div className="text-[11px] text-slate-500">Tournament Finalists</div>
            </div>

            {/* Bronze Medals Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2 relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-semibold uppercase">Bronze Medals</span>
                <span className="text-2xl">🥉</span>
              </div>
              <div className="text-3xl font-black text-amber-600">{careerStats.bronzeCount}</div>
              <div className="text-[11px] text-slate-500">Podium Deciders</div>
            </div>

            {/* Win / Loss Record Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2 relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-semibold uppercase">Bout Record</span>
                <Swords className="w-5 h-5 text-blue-400" />
              </div>
              <div className="text-2xl font-black text-white flex items-center gap-1.5">
                <span className="text-emerald-400">{careerStats.matchesWon}W</span>
                <span className="text-slate-600">-</span>
                <span className="text-rose-400">{careerStats.matchesLost}L</span>
              </div>
              <div className="text-[11px] text-slate-500">Verified official matches</div>
            </div>
          </div>

          {/* Chronological Achievement Timeline */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-7 shadow-xl space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2.5 text-white font-bold text-base">
                <Award className="w-5 h-5 text-amber-400" />
                Chronological Career Timeline
              </div>
              <span className="text-xs text-slate-400">Verified Results</span>
            </div>

            {achievements.length > 0 ? (
              <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
                {achievements.map((ach) => (
                  <div key={ach.id} className="relative space-y-1">
                    <div className="absolute -left-6 top-1.5 w-3 h-3 rounded-full bg-amber-400 ring-4 ring-slate-900" />
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
                      <span className="font-bold text-amber-300">{ach.tournamentName}</span>
                      <span className="text-slate-500 font-mono">{ach.date}</span>
                    </div>
                    <div className="text-sm font-bold text-white">{ach.eventName}</div>
                    <div className="text-xs text-slate-400 flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-slate-950 text-slate-300 border border-slate-800 font-medium">
                        {ach.detail}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-xs text-slate-500">
                No historical achievements logged yet. Results are automatically recorded upon match finalization.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL: REQUEST CLUB MEMBERSHIP */}
      {/* ==================================================================== */}
      {showJoinModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-7 max-w-md w-full shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Building2 className="w-5 h-5 text-amber-400" />
                Join an Official Club
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowJoinModal(false);
                  setClubSearchQuery('');
                }}
                className="text-slate-400 hover:text-white p-1"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleJoinClub} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Search & Select Club</label>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={clubSearchQuery}
                    onChange={(e) => setClubSearchQuery(e.target.value)}
                    placeholder="Filter by club name or code..."
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <select
                    value={selectedClubId}
                    onChange={(e) => setSelectedClubId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    required
                  >
                    <option value="">-- Choose active club ({filteredClubsList.length} available) --</option>
                    {filteredClubsList.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.code})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Notes / Motivation (Optional)</label>
                <textarea
                  value={joinNotes}
                  onChange={(e) => setJoinNotes(e.target.value)}
                  rows={3}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  placeholder="Introduce yourself to the club coach..."
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowJoinModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isJoining || !selectedClubId}
                  className="px-4 py-2 rounded-xl bg-amber-400 text-slate-950 text-xs font-bold hover:bg-amber-300 disabled:opacity-50 flex items-center gap-2"
                >
                  {isJoining && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Submit Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL: RESIGN / LEAVE CLUB CONFIRMATION */}
      {/* ==================================================================== */}
      {showResignModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-7 max-w-md w-full shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-lg font-bold text-rose-400 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                Resign from Club
              </h3>
              <button
                type="button"
                onClick={() => setShowResignModal(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to relieve your membership from <strong>{activeMembership?.club_name}</strong>? You will no longer represent this club in upcoming tournaments until you join another club.
            </p>

            <form onSubmit={handleResignClub} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Reason for Resignation (Optional)</label>
                <input
                  type="text"
                  value={resignReason}
                  onChange={(e) => setResignReason(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                  placeholder="e.g. Relocating, personal reasons"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowResignModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isResigning}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-2"
                >
                  {isResigning && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Confirm Resignation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
