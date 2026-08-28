import React, { useState, useEffect, useCallback } from 'react';
import {
  Trophy,
  Plus,
  Calendar,
  Lock,
  Layers,
  Database,
  Users,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
  ShieldAlert,
  ArrowRight,
  GitBranch,
  Info,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { tournamentService } from '../../services/tournamentService';
import {
  Tournament,
  TournamentSnapshot,
  TournamentEvent,
  Court,
  TournamentClosureSeal,
} from '../../types/tournament';
import { CreateTournamentModal } from './CreateTournamentModal';
import { SnapshotInitializationModal } from './SnapshotInitializationModal';
import { EventConfigurationModal } from './EventConfigurationModal';
import { CompetitionPreparationPanel } from './CompetitionPreparationPanel';
import { TournamentClosureModal } from './TournamentClosureModal';
import { TournamentChatPanel } from '../chat/TournamentChatPanel';
import { NavigationTab } from '../layout/AppLayout';
import { MessageSquare } from 'lucide-react';

interface TournamentManagementViewProps {
  onNavigateTab?: (tab: NavigationTab) => void;
}

export const TournamentManagementView: React.FC<TournamentManagementViewProps> = ({ onNavigateTab }) => {
  const { roles } = useAuth();
  const canManage = roles.includes('SUPER_ADMIN') || roles.includes('ADMIN') || roles.includes('ORGANIZER');
  const canFinalize = roles.includes('SUPER_ADMIN') || roles.includes('ADMIN');

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(null);
  const [selectedSubTab, setSelectedSubTab] = useState<'overview' | 'brackets' | 'chat'>('overview');
  const [activeSnapshot, setActiveSnapshot] = useState<TournamentSnapshot | null>(null);
  const [events, setEvents] = useState<TournamentEvent[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [closureSeal, setClosureSeal] = useState<TournamentClosureSeal | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isSnapshotModalOpen, setIsSnapshotModalOpen] = useState(false);
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [isClosureModalOpen, setIsClosureModalOpen] = useState(false);

  // Court creation inline
  const [newCourtName, setNewCourtName] = useState('');
  const [newCourtIdentifier, setNewCourtIdentifier] = useState('');
  const [isAddingCourt, setIsAddingCourt] = useState(false);

  const loadTournaments = useCallback(async (): Promise<Tournament[]> => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await tournamentService.getTournaments();
      setTournaments(data);
      if (data.length > 0) {
        setSelectedTournament((prev) => {
          if (!prev) return data[0];
          const exists = data.find((t) => t.id === prev.id);
          return exists || data[0];
        });
      } else {
        setSelectedTournament(null);
      }
      return data;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load tournaments.');
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadTournamentDetails = useCallback(async (tournamentId: string) => {
    // 1. Authoritatively fetch and set active snapshot and events
    try {
      const snapshot = await tournamentService.getActiveSnapshot(tournamentId);
      if (snapshot) {
        setActiveSnapshot(snapshot);
        try {
          const eventsList = await tournamentService.getEventsBySnapshotId(snapshot.id);
          setEvents(eventsList || []);
        } catch (eventsErr: unknown) {
          console.warn('Error fetching snapshot events:', eventsErr);
        }
      } else {
        setActiveSnapshot((prev) =>
          prev && prev.tournament_id === tournamentId ? prev : null
        );
      }
    } catch (err: unknown) {
      console.error('Error fetching active snapshot:', err);
      // On network/query error, preserve existing activeSnapshot if it belongs to this tournament
      setActiveSnapshot((prev) => (prev && prev.tournament_id === tournamentId ? prev : null));
    }

    // 2. Independently load courts without blocking snapshot UI state
    try {
      const courtsList = await tournamentService.getCourts(tournamentId);
      setCourts(courtsList);
    } catch (courtErr: unknown) {
      console.warn('Error fetching courts list:', courtErr);
    }

    // 3. Independently load closure seal without blocking snapshot UI state
    try {
      const seal = await tournamentService.getTournamentClosureSeal(tournamentId);
      setClosureSeal(seal);
    } catch (sealErr: unknown) {
      console.warn('Error fetching closure seal:', sealErr);
    }
  }, []);

  useEffect(() => {
    loadTournaments();
  }, [loadTournaments]);

  useEffect(() => {
    if (selectedTournament) {
      loadTournamentDetails(selectedTournament.id);
    } else {
      setActiveSnapshot(null);
      setEvents([]);
      setCourts([]);
    }
  }, [selectedTournament, loadTournamentDetails]);

  const handleStatusTransition = async (newStatus: 'REGISTRATION_OPEN' | 'REGISTRATION_CLOSED') => {
    if (!selectedTournament) return;
    setError(null);
    setSuccessMessage(null);
    setIsActionLoading(true);

    try {
      const updated = await tournamentService.updateTournamentStatus(selectedTournament.id, newStatus);
      setSelectedTournament(updated);
      await loadTournaments();
      setSuccessMessage(`Tournament status transitioned to ${newStatus}.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update tournament status.');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleLockAndStartTournament = async () => {
    if (!selectedTournament) return;
    const targetId = selectedTournament.id;
    setError(null);
    setSuccessMessage(null);
    setIsActionLoading(true);

    try {
      const res = await tournamentService.lockAndSnapshotTournament(targetId);
      const freshTournaments = await loadTournaments();
      const freshTournament = freshTournaments.find((t) => t.id === targetId);

      if (!freshTournament || freshTournament.status !== 'ONGOING') {
        setError(
          'Pre-Competition Lock could not be confirmed. The tournament lifecycle status was not persisted as ONGOING. Please refresh and verify the tournament state.'
        );
        return;
      }

      setSelectedTournament(freshTournament);
      await loadTournamentDetails(targetId);

      setSuccessMessage(
        `Pre-Competition Lock Successful! Status is now ONGOING with ${res.events_count} events, ${res.registrations_count} approved athletes, and ${res.courts_count} courts.`
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to lock tournament.');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleAddCourt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTournament || !newCourtName || !newCourtIdentifier) return;
    setIsAddingCourt(true);
    setError(null);
    try {
      await tournamentService.createCourt(selectedTournament.id, newCourtName.trim(), newCourtIdentifier.trim());
      setNewCourtName('');
      setNewCourtIdentifier('');
      const updatedCourts = await tournamentService.getCourts(selectedTournament.id);
      setCourts(updatedCourts);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create court.');
    } finally {
      setIsAddingCourt(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return <span className="px-2.5 py-1 text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700 rounded-full">DRAFT</span>;
      case 'REGISTRATION_OPEN':
        return <span className="px-2.5 py-1 text-xs font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-800 rounded-full">REGISTRATION OPEN</span>;
      case 'REGISTRATION_CLOSED':
        return <span className="px-2.5 py-1 text-xs font-semibold bg-amber-950/80 text-amber-300 border border-amber-800 rounded-full">REGISTRATION CLOSED</span>;
      case 'ONGOING':
        return <span className="px-2.5 py-1 text-xs font-semibold bg-blue-950/80 text-blue-300 border border-blue-800 rounded-full">ONGOING (COMPETITION)</span>;
      case 'COMPLETED':
        return <span className="px-2.5 py-1 text-xs font-semibold bg-purple-950/80 text-purple-300 border border-purple-800 rounded-full">COMPLETED</span>;
      default:
        return <span className="px-2.5 py-1 text-xs font-semibold bg-slate-800 text-slate-400 rounded-full">{status}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Trophy className="w-6 h-6 text-amber-400" />
            <h1 className="text-2xl font-bold text-slate-100">Tournament Management</h1>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Snapshot-First Tournament Lifecycle Engine & Competition Management
          </p>
        </div>

        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="px-4 py-2.5 text-sm font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-lg shadow-amber-400/10"
        >
          <Plus className="w-4 h-4" />
          <span>New Tournament (DRAFT)</span>
        </button>
      </div>

      {/* Messages */}
      {error && (
        <div className="p-4 bg-red-950/50 border border-red-800 rounded-xl flex items-start gap-3 text-red-200 text-sm">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1">{error}</div>
        </div>
      )}

      {successMessage && (
        <div className="p-4 bg-emerald-950/50 border border-emerald-800 rounded-xl flex items-start gap-3 text-emerald-200 text-sm">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="flex-1">{successMessage}</div>
        </div>
      )}

      {/* Main Grid */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-amber-400 mb-3" />
          <span>Loading tournaments...</span>
        </div>
      ) : tournaments.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-slate-800 rounded-2xl bg-slate-900/30">
          <Trophy className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-slate-200">No Tournaments Created</h3>
          <p className="text-sm text-slate-400 mt-1 max-w-md mx-auto mb-6">
            Get started by creating a tournament in DRAFT status, initializing its immutable snapshot, and configuring events.
          </p>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="px-5 py-2.5 text-sm font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Create Tournament</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Tournament Selector Sidebar */}
          <div className="space-y-3">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">
              Tournaments ({tournaments.length})
            </h2>
            <div className="space-y-2 max-h-[700px] overflow-y-auto pr-1">
              {tournaments.map((t) => {
                const isSelected = selectedTournament?.id === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTournament(t)}
                    className={`w-full text-left p-4 rounded-xl border transition-all ${
                      isSelected
                        ? 'bg-slate-900 border-amber-400/50 shadow-md shadow-amber-400/5'
                        : 'bg-slate-900/40 border-slate-800 hover:bg-slate-900/80 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="text-sm font-semibold text-slate-100 line-clamp-1">{t.name}</h3>
                      {getStatusBadge(t.status)}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-400">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        {new Date(t.start_date).toLocaleDateString()}
                      </span>
                      <span className="font-mono text-slate-500 text-[11px]">{t.slug}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Tournament Detail & Control Panel */}
          {selectedTournament && (
            <div className="lg:col-span-2 space-y-6">
              {/* Tournament Management Sub-Tabs */}
              <div className="flex bg-slate-900 border border-slate-800 rounded-2xl p-1.5 w-full max-w-full sm:max-w-xl lg:max-w-2xl shadow-md gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedSubTab('overview')}
                  className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                    selectedSubTab === 'overview'
                      ? 'bg-amber-400 text-slate-950 shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5 shrink-0" />
                  <span>Overview</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedSubTab('brackets')}
                  className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                    selectedSubTab === 'brackets'
                      ? 'bg-amber-400 text-slate-950 shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Trophy className="w-3.5 h-3.5 shrink-0" />
                  <span>Competition Prep</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedSubTab('chat')}
                  className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                    selectedSubTab === 'chat'
                      ? 'bg-amber-400 text-slate-950 shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                  <span>Official Chat</span>
                </button>
              </div>

              {selectedSubTab === 'chat' ? (
                <TournamentChatPanel
                  tournamentId={selectedTournament.id}
                  tournamentName={selectedTournament.name}
                  organizerId={selectedTournament.organizer_id}
                  isOrganizerOrAdmin={canManage}
                />
              ) : selectedSubTab === 'brackets' ? (
                <CompetitionPreparationPanel
                  tournament={selectedTournament}
                  snapshot={activeSnapshot}
                  events={events}
                  canManage={canManage}
                  onOpenCourtOperations={onNavigateTab ? () => onNavigateTab('competition') : undefined}
                />
              ) : (
                /* Tournament Meta Card & Overview */
                <div className="p-4 sm:p-6 bg-slate-900 border border-slate-800 rounded-2xl space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
                    <div>
                      <div className="flex items-center gap-3">
                        <h2 className="text-xl font-bold text-slate-100">{selectedTournament.name}</h2>
                        {getStatusBadge(selectedTournament.status)}
                      </div>
                      <p className="text-xs text-slate-400 font-mono mt-1">
                        ID: {selectedTournament.id} • Slug: /{selectedTournament.slug}
                      </p>
                    </div>
                    <div className="text-right text-xs text-slate-400">
                      <div>Schedule: {selectedTournament.start_date} to {selectedTournament.end_date}</div>
                    </div>
                  </div>

                {/* Canonical Lifecycle Pipeline Stepper */}
                <div>
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                    Tournament Lifecycle Pipeline
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className={`p-3 rounded-lg border text-xs ${
                      selectedTournament.status === 'DRAFT'
                        ? 'bg-amber-950/40 border-amber-500/50 text-amber-200'
                        : 'bg-slate-950/50 border-slate-800 text-slate-400'
                    }`}>
                      <div className="font-semibold mb-0.5">1. DRAFT</div>
                      <div className="text-[11px] text-slate-400">Snapshot & Event Setup</div>
                    </div>

                    <div className={`p-3 rounded-lg border text-xs ${
                      selectedTournament.status === 'REGISTRATION_OPEN'
                        ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-200'
                        : 'bg-slate-950/50 border-slate-800 text-slate-400'
                    }`}>
                      <div className="font-semibold mb-0.5">2. REG. OPEN</div>
                      <div className="text-[11px] text-slate-400">Athlete Entry Active</div>
                    </div>

                    <div className={`p-3 rounded-lg border text-xs ${
                      selectedTournament.status === 'REGISTRATION_CLOSED'
                        ? 'bg-amber-950/40 border-amber-500/50 text-amber-200'
                        : 'bg-slate-950/50 border-slate-800 text-slate-400'
                    }`}>
                      <div className="font-semibold mb-0.5">3. REG. CLOSED</div>
                      <div className="text-[11px] text-slate-400">Weigh-in & Lock Check</div>
                    </div>

                    <div className={`p-3 rounded-lg border text-xs ${
                      selectedTournament.status === 'ONGOING'
                        ? 'bg-blue-950/40 border-blue-500/50 text-blue-200'
                        : 'bg-slate-950/50 border-slate-800 text-slate-400'
                    }`}>
                      <div className="font-semibold mb-0.5">4. ONGOING</div>
                      <div className="text-[11px] text-slate-400">Live Competition</div>
                    </div>
                  </div>
                </div>

                {/* Snapshot Status Panel */}
                <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <Database className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-sm font-semibold text-slate-200">
                        {activeSnapshot
                          ? `Active Snapshot v${activeSnapshot.version} (Immutable)`
                          : 'No Snapshot Initialized'}
                      </h4>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {activeSnapshot
                          ? `Bound Snapshot ID: ${activeSnapshot.id.slice(0, 18)}...`
                          : 'Initial Snapshot must be created in DRAFT before configuring events.'}
                      </p>
                    </div>
                  </div>

                  {!activeSnapshot && selectedTournament.status === 'DRAFT' && (
                    <button
                      onClick={() => setIsSnapshotModalOpen(true)}
                      className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors shrink-0 flex items-center gap-1.5"
                    >
                      <Database className="w-3.5 h-3.5" />
                      <span>Initialize Snapshot v1</span>
                    </button>
                  )}
                </div>

                {/* Action Toolbar by Lifecycle State */}
                <div className="p-4 bg-slate-950/40 border border-slate-800 rounded-xl space-y-3">
                  <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                    Lifecycle Execution Actions
                  </h4>

                  {/* Inline Next-Step Helper for DRAFT tournaments with active Snapshot and 0 events */}
                  {selectedTournament.status === 'DRAFT' && activeSnapshot && events.length === 0 && (
                    <div className="p-3 bg-emerald-950/30 border border-emerald-800/50 rounded-lg flex items-center gap-2.5 text-xs text-emerald-300">
                      <Info className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>
                        Snapshot v{activeSnapshot.version} active. Click <strong className="text-emerald-200">“Configure Events”</strong> to add at least 1 event before opening registrations.
                      </span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-3">
                    {/* DRAFT ACTIONS */}
                    {selectedTournament.status === 'DRAFT' && (
                      <>
                        <button
                          disabled={!activeSnapshot || isActionLoading}
                          onClick={() => setIsEventModalOpen(true)}
                          className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 disabled:opacity-40 disabled:hover:bg-emerald-400 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
                        >
                          <Layers className="w-3.5 h-3.5" />
                          <span>Configure Events ({events.length})</span>
                        </button>

                        <div className="relative group">
                          <button
                            disabled={!activeSnapshot || events.length === 0 || isActionLoading}
                            onClick={() => handleStatusTransition('REGISTRATION_OPEN')}
                            title={events.length === 0 ? 'Configure at least 1 event before opening registrations.' : undefined}
                            className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
                          >
                            {isActionLoading ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <ArrowRight className="w-3.5 h-3.5" />
                            )}
                            <span>Open Registrations</span>
                          </button>
                          {events.length === 0 && (
                            <span className="hidden sm:group-hover:block absolute bottom-full mb-1.5 left-0 z-20 px-2 py-1 text-[11px] font-medium text-slate-200 bg-slate-900 border border-slate-700 rounded shadow-lg whitespace-nowrap pointer-events-none">
                              Configure at least 1 event before opening registrations.
                            </span>
                          )}
                        </div>
                      </>
                    )}

                    {/* REGISTRATION OPEN ACTIONS */}
                    {selectedTournament.status === 'REGISTRATION_OPEN' && (
                      <>
                        <button
                          onClick={() => setIsEventModalOpen(true)}
                          className="px-4 py-2 text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5"
                        >
                          <Layers className="w-3.5 h-3.5" />
                          <span>View Events ({events.length})</span>
                        </button>

                        <button
                          disabled={isActionLoading}
                          onClick={() => handleStatusTransition('REGISTRATION_CLOSED')}
                          className="px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 disabled:opacity-40 rounded-lg transition-colors flex items-center gap-1.5"
                        >
                          {isActionLoading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Lock className="w-3.5 h-3.5" />
                          )}
                          <span>Close Registrations (Start Weigh-In)</span>
                        </button>
                      </>
                    )}

                    {/* REGISTRATION CLOSED ACTIONS */}
                    {selectedTournament.status === 'REGISTRATION_CLOSED' && (
                      <div className="w-full space-y-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            disabled={isActionLoading || courts.length === 0}
                            onClick={handleLockAndStartTournament}
                            className="px-5 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-lg transition-colors flex items-center gap-2 shadow-lg shadow-blue-500/20 cursor-pointer disabled:cursor-not-allowed"
                          >
                            {isActionLoading ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span>Locking and finalizing tournament snapshot...</span>
                              </>
                            ) : (
                              <>
                                <ShieldAlert className="w-4 h-4 text-amber-300" />
                                <span>Pre-Competition Lock (Start ONGOING)</span>
                              </>
                            )}
                          </button>

                          <button
                            disabled={isActionLoading}
                            onClick={() => handleStatusTransition('REGISTRATION_OPEN')}
                            className="px-3.5 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
                          >
                            Re-open Registrations
                          </button>
                        </div>

                        {/* Inline Error Feedback for Lock and Lifecycle Failures */}
                        {error && (
                          <div
                            role="alert"
                            className="p-3.5 bg-red-950/60 border border-red-800/80 rounded-xl flex items-start gap-3 text-red-200 text-xs shadow-sm"
                          >
                            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                            <div className="flex-1 space-y-1">
                              <div className="font-semibold text-red-300">
                                Pre-Competition Lock Rejected
                              </div>
                              <div className="text-red-200 leading-relaxed font-mono text-[11px] bg-red-950/80 p-2 rounded border border-red-900/50">
                                {error}
                              </div>
                              {error.includes('approved athlete registration') && (
                                <p className="text-[11px] text-amber-300/90 pt-0.5">
                                  Action required: Ensure at least one athlete registration has been approved before initiating the Pre-Competition Lock.
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ONGOING STATE */}
                    {selectedTournament.status === 'ONGOING' && (
                      <div className="space-y-3 w-full">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-blue-950/40 border border-blue-800/60 rounded-xl">
                          <div className="flex items-center gap-2 text-xs text-blue-300 min-w-0">
                            <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0" />
                            <span>Competition in progress. Configuration, events, and rosters are locked and immutable.</span>
                          </div>

                          {canFinalize && (
                            <button
                              onClick={() => setIsClosureModalOpen(true)}
                              className="w-full sm:w-auto justify-center px-4 py-2 text-xs font-bold text-slate-950 bg-linear-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 rounded-lg transition-all shadow-md shadow-amber-950/40 flex items-center gap-1.5 shrink-0 cursor-pointer"
                            >
                              <ShieldAlert className="w-3.5 h-3.5" />
                              <span>Finalize & Seal Tournament</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* COMPLETED / SEALED STATE */}
                    {selectedTournament.status === 'COMPLETED' && (
                      <div className="p-4 bg-slate-950/80 border border-amber-500/40 rounded-xl space-y-2.5 w-full text-xs">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                          <div className="flex items-center gap-2">
                            <Lock className="w-4 h-4 text-amber-400" />
                            <span className="font-bold text-slate-100 uppercase tracking-wide">
                              Tournament Officially Sealed & Frozen
                            </span>
                          </div>
                          <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded font-mono">
                            IMMUTABLE
                          </span>
                        </div>

                        {closureSeal ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono text-slate-400 pt-1">
                            <div>
                              <span className="font-sans font-semibold text-slate-500 block">Seal Number:</span>
                              <span className="text-amber-300 font-bold">{closureSeal.seal_number}</span>
                            </div>
                            <div>
                              <span className="font-sans font-semibold text-slate-500 block">Grand Champion Team:</span>
                              <span className="text-slate-200 font-bold font-sans">
                                {closureSeal.champion_team_name || 'TBD'}
                              </span>
                            </div>
                            <div className="sm:col-span-2">
                              <span className="font-sans font-semibold text-slate-500 block">SHA-256 Closure Hash:</span>
                              <span className="text-slate-300 break-all text-[10px]">{closureSeal.closure_hash}</span>
                            </div>
                            <div>
                              <span className="font-sans font-semibold text-slate-500 block">Total Certified Bouts:</span>
                              <span className="text-slate-300 font-sans">
                                {closureSeal.total_bouts_completed} Matches | {closureSeal.total_anyo_performances} Anyo
                              </span>
                            </div>
                            <div>
                              <span className="font-sans font-semibold text-slate-500 block">Finalized Timestamp:</span>
                              <span className="text-slate-300 font-sans">
                                {new Date(closureSeal.finalized_at).toLocaleString()} (UTC)
                              </span>
                            </div>
                          </div>
                        ) : (
                          <p className="text-slate-400 text-xs">
                            This tournament has been officially finalized. Results, scores, and medal allocations are permanently frozen.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Courts Configuration Section */}
                <div className="p-4 bg-slate-950/40 border border-slate-800 rounded-xl space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                        Tournament Courts ({courts.length})
                      </h4>
                      <p className="text-xs text-slate-500">
                        At least 1 active court is required to lock and begin tournament.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {courts.map((court) => (
                      <div
                        key={court.id}
                        className="p-3 bg-slate-900 border border-slate-800 rounded-lg flex items-center justify-between"
                      >
                        <div>
                          <div className="text-xs font-semibold text-slate-200">{court.name}</div>
                          <div className="text-[11px] text-slate-400 font-mono">Identifier: {court.identifier}</div>
                        </div>
                        <span className="px-2 py-0.5 text-[10px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800 rounded">
                          ACTIVE
                        </span>
                      </div>
                    ))}
                  </div>

                  {selectedTournament.status !== 'ONGOING' && selectedTournament.status !== 'COMPLETED' && (
                    <form onSubmit={handleAddCourt} className="flex flex-col sm:flex-row gap-2 pt-2">
                      <input
                        type="text"
                        required
                        value={newCourtName}
                        onChange={(e) => setNewCourtName(e.target.value)}
                        placeholder="Court Name (e.g., Court 1)"
                        className="flex-1 min-w-0 px-3 py-2 sm:py-1.5 bg-slate-900 border border-slate-800 rounded text-xs text-slate-100 focus:outline-hidden focus:border-amber-400"
                      />
                      <input
                        type="text"
                        required
                        value={newCourtIdentifier}
                        onChange={(e) => setNewCourtIdentifier(e.target.value)}
                        placeholder="ID (e.g., C1)"
                        className="w-full sm:w-24 px-3 py-2 sm:py-1.5 bg-slate-900 border border-slate-800 rounded text-xs text-slate-100 font-mono focus:outline-hidden focus:border-amber-400"
                      />
                      <button
                        type="submit"
                        disabled={isAddingCourt}
                        className="w-full sm:w-auto px-4 py-2 sm:py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 rounded transition-colors"
                      >
                        {isAddingCourt ? 'Adding...' : 'Add Court'}
                      </button>
                    </form>
                  )}
                </div>
              </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <CreateTournamentModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={(newTournament) => {
          setTournaments((prev) => [newTournament, ...prev]);
          setSelectedTournament(newTournament);
          setSuccessMessage(`Tournament "${newTournament.name}" created in DRAFT status.`);
        }}
      />

      <SnapshotInitializationModal
        isOpen={isSnapshotModalOpen}
        tournament={selectedTournament}
        onClose={() => setIsSnapshotModalOpen(false)}
        onSuccess={async (res) => {
          if (selectedTournament) {
            const snapshotId = res.id || res.snapshot_id;
            try {
              let snapshot = await tournamentService.getSnapshotById(snapshotId);
              if (!snapshot) {
                snapshot = await tournamentService.getActiveSnapshot(selectedTournament.id);
              }
              if (snapshot) {
                setActiveSnapshot(snapshot);
                try {
                  const evs = await tournamentService.getEventsBySnapshotId(snapshot.id);
                  setEvents(evs || []);
                } catch {
                  setEvents([]);
                }
              } else {
                const fallbackSnapshot: TournamentSnapshot = {
                  id: snapshotId,
                  tournament_id: res.tournament_id || selectedTournament.id,
                  version: res.version,
                  is_active: true,
                  configuration: {},
                  created_at: new Date().toISOString(),
                };
                setActiveSnapshot(fallbackSnapshot);
                try {
                  const evs = await tournamentService.getEventsBySnapshotId(snapshotId);
                  setEvents(evs || []);
                } catch {
                  setEvents([]);
                }
              }
            } catch (snapErr) {
              console.warn('Error hydrating snapshot immediately on success:', snapErr);
              const fallbackSnapshot: TournamentSnapshot = {
                id: snapshotId,
                tournament_id: res.tournament_id || selectedTournament.id,
                version: res.version,
                is_active: true,
                configuration: {},
                created_at: new Date().toISOString(),
              };
              setActiveSnapshot(fallbackSnapshot);
            }
            await loadTournamentDetails(selectedTournament.id);
          }
          setSuccessMessage(`Snapshot Version ${res.version} successfully created and frozen.`);
        }}
      />

      <EventConfigurationModal
        isOpen={isEventModalOpen}
        tournament={selectedTournament}
        snapshot={activeSnapshot}
        events={events}
        onClose={() => setIsEventModalOpen(false)}
        onRefreshEvents={() => {
          if (activeSnapshot) {
            tournamentService.getEventsBySnapshotId(activeSnapshot.id).then(setEvents);
          }
        }}
      />

      <TournamentClosureModal
        isOpen={isClosureModalOpen}
        tournament={selectedTournament}
        onClose={() => setIsClosureModalOpen(false)}
        onSuccess={async (res) => {
          setIsClosureModalOpen(false);
          setSuccessMessage(`Tournament "${selectedTournament?.name}" officially sealed with Seal Number ${res.seal_number}.`);
          await loadTournaments();
          if (selectedTournament) {
            await loadTournamentDetails(selectedTournament.id);
          }
        }}
      />
    </div>
  );
};
