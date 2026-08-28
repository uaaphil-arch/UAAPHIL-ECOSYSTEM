import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Award,
  Lock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Trophy,
  FileCheck,
  Hash,
  Clock,
  Users,
  ScrollText,
} from 'lucide-react';
import { tournamentService } from '../../services/tournamentService';
import {
  Tournament,
  TournamentSignatory,
  FinalizeTournamentResponse,
} from '../../types/tournament';

interface TournamentClosureModalProps {
  isOpen: boolean;
  tournament: Tournament | null;
  onClose: () => void;
  onSuccess: (response: FinalizeTournamentResponse) => void;
}

export const TournamentClosureModal: React.FC<TournamentClosureModalProps> = ({
  isOpen,
  tournament,
  onClose,
  onSuccess,
}) => {
  const [diagnostics, setDiagnostics] = useState<{
    isLocked: boolean;
    uncompletedMatches: number;
    inProgressMatches: number;
    unresolvedWinners: number;
    uncompletedAnyo: number;
    unresolvedWeighIns: number;
    totalBoutsCompleted: number;
    totalAnyoCompleted: number;
    totalApprovedAthletes: number;
    weighInRequired: boolean;
  } | null>(null);

  const [isLoadingDiagnostics, setIsLoadingDiagnostics] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<FinalizeTournamentResponse | null>(null);

  // Signatories
  const [signatories, setSignatories] = useState<TournamentSignatory[]>([
    { role: 'Tournament Director', name: '', title: 'Tournament Director' },
    { role: 'Chief Referee', name: '', title: 'Chief Referee' },
    { role: 'Head Table Official', name: '', title: 'Head Table Official' },
  ]);

  const [notes, setNotes] = useState('');
  const [confirmIrreversible, setConfirmIrreversible] = useState(false);

  useEffect(() => {
    if (isOpen && tournament) {
      setError(null);
      setSuccessData(null);
      setConfirmIrreversible(false);
      loadDiagnostics(tournament.id);
    }
  }, [isOpen, tournament]);

  const loadDiagnostics = async (tourneyId: string) => {
    setIsLoadingDiagnostics(true);
    setError(null);
    try {
      const diag = await tournamentService.getTournamentPreflightDiagnostics(tourneyId);
      setDiagnostics(diag);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load preflight diagnostics.');
    } finally {
      setIsLoadingDiagnostics(false);
    }
  };

  if (!isOpen || !tournament) return null;

  const handleSignatoryChange = (index: number, field: 'name' | 'title', value: string) => {
    setSignatories((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const isPreflightPassed =
    diagnostics &&
    diagnostics.isLocked &&
    diagnostics.uncompletedMatches === 0 &&
    diagnostics.inProgressMatches === 0 &&
    diagnostics.unresolvedWinners === 0 &&
    diagnostics.uncompletedAnyo === 0 &&
    diagnostics.unresolvedWeighIns === 0;

  const handleFinalize = async () => {
    if (!confirmIrreversible || !isPreflightPassed) return;
    setError(null);
    setIsFinalizing(true);

    try {
      const validSignatories = signatories.filter((s) => s.name.trim().length > 0);
      const res = await tournamentService.finalizeTournament({
        tournamentId: tournament.id,
        signatories: validSignatories,
        notes: notes.trim(),
      });

      setSuccessData(res);
      onSuccess(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to finalize tournament.');
    } finally {
      setIsFinalizing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="p-6 bg-linear-to-r from-amber-950/40 via-slate-900 to-slate-900 border-b border-amber-900/30 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-400">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                Tournament Finalization & Closure Seal
              </h2>
              <p className="text-xs text-slate-400">
                Official closure workflow for <span className="text-amber-300 font-semibold">{tournament.name}</span>
              </p>
            </div>
          </div>
          {!isFinalizing && (
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 rounded-lg transition-colors"
            >
              ✕
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
          {/* SUCCESS STATE */}
          {successData ? (
            <div className="space-y-6 text-center py-4">
              <div className="inline-flex p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-emerald-400 mb-2">
                <ShieldCheck className="w-12 h-12" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-100 uppercase tracking-wide">
                  Tournament Officially Sealed & Frozen
                </h3>
                <p className="text-xs text-emerald-400 mt-1 font-semibold">
                  All match results, scoring rounds, Anyo forms, and podiums are now permanently immutable.
                </p>
              </div>

              {/* Seal Card */}
              <div className="p-5 bg-slate-950/80 border border-amber-500/30 rounded-xl text-left space-y-3 font-mono text-xs shadow-inner">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="text-slate-400 flex items-center gap-1.5 font-sans font-semibold">
                    <Award className="w-4 h-4 text-amber-400" />
                    Official Seal Number:
                  </span>
                  <span className="text-amber-300 font-bold text-sm tracking-wider">
                    {successData.seal_number}
                  </span>
                </div>

                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="text-slate-400 flex items-center gap-1.5 font-sans font-semibold">
                    <Hash className="w-4 h-4 text-slate-400" />
                    SHA-256 Closure Hash:
                  </span>
                  <span className="text-slate-300 text-[11px] break-all max-w-md text-right">
                    {successData.closure_hash}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <span className="text-slate-400 block font-sans font-semibold">Grand Champion Team:</span>
                    <span className="text-amber-400 font-bold text-sm font-sans">
                      {successData.champion_team || 'TBD'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-sans font-semibold">Total Verified Bouts:</span>
                    <span className="text-slate-200 font-bold text-sm">
                      {successData.total_bouts} Matches | {successData.total_anyo} Anyo
                    </span>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800 text-[11px] text-slate-500 flex items-center gap-1.5 font-sans">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  Sealed At: {new Date(successData.finalized_at).toLocaleString()} (UTC)
                </div>
              </div>

              <button
                onClick={onClose}
                className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs uppercase tracking-wider rounded-xl transition-colors"
              >
                Done / View Sealed Standings
              </button>
            </div>
          ) : (
            <>
              {/* Error Banner */}
              {error && (
                <div className="p-3.5 bg-red-950/60 border border-red-800/80 rounded-xl flex items-start gap-2.5 text-xs text-red-200">
                  <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-red-300">Finalization Preflight Error</p>
                    <p className="mt-0.5 text-red-200/90">{error}</p>
                  </div>
                </div>
              )}

              {/* Preflight Diagnostics Section */}
              <div className="p-4 bg-slate-950/50 border border-slate-800 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                    <FileCheck className="w-4 h-4 text-amber-400" />
                    Automated Preflight Integrity Checklist
                  </h3>
                  <button
                    type="button"
                    onClick={() => loadDiagnostics(tournament.id)}
                    disabled={isLoadingDiagnostics}
                    className="text-[11px] text-amber-400 hover:text-amber-300 font-semibold"
                  >
                    {isLoadingDiagnostics ? 'Refreshing...' : 'Re-check'}
                  </button>
                </div>

                {isLoadingDiagnostics ? (
                  <div className="flex items-center justify-center py-6 gap-2 text-xs text-slate-400">
                    <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                    Validating tournament database integrity...
                  </div>
                ) : diagnostics ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {/* Condition 1: Snapshot Locked */}
                    <div
                      className={`p-2.5 rounded-lg border flex items-center justify-between ${
                        diagnostics.isLocked
                          ? 'bg-emerald-950/30 border-emerald-800/50 text-emerald-300'
                          : 'bg-red-950/30 border-red-800/50 text-red-300'
                      }`}
                    >
                      <span>Competition Snapshot Locked</span>
                      {diagnostics.isLocked ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-400" />
                      )}
                    </div>

                    {/* Condition 2: Uncompleted Matches */}
                    <div
                      className={`p-2.5 rounded-lg border flex items-center justify-between ${
                        diagnostics.uncompletedMatches === 0
                          ? 'bg-emerald-950/30 border-emerald-800/50 text-emerald-300'
                          : 'bg-red-950/30 border-red-800/50 text-red-300'
                      }`}
                    >
                      <span>All Matches Completed</span>
                      {diagnostics.uncompletedMatches === 0 ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <span className="font-bold text-red-400">
                          {diagnostics.uncompletedMatches} remaining
                        </span>
                      )}
                    </div>

                    {/* Condition 3: In Progress Matches */}
                    <div
                      className={`p-2.5 rounded-lg border flex items-center justify-between ${
                        diagnostics.inProgressMatches === 0
                          ? 'bg-emerald-950/30 border-emerald-800/50 text-emerald-300'
                          : 'bg-red-950/30 border-red-800/50 text-red-300'
                      }`}
                    >
                      <span>No Matches In-Progress on Courts</span>
                      {diagnostics.inProgressMatches === 0 ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <span className="font-bold text-red-400">
                          {diagnostics.inProgressMatches} active
                        </span>
                      )}
                    </div>

                    {/* Condition 4: Missing Winners */}
                    <div
                      className={`p-2.5 rounded-lg border flex items-center justify-between ${
                        diagnostics.unresolvedWinners === 0
                          ? 'bg-emerald-950/30 border-emerald-800/50 text-emerald-300'
                          : 'bg-red-950/30 border-red-800/50 text-red-300'
                      }`}
                    >
                      <span>All Completed Matches Have Winners</span>
                      {diagnostics.unresolvedWinners === 0 ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <span className="font-bold text-red-400">
                          {diagnostics.unresolvedWinners} missing
                        </span>
                      )}
                    </div>

                    {/* Condition 5: Anyo Completed */}
                    <div
                      className={`p-2.5 rounded-lg border flex items-center justify-between ${
                        diagnostics.uncompletedAnyo === 0
                          ? 'bg-emerald-950/30 border-emerald-800/50 text-emerald-300'
                          : 'bg-red-950/30 border-red-800/50 text-red-300'
                      }`}
                    >
                      <span>All Anyo Routines Completed</span>
                      {diagnostics.uncompletedAnyo === 0 ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <span className="font-bold text-red-400">
                          {diagnostics.uncompletedAnyo} remaining
                        </span>
                      )}
                    </div>

                    {/* Condition 6: Weigh-In Check */}
                    <div
                      className={`p-2.5 rounded-lg border flex items-center justify-between ${
                        diagnostics.unresolvedWeighIns === 0
                          ? 'bg-emerald-950/30 border-emerald-800/50 text-emerald-300'
                          : 'bg-red-950/30 border-red-800/50 text-red-300'
                      }`}
                    >
                      <span>
                        {diagnostics.weighInRequired
                          ? 'All Weigh-Ins Resolved (PASSED)'
                          : 'Weigh-In Requirement Disabled'}
                      </span>
                      {diagnostics.unresolvedWeighIns === 0 ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <span className="font-bold text-red-400">
                          {diagnostics.unresolvedWeighIns} unresolved
                        </span>
                      )}
                    </div>
                  </div>
                ) : null}

                {!isPreflightPassed && !isLoadingDiagnostics && (
                  <div className="p-3 bg-amber-950/40 border border-amber-800/60 rounded-lg text-xs text-amber-300 flex items-start gap-2 mt-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span>
                      The tournament cannot be sealed until all matches are finished, all Anyo scores recorded, and all preflight integrity checks pass.
                    </span>
                  </div>
                )}
              </div>

              {/* Official Signatories Section */}
              <div className="p-4 bg-slate-950/50 border border-slate-800 rounded-xl space-y-3">
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <Users className="w-4 h-4 text-amber-400" />
                  Official Tournament Signatories
                </h3>
                <p className="text-xs text-slate-500">
                  Recorded in the immutable cryptographic seal as official certifying authorities.
                </p>

                <div className="space-y-2.5">
                  {signatories.map((sig, idx) => (
                    <div key={idx} className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                          {sig.role} Name
                        </label>
                        <input
                          type="text"
                          value={sig.name}
                          onChange={(e) => handleSignatoryChange(idx, 'name', e.target.value)}
                          placeholder={`Enter ${sig.role} name`}
                          className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-hidden focus:border-amber-400"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                          Official Designation / Title
                        </label>
                        <input
                          type="text"
                          value={sig.title || ''}
                          onChange={(e) => handleSignatoryChange(idx, 'title', e.target.value)}
                          placeholder="e.g. Tournament Director"
                          className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-hidden focus:border-amber-400"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Administrative Notes */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <ScrollText className="w-3.5 h-3.5 text-amber-400" />
                  Official Closure Notes & Executive Remarks
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional notes regarding final results, extraordinary awards, or competition summary..."
                  className="w-full px-3 py-2 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-hidden focus:border-amber-400 resize-none"
                />
              </div>

              {/* Irreversibility Confirmation */}
              <div className="p-3.5 bg-amber-950/30 border border-amber-500/40 rounded-xl flex items-start gap-3">
                <input
                  type="checkbox"
                  id="confirm-closure-irreversible"
                  checked={confirmIrreversible}
                  onChange={(e) => setConfirmIrreversible(e.target.checked)}
                  disabled={!isPreflightPassed || isFinalizing}
                  className="mt-0.5 rounded border-slate-700 text-amber-500 focus:ring-amber-400 focus:ring-offset-slate-900"
                />
                <label
                  htmlFor="confirm-closure-irreversible"
                  className="text-xs text-amber-200/90 leading-relaxed select-none cursor-pointer"
                >
                  <span className="font-bold text-amber-300 block mb-0.5">
                    I confirm that tournament closure is PERMANENT and IRREVERSIBLE.
                  </span>
                  Sealing this tournament will atomically transition its status to <span className="font-mono text-amber-300 font-bold">COMPLETED</span>, generate an immutable SHA-256 seal record, and lock all matches, points, and standings from further editing.
                </label>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isFinalizing}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleFinalize}
                  disabled={!confirmIrreversible || !isPreflightPassed || isFinalizing}
                  className={`px-5 py-2 text-xs font-bold uppercase tracking-wider rounded-xl flex items-center gap-2 transition-all ${
                    confirmIrreversible && isPreflightPassed && !isFinalizing
                      ? 'bg-linear-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 shadow-lg shadow-amber-950/40'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50'
                  }`}
                >
                  {isFinalizing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                      Sealing Tournament...
                    </>
                  ) : (
                    <>
                      <Lock className="w-4 h-4" />
                      Finalize & Seal Tournament
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
