import React, { useState, useMemo } from 'react';
import { CourtTelemetry, EnrichedQueueMatch } from '../../types/courtOperations';
import { Swords, Check, X, AlertTriangle, ShieldCheck, ChevronRight } from 'lucide-react';

interface CourtDispatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  courts: CourtTelemetry[];
  readyMatches: EnrichedQueueMatch[];
  preselectedCourtId?: string | null;
  preselectedMatchId?: string | null;
  onConfirmDispatch: (matchId: string, courtId: string) => Promise<void>;
}

export const CourtDispatchModal: React.FC<CourtDispatchModalProps> = ({
  isOpen,
  onClose,
  courts,
  readyMatches,
  preselectedCourtId,
  preselectedMatchId,
  onConfirmDispatch
}) => {
  const modalContainerRef = React.useRef<HTMLDivElement>(null);
  const triggerElementRef = React.useRef<HTMLElement | null>(null);
  const [selectedCourtId, setSelectedCourtId] = useState<string>(preselectedCourtId || '');
  const [selectedMatchId, setSelectedMatchId] = useState<string>(preselectedMatchId || '');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Accessible Focus Management & Escape key listener
  React.useEffect(() => {
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

  // Sync props when opening
  React.useEffect(() => {
    if (preselectedCourtId) setSelectedCourtId(preselectedCourtId);
    if (preselectedMatchId) setSelectedMatchId(preselectedMatchId);
    setErrorMessage(null);
  }, [preselectedCourtId, preselectedMatchId, isOpen]);

  const activeCourts = useMemo(() => courts.filter(c => c.isActive), [courts]);

  const selectedMatch = useMemo(
    () => readyMatches.find(m => m.matchId === selectedMatchId),
    [readyMatches, selectedMatchId]
  );

  const selectedCourt = useMemo(
    () => activeCourts.find(c => c.courtId === selectedCourtId),
    [activeCourts, selectedCourtId]
  );

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMatchId || !selectedCourtId) {
      setErrorMessage('Please select both a match and a target court.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await onConfirmDispatch(selectedMatchId, selectedCourtId);
      onClose();
    } catch (err: any) {
      console.error('Dispatch error:', err);
      setErrorMessage(err.message || 'Failed to dispatch match to court. Please retry.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        ref={modalContainerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dispatch-modal-title"
        className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150 focus:outline-hidden"
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-xs">
              <Swords className="w-5 h-5" />
            </div>
            <div>
              <h3 id="dispatch-modal-title" className="font-bold text-slate-900 text-base leading-tight">Dispatch Match to Court</h3>
              <p className="text-xs text-slate-500 mt-0.5">Assign a ready sparring bout to an active court queue</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {errorMessage && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* 1. Match Selection */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              1. Select Ready Match ({readyMatches.length} available)
            </label>
            {readyMatches.length === 0 ? (
              <div className="p-4 rounded-xl border border-dashed border-slate-200 text-center text-xs text-slate-400">
                No matches are currently in READY state. All scheduled matches are either already assigned, in progress, or waiting for feeder brackets.
              </div>
            ) : (
              <select
                value={selectedMatchId}
                onChange={(e) => setSelectedMatchId(e.target.value)}
                className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 font-medium focus:ring-2 focus:ring-slate-900 focus:outline-none"
              >
                <option value="">-- Choose a Match --</option>
                {readyMatches.map(m => (
                  <option key={m.matchId} value={m.matchId}>
                    Match #{m.matchNumber}: {m.eventName} ({m.roundName}) — {m.redAthlete?.athleteName} vs {m.blueAthlete?.athleteName}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Match Preview Card */}
          {selectedMatch && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs">
              <div className="flex items-center justify-between text-slate-600 font-semibold">
                <span>{selectedMatch.eventName}</span>
                <span className="font-mono text-[11px] bg-white px-2 py-0.5 rounded border border-slate-200">
                  {selectedMatch.roundName}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-white p-2 rounded-lg border border-red-200">
                  <span className="text-[10px] font-bold text-red-600 uppercase">Red Corner</span>
                  <p className="font-bold text-slate-900 truncate">{selectedMatch.redAthlete?.athleteName}</p>
                  <p className="text-[10px] text-slate-500 truncate">{selectedMatch.redAthlete?.teamName}</p>
                </div>
                <div className="bg-white p-2 rounded-lg border border-blue-200">
                  <span className="text-[10px] font-bold text-blue-600 uppercase">Blue Corner</span>
                  <p className="font-bold text-slate-900 truncate">{selectedMatch.blueAthlete?.athleteName}</p>
                  <p className="text-[10px] text-slate-500 truncate">{selectedMatch.blueAthlete?.teamName}</p>
                </div>
              </div>
            </div>
          )}

          {/* 2. Court Selection */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              2. Select Target Court
            </label>
            <div className="grid grid-cols-2 gap-2">
              {activeCourts.map(c => {
                const isSelected = selectedCourtId === c.courtId;
                return (
                  <button
                    type="button"
                    key={c.courtId}
                    onClick={() => setSelectedCourtId(c.courtId)}
                    className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between ${
                      isSelected
                        ? 'border-slate-900 ring-2 ring-slate-900/10 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white hover:border-slate-300 text-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`font-black text-sm ${isSelected ? 'text-white' : 'text-slate-900'}`}>
                        {c.courtIdentifier}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                        isSelected 
                          ? 'bg-slate-800 text-slate-200' 
                          : c.state === 'LIVE'
                          ? 'bg-red-100 text-red-700'
                          : c.state === 'ASSIGNED'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {c.state}
                      </span>
                    </div>
                    <p className={`text-xs mt-2 truncate ${isSelected ? 'text-slate-200' : 'text-slate-600'}`}>
                      {c.courtName}
                    </p>
                    <p className={`text-[10px] mt-0.5 ${isSelected ? 'text-slate-400' : 'text-slate-400'}`}>
                      Queue: {c.queueCount} match{c.queueCount !== 1 ? 'es' : ''}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !selectedMatchId || !selectedCourtId}
              className="px-5 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center gap-1.5"
            >
              {isSubmitting ? (
                <>Dispatching...</>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Confirm Dispatch
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
