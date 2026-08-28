import React, { useState, useMemo } from 'react';
import { ResultBookData } from '../../types/reports';
import { useBranding } from '../../context/BrandingContext';
import { reportService } from '../../services/reportService';
import { 
  Printer, 
  Download, 
  Calendar, 
  Filter, 
  CheckCircle2, 
  Clock, 
  Trophy, 
  Swords, 
  FileSpreadsheet,
  Layers
} from 'lucide-react';
import { MatchStatus } from '../../types/tournament';

interface PrintableMatchScheduleProps {
  data: ResultBookData;
}

export const PrintableMatchSchedule: React.FC<PrintableMatchScheduleProps> = ({ data }) => {
  const { logoUrl } = useBranding();
  const { tournament, matches, courts, events, isProvisional } = data;

  // Filter states
  const [selectedCourt, setSelectedCourt] = useState<string>('ALL');
  const [selectedEventId, setSelectedEventId] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<'ALL' | MatchStatus>('ALL');
  const [groupByCourt, setGroupByCourt] = useState<boolean>(true);

  // Filter matches
  const filteredMatches = useMemo(() => {
    return matches.filter((m) => {
      // Court filter
      if (selectedCourt !== 'ALL' && (m.court_identifier || 'TBD') !== selectedCourt) {
        return false;
      }
      // Event filter
      if (selectedEventId !== 'ALL' && m.event_id !== selectedEventId) {
        return false;
      }
      // Status filter
      if (selectedStatus !== 'ALL' && m.status !== selectedStatus) {
        return false;
      }
      return true;
    });
  }, [matches, selectedCourt, selectedEventId, selectedStatus]);

  // Summary statistics
  const stats = useMemo(() => {
    const total = filteredMatches.length;
    const completed = filteredMatches.filter((m) => m.status === 'COMPLETED').length;
    const inProgress = filteredMatches.filter((m) => m.status === 'IN_PROGRESS').length;
    const scheduled = filteredMatches.filter((m) => m.status === 'SCHEDULED').length;
    const activeCourts = new Set(filteredMatches.map((m) => m.court_identifier).filter(Boolean)).size;

    return { total, completed, inProgress, scheduled, activeCourts };
  }, [filteredMatches]);

  // Group matches by court if enabled
  const courtGroups = useMemo(() => {
    const map = new Map<string, typeof filteredMatches>();
    filteredMatches.forEach((m) => {
      const courtName = m.court_identifier || 'Unassigned Court / Mat';
      if (!map.has(courtName)) {
        map.set(courtName, []);
      }
      map.get(courtName)!.push(m);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredMatches]);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Top Controls Bar - Screen Only */}
      <div className="no-print flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-6 rounded-2xl">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`px-2.5 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider ${
                isProvisional
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              }`}
            >
              {isProvisional ? 'Live Tournament Schedule' : 'Official Match Order'}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              Generated {new Date(data.generatedAt).toLocaleDateString()}
            </span>
          </div>
          <h2 className="text-xl font-black text-white uppercase tracking-tight mt-1 flex items-center gap-2">
            <Swords className="w-5 h-5 text-amber-400" />
            Arena Court Match Schedule & Bout Sequence
          </h2>
          <p className="text-xs text-slate-400">
            Printable operational match order, court allocations, scheduled bout sequences, and corner assignments.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-amber-600/20 transition"
          >
            <Printer className="w-4 h-4" />
            <span>Print Match Schedule</span>
          </button>

          <button
            onClick={() => reportService.exportMatchResultsCSV(filteredMatches, tournament.name)}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold transition"
            title="Download CSV"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Screen Filter Bar */}
      <div className="no-print bg-slate-900/60 border border-slate-800 p-4 rounded-2xl space-y-3">
        <div className="flex items-center justify-between text-xs font-bold text-slate-300">
          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-amber-400" />
            <span>Schedule Filters & View Options</span>
          </div>
          <span className="text-slate-400 font-mono text-[11px]">
            Showing {filteredMatches.length} of {matches.length} Bouts
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Court / Mat</label>
            <select
              value={selectedCourt}
              onChange={(e) => setSelectedCourt(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-3 py-2 text-xs focus:border-amber-500 focus:outline-none"
            >
              <option value="ALL">All Courts & Mats</option>
              {courts.map((c) => (
                <option key={c.id} value={c.identifier || c.name}>
                  {c.name || `Court ${c.identifier}`}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Event Category</label>
            <select
              value={selectedEventId}
              onChange={(e) => setSelectedEventId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-3 py-2 text-xs focus:border-amber-500 focus:outline-none"
            >
              <option value="ALL">All Events ({events.length})</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name} ({ev.category})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Match Status</label>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value as any)}
              className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-3 py-2 text-xs focus:border-amber-500 focus:outline-none"
            >
              <option value="ALL">All Statuses</option>
              <option value="SCHEDULED">Scheduled</option>
              <option value="IN_PROGRESS">In Progress / Live</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Grouping Layout</label>
            <button
              type="button"
              onClick={() => setGroupByCourt(!groupByCourt)}
              className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border transition ${
                groupByCourt 
                  ? 'bg-amber-500/15 border-amber-500/30 text-amber-300' 
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>{groupByCourt ? 'Grouped by Court / Mat' : 'Chronological List'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Screen KPIs */}
      <div className="no-print grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <div className="text-[10px] uppercase font-bold text-slate-400">Total Bouts</div>
          <div className="text-xl font-black text-white mt-0.5">{stats.total}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <div className="text-[10px] uppercase font-bold text-emerald-400">Completed</div>
          <div className="text-xl font-black text-emerald-400 mt-0.5">{stats.completed}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <div className="text-[10px] uppercase font-bold text-amber-400">In Progress / Live</div>
          <div className="text-xl font-black text-amber-400 mt-0.5">{stats.inProgress}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <div className="text-[10px] uppercase font-bold text-cyan-400">Scheduled / Queue</div>
          <div className="text-xl font-black text-cyan-400 mt-0.5">{stats.scheduled}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <div className="text-[10px] uppercase font-bold text-purple-400">Active Courts</div>
          <div className="text-xl font-black text-purple-400 mt-0.5">{stats.activeCourts}</div>
        </div>
      </div>

      {/* Printable Sheet Canvas Container */}
      <div className="printable-schedule-canvas bg-slate-950 text-slate-100 border border-slate-800 rounded-2xl p-6 sm:p-10 space-y-8 shadow-2xl relative overflow-hidden print:p-0 print:m-0 print:border-none print:bg-white print:text-black">
        {/* Header Section */}
        <div className="border-b-2 border-slate-800 print:border-black pb-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full p-0.5 bg-black border border-amber-500/40 flex items-center justify-center flex-shrink-0 shadow-lg print:border-black">
                <img
                  src={logoUrl}
                  alt="UAAPhil Logo"
                  className="w-full h-full object-contain rounded-full"
                  referrerPolicy="no-referrer"
                />
              </div>
              <div>
                <div className="text-xs font-black tracking-widest text-amber-400 print:text-black uppercase">
                  Unified Arnis Association of the Philippines
                </div>
                <h1 className="text-2xl font-black text-white print:text-black tracking-tight uppercase">
                  {tournament.name}
                </h1>
                <div className="text-xs text-slate-400 print:text-gray-700 mt-0.5">
                  {(tournament as any).venue || 'Official Arena'} • {new Date(tournament.start_date).toLocaleDateString()} to {new Date(tournament.end_date).toLocaleDateString()}
                </div>
              </div>
            </div>

            <div className="text-right">
              <div className="inline-block px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 print:bg-gray-100 print:border-black text-left">
                <div className="text-[10px] font-black uppercase text-amber-400 print:text-black">Document Type</div>
                <div className="text-sm font-black text-white print:text-black">OFFICIAL MATCH SCHEDULE</div>
                <div className="text-[10px] text-slate-400 print:text-gray-600 font-mono">
                  {isProvisional ? 'ARENA OPERATIONS ORDER' : 'OFFICIAL BOUT LOG'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Schedule Listing / Groups */}
        {groupByCourt ? (
          courtGroups.map(([courtName, courtMatches]) => (
            <div key={courtName} className="space-y-3 print:break-inside-avoid">
              <div className="flex items-center justify-between bg-slate-900/80 print:bg-gray-100 p-2.5 px-4 rounded-xl border border-slate-800 print:border-black">
                <h3 className="text-xs font-black uppercase tracking-wider text-amber-400 print:text-black flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400 print:bg-black inline-block"></span>
                  {courtName}
                </h3>
                <span className="text-[11px] font-mono text-slate-400 print:text-gray-700">
                  {courtMatches.length} Assigned Bouts
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse border border-slate-800 print:border-black">
                  <thead>
                    <tr className="bg-slate-900 print:bg-gray-200 border-b border-slate-800 print:border-black text-slate-300 print:text-black text-[10px] uppercase font-bold tracking-wider">
                      <th className="py-2 px-2.5 border-r border-slate-800 print:border-black w-10 text-center">Bout</th>
                      <th className="py-2 px-2.5 border-r border-slate-800 print:border-black">Event / Division</th>
                      <th className="py-2 px-2.5 border-r border-slate-800 print:border-black text-center">Round</th>
                      <th className="py-2 px-2.5 border-r border-slate-800 print:border-black bg-red-950/20 text-red-300 print:bg-transparent print:text-black">
                        RED Corner (Athlete & Club)
                      </th>
                      <th className="py-2 px-2.5 border-r border-slate-800 print:border-black bg-blue-950/20 text-blue-300 print:bg-transparent print:text-black">
                        BLUE Corner (Athlete & Club)
                      </th>
                      <th className="py-2 px-2.5 border-r border-slate-800 print:border-black text-center">Status</th>
                      <th className="py-2 px-2.5 text-center">Winner / Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 print:divide-black">
                    {courtMatches.map((m, idx) => {
                      const eventName = m.event?.name || 'Sparring Event';
                      const division = typeof m.event?.division === 'string' ? m.event.division : 'OPEN';
                      const round = m.round_name || (m.round_number ? `Round ${m.round_number}` : `Bout ${idx + 1}`);
                      
                      const redName = m.red_registration?.user_profile?.full_name || 'TBD / Bye';
                      const redTeam = m.red_registration?.team_name || '—';
                      const blueName = m.blue_registration?.user_profile?.full_name || 'TBD / Bye';
                      const blueTeam = m.blue_registration?.team_name || '—';

                      const winnerName = m.winner_registration?.user_profile?.full_name;
                      const winnerTeam = m.winner_registration?.team_name;

                      return (
                        <tr key={m.id} className="hover:bg-slate-900/40 print:hover:bg-transparent">
                          <td className="py-2 px-2.5 border-r border-slate-800 print:border-black text-center text-slate-400 print:text-black font-mono font-bold">
                            {m.match_number || idx + 1}
                          </td>
                          <td className="py-2 px-2.5 border-r border-slate-800 print:border-black">
                            <div className="font-bold text-white print:text-black">{eventName}</div>
                            <div className="text-[10px] text-slate-500 print:text-gray-600">{division}</div>
                          </td>
                          <td className="py-2 px-2.5 border-r border-slate-800 print:border-black text-center font-semibold text-slate-300 print:text-black">
                            {round}
                          </td>
                          <td className="py-2 px-2.5 border-r border-slate-800 print:border-black">
                            <div className="font-bold text-red-400 print:text-black">{redName}</div>
                            <div className="text-[10px] text-slate-400 print:text-gray-600">{redTeam}</div>
                          </td>
                          <td className="py-2 px-2.5 border-r border-slate-800 print:border-black">
                            <div className="font-bold text-blue-400 print:text-black">{blueName}</div>
                            <div className="text-[10px] text-slate-400 print:text-gray-600">{blueTeam}</div>
                          </td>
                          <td className="py-2 px-2.5 border-r border-slate-800 print:border-black text-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              m.status === 'COMPLETED'
                                ? 'bg-emerald-500/20 text-emerald-300 print:bg-transparent print:text-black'
                                : m.status === 'IN_PROGRESS'
                                ? 'bg-amber-500/20 text-amber-300 print:bg-transparent print:text-black'
                                : 'bg-slate-800 text-slate-400 print:bg-transparent print:text-black'
                            }`}>
                              {m.status}
                            </span>
                          </td>
                          <td className="py-2 px-2.5 text-center font-bold text-amber-400 print:text-black">
                            {winnerName ? (
                              <div>
                                <span className="text-white print:text-black">{winnerName}</span>
                                <span className="text-[10px] text-slate-400 print:text-gray-600 block">{winnerTeam}</span>
                              </div>
                            ) : (
                              <span className="text-slate-500 print:text-gray-400 italic font-normal text-[10px]">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse border border-slate-800 print:border-black">
              <thead>
                <tr className="bg-slate-900 print:bg-gray-200 border-b border-slate-800 print:border-black text-slate-300 print:text-black text-[10px] uppercase font-bold tracking-wider">
                  <th className="py-2 px-2.5 border-r border-slate-800 print:border-black w-10 text-center">#</th>
                  <th className="py-2 px-2.5 border-r border-slate-800 print:border-black">Court</th>
                  <th className="py-2 px-2.5 border-r border-slate-800 print:border-black">Event / Division</th>
                  <th className="py-2 px-2.5 border-r border-slate-800 print:border-black text-center">Round</th>
                  <th className="py-2 px-2.5 border-r border-slate-800 print:border-black text-red-300 print:text-black">RED Corner</th>
                  <th className="py-2 px-2.5 border-r border-slate-800 print:border-black text-blue-300 print:text-black">BLUE Corner</th>
                  <th className="py-2 px-2.5 border-r border-slate-800 print:border-black text-center">Status</th>
                  <th className="py-2 px-2.5 text-center">Winner / Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 print:divide-black">
                {filteredMatches.map((m, idx) => {
                  const eventName = m.event?.name || 'Sparring Event';
                  const division = typeof m.event?.division === 'string' ? m.event.division : 'OPEN';
                  const round = m.round_name || (m.round_number ? `Round ${m.round_number}` : `Bout ${idx + 1}`);
                  const court = m.court_identifier || 'TBD';

                  const redName = m.red_registration?.user_profile?.full_name || 'TBD / Bye';
                  const blueName = m.blue_registration?.user_profile?.full_name || 'TBD / Bye';
                  const winnerName = m.winner_registration?.user_profile?.full_name;

                  return (
                    <tr key={m.id} className="hover:bg-slate-900/40 print:hover:bg-transparent">
                      <td className="py-2 px-2.5 border-r border-slate-800 print:border-black text-center text-slate-500 print:text-black font-mono">
                        {idx + 1}
                      </td>
                      <td className="py-2 px-2.5 border-r border-slate-800 print:border-black font-bold text-amber-400 print:text-black">
                        {court}
                      </td>
                      <td className="py-2 px-2.5 border-r border-slate-800 print:border-black">
                        <div className="font-bold text-white print:text-black">{eventName}</div>
                        <div className="text-[10px] text-slate-500 print:text-gray-600">{division}</div>
                      </td>
                      <td className="py-2 px-2.5 border-r border-slate-800 print:border-black text-center font-semibold text-slate-300 print:text-black">
                        {round}
                      </td>
                      <td className="py-2 px-2.5 border-r border-slate-800 print:border-black font-bold text-red-400 print:text-black">
                        {redName}
                      </td>
                      <td className="py-2 px-2.5 border-r border-slate-800 print:border-black font-bold text-blue-400 print:text-black">
                        {blueName}
                      </td>
                      <td className="py-2 px-2.5 border-r border-slate-800 print:border-black text-center">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 print:bg-transparent print:text-black">
                          {m.status}
                        </span>
                      </td>
                      <td className="py-2 px-2.5 text-center font-bold text-white print:text-black">
                        {winnerName || '—'}
                      </td>
                    </tr>
                  );
                })}

                {filteredMatches.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-500 italic">
                      No matches found matching the selected schedule criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Official Signatures Block */}
        <div className="pt-8 border-t border-slate-800 print:border-black grid grid-cols-1 sm:grid-cols-2 gap-8 print:gap-4 print:pt-6">
          <div className="space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 print:text-black">
              Chief Table Official / Match Marshal
            </div>
            <div className="h-12 border-b-2 border-slate-700 print:border-black"></div>
            <div className="text-[10px] text-slate-500 print:text-gray-600">Printed Name & Signature</div>
          </div>

          <div className="space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 print:text-black">
              Tournament Operations Director
            </div>
            <div className="h-12 border-b-2 border-slate-700 print:border-black"></div>
            <div className="text-[10px] text-slate-500 print:text-gray-600">Official Stamp & Date</div>
          </div>
        </div>
      </div>
    </div>
  );
};
