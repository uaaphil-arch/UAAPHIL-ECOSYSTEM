import React, { useState } from 'react';
import { Printer, X, Shield, Trophy, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import { EventBracket } from '../../types/brackets';
import { Tournament, TournamentEvent } from '../../types/tournament';
import { useBranding } from '../../context/BrandingContext';

interface BracketPrintViewProps {
  tournament: Tournament;
  bracket: EventBracket;
  onClose: () => void;
  events?: TournamentEvent[];
  onSelectEvent?: (eventId: string) => void;
}

export const BracketPrintView: React.FC<BracketPrintViewProps> = ({
  tournament,
  bracket,
  onClose,
  events,
  onSelectEvent,
}) => {
  const { logoUrl } = useBranding();
  const { event, rounds } = bracket;
  const [zoomLevel, setZoomLevel] = useState<number>(100);

  const currentEventIndex = events ? events.findIndex((e) => e.id === event.id) : -1;
  const hasPrev = events && currentEventIndex > 0;
  const hasNext = events && currentEventIndex >= 0 && currentEventIndex < events.length - 1;

  const handlePrevEvent = () => {
    if (hasPrev && onSelectEvent && events) {
      onSelectEvent(events[currentEventIndex - 1].id);
    }
  };

  const handleNextEvent = () => {
    if (hasNext && onSelectEvent && events) {
      onSelectEvent(events[currentEventIndex + 1].id);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md overflow-y-auto p-3 sm:p-6 flex justify-center">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-7xl w-full p-4 sm:p-8 shadow-2xl flex flex-col my-auto text-slate-100 print:m-0 print:p-0 print:border-none print:bg-white print:text-black">
        
        {/* Action Header - Screen Only */}
        <div className="no-print flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-800 mb-5">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-400" />
              Printable Tournament Bracket Sheet
            </h2>
            <p className="text-xs text-slate-400">
              Official UAAPHIL single-elimination tournament bracket layout (A4 Landscape optimized).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* Sequential Event Navigation if list provided */}
            {events && events.length > 1 && onSelectEvent && (
              <div className="flex items-center bg-slate-950 border border-slate-700 rounded-xl p-1 text-xs">
                <button
                  type="button"
                  onClick={handlePrevEvent}
                  disabled={!hasPrev}
                  className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent"
                  title="Previous Bracket"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="px-2 font-mono text-[11px] text-slate-400">
                  {currentEventIndex + 1} / {events.length}
                </span>
                <button
                  type="button"
                  onClick={handleNextEvent}
                  disabled={!hasNext}
                  className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent"
                  title="Next Bracket"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Zoom Controls */}
            <div className="hidden sm:flex items-center bg-slate-950 border border-slate-700 rounded-xl p-1 text-xs">
              <button
                type="button"
                onClick={() => setZoomLevel((z) => Math.max(z - 15, 60))}
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="px-2 font-mono text-[11px] text-amber-400 font-bold min-w-[40px] text-center">
                {zoomLevel}%
              </span>
              <button
                type="button"
                onClick={() => setZoomLevel((z) => Math.min(z + 15, 130))}
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs shadow-lg transition-all"
            >
              <Printer className="w-4 h-4" />
              Print Bracket Sheet
            </button>
            
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
              title="Close Preview"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Canvas Section */}
        <div className="print-bracket-canvas bg-slate-950 border border-slate-800/80 rounded-2xl p-6 print:p-0 print:bg-white print:border-none print:text-black overflow-x-auto">
          {/* Header Banner */}
          <div className="flex items-start justify-between border-b-2 border-slate-700 pb-4 mb-6 print:border-black">
            <div className="flex items-center gap-4">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt="UAAPHIL Logo"
                  className="h-14 w-auto object-contain print:h-12"
                />
              ) : (
                <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center border border-slate-700 print:border-black">
                  <Shield className="w-6 h-6 text-amber-400 print:text-black" />
                </div>
              )}
              <div>
                <div className="text-[10px] font-black uppercase tracking-wider text-amber-400 print:text-black">
                  UAAPHIL Official Tournament Bracket
                </div>
                <h1 className="text-lg sm:text-xl font-black text-slate-100 print:text-black mt-0.5">
                  {tournament.name}
                </h1>
                <div className="text-xs text-slate-400 print:text-gray-700 mt-0.5">
                  {(tournament as any).venue || 'Official Arena'} • {new Date(tournament.start_date).toLocaleDateString()}
                </div>
              </div>
            </div>

            <div className="text-right">
              <div className="px-3 py-1.5 rounded bg-slate-800 border border-slate-700 print:bg-gray-100 print:border-black inline-block text-left">
                <div className="text-[9px] uppercase font-bold text-slate-400 print:text-gray-600">Event</div>
                <div className="text-xs font-black text-amber-400 print:text-black">{event.name}</div>
                <div className="text-[10px] text-slate-300 print:text-gray-700">
                  {typeof event.division === 'string' ? event.division : (event.division as any)?.name || 'Open Division'} • {event.gender || (event as any).gender_category || 'Open'} • {event.weight_class || (event as any).weight_category || 'Open Weight'}
                </div>
              </div>
            </div>
          </div>

          {/* Tree Columns Grid */}
          <div 
            className="overflow-x-auto pb-4 transition-transform origin-top-left"
            style={{ zoom: `${zoomLevel}%` }}
          >
            <div className="flex items-stretch gap-4 sm:gap-6 min-w-max">
              {rounds.map((r) => (
                <div key={r.round_number} className="w-56 sm:w-64 flex flex-col">
                  {/* Round Header */}
                  <div className="text-center py-2 px-3 bg-slate-800/80 border border-slate-700 rounded-xl mb-4 print:bg-gray-200 print:border-black print:text-black">
                    <div className="text-xs font-black text-slate-200 print:text-black uppercase tracking-wider">
                      {r.round_name}
                    </div>
                    <div className="text-[10px] text-slate-400 print:text-gray-600">
                      {r.nodes.length} {r.nodes.length === 1 ? 'Match' : 'Matches'}
                    </div>
                  </div>

                  {/* Matches In Round */}
                  <div className="flex-1 flex flex-col justify-around gap-4">
                    {r.nodes.map((node) => (
                      <div
                        key={node.match_id}
                        className="rounded-xl border border-slate-700 bg-slate-900/90 p-2.5 shadow-sm print:bg-white print:border-black print:text-black text-xs"
                      >
                        <div className="flex items-center justify-between pb-1 mb-1.5 border-b border-slate-800 print:border-gray-300 text-[10px] font-bold text-slate-400 print:text-gray-600">
                          <span>Match #{node.match_number}</span>
                          {node.court_identifier && <span>{node.court_identifier}</span>}
                        </div>

                        {/* Red Corner */}
                        <div
                          className={`p-1.5 rounded mb-1 border ${
                            node.winner_corner === 'RED'
                              ? 'bg-rose-950/40 border-rose-600/80 text-rose-200 print:bg-gray-200 font-bold'
                              : 'bg-slate-950/40 border-slate-800/80 text-slate-300 print:bg-white'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold truncate">{node.red_participant.athlete_name}</span>
                            <span className="text-[9px] font-bold text-rose-400 print:text-black">RED</span>
                          </div>
                          {node.red_participant.club_or_school && (
                            <div className="text-[9px] text-slate-400 print:text-gray-600 truncate">
                              {node.red_participant.club_or_school}
                            </div>
                          )}
                        </div>

                        {/* Blue Corner */}
                        <div
                          className={`p-1.5 rounded border ${
                            node.winner_corner === 'BLUE'
                              ? 'bg-blue-950/40 border-blue-600/80 text-blue-200 print:bg-gray-200 font-bold'
                              : 'bg-slate-950/40 border-slate-800/80 text-slate-300 print:bg-white'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold truncate">{node.blue_participant.athlete_name}</span>
                            <span className="text-[9px] font-bold text-blue-400 print:text-black">BLUE</span>
                          </div>
                          {node.blue_participant.club_or_school && (
                            <div className="text-[9px] text-slate-400 print:text-gray-600 truncate">
                              {node.blue_participant.club_or_school}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Official Sign-off Footer */}
          <div className="mt-8 pt-6 border-t-2 border-slate-700 grid grid-cols-2 gap-8 text-center text-xs text-slate-400 print:border-black print:text-black">
            <div>
              <div className="border-b border-slate-600 print:border-black w-3/4 mx-auto pb-6 mb-1.5"></div>
              <div className="font-bold text-slate-200 print:text-black">Tournament Director</div>
              <div className="text-[10px]">Official Signature & Date</div>
            </div>
            <div>
              <div className="border-b border-slate-600 print:border-black w-3/4 mx-auto pb-6 mb-1.5"></div>
              <div className="font-bold text-slate-200 print:text-black">Chief Referee / Technical Delegate</div>
              <div className="text-[10px]">Official Signature & Date</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

