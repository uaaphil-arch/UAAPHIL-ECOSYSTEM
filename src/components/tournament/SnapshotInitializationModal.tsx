import React, { useState } from 'react';
import { X, ShieldCheck, AlertCircle, Loader2, Database, Info } from 'lucide-react';
import { tournamentService } from '../../services/tournamentService';
import { Tournament, CreateSnapshotResponse } from '../../types/tournament';

interface SnapshotInitializationModalProps {
  isOpen: boolean;
  tournament: Tournament | null;
  onClose: () => void;
  onSuccess: (response: CreateSnapshotResponse) => void;
}

export const SnapshotInitializationModal: React.FC<SnapshotInitializationModalProps> = ({
  isOpen,
  tournament,
  onClose,
  onSuccess,
}) => {
  const [rulebookVersion, setRulebookVersion] = useState('UAAPHIL 2026.1 Canonical');
  const [allowWeighInTolerance, setAllowWeighInTolerance] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !tournament) return null;

  const handleInitialize = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const config = {
        rulebook_version: rulebookVersion,
        weigh_in_tolerance_enabled: allowWeighInTolerance,
        system_architecture: 'SNAPSHOT_FIRST_CANONICAL',
        freeze_timestamp: new Date().toISOString(),
      };

      const res = await tournamentService.createInitialTournamentSnapshot(
        tournament.id,
        config
      );
      onSuccess(res);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to initialize snapshot.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-indigo-400" />
            <h2 className="text-lg font-semibold text-slate-100">Initialize Tournament Snapshot (v1)</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleInitialize} className="p-6 space-y-4">
          <div className="p-3.5 bg-indigo-950/40 border border-indigo-800/60 rounded-lg flex items-start gap-2.5 text-xs text-indigo-200 leading-relaxed">
            <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-indigo-100 mb-0.5">Snapshot-First Invariant</p>
              This operation locks the tournament rules and structure into an immutable baseline.
              The resulting Snapshot Version 1 becomes the immutable root for all event configurations and athlete registrations.
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-950/50 border border-red-800/80 rounded-lg flex items-start gap-2 text-red-200 text-sm">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              Tournament Target
            </label>
            <div className="px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-200 text-sm font-medium">
              {tournament.name}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              Competition Rulebook & Format *
            </label>
            <input
              type="text"
              required
              value={rulebookVersion}
              onChange={(e) => setRulebookVersion(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-hidden focus:border-indigo-400 transition-colors text-sm"
            />
          </div>

          <div className="flex items-center gap-3 p-3 bg-slate-950/60 border border-slate-800 rounded-lg">
            <input
              type="checkbox"
              id="weighin-tolerance"
              checked={allowWeighInTolerance}
              onChange={(e) => setAllowWeighInTolerance(e.target.checked)}
              className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-indigo-500 focus:ring-indigo-400"
            />
            <label htmlFor="weighin-tolerance" className="text-xs text-slate-300 cursor-pointer">
              Enable Official Weigh-In Verification Checkpoint
            </label>
          </div>

          <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Freezing Snapshot...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Initialize Snapshot v1</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
