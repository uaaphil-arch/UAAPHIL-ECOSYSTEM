import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  Trophy,
  Layers,
  ListOrdered,
  Lock,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Eye,
  Edit3,
  ArrowUp,
  ArrowDown,
  Check,
  Info,
  Shield,
  Loader2,
  Award,
  Medal,
  Calendar,
} from 'lucide-react';
import {
  Tournament,
  TournamentSnapshot,
  TournamentEvent,
  AnyoCategorySession,
  AnyoPerformance,
  AnyoPanelSize,
  AnyoCalcMethod,
} from '../../types/tournament';
import { BracketSummary, BracketGenerationResult } from '../../types/brackets';
import { bracketService } from '../../services/bracketService';
import { anyoScoringService } from '../../services/anyoScoringService';
import { InteractiveBracketViewer } from './InteractiveBracketViewer';

interface CompetitionPreparationPanelProps {
  tournament: Tournament;
  snapshot: TournamentSnapshot | null;
  events: TournamentEvent[];
  canManage: boolean;
  onOpenCourtOperations?: (matchId?: string) => void;
}

export const CompetitionPreparationPanel: React.FC<CompetitionPreparationPanelProps> = ({
  tournament,
  snapshot,
  events,
  canManage,
  onOpenCourtOperations,
}) => {
  // Discipline Filtering: Separate Full Contact vs Anyo events
  const isAnyoEvent = (evt: TournamentEvent) => {
    const cat = evt.category || '';
    const name = evt.name || '';
    return cat.toLowerCase().includes('anyo') || name.toLowerCase().includes('anyo');
  };

  const anyoEvents = events.filter(isAnyoEvent);
  const fullContactEvents = events.filter((e) => !isAnyoEvent(e));

  // Mode Selection: 'FULL_CONTACT' vs 'ANYO'
  const [selectedDiscipline, setSelectedDiscipline] = useState<'FULL_CONTACT' | 'ANYO'>(() => {
    if (fullContactEvents.length > 0) return 'FULL_CONTACT';
    if (anyoEvents.length > 0) return 'ANYO';
    return 'FULL_CONTACT';
  });

  // Selected Anyo Event
  const [selectedAnyoEventId, setSelectedAnyoEventId] = useState<string>('');

  // -------------------------------------------------------------
  // FULL CONTACT STATE
  // -------------------------------------------------------------
  const [fcSummary, setFcSummary] = useState<BracketSummary | null>(null);
  const [isFcLoading, setIsFcLoading] = useState<boolean>(false);
  const [isFcGenerating, setIsFcGenerating] = useState<boolean>(false);
  const [fcGenerationResult, setFcGenerationResult] = useState<BracketGenerationResult | null>(null);
  const [fcError, setFcError] = useState<string | null>(null);
  const [showFcConfirmModal, setShowFcConfirmModal] = useState<boolean>(false);
  const [fcActiveView, setFcActiveView] = useState<'PANEL' | 'VIEWER'>('PANEL');

  // -------------------------------------------------------------
  // ANYO STATE
  // -------------------------------------------------------------
  const [anyoSession, setAnyoSession] = useState<AnyoCategorySession | null>(null);
  const [anyoPerformances, setAnyoPerformances] = useState<AnyoPerformance[]>([]);
  const [isAnyoLoading, setIsAnyoLoading] = useState<boolean>(false);
  const [isAnyoGenerating, setIsAnyoGenerating] = useState<boolean>(false);
  const [isAnyoConfirming, setIsAnyoConfirming] = useState<boolean>(false);
  const [isAnyoSavingOverride, setIsAnyoSavingOverride] = useState<boolean>(false);
  const [anyoError, setAnyoError] = useState<string | null>(null);
  const [anyoSuccessMessage, setAnyoSuccessMessage] = useState<string | null>(null);

  // Anyo Modal State
  const [showAnyoDrawModal, setShowAnyoDrawModal] = useState<boolean>(false);
  const [showAnyoManualOverrideModal, setShowAnyoManualOverrideModal] = useState<boolean>(false);
  const [anyoManualOrderList, setAnyoManualOrderList] = useState<string[]>([]);
  const [anyoManualOverrideReason, setAnyoManualOverrideReason] = useState<string>('');

  // -------------------------------------------------------------
  // LOAD FULL CONTACT BRACKET SUMMARY
  // -------------------------------------------------------------
  const loadFcSummary = useCallback(async () => {
    try {
      setIsFcLoading(true);
      setFcError(null);
      const data = await bracketService.getBracketSummary(tournament.id);
      setFcSummary(data);
      if (data.total_bracket_nodes > 0) {
        setFcActiveView('VIEWER');
      }
    } catch (err: unknown) {
      console.error('Error fetching bracket summary:', err);
      setFcError(err instanceof Error ? err.message : 'Failed to check bracket status');
    } finally {
      setIsFcLoading(false);
    }
  }, [tournament.id]);

  useEffect(() => {
    if (selectedDiscipline === 'FULL_CONTACT') {
      loadFcSummary();
    }
  }, [selectedDiscipline, loadFcSummary]);

  // Set default Anyo event if available
  useEffect(() => {
    if (anyoEvents.length > 0 && (!selectedAnyoEventId || !anyoEvents.find((e) => e.id === selectedAnyoEventId))) {
      setSelectedAnyoEventId(anyoEvents[0].id);
    }
  }, [anyoEvents, selectedAnyoEventId]);

  // -------------------------------------------------------------
  // LOAD ANYO CATEGORY SESSION & PERFORMANCES
  // -------------------------------------------------------------
  const loadAnyoSession = useCallback(async (eventId: string) => {
    if (!eventId) return;
    try {
      setIsAnyoLoading(true);
      setAnyoError(null);

      // Get or initialize session for this event (panel size and calc method derived authoritatively from event contract)
      const sess = await anyoScoringService.getOrCreateSession(
        tournament.id,
        eventId
      );
      setAnyoSession(sess);

      const perfs = await anyoScoringService.getSessionPerformances(sess.id);
      setAnyoPerformances(perfs);
    } catch (err: unknown) {
      console.error('Error fetching Anyo session:', err);
      setAnyoError(err instanceof Error ? err.message : 'Failed to load Anyo session');
    } finally {
      setIsAnyoLoading(false);
    }
  }, [tournament.id]);

  useEffect(() => {
    if (selectedDiscipline === 'ANYO' && selectedAnyoEventId) {
      loadAnyoSession(selectedAnyoEventId);
    }
  }, [selectedDiscipline, selectedAnyoEventId, loadAnyoSession]);

  // -------------------------------------------------------------
  // FULL CONTACT HANDLERS
  // -------------------------------------------------------------
  const handleGenerateBrackets = async () => {
    try {
      setIsFcGenerating(true);
      setFcError(null);
      setShowFcConfirmModal(false);

      const result = await bracketService.generateTournamentBrackets(tournament.id);
      setFcGenerationResult(result);
      await loadFcSummary();
      setFcActiveView('VIEWER');
    } catch (err: unknown) {
      console.error('Error generating tournament brackets:', err);
      setFcError(err instanceof Error ? err.message : 'Failed to generate tournament brackets');
    } finally {
      setIsFcGenerating(false);
    }
  };

  const isFcEligibleToGenerate =
    canManage &&
    (tournament.status === 'ONGOING' || tournament.status === 'REGISTRATION_CLOSED') &&
    snapshot !== null &&
    (!fcSummary || !fcSummary.has_active_or_completed_matches);

  // -------------------------------------------------------------
  // ANYO HANDLERS
  // -------------------------------------------------------------
  const handleGenerateAnyoDraw = async (isRegeneration = false) => {
    if (!anyoSession) return;
    setIsAnyoGenerating(true);
    setAnyoError(null);
    setAnyoSuccessMessage(null);
    try {
      const res = await anyoScoringService.generateSeededMarchingOrder(anyoSession.id, isRegeneration);
      setAnyoSuccessMessage(
        isRegeneration
          ? `Marching order regenerated (Draw v${res.draw_version}) with 24-month snapshot seeding cutoff.`
          : `Seeded marching order generated (Draw v${res.draw_version}) for ${res.total_performers} competitors.`
      );
      await loadAnyoSession(selectedAnyoEventId);
      setShowAnyoDrawModal(true);
    } catch (err: unknown) {
      console.error('Error generating Anyo marching order:', err);
      setAnyoError(err instanceof Error ? err.message : 'Failed to generate seeded marching order.');
    } finally {
      setIsAnyoGenerating(false);
    }
  };

  const handleConfirmAnyoDraw = async () => {
    if (!anyoSession) return;
    setIsAnyoConfirming(true);
    setAnyoError(null);
    setAnyoSuccessMessage(null);
    try {
      await anyoScoringService.confirmMarchingOrder(anyoSession.id);
      setAnyoSuccessMessage('Official marching order confirmed and locked for competition.');
      setShowAnyoDrawModal(false);
      await loadAnyoSession(selectedAnyoEventId);
    } catch (err: unknown) {
      console.error('Error confirming Anyo marching order:', err);
      setAnyoError(err instanceof Error ? err.message : 'Failed to confirm marching order.');
    } finally {
      setIsAnyoConfirming(false);
    }
  };

  const handleOpenAnyoManualOverride = () => {
    if (!anyoSession || anyoSession.draw_status === 'CONFIRMED') {
      setAnyoError('Official marching order is locked and confirmed. Manual reordering is strictly prohibited.');
      return;
    }
    const currentSortedIds = [...anyoPerformances]
      .sort((a, b) => a.order_number - b.order_number)
      .map((p) => p.id);
    setAnyoManualOrderList(currentSortedIds);
    setAnyoManualOverrideReason('');
    setShowAnyoManualOverrideModal(true);
  };

  const handleMoveAnyoOrderItem = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= anyoManualOrderList.length) return;
    const nextList = [...anyoManualOrderList];
    const [moved] = nextList.splice(index, 1);
    nextList.splice(targetIndex, 0, moved);
    setAnyoManualOrderList(nextList);
  };

  const handleSaveAnyoManualReorder = async () => {
    if (!anyoSession) return;
    const trimmedReason = anyoManualOverrideReason.trim();
    if (!trimmedReason) {
      setAnyoError('A written justification is required for manual marching order overrides.');
      return;
    }
    if (anyoManualOrderList.length !== anyoPerformances.length) {
      setAnyoError('Manual reorder list must contain all session performers.');
      return;
    }

    setIsAnyoSavingOverride(true);
    setAnyoError(null);
    try {
      await anyoScoringService.reorderPerformances(anyoSession.id, anyoManualOrderList, trimmedReason);
      setAnyoSuccessMessage('Marching order updated successfully with audit trail justification.');
      setShowAnyoManualOverrideModal(false);
      await loadAnyoSession(selectedAnyoEventId);
    } catch (err: unknown) {
      console.error('Error reordering Anyo performances:', err);
      setAnyoError(err instanceof Error ? err.message : 'Failed to reorder performances.');
    } finally {
      setIsAnyoSavingOverride(false);
    }
  };

  const renderSeedBadge = (perf: AnyoPerformance) => {
    const tier = perf.seed_tier || 5;
    if (tier === 1) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
          <Award className="w-3 h-3 text-amber-400" />
          Top Seed (Gold)
        </span>
      );
    }
    if (tier === 2) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-300/20 text-slate-200 border border-slate-400/40">
          <Medal className="w-3 h-3 text-slate-300" />
          High Seed (Silver)
        </span>
      );
    }
    if (tier === 3) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-700/20 text-amber-400 border border-amber-700/40">
          <Medal className="w-3 h-3 text-amber-500" />
          Seeded (Bronze)
        </span>
      );
    }
    if (tier === 4) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
          Experienced
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
        Unseeded
      </span>
    );
  };

  const anyoDrawStatus = anyoSession?.draw_status || 'PENDING';
  const anyoDrawVersion = anyoSession?.draw_version || 0;
  const isAnyoEligibleToGenerate =
    canManage &&
    (tournament.status === 'ONGOING' || tournament.status === 'REGISTRATION_CLOSED') &&
    snapshot !== null &&
    anyoDrawStatus !== 'CONFIRMED' &&
    anyoPerformances.length > 0;

  return (
    <div className="space-y-6">
      {/* Discipline Navigation Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-400 mb-1">
              <Layers className="w-4 h-4" />
              Competition Preparation
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-100">{tournament.name}</h2>
            <p className="text-xs text-slate-400 mt-1">
              Unified competition structure engine with strictly isolated Full Contact (Brackets) and Anyo (Seeded Marching Order) workflows.
            </p>
          </div>

          {/* Discipline Selector Pills */}
          <div className="flex bg-slate-950 border border-slate-800 rounded-2xl p-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setSelectedDiscipline('FULL_CONTACT')}
              className={`py-2 px-4 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                selectedDiscipline === 'FULL_CONTACT'
                  ? 'bg-amber-400 text-slate-950 shadow-md shadow-amber-400/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Trophy className="w-3.5 h-3.5" />
              <span>Full Contact ({fullContactEvents.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedDiscipline('ANYO')}
              className={`py-2 px-4 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                selectedDiscipline === 'ANYO'
                  ? 'bg-amber-400 text-slate-950 shadow-md shadow-amber-400/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Anyo Forms ({anyoEvents.length})</span>
            </button>
          </div>
        </div>

        {/* ==================================================================== */}
        {/* DISCIPLINE 1: FULL CONTACT ENGINE                                    */}
        {/* ==================================================================== */}
        {selectedDiscipline === 'FULL_CONTACT' && (
          <div className="space-y-6 pt-2">
            {/* View Switcher if Brackets Exist */}
            {fcSummary && fcSummary.total_bracket_nodes > 0 && (
              <div className="flex bg-slate-950 border border-slate-800 rounded-2xl p-1.5 max-w-sm">
                <button
                  type="button"
                  onClick={() => setFcActiveView('VIEWER')}
                  className={`flex-1 py-2 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                    fcActiveView === 'VIEWER'
                      ? 'bg-amber-400 text-slate-950 shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Trophy className="w-3.5 h-3.5" />
                  Interactive Bracket
                </button>
                <button
                  type="button"
                  onClick={() => setFcActiveView('PANEL')}
                  className={`flex-1 py-2 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                    fcActiveView === 'PANEL'
                      ? 'bg-amber-400 text-slate-950 shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Shield className="w-3.5 h-3.5" />
                  Status &amp; Actions
                </button>
              </div>
            )}

            {/* Interactive Viewer View */}
            {fcActiveView === 'VIEWER' && fcSummary && fcSummary.total_bracket_nodes > 0 ? (
              <InteractiveBracketViewer
                tournament={tournament}
                canManage={canManage}
                onOpenCourtOperations={onOpenCourtOperations}
                onRefresh={loadFcSummary}
              />
            ) : (
              /* Full Contact Status & Action Panel */
              <div className="space-y-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-slate-800/80">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-400 mb-1">
                      <Trophy className="w-4 h-4" />
                      Deterministic Bracket Engine (Full Contact Sparring)
                    </div>
                    <h3 className="text-xl font-bold text-slate-100">Full Contact Tournament Brackets</h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Computes single-elimination trees, seeds verified fighters, advances BYEs, and creates initial matches in public.matches.
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    {fcSummary && fcSummary.total_bracket_nodes > 0 && (
                      <button
                        type="button"
                        onClick={() => setFcActiveView('VIEWER')}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-colors"
                      >
                        <Eye className="w-4 h-4 text-amber-400" />
                        View Interactive Brackets
                      </button>
                    )}

                    {canManage && (
                      <button
                        type="button"
                        onClick={() => setShowFcConfirmModal(true)}
                        disabled={!isFcEligibleToGenerate || isFcGenerating}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold shadow-lg shadow-amber-400/10 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Sparkles className={`w-4 h-4 ${isFcGenerating ? 'animate-spin' : ''}`} />
                        {fcSummary && fcSummary.total_bracket_nodes > 0
                          ? 'Regenerate Brackets'
                          : 'Generate Tournament Bracket'}
                      </button>
                    )}
                  </div>
                </div>

                {/* FC Error Message */}
                {fcError && (
                  <div className="p-4 rounded-2xl bg-rose-950/50 border border-rose-800 text-rose-300 text-xs font-semibold flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{fcError}</span>
                  </div>
                )}

                {/* FC Generation Success Feedback */}
                {fcGenerationResult && (
                  <div className="p-4 rounded-2xl bg-emerald-950/50 border border-emerald-800 text-emerald-300 text-xs font-semibold flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>
                        Successfully generated <strong>{fcGenerationResult.matches_generated}</strong> matches ({fcGenerationResult.byes_generated} BYEs) across <strong>{fcGenerationResult.events_processed}</strong> events.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFcActiveView('VIEWER')}
                      className="px-3 py-1 rounded-lg bg-emerald-400 text-slate-950 font-bold text-[11px] hover:bg-emerald-300 transition-colors"
                    >
                      Inspect Now
                    </button>
                  </div>
                )}

                {/* Status Gates */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 font-medium">Snapshot State</span>
                      {snapshot ? (
                        <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 text-[10px] font-bold">
                          v{snapshot.version} LOCKED
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-400 text-[10px] font-bold">
                          NOT SNAPSHOTTED
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {snapshot
                        ? 'Authoritative snapshot verified for Full Contact seeding.'
                        : 'A locked snapshot is required prior to bracket generation.'}
                    </p>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 font-medium">Lifecycle Status</span>
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] font-bold">
                        {tournament.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {tournament.status === 'ONGOING' || tournament.status === 'REGISTRATION_CLOSED'
                        ? 'Lifecycle is valid for bracket generation.'
                        : 'Tournament must be in REGISTRATION_CLOSED or ONGOING.'}
                    </p>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 font-medium">Bracket Mutation Lock</span>
                      {fcSummary?.has_active_or_completed_matches ? (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-rose-950 text-rose-400 text-[10px] font-bold">
                          <Lock className="w-2.5 h-2.5" />
                          LOCKED (LIVE)
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 text-[10px] font-bold">
                          UNLOCKED
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {fcSummary?.has_active_or_completed_matches
                        ? 'Live/completed matches exist. Bracket topology is immutable.'
                        : 'No live matches started. Brackets can be safely regenerated.'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================================================================== */}
        {/* DISCIPLINE 2: ANYO ENGINE (SEEDED MARCHING ORDER)                    */}
        {/* ==================================================================== */}
        {selectedDiscipline === 'ANYO' && (
          <div className="space-y-6 pt-2">
            {/* Anyo Event Selector */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-slate-950/80 border border-slate-800 rounded-2xl">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Target Anyo Event
                </label>
                <div className="flex items-center gap-3">
                  <select
                    value={selectedAnyoEventId}
                    onChange={(e) => setSelectedAnyoEventId(e.target.value)}
                    className="bg-slate-900 border border-slate-700 text-slate-100 rounded-xl px-3.5 py-2 text-xs font-semibold focus:outline-hidden focus:border-amber-400 min-w-[280px]"
                  >
                    {anyoEvents.map((evt) => (
                      <option key={evt.id} value={evt.id}>
                        {evt.name} ({evt.category} • {evt.division})
                      </option>
                    ))}
                  </select>
                  {anyoSession && (
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-bold border ${
                        anyoDrawStatus === 'CONFIRMED'
                          ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                          : anyoDrawStatus === 'GENERATED'
                          ? 'bg-amber-950/80 text-amber-300 border-amber-800'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      {anyoDrawStatus === 'CONFIRMED'
                        ? `Official Draw Locked (v${anyoDrawVersion})`
                        : anyoDrawStatus === 'GENERATED'
                        ? `Draft Draw (v${anyoDrawVersion})`
                        : 'Draw Pending'}
                    </span>
                  )}
                </div>
              </div>

              {/* Action Buttons for Selected Anyo Event */}
              <div className="flex items-center gap-2.5 flex-wrap">
                {anyoDrawStatus === 'PENDING' ? (
                  <button
                    type="button"
                    onClick={() => handleGenerateAnyoDraw(false)}
                    disabled={!isAnyoEligibleToGenerate || isAnyoGenerating}
                    className="px-4 py-2.5 bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 text-xs font-bold rounded-xl shadow-lg shadow-amber-400/10 transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Sparkles className={`w-4 h-4 ${isAnyoGenerating ? 'animate-spin' : ''}`} />
                    <span>Generate Seeded Marching Order</span>
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowAnyoDrawModal(true)}
                      className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-bold rounded-xl transition-colors flex items-center gap-2 border border-amber-500/30"
                    >
                      <ListOrdered className="w-4 h-4 text-amber-400" />
                      <span>{anyoDrawStatus === 'CONFIRMED' ? 'View Official Draw' : 'Review & Confirm Draw'}</span>
                    </button>

                    {anyoDrawStatus !== 'CONFIRMED' && canManage && (
                      <button
                        type="button"
                        onClick={() => handleGenerateAnyoDraw(true)}
                        disabled={isAnyoGenerating || isAnyoConfirming}
                        className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5 border border-slate-700"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isAnyoGenerating ? 'animate-spin' : ''}`} />
                        <span>Regenerate Draw</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Error / Success feedback */}
            {anyoError && (
              <div className="p-4 rounded-2xl bg-rose-950/50 border border-rose-800 text-rose-300 text-xs font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{anyoError}</span>
              </div>
            )}

            {anyoSuccessMessage && (
              <div className="p-4 rounded-2xl bg-emerald-950/50 border border-emerald-800 text-emerald-300 text-xs font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{anyoSuccessMessage}</span>
              </div>
            )}

            {/* Seed-Tier Summary & Competitor Queue */}
            {isAnyoLoading ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin text-amber-400 mb-2" />
                <span className="text-xs">Loading Anyo category session...</span>
              </div>
            ) : anyoPerformances.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-slate-800 rounded-2xl bg-slate-950/40">
                <Sparkles className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <h4 className="text-sm font-semibold text-slate-300">No Approved Competitors Found</h4>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Ensure athletes are registered and approved for this Anyo category before generating the marching sequence.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Seed Tier Distribution Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div className="p-3 bg-slate-950 border border-amber-500/30 rounded-xl">
                    <div className="text-[10px] uppercase tracking-wider font-bold text-amber-400 flex items-center gap-1">
                      <Award className="w-3 h-3 text-amber-400" /> Tier 1 (Gold)
                    </div>
                    <div className="text-xl font-black text-amber-300 mt-1">
                      {anyoPerformances.filter((p) => p.seed_tier === 1).length}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Performs Last</div>
                  </div>

                  <div className="p-3 bg-slate-950 border border-slate-400/30 rounded-xl">
                    <div className="text-[10px] uppercase tracking-wider font-bold text-slate-300 flex items-center gap-1">
                      <Medal className="w-3 h-3 text-slate-300" /> Tier 2 (Silver)
                    </div>
                    <div className="text-xl font-black text-slate-200 mt-1">
                      {anyoPerformances.filter((p) => p.seed_tier === 2).length}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Late Seeded</div>
                  </div>

                  <div className="p-3 bg-slate-950 border border-amber-700/30 rounded-xl">
                    <div className="text-[10px] uppercase tracking-wider font-bold text-amber-500 flex items-center gap-1">
                      <Medal className="w-3 h-3 text-amber-500" /> Tier 3 (Bronze)
                    </div>
                    <div className="text-xl font-black text-amber-400 mt-1">
                      {anyoPerformances.filter((p) => p.seed_tier === 3).length}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Mid Seeded</div>
                  </div>

                  <div className="p-3 bg-slate-950 border border-blue-500/30 rounded-xl">
                    <div className="text-[10px] uppercase tracking-wider font-bold text-blue-400">
                      Tier 4 (Experienced)
                    </div>
                    <div className="text-xl font-black text-blue-300 mt-1">
                      {anyoPerformances.filter((p) => p.seed_tier === 4).length}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Early Field</div>
                  </div>

                  <div className="p-3 bg-slate-950 border border-slate-700 rounded-xl">
                    <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400">
                      Tier 5 (Unseeded)
                    </div>
                    <div className="text-xl font-black text-slate-300 mt-1">
                      {anyoPerformances.filter((p) => !p.seed_tier || p.seed_tier === 5).length}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Opening Draw</div>
                  </div>
                </div>

                {/* Marching Order Queue List */}
                <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950/70">
                  <div className="p-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                        <ListOrdered className="w-4 h-4 text-amber-400" />
                        <span>Current Marching Sequence ({anyoPerformances.length} Competitors)</span>
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Performance sequence executed in ascending order. Seeded athletes perform later in the session.
                      </p>
                    </div>

                    {anyoDrawStatus !== 'CONFIRMED' && canManage && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleOpenAnyoManualOverride}
                          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 border border-slate-700"
                        >
                          <Edit3 className="w-3.5 h-3.5 text-amber-400" />
                          <span>Manual Adjust</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleConfirmAnyoDraw}
                          disabled={isAnyoConfirming}
                          className="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 shadow-md shadow-emerald-950/50"
                        >
                          {isAnyoConfirming ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Check className="w-3.5 h-3.5" />
                          )}
                          <span>Confirm &amp; Lock Draw</span>
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="divide-y divide-slate-800/80 max-h-[380px] overflow-y-auto">
                    {anyoPerformances.map((perf) => (
                      <div
                        key={perf.id}
                        className="p-3.5 flex items-center justify-between gap-3 hover:bg-slate-900/50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-mono font-bold text-amber-400">
                            #{perf.order_number}
                          </div>
                          <div>
                            <div className="text-xs sm:text-sm font-semibold text-slate-100">
                              {perf.registration?.user_profile?.full_name || 'Competitor'}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {perf.registration?.team_name || 'Independent'}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {renderSeedBadge(perf)}
                          <span className="text-[10px] font-mono text-slate-500">
                            {perf.draw_group || 'GROUP'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ==================================================================== */}
      {/* MODAL 1: FULL CONTACT CONFIRMATION MODAL                             */}
      {/* ==================================================================== */}
      {showFcConfirmModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm p-4 flex items-center justify-center">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-400/10 border border-amber-400/30 flex items-center justify-center text-amber-400">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-lg font-bold text-slate-100">
                Confirm Tournament Bracket Generation
              </h3>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                This will authoritatively generate all single-elimination tournament match brackets.
                It will compute binary trees, calculate seed slots, advance structural BYEs, and schedule opening round matches strictly from the frozen snapshot.
              </p>
            </div>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-[11px] text-slate-400 space-y-1">
              <div>• Target Tournament: <strong className="text-slate-200">{tournament.name}</strong></div>
              <div>• Snapshot Version: <strong className="text-slate-200">{snapshot?.version || 1}</strong></div>
              <div>• Irreversibility: Once matches enter live play, brackets cannot be regenerated.</div>
            </div>

            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowFcConfirmModal(false)}
                disabled={isFcGenerating}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleGenerateBrackets}
                disabled={isFcGenerating}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs shadow-lg transition-all"
              >
                <Sparkles className={`w-3.5 h-3.5 ${isFcGenerating ? 'animate-spin' : ''}`} />
                {isFcGenerating ? 'Generating...' : 'Confirm & Generate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 2: ANYO DRAW PREVIEW & CONFIRM MODAL                           */}
      {/* ==================================================================== */}
      {showAnyoDrawModal && anyoSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-3xl w-full p-6 shadow-2xl space-y-5 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <ListOrdered className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-100">
                    Seeded Marching Order Review
                  </h3>
                  <p className="text-xs text-slate-400 font-mono">
                    Draw v{anyoDrawVersion} • Cutoff: 24-Month Snapshot Filter
                  </p>
                </div>
              </div>

              <span
                className={`px-3 py-1 rounded-full text-xs font-bold ${
                  anyoDrawStatus === 'CONFIRMED'
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                    : 'bg-amber-950 text-amber-300 border border-amber-800'
                }`}
              >
                {anyoDrawStatus}
              </span>
            </div>

            {/* Invariant Explainer */}
            <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl flex items-start gap-3">
              <Info className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-300 leading-relaxed">
                <strong className="text-slate-100">UAAPHIL Marching Order Rule:</strong> Competitors perform in ascending order (1 through {anyoPerformances.length}). Higher seeded athletes (Tier 1 &amp; 2) perform later in the session.
              </p>
            </div>

            {/* Performance Order Table */}
            <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
              <div className="divide-y divide-slate-800/80 border border-slate-800 rounded-xl overflow-hidden bg-slate-950/60">
                {anyoPerformances.map((perf) => (
                  <div
                    key={perf.id}
                    className="p-3 flex items-center justify-between gap-3 hover:bg-slate-900/60 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-mono font-bold text-amber-400">
                        #{perf.order_number}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-slate-100">
                          {perf.registration?.user_profile?.full_name || 'Competitor'}
                        </div>
                        <div className="text-xs text-slate-400">
                          {perf.registration?.team_name || 'Independent'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {renderSeedBadge(perf)}
                      <span className="text-[11px] font-mono text-slate-500 hidden sm:inline">
                        {perf.draw_group || 'GROUP'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex flex-col sm:flex-row items-center justify-between pt-4 border-t border-slate-800 gap-3">
              <button
                type="button"
                onClick={() => setShowAnyoDrawModal(false)}
                className="w-full sm:w-auto px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-colors"
              >
                Close Preview
              </button>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                {anyoDrawStatus !== 'CONFIRMED' && canManage && (
                  <>
                    <button
                      type="button"
                      onClick={handleOpenAnyoManualOverride}
                      disabled={isAnyoGenerating || isAnyoConfirming}
                      className="flex-1 sm:flex-initial px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-colors flex items-center justify-center gap-1.5 border border-slate-700"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-amber-400" />
                      <span>Manual Adjust</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleGenerateAnyoDraw(true)}
                      disabled={isAnyoGenerating || isAnyoConfirming}
                      className="flex-1 sm:flex-initial px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 border border-amber-500/30"
                    >
                      {isAnyoGenerating ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4" />
                      )}
                      <span>Regenerate</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleConfirmAnyoDraw}
                      disabled={isAnyoConfirming || isAnyoGenerating}
                      className="flex-1 sm:flex-initial px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black rounded-xl transition-all shadow-md shadow-emerald-950/60 flex items-center justify-center gap-1.5"
                    >
                      {isAnyoConfirming ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Check className="w-4 h-4" />
                      )}
                      <span>Confirm &amp; Lock Official Draw</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 3: ANYO MANUAL REORDER MODAL (PRE-LOCK ONLY)                   */}
      {/* ==================================================================== */}
      {showAnyoManualOverrideModal && anyoSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-5 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  MANUAL REORDER OVERRIDE
                </span>
                <h3 className="text-lg font-black text-slate-100 mt-1">
                  Adjust Marching Sequence
                </h3>
              </div>
              <span className="text-xs text-slate-400 font-mono">
                {anyoManualOrderList.length} Performers
              </span>
            </div>

            <div className="p-3 bg-amber-950/40 border border-amber-800/60 rounded-xl flex items-start gap-2.5 text-xs text-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <span>
                Manual reordering requires a formal written reason. All changes are logged with full before/after diffs in the system audit log.
              </span>
            </div>

            {/* Reorder Items List */}
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
              {anyoManualOrderList.map((perfId, idx) => {
                const perfObj = anyoPerformances.find((p) => p.id === perfId);
                if (!perfObj) return null;

                return (
                  <div
                    key={perfId}
                    className="p-2.5 bg-slate-950/70 border border-slate-800 rounded-xl flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-lg bg-slate-800 text-amber-400 font-bold font-mono text-xs flex items-center justify-center">
                        #{idx + 1}
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-slate-200">
                          {perfObj.registration?.user_profile?.full_name || 'Competitor'}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {perfObj.registration?.team_name || 'Independent'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {renderSeedBadge(perfObj)}
                      <button
                        type="button"
                        onClick={() => handleMoveAnyoOrderItem(idx, 'up')}
                        disabled={idx === 0}
                        className="p-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-slate-300 rounded-lg transition-colors"
                        title="Move Up"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveAnyoOrderItem(idx, 'down')}
                        disabled={idx === anyoManualOrderList.length - 1}
                        className="p-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-slate-300 rounded-lg transition-colors"
                        title="Move Down"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Mandatory Reason Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-300 flex items-center gap-1">
                <span>Official Written Justification</span>
                <span className="text-amber-400 font-bold">*</span>
              </label>
              <textarea
                value={anyoManualOverrideReason}
                onChange={(e) => setAnyoManualOverrideReason(e.target.value)}
                placeholder="Enter formal justification (e.g. Verified schedule conflict, medical delay, or head judge resolution)..."
                rows={2}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 placeholder-slate-500 focus:outline-hidden focus:border-amber-500/50"
              />
              <span className="text-[10px] text-slate-500">
                Reason is mandatory and cannot be empty or whitespace only.
              </span>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowAnyoManualOverrideModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveAnyoManualReorder}
                disabled={isAnyoSavingOverride || !anyoManualOverrideReason.trim()}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 shadow-md shadow-amber-950/50"
              >
                {isAnyoSavingOverride ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                <span>Save New Order</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
