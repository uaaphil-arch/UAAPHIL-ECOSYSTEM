import React, { useState, useEffect } from 'react';
import { CourtTelemetry } from '../../types/courtOperations';
import { Maximize2, Minimize2, X, Clock, Swords, Layers, Sun, Moon } from 'lucide-react';

interface ArenaProjectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  court: CourtTelemetry | null;
  tournamentName?: string;
}

type ContrastMode = 'standard' | 'sunlight';

const STORAGE_KEY = 'uaaphil_projector_contrast_mode';

const getInitialContrastMode = (): ContrastMode => {
  if (typeof window === 'undefined') return 'standard';
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'sunlight' || saved === 'standard') {
      return saved;
    }
  } catch (err) {
    console.warn('Unable to read contrast mode from localStorage:', err);
  }
  return 'standard';
};

export const ArenaProjectorModal: React.FC<ArenaProjectorModalProps> = ({
  isOpen,
  onClose,
  court,
  tournamentName = 'UAAPHIL Tournament Arena'
}) => {
  const modalContainerRef = React.useRef<HTMLDivElement>(null);
  const triggerElementRef = React.useRef<HTMLElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());
  const [showQueueDrawer, setShowQueueDrawer] = useState(true);
  const [contrastMode, setContrastMode] = useState<ContrastMode>(getInitialContrastMode);

  // Accessible Focus Management & Escape key listener
  useEffect(() => {
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

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const toggleContrastMode = () => {
    setContrastMode(prev => {
      const next: ContrastMode = prev === 'standard' ? 'sunlight' : 'standard';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch (err) {
        console.warn('Unable to persist contrast mode to localStorage:', err);
      }
      return next;
    });
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.warn('Fullscreen request denied:', err);
      });
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
        setIsFullscreen(false);
      }
    }
  };

  if (!isOpen || !court) return null;

  const isSunlight = contrastMode === 'sunlight';
  const activeMatch = court.activeMatch;
  const onDeckItem = court.assignedQueue[0] || court.nextOnDeck || null;
  const inTheHoleItem = court.assignedQueue[1] || null;

  return (
    <div
      ref={modalContainerRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`Arena Projector - ${court.courtName}`}
      className={`fixed inset-0 z-50 flex flex-col justify-between select-none overflow-hidden font-sans focus:outline-hidden ${
        isSunlight ? 'bg-black text-white' : 'bg-slate-950 text-white'
      }`}
    >
      {/* Top Telemetry Bar */}
      <header
        className={`px-6 py-3.5 flex items-center justify-between border-b ${
          isSunlight
            ? 'bg-black border-neutral-800'
            : 'bg-slate-900/90 border-slate-800'
        }`}
      >
        <div className="flex items-center gap-4">
          <div
            className={`w-12 h-12 rounded-xl flex items-center justify-center font-black text-2xl shadow-lg border-2 ${
              isSunlight
                ? 'bg-red-600 text-white border-white'
                : 'bg-red-600 text-white border-transparent'
            }`}
          >
            {court.courtIdentifier}
          </div>
          <div>
            <h1 className="text-xl font-black tracking-wide uppercase text-white flex items-center gap-3">
              {court.courtName}
              {court.state === 'LIVE' ? (
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-black ${
                    isSunlight
                      ? 'bg-red-600 text-white border border-white'
                      : 'bg-red-600 text-white animate-pulse'
                  }`}
                >
                  ● LIVE MATCH
                </span>
              ) : court.state === 'ASSIGNED' ? (
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-black ${
                    isSunlight
                      ? 'bg-amber-400 text-black border border-white'
                      : 'bg-amber-500 text-slate-950'
                  }`}
                >
                  ON DECK
                </span>
              ) : (
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-black ${
                    isSunlight
                      ? 'bg-neutral-800 text-neutral-200 border border-neutral-600'
                      : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  {court.state}
                </span>
              )}
            </h1>
            <p
              className={`text-xs font-medium tracking-wider uppercase ${
                isSunlight ? 'text-neutral-300' : 'text-slate-400'
              }`}
            >
              {tournamentName}
            </p>
          </div>
        </div>

        {/* Center Event Label */}
        {activeMatch && (
          <div className="text-center hidden md:block">
            <p
              className={`text-lg font-black uppercase tracking-wide ${
                isSunlight ? 'text-amber-300' : 'text-amber-400'
              }`}
            >
              {activeMatch.eventName}
            </p>
            <p
              className={`text-xs font-medium ${
                isSunlight ? 'text-neutral-200' : 'text-slate-300'
              }`}
            >
              Match #{activeMatch.matchNumber} • {activeMatch.roundName}
            </p>
          </div>
        )}

        {/* Right Controls & Clock */}
        <div className="flex items-center gap-3">
          <div
            className={`text-right font-mono text-sm font-bold ${
              isSunlight ? 'text-neutral-200' : 'text-slate-400'
            }`}
          >
            {currentTime}
          </div>

          {/* Sunlight Mode Toggle */}
          <button
            onClick={toggleContrastMode}
            className={`p-2 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 border ${
              isSunlight
                ? 'bg-yellow-400 text-black border-yellow-300 shadow-md ring-1 ring-yellow-400'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border-slate-700'
            }`}
            title={
              isSunlight
                ? 'Sunlight Mode Active (High Contrast). Click for Standard Mode.'
                : 'Standard Mode Active. Click for High-Contrast Sunlight Mode.'
            }
            aria-label={
              isSunlight
                ? 'Switch to Standard Display Mode'
                : 'Switch to High-Contrast Sunlight Display Mode'
            }
          >
            {isSunlight ? <Sun className="w-4 h-4 text-black" /> : <Moon className="w-4 h-4" />}
            <span className="hidden sm:inline font-mono uppercase text-[11px]">
              {isSunlight ? 'Sunlight' : 'Standard'}
            </span>
          </button>

          <button
            onClick={() => setShowQueueDrawer(prev => !prev)}
            className={`p-2 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 border ${
              showQueueDrawer
                ? isSunlight
                  ? 'bg-amber-400 text-black border-amber-300'
                  : 'bg-amber-400 text-slate-950 border-amber-300'
                : isSunlight
                ? 'bg-neutral-900 text-neutral-300 hover:bg-neutral-800 border-neutral-700'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border-slate-700'
            }`}
            title="Toggle Upcoming Queue Preview"
            aria-label="Toggle Upcoming Schedule Preview"
          >
            <Layers className="w-4 h-4" />
            <span className="hidden sm:inline">Schedule</span>
          </button>

          <button
            onClick={toggleFullscreen}
            className={`p-2 rounded-xl transition-colors border ${
              isSunlight
                ? 'bg-neutral-900 hover:bg-neutral-800 text-neutral-200 border-neutral-700'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            }`}
            title="Toggle Fullscreen"
            aria-label="Toggle Fullscreen"
          >
            {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
          </button>

          <button
            onClick={onClose}
            className={`p-2 rounded-xl transition-colors border ${
              isSunlight
                ? 'bg-neutral-900 hover:bg-red-900 hover:text-white text-neutral-200 border-neutral-700'
                : 'bg-slate-800 hover:bg-rose-900/50 hover:text-rose-400 text-slate-300 border-slate-700'
            }`}
            title="Exit Projector Mode"
            aria-label="Exit Projector Mode"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Center Display Area */}
      <main
        className={`flex-1 flex flex-col justify-center px-6 py-4 overflow-y-auto ${
          isSunlight ? 'bg-black' : ''
        }`}
      >
        {court.state === 'LIVE' && activeMatch ? (
          <div className="w-full max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6 h-full items-center">
            {/* RED CORNER */}
            <div
              className={`rounded-3xl p-8 shadow-2xl flex flex-col justify-between h-[420px] relative overflow-hidden ${
                isSunlight
                  ? 'bg-red-700 border-4 border-red-400 ring-2 ring-white/40'
                  : 'bg-gradient-to-b from-red-600 to-red-800 border-4 border-red-500/50'
              }`}
            >
              {/* Corner Badge with Text and Glyph */}
              <div
                className={`absolute top-4 right-6 font-black text-sm px-4 py-1.5 rounded-full uppercase tracking-widest flex items-center gap-2 ${
                  isSunlight
                    ? 'bg-black text-white border-2 border-white shadow-lg'
                    : 'bg-red-950/60 text-white border border-red-400/30'
                }`}
              >
                <span className="text-base leading-none text-red-400 font-black">▲</span>
                <span>{isSunlight ? 'RED CORNER / PULA' : 'Red Corner'}</span>
              </div>

              <div className="mt-8">
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-block text-xl text-white font-black">▲</span>
                  <span
                    className={`text-xs font-black uppercase tracking-wider ${
                      isSunlight ? 'text-neutral-200' : 'text-red-200'
                    }`}
                  >
                    Competitor 1
                  </span>
                </div>
                <h2 className="text-4xl md:text-5xl font-black text-white leading-tight uppercase drop-shadow-md">
                  {activeMatch.redAthlete.athleteName}
                </h2>
                <p
                  className={`text-xl font-bold mt-2 tracking-wide uppercase ${
                    isSunlight ? 'text-neutral-100' : 'text-red-200'
                  }`}
                >
                  {activeMatch.redAthlete.teamName}
                </p>
              </div>

              {/* Massive Score Number */}
              <div
                className={`flex items-baseline justify-between pt-4 mt-4 border-t-2 ${
                  isSunlight ? 'border-white/50' : 'border-red-400/30'
                }`}
              >
                <span
                  className={`text-sm font-black uppercase tracking-widest ${
                    isSunlight ? 'text-white' : 'text-red-200'
                  }`}
                >
                  Total Points
                </span>
                <span className="text-8xl md:text-9xl font-black text-white tracking-tighter drop-shadow-xl font-mono">
                  {activeMatch.redAthlete.score || 0}
                </span>
              </div>
            </div>

            {/* BLUE CORNER */}
            <div
              className={`rounded-3xl p-8 shadow-2xl flex flex-col justify-between h-[420px] relative overflow-hidden ${
                isSunlight
                  ? 'bg-blue-700 border-4 border-blue-400 ring-2 ring-white/40'
                  : 'bg-gradient-to-b from-blue-600 to-blue-800 border-4 border-blue-500/50'
              }`}
            >
              {/* Corner Badge with Text and Glyph */}
              <div
                className={`absolute top-4 right-6 font-black text-sm px-4 py-1.5 rounded-full uppercase tracking-widest flex items-center gap-2 ${
                  isSunlight
                    ? 'bg-black text-white border-2 border-white shadow-lg'
                    : 'bg-blue-950/60 text-white border border-blue-400/30'
                }`}
              >
                <span className="text-base leading-none text-blue-400 font-black">●</span>
                <span>{isSunlight ? 'BLUE CORNER / ASUL' : 'Blue Corner'}</span>
              </div>

              <div className="mt-8">
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-block text-xl text-white font-black">●</span>
                  <span
                    className={`text-xs font-black uppercase tracking-wider ${
                      isSunlight ? 'text-neutral-200' : 'text-blue-200'
                    }`}
                  >
                    Competitor 2
                  </span>
                </div>
                <h2 className="text-4xl md:text-5xl font-black text-white leading-tight uppercase drop-shadow-md">
                  {activeMatch.blueAthlete.athleteName}
                </h2>
                <p
                  className={`text-xl font-bold mt-2 tracking-wide uppercase ${
                    isSunlight ? 'text-neutral-100' : 'text-blue-200'
                  }`}
                >
                  {activeMatch.blueAthlete.teamName}
                </p>
              </div>

              {/* Massive Score Number */}
              <div
                className={`flex items-baseline justify-between pt-4 mt-4 border-t-2 ${
                  isSunlight ? 'border-white/50' : 'border-blue-400/30'
                }`}
              >
                <span
                  className={`text-sm font-black uppercase tracking-widest ${
                    isSunlight ? 'text-white' : 'text-blue-200'
                  }`}
                >
                  Total Points
                </span>
                <span className="text-8xl md:text-9xl font-black text-white tracking-tighter drop-shadow-xl font-mono">
                  {activeMatch.blueAthlete.score || 0}
                </span>
              </div>
            </div>
          </div>
        ) : court.nextOnDeck ? (
          /* Court is ASSIGNED / ON DECK */
          <div
            className={`max-w-3xl mx-auto text-center rounded-3xl p-10 shadow-2xl border ${
              isSunlight
                ? 'bg-neutral-950 border-neutral-700 ring-2 ring-neutral-600'
                : 'bg-slate-900/80 border-slate-800'
            }`}
          >
            <span
              className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full font-black text-sm uppercase tracking-wider mb-6 border ${
                isSunlight
                  ? 'bg-amber-400 text-black border-white'
                  : 'bg-amber-500/20 border-amber-500/40 text-amber-300'
              }`}
            >
              <Clock className="w-4 h-4" /> Next Bout on Deck
            </span>
            <p
              className={`text-sm font-bold uppercase tracking-widest ${
                isSunlight ? 'text-neutral-200' : 'text-slate-400'
              }`}
            >
              {court.nextOnDeck.eventName} • {court.nextOnDeck.roundName}
            </p>
            <div className="grid grid-cols-2 gap-6 mt-6">
              <div
                className={`p-6 rounded-2xl border-2 ${
                  isSunlight
                    ? 'bg-red-950 border-red-500'
                    : 'bg-red-950/40 border-red-600/40'
                }`}
              >
                <div className="flex items-center justify-center gap-1.5">
                  <span className="text-red-400 text-base leading-none">▲</span>
                  <span className="text-xs font-black text-red-300 uppercase">
                    {isSunlight ? 'RED CORNER / PULA' : 'Red Corner'}
                  </span>
                </div>
                <p className="text-2xl font-black text-white uppercase mt-2">
                  {court.nextOnDeck.redAthlete.athleteName}
                </p>
                <p
                  className={`text-sm font-medium ${
                    isSunlight ? 'text-neutral-300' : 'text-slate-400'
                  }`}
                >
                  {court.nextOnDeck.redAthlete.teamName}
                </p>
              </div>

              <div
                className={`p-6 rounded-2xl border-2 ${
                  isSunlight
                    ? 'bg-blue-950 border-blue-500'
                    : 'bg-blue-950/40 border-blue-600/40'
                }`}
              >
                <div className="flex items-center justify-center gap-1.5">
                  <span className="text-blue-400 text-base leading-none">●</span>
                  <span className="text-xs font-black text-blue-300 uppercase">
                    {isSunlight ? 'BLUE CORNER / ASUL' : 'Blue Corner'}
                  </span>
                </div>
                <p className="text-2xl font-black text-white uppercase mt-2">
                  {court.nextOnDeck.blueAthlete.athleteName}
                </p>
                <p
                  className={`text-sm font-medium ${
                    isSunlight ? 'text-neutral-300' : 'text-slate-400'
                  }`}
                >
                  {court.nextOnDeck.blueAthlete.teamName}
                </p>
              </div>
            </div>
            <p
              className={`text-xs font-mono mt-6 ${
                isSunlight ? 'text-neutral-400' : 'text-slate-500'
              }`}
            >
              Fighters please proceed to staging area for equipment check.
            </p>
          </div>
        ) : (
          /* Court is AVAILABLE / OFFLINE */
          <div className="max-w-2xl mx-auto text-center p-12">
            <Swords
              className={`w-16 h-16 mx-auto mb-4 ${
                isSunlight ? 'text-neutral-500' : 'text-slate-700'
              }`}
            />
            <h2
              className={`text-3xl font-black uppercase tracking-wider ${
                isSunlight ? 'text-white' : 'text-slate-300'
              }`}
            >
              {court.courtName}
            </h2>
            <p
              className={`text-sm mt-2 font-medium ${
                isSunlight ? 'text-neutral-400' : 'text-slate-500'
              }`}
            >
              Court is currently open. Awaiting next round assignment.
            </p>
          </div>
        )}
      </main>

      {/* Upcoming Queue Preview Drawer & Banner */}
      {showQueueDrawer && (
        <div
          className={`px-8 py-3 border-t ${
            isSunlight
              ? 'bg-black border-neutral-800'
              : 'bg-slate-900/95 border-slate-800'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-4">
              <span
                className={`font-bold uppercase tracking-wider flex items-center gap-1.5 ${
                  isSunlight ? 'text-amber-300' : 'text-amber-400'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                Upcoming Schedule ({court.assignedQueue.length})
              </span>

              {/* On-Deck Preview */}
              {onDeckItem && (
                <div
                  className={`px-3 py-1 rounded-lg border flex items-center gap-2 ${
                    isSunlight
                      ? 'bg-neutral-900 border-neutral-700'
                      : 'bg-slate-800/80 border-slate-700'
                  }`}
                >
                  <span
                    className={`text-[10px] font-black px-1.5 py-0.5 rounded border ${
                      isSunlight
                        ? 'text-amber-300 bg-black border-amber-500'
                        : 'text-amber-400 bg-amber-950/60 border-amber-800/50'
                    }`}
                  >
                    ON-DECK #{onDeckItem.matchNumber}
                  </span>
                  <span className="text-white font-bold">
                    <span className="text-red-400">▲ {onDeckItem.redAthlete.athleteName}</span>
                    <span className="text-neutral-400 mx-1 font-normal">({onDeckItem.redAthlete.teamName})</span>
                    <span className="text-neutral-500 font-normal">vs</span>
                    <span className="text-blue-400 ml-1">● {onDeckItem.blueAthlete.athleteName}</span>
                    <span className="text-neutral-400 ml-1 font-normal">({onDeckItem.blueAthlete.teamName})</span>
                  </span>
                </div>
              )}

              {/* In-The-Hole Preview */}
              {inTheHoleItem && (
                <div
                  className={`px-3 py-1 rounded-lg border hidden md:flex items-center gap-2 ${
                    isSunlight
                      ? 'bg-neutral-950 border-neutral-800'
                      : 'bg-slate-800/50 border-slate-700/60'
                  }`}
                >
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      isSunlight
                        ? 'text-neutral-400 bg-neutral-900'
                        : 'text-slate-400 bg-slate-900'
                    }`}
                  >
                    IN-THE-HOLE #{inTheHoleItem.matchNumber}
                  </span>
                  <span className="text-neutral-300 font-medium">
                    <span className="text-red-400">▲ {inTheHoleItem.redAthlete.athleteName}</span>
                    <span className="text-neutral-500 mx-1">vs</span>
                    <span className="text-blue-400">● {inTheHoleItem.blueAthlete.athleteName}</span>
                  </span>
                </div>
              )}
            </div>

            <div
              className={`font-mono text-[11px] shrink-0 ${
                isSunlight ? 'text-neutral-400' : 'text-slate-500'
              }`}
            >
              UAAPHIL Live Arena Telemetry
            </div>
          </div>
        </div>
      )}

      {/* Bottom Telemetry Footer */}
      <footer
        className={`px-8 py-2.5 border-t flex items-center justify-between text-xs ${
          isSunlight
            ? 'bg-black border-neutral-800 text-neutral-400'
            : 'bg-slate-950 border-slate-900 text-slate-500'
        }`}
      >
        <div className="flex items-center gap-4">
          <span
            className={`font-medium ${
              isSunlight ? 'text-neutral-200' : 'text-slate-400'
            }`}
          >
            Court Identifier: {court.courtIdentifier}
          </span>
          <span>•</span>
          <span>Completed: {court.completedCount} bouts</span>
          <span>•</span>
          <span>
            Officials:{' '}
            {court.assignedOfficials.length > 0
              ? court.assignedOfficials.map(o => o.fullName).join(', ')
              : 'Assigned Table'}
          </span>
        </div>
        <div className="font-mono text-[11px]">
          UAAPHIL Official Tournament Management Platform
        </div>
      </footer>
    </div>
  );
};

