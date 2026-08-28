import React from 'react';
import { X, Maximize2, Minimize2, Radio, Trophy, ShieldAlert, Award } from 'lucide-react';
import { Court, Match } from '../../types/tournament';

interface PublicScoreboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  court: Court | null;
  match: Match | null;
  currentRound: number;
  timerSeconds: number;
  redScore: number;
  blueScore: number;
  redAdvantage: boolean;
  blueAdvantage: boolean;
  redFouls: number;
  blueFouls: number;
}

export const PublicScoreboardModal: React.FC<PublicScoreboardModalProps> = ({
  isOpen,
  onClose,
  court,
  match,
  currentRound,
  timerSeconds,
  redScore,
  blueScore,
  redAdvantage,
  blueAdvantage,
  redFouls,
  blueFouls,
}) => {
  const modalContainerRef = React.useRef<HTMLDivElement>(null);
  const triggerElementRef = React.useRef<HTMLElement | null>(null);
  const [isFullscreen, setIsFullscreen] = React.useState(false);

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

  if (!isOpen || !court || !match) return null;

  const formatTimer = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch((err) => {
          console.error(`Error attempting to disable fullscreen: ${err.message}`);
        });
        setIsFullscreen(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-2 sm:p-4 overflow-y-auto">
      <div
        ref={modalContainerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Public Scoreboard - ${court.name}`}
        className="relative w-full max-w-6xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col focus:outline-hidden"
      >
        {/* Top Navigation & Status Bar */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-800/80 border-b border-slate-700/80">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-rose-500/20 text-rose-300 border border-rose-500/30 animate-pulse">
              <Radio className="w-3.5 h-3.5" /> LIVE SCORING
            </span>
            <span className="text-slate-300 font-semibold text-sm sm:text-base">
              {court.name} ({court.identifier})
            </span>
            {match.event && (
              <span className="hidden sm:inline-block px-2.5 py-0.5 rounded text-xs font-medium bg-slate-700/60 text-slate-300 border border-slate-600/60">
                {match.event.category} • {match.event.division} {match.event.weight_class ? `• ${match.event.weight_class}` : ''}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={toggleFullscreen}
              className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700/60 transition-colors"
              title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            >
              {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700/60 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Center Round & Match Timer Bar */}
        <div className="bg-slate-950 py-4 px-6 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 text-center">
          <div className="flex items-center gap-2 text-left">
            <div>
              <p className="text-xs uppercase tracking-widest text-slate-400 font-bold">Match Identifier</p>
              <p className="text-sm font-mono font-bold text-slate-200">
                {match.round_name || `Round ${match.round_number || 1}`} • Match #{match.match_number || 1}
              </p>
            </div>
          </div>

          {/* Central Timer Display */}
          <div className="flex flex-col items-center">
            <div className="px-6 py-2 bg-slate-900 border border-slate-700 rounded-xl shadow-inner font-mono text-3xl sm:text-5xl font-black tracking-widest text-amber-400">
              {formatTimer(timerSeconds)}
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 mt-1">
              Active Round: {currentRound}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300">
              Full Contact Sparring
            </div>
          </div>
        </div>

        {/* Duel Scoreboard Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-800 flex-1">
          {/* Red Corner */}
          <div className="p-6 sm:p-8 bg-gradient-to-b from-rose-950/40 via-slate-900 to-slate-900 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest bg-rose-600 text-white shadow-md shadow-rose-900/50">
                  RED CORNER
                </span>
                {redAdvantage && (
                  <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    <Award className="w-3.5 h-3.5" /> ADVANTAGE
                  </span>
                )}
              </div>

              <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-100 tracking-tight line-clamp-1">
                {match.red_registration?.user_profile?.full_name || 'Red Corner Athlete'}
              </h2>
              <p className="text-sm font-semibold text-rose-300/80 mt-0.5">
                {match.red_registration?.team_name || 'Independent / Team Red'}
              </p>
            </div>

            {/* Score Number Display */}
            <div className="my-8 flex flex-col items-center justify-center">
              <div className="w-36 h-36 sm:w-44 sm:h-44 rounded-2xl bg-rose-950/60 border-2 border-rose-600/80 shadow-2xl shadow-rose-950/80 flex items-center justify-center">
                <span className="font-mono text-7xl sm:text-8xl font-black text-rose-100 tracking-tighter">
                  {redScore}
                </span>
              </div>
              <span className="text-xs uppercase font-bold tracking-widest text-rose-400/80 mt-2">
                Accumulated Points
              </span>
            </div>

            {/* Bottom Penalties & Info */}
            <div className="flex items-center justify-between pt-4 border-t border-rose-900/40 text-xs">
              <div className="flex items-center gap-1.5 text-rose-300">
                <ShieldAlert className="w-4 h-4 text-rose-400" />
                <span>Fouls / Warnings: <strong>{redFouls}</strong></span>
              </div>
              {match.red_registration?.weigh_in_weight && (
                <span className="text-slate-400 font-mono">
                  Weight: {match.red_registration.weigh_in_weight} kg
                </span>
              )}
            </div>
          </div>

          {/* Blue Corner */}
          <div className="p-6 sm:p-8 bg-gradient-to-b from-blue-950/40 via-slate-900 to-slate-900 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest bg-blue-600 text-white shadow-md shadow-blue-900/50">
                  BLUE CORNER
                </span>
                {blueAdvantage && (
                  <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    <Award className="w-3.5 h-3.5" /> ADVANTAGE
                  </span>
                )}
              </div>

              <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-100 tracking-tight line-clamp-1">
                {match.blue_registration?.user_profile?.full_name || 'Blue Corner Athlete'}
              </h2>
              <p className="text-sm font-semibold text-blue-300/80 mt-0.5">
                {match.blue_registration?.team_name || 'Independent / Team Blue'}
              </p>
            </div>

            {/* Score Number Display */}
            <div className="my-8 flex flex-col items-center justify-center">
              <div className="w-36 h-36 sm:w-44 sm:h-44 rounded-2xl bg-blue-950/60 border-2 border-blue-600/80 shadow-2xl shadow-blue-950/80 flex items-center justify-center">
                <span className="font-mono text-7xl sm:text-8xl font-black text-blue-100 tracking-tighter">
                  {blueScore}
                </span>
              </div>
              <span className="text-xs uppercase font-bold tracking-widest text-blue-400/80 mt-2">
                Accumulated Points
              </span>
            </div>

            {/* Bottom Penalties & Info */}
            <div className="flex items-center justify-between pt-4 border-t border-blue-900/40 text-xs">
              <div className="flex items-center gap-1.5 text-blue-300">
                <ShieldAlert className="w-4 h-4 text-blue-400" />
                <span>Fouls / Warnings: <strong>{blueFouls}</strong></span>
              </div>
              {match.blue_registration?.weigh_in_weight && (
                <span className="text-slate-400 font-mono">
                  Weight: {match.blue_registration.weigh_in_weight} kg
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-950 border-t border-slate-800 text-center text-xs text-slate-500">
          Official UAAPHIL Live Competition Scoreboard • Authoritative Match Record
        </div>
      </div>
    </div>
  );
};
