import React, { useState, useMemo } from 'react';
import { ResultBookData } from '../../types/reports';
import { useBranding } from '../../context/BrandingContext';
import { reportService } from '../../services/reportService';
import { getWeighInStatus, renderLineupRoleBadge } from '../registration/RegistrationManagementView';
import { 
  Printer, 
  Download, 
  Scale, 
  Filter, 
  CheckCircle2, 
  AlertCircle, 
  AlertTriangle, 
  Clock, 
  Users, 
  FileSpreadsheet,
  Check,
  ShieldCheck
} from 'lucide-react';
import { LineupRole, WeighInStatus } from '../../types/tournament';

interface PrintableWeighInSheetProps {
  data: ResultBookData;
}

export const PrintableWeighInSheet: React.FC<PrintableWeighInSheetProps> = ({ data }) => {
  const { logoUrl } = useBranding();
  const { tournament, registrations, events, isProvisional } = data;

  // Filter states
  const [selectedEventId, setSelectedEventId] = useState<string>('ALL');
  const [selectedClub, setSelectedClub] = useState<string>('ALL');
  const [selectedLineupRole, setSelectedLineupRole] = useState<'ALL' | LineupRole>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<'ALL' | WeighInStatus>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Extract unique clubs
  const uniqueClubs = useMemo(() => {
    const clubs = new Set<string>();
    registrations.forEach((r) => {
      if (r.team_name) clubs.add(r.team_name);
    });
    return Array.from(clubs).sort();
  }, [registrations]);

  // Filter registrations
  const filteredRegistrations = useMemo(() => {
    return registrations.filter((r) => {
      // Event filter
      if (selectedEventId !== 'ALL' && r.event_id !== selectedEventId) return false;
      // Club filter
      if (selectedClub !== 'ALL' && (r.team_name || '') !== selectedClub) return false;
      // Lineup filter
      if (selectedLineupRole !== 'ALL' && (r.lineup_role || 'LINEUP') !== selectedLineupRole) return false;
      
      // Weigh-in status filter
      const minW = r.event?.min_weight;
      const maxW = r.event?.max_weight;
      const requiresWeighIn = r.event?.rules_override?.requires_weigh_in !== false;
      const status = getWeighInStatus(r.weigh_in_weight, minW, maxW, requiresWeighIn);
      if (selectedStatus !== 'ALL' && status !== selectedStatus) return false;

      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const name = (r.user_profile?.full_name || '').toLowerCase();
        const club = (r.team_name || '').toLowerCase();
        const eventName = (r.event?.name || '').toLowerCase();
        if (!name.includes(query) && !club.includes(query) && !eventName.includes(query)) {
          return false;
        }
      }

      return true;
    });
  }, [registrations, selectedEventId, selectedClub, selectedLineupRole, selectedStatus, searchQuery]);

  // Summary statistics
  const stats = useMemo(() => {
    let passed = 0;
    let overweight = 0;
    let underweight = 0;
    let pending = 0;
    let notRequired = 0;

    filteredRegistrations.forEach((r) => {
      const minW = r.event?.min_weight;
      const maxW = r.event?.max_weight;
      const requiresWeighIn = r.event?.rules_override?.requires_weigh_in !== false;
      const status = getWeighInStatus(r.weigh_in_weight, minW, maxW, requiresWeighIn);
      if (status === 'PASSED') passed++;
      else if (status === 'NOT_REQUIRED') notRequired++;
      else if (status === 'OVERWEIGHT') overweight++;
      else if (status === 'UNDERWEIGHT') underweight++;
      else pending++;
    });

    const total = filteredRegistrations.length;
    const eligible = passed + notRequired;
    const weighed = passed + overweight + underweight;
    const passRate = weighed > 0 ? Math.round((passed / weighed) * 100) : (total > 0 && notRequired === total ? 100 : 0);

    return { total, passed: eligible, overweight, underweight, pending, weighed, notRequired, passRate };
  }, [filteredRegistrations]);

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
              {isProvisional ? 'Official Provisional Roster' : 'Official Verified Sheet'}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              Generated {new Date(data.generatedAt).toLocaleDateString()}
            </span>
          </div>
          <h2 className="text-xl font-black text-white uppercase tracking-tight mt-1 flex items-center gap-2">
            <Scale className="w-5 h-5 text-amber-400" />
            Official Weigh-In & Eligibility Report Sheet
          </h2>
          <p className="text-xs text-slate-400">
            Print-optimized weigh-in station record for athlete check-in, official scale readings, and division compliance.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-amber-600/20 transition"
          >
            <Printer className="w-4 h-4" />
            <span>Print Weigh-In Sheet</span>
          </button>

          <button
            onClick={() => reportService.exportWeighInRecordsCSV(filteredRegistrations, tournament.name)}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold transition"
            title="Download CSV"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Screen-Only Filter Matrix */}
      <div className="no-print bg-slate-900/60 border border-slate-800 p-4 rounded-2xl space-y-3">
        <div className="flex items-center justify-between text-xs font-bold text-slate-300">
          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-amber-400" />
            <span>Report Filters & Staging Parameters</span>
          </div>
          <span className="text-slate-400 font-mono text-[11px]">
            Showing {filteredRegistrations.length} of {registrations.length} Athletes
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
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
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Club / School</label>
            <select
              value={selectedClub}
              onChange={(e) => setSelectedClub(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-3 py-2 text-xs focus:border-amber-500 focus:outline-none"
            >
              <option value="ALL">All Clubs ({uniqueClubs.length})</option>
              {uniqueClubs.map((club) => (
                <option key={club} value={club}>
                  {club}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Lineup Role</label>
            <select
              value={selectedLineupRole}
              onChange={(e) => setSelectedLineupRole(e.target.value as any)}
              className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-3 py-2 text-xs focus:border-amber-500 focus:outline-none"
            >
              <option value="ALL">All Roles</option>
              <option value="LINEUP">Official Lineup</option>
              <option value="RESERVE">Reserve Athlete</option>
              <option value="WITHDRAWN">Withdrawn</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Weigh-In Status</label>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value as any)}
              className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-3 py-2 text-xs focus:border-amber-500 focus:outline-none"
            >
              <option value="ALL">All Statuses</option>
              <option value="PASSED">Passed</option>
              <option value="NOT_REQUIRED">Not Required / Exempt</option>
              <option value="OVERWEIGHT">Overweight</option>
              <option value="UNDERWEIGHT">Underweight</option>
              <option value="PENDING">Pending</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Athlete Search</label>
            <input
              type="text"
              placeholder="Search by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-3 py-2 text-xs focus:border-amber-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Screen KPIs Banner */}
      <div className="no-print grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <div className="text-[10px] uppercase font-bold text-slate-400">Total Athletes</div>
          <div className="text-xl font-black text-white mt-0.5">{stats.total}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <div className="text-[10px] uppercase font-bold text-emerald-400">Passed / Eligible</div>
          <div className="text-xl font-black text-emerald-400 mt-0.5">{stats.passed}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <div className="text-[10px] uppercase font-bold text-amber-400">Pending Scale</div>
          <div className="text-xl font-black text-amber-400 mt-0.5">{stats.pending}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <div className="text-[10px] uppercase font-bold text-red-400">Overweight</div>
          <div className="text-xl font-black text-red-400 mt-0.5">{stats.overweight}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <div className="text-[10px] uppercase font-bold text-purple-400">Underweight</div>
          <div className="text-xl font-black text-purple-400 mt-0.5">{stats.underweight}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <div className="text-[10px] uppercase font-bold text-cyan-400">Pass Rate</div>
          <div className="text-xl font-black text-cyan-400 mt-0.5">{stats.passRate}%</div>
        </div>
      </div>

      {/* Printable Sheet Canvas Container */}
      <div className="printable-weighin-canvas bg-slate-950 text-slate-100 border border-slate-800 rounded-2xl p-6 sm:p-10 space-y-8 shadow-2xl relative overflow-hidden print:p-0 print:m-0 print:border-none print:bg-white print:text-black">
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
                <div className="text-sm font-black text-white print:text-black">OFFICIAL WEIGH-IN SHEET</div>
                <div className="text-[10px] text-slate-400 print:text-gray-600 font-mono">
                  {isProvisional ? 'PROVISIONAL / PRE-BOUT' : 'FINAL AUTHORITATIVE'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Official Table */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-white print:text-black">
              Official Athlete Weigh-In & Division Verification Register
            </h3>
            <span className="text-xs text-slate-400 print:text-gray-600 font-mono">
              Total Listed: {filteredRegistrations.length}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse border border-slate-800 print:border-black">
              <thead>
                <tr className="bg-slate-900 print:bg-gray-100 border-b border-slate-800 print:border-black text-slate-300 print:text-black text-[10px] uppercase font-bold tracking-wider">
                  <th className="py-2.5 px-3 border-r border-slate-800 print:border-black w-10 text-center">#</th>
                  <th className="py-2.5 px-3 border-r border-slate-800 print:border-black">Athlete Name</th>
                  <th className="py-2.5 px-3 border-r border-slate-800 print:border-black">School / Club</th>
                  <th className="py-2.5 px-3 border-r border-slate-800 print:border-black">Event / Division</th>
                  <th className="py-2.5 px-3 border-r border-slate-800 print:border-black text-center">Role</th>
                  <th className="py-2.5 px-3 border-r border-slate-800 print:border-black text-center">Weight Class</th>
                  <th className="py-2.5 px-3 border-r border-slate-800 print:border-black text-center">Allowance</th>
                  <th className="py-2.5 px-3 border-r border-slate-800 print:border-black text-center font-mono">Scale (kg)</th>
                  <th className="py-2.5 px-3 border-r border-slate-800 print:border-black text-center">Eligibility</th>
                  <th className="py-2.5 px-3 text-center print:w-24">Marshal Signature</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 print:divide-black">
                {filteredRegistrations.map((reg, idx) => {
                  const athleteName = reg.user_profile?.full_name || 'Athlete';
                  const club = reg.team_name || 'Independent Club';
                  const eventName = reg.event?.name || 'Event';
                  const division = reg.event?.division || 'OPEN';
                  const weightClass = reg.event?.weight_class || 'Open Weight';
                  const minW = reg.event?.min_weight;
                  const maxW = reg.event?.max_weight;
                  const recordedW = reg.weigh_in_weight;
                  const requiresWeighIn = reg.event?.rules_override?.requires_weigh_in !== false;
                  const status = getWeighInStatus(recordedW, minW, maxW, requiresWeighIn);
                  const lineup = reg.lineup_role || 'LINEUP';

                  return (
                    <tr key={reg.id} className="hover:bg-slate-900/40 print:hover:bg-transparent">
                      <td className="py-2.5 px-3 border-r border-slate-800 print:border-black text-center text-slate-500 print:text-black font-mono">
                        {idx + 1}
                      </td>
                      <td className="py-2.5 px-3 border-r border-slate-800 print:border-black font-bold text-white print:text-black">
                        {athleteName}
                      </td>
                      <td className="py-2.5 px-3 border-r border-slate-800 print:border-black text-slate-300 print:text-black">
                        {club}
                      </td>
                      <td className="py-2.5 px-3 border-r border-slate-800 print:border-black text-slate-400 print:text-black">
                        <div className="font-semibold text-slate-200 print:text-black">{eventName}</div>
                        <div className="text-[10px] text-slate-500 print:text-gray-600">{division}</div>
                      </td>
                      <td className="py-2.5 px-3 border-r border-slate-800 print:border-black text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          lineup === 'LINEUP' 
                            ? 'bg-amber-500/20 text-amber-300 print:bg-transparent print:text-black' 
                            : lineup === 'RESERVE'
                            ? 'bg-purple-500/20 text-purple-300 print:bg-transparent print:text-black'
                            : 'bg-red-500/20 text-red-300 print:bg-transparent print:text-black'
                        }`}>
                          {lineup}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 border-r border-slate-800 print:border-black text-center text-slate-300 print:text-black font-mono">
                        {weightClass}
                      </td>
                      <td className="py-2.5 px-3 border-r border-slate-800 print:border-black text-center text-[10px] text-slate-400 print:text-black font-mono">
                        {!requiresWeighIn ? 'Exempt' : minW ? `${minW}kg` : '0'} {!requiresWeighIn ? '' : `- ${maxW ? `${maxW}kg` : 'Open'}`}
                      </td>
                      <td className="py-2.5 px-3 border-r border-slate-800 print:border-black text-center font-mono font-bold text-amber-400 print:text-black">
                        {recordedW !== null && recordedW !== undefined ? `${recordedW.toFixed(2)}` : (!requiresWeighIn ? 'N/A' : '—')}
                      </td>
                      <td className="py-2.5 px-3 border-r border-slate-800 print:border-black text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          status === 'PASSED'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 print:bg-transparent print:border-black print:text-black'
                            : status === 'NOT_REQUIRED'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 print:bg-transparent print:border-black print:text-black'
                            : status === 'OVERWEIGHT'
                            ? 'bg-red-500/20 text-red-300 border border-red-500/30 print:bg-transparent print:border-black print:text-black'
                            : status === 'UNDERWEIGHT'
                            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30 print:bg-transparent print:border-black print:text-black'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30 print:bg-transparent print:border-black print:text-black'
                        }`}>
                          {status === 'NOT_REQUIRED' ? 'NOT REQUIRED' : status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center border-slate-800 print:border-black print:h-8">
                        <div className="hidden print:block border-b border-gray-400 w-full h-4 mt-2"></div>
                      </td>
                    </tr>
                  );
                })}

                {filteredRegistrations.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-slate-500 italic">
                      No athletes found matching the selected weigh-in criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Official Signatures Block */}
        <div className="pt-8 border-t border-slate-800 print:border-black grid grid-cols-1 sm:grid-cols-3 gap-8 print:gap-4 print:pt-6">
          <div className="space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 print:text-black">
              Official Weigh-In Marshal
            </div>
            <div className="h-12 border-b-2 border-slate-700 print:border-black"></div>
            <div className="text-[10px] text-slate-500 print:text-gray-600">Printed Name & Signature</div>
          </div>

          <div className="space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 print:text-black">
              Chief Technical Official
            </div>
            <div className="h-12 border-b-2 border-slate-700 print:border-black"></div>
            <div className="text-[10px] text-slate-500 print:text-gray-600">Printed Name & Signature</div>
          </div>

          <div className="space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 print:text-black">
              Tournament Director
            </div>
            <div className="h-12 border-b-2 border-slate-700 print:border-black"></div>
            <div className="text-[10px] text-slate-500 print:text-gray-600">Official Stamp & Date</div>
          </div>
        </div>
      </div>
    </div>
  );
};
