import React, { useState, useEffect } from 'react';
import {
  Trophy,
  Layers,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Lock,
  RefreshCw,
  Eye,
  Shield,
  Clock,
  Activity,
  ArrowRight,
} from 'lucide-react';
import { Tournament, TournamentSnapshot } from '../../types/tournament';
import { BracketSummary, BracketGenerationResult } from '../../types/brackets';
import { bracketService } from '../../services/bracketService';
import { InteractiveBracketViewer } from './InteractiveBracketViewer';

interface BracketManagementPanelProps {
  tournament: Tournament;
  snapshot: TournamentSnapshot | null;
  canManage: boolean;
  onOpenCourtOperations?: (matchId: string) => void;
}

export const BracketManagementPanel: React.FC<BracketManagementPanelProps> = ({
  tournament,
  snapshot,
  canManage,
  onOpenCourtOperations,
}) => {
  const [summary, setSummary] = useState<BracketSummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generationResult, setGenerationResult] = useState<BracketGenerationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [activeView, setActiveView] = useState<'PANEL' | 'VIEWER'>('PANEL');

  const loadSummary = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await bracketService.getBracketSummary(tournament.id);
      setSummary(data);
      if (data.total_bracket_nodes > 0) {
        setActiveView('VIEWER');
      }
    } catch (err: any) {
      console.error('Error fetching bracket summary:', err);
      setError(err.message || 'Failed to check bracket status');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
  }, [tournament.id]);

  const handleGenerateBrackets = async () => {
    try {
      setIsGenerating(true);
      setError(null);
      setShowConfirmModal(false);

      const result = await bracketService.generateTournamentBrackets(tournament.id);
      setGenerationResult(result);
      await loadSummary();
      setActiveView('VIEWER');
    } catch (err: any) {
      console.error('Error generating tournament brackets:', err);
      setError(err.message || 'Failed to generate tournament brackets');
    } finally {
      setIsGenerating(false);
    }
  };

  const isEligibleToGenerate =
    canManage &&
    (tournament.status === 'ONGOING' || tournament.status === 'REGISTRATION_CLOSED') &&
    snapshot !== null &&
    (!summary || !summary.has_active_or_completed_matches);

  return (
    <div className="space-y-6">
      {/* Subnav / View Switcher if Brackets Exist */}
      {summary && summary.total_bracket_nodes > 0 && (
        <div className="flex bg-slate-900 border border-slate-800 rounded-2xl p-1.5 max-w-sm">
          <button
            type="button"
            onClick={() => setActiveView('VIEWER')}
            className={`flex-1 py-2 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              activeView === 'VIEWER'
                ? 'bg-amber-400 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Trophy className="w-3.5 h-3.5" />
            Interactive Bracket
          </button>
          <button
            type="button"
            onClick={() => setActiveView('PANEL')}
            className={`flex-1 py-2 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              activeView === 'PANEL'
                ? 'bg-amber-400 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            Status &amp; Actions
          </button>
        </div>
      )}

      {/* Primary Content Switch */}
      {activeView === 'VIEWER' && summary && summary.total_bracket_nodes > 0 ? (
        <InteractiveBracketViewer
          tournament={tournament}
          canManage={canManage}
          onOpenCourtOperations={onOpenCourtOperations}
          onRefresh={loadSummary}
        />
      ) : (
        /* Status & Generation Control Panel */
        <div className="space-y-6">
          {/* Main Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-slate-800">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-400 mb-1">
                  <Layers className="w-4 h-4" />
                  Deterministic Bracket Engine (O-38)
                </div>
                <h2 className="text-2xl font-black text-slate-100">{tournament.name}</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Generate balanced single-elimination tournament trees directly from the authoritative snapshot.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-3">
                {summary && summary.total_bracket_nodes > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveView('VIEWER')}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-colors"
                  >
                    <Eye className="w-4 h-4 text-amber-400" />
                    View Interactive Brackets
                  </button>
                )}

                {canManage && (
                  <button
                    type="button"
                    onClick={() => setShowConfirmModal(true)}
                    disabled={!isEligibleToGenerate || isGenerating}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold shadow-lg shadow-amber-400/10 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Sparkles className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
                    {summary && summary.total_bracket_nodes > 0
                      ? 'Regenerate Brackets'
                      : 'Generate Tournament Brackets'}
                  </button>
                )}
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="mt-6 p-4 rounded-2xl bg-rose-950/50 border border-rose-800 text-rose-300 text-xs font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Generation Success Feedback */}
            {generationResult && (
              <div className="mt-6 p-4 rounded-2xl bg-emerald-950/50 border border-emerald-800 text-emerald-300 text-xs font-semibold flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    Successfully generated <strong>{generationResult.matches_generated}</strong> matches ({generationResult.byes_generated} BYEs) across <strong>{generationResult.events_processed}</strong> events.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveView('VIEWER')}
                  className="px-3 py-1 rounded-lg bg-emerald-400 text-slate-950 font-bold text-[11px] hover:bg-emerald-300 transition-colors"
                >
                  Inspect Now
                </button>
              </div>
            )}

            {/* Status Checklist / Diagnostics */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
              {/* Snapshot Gate */}
              <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-medium">Tournament Snapshot</span>
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
                    ? 'Authoritative snapshot is locked and verified for bracket seeding.'
                    : 'A snapshot must be created before brackets can be computed.'}
                </p>
              </div>

              {/* Lifecycle Gate */}
              <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-medium">Lifecycle Status</span>
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] font-bold">
                    {tournament.status}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">
                  {tournament.status === 'ONGOING' || tournament.status === 'REGISTRATION_CLOSED'
                    ? 'Lifecycle state is valid for single-elimination tournament bracket generation.'
                    : 'Tournament must be in REGISTRATION_CLOSED or ONGOING state.'}
                </p>
              </div>

              {/* Match Lock Gate */}
              <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-medium">Regeneration Lock</span>
                  {summary?.has_active_or_completed_matches ? (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-rose-950 text-rose-400 text-[10px] font-bold">
                      <Lock className="w-2.5 h-2.5" />
                      LOCKED
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 text-[10px] font-bold">
                      UNLOCKED
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500">
                  {summary?.has_active_or_completed_matches
                    ? 'Live or finished matches exist. Bracket topology is permanently immutable.'
                    : 'No live matches in progress. Brackets can be safely computed.'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirmModal && (
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
                It will compute binary single-elimination trees, calculate seed slots, advance structural BYEs, and schedule opening round matches strictly from the frozen snapshot.
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
                onClick={() => setShowConfirmModal(false)}
                disabled={isGenerating}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleGenerateBrackets}
                disabled={isGenerating}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs shadow-lg transition-all"
              >
                <Sparkles className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
                {isGenerating ? 'Generating...' : 'Confirm & Generate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
