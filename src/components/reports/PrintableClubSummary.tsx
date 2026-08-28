import React, { useState, useMemo } from 'react';
import { ResultBookData } from '../../types/reports';
import { useBranding } from '../../context/BrandingContext';
import { reportService } from '../../services/reportService';
import { getWeighInStatus } from '../registration/RegistrationManagementView';
import { 
  Printer, 
  Download, 
  Users, 
  Trophy, 
  Medal, 
  Swords, 
  ShieldCheck, 
  FileSpreadsheet, 
  Building2,
  CheckCircle2
} from 'lucide-react';

interface PrintableClubSummaryProps {
  data: ResultBookData;
  userRole?: string;
  userTeam?: string;
}

export const PrintableClubSummary: React.FC<PrintableClubSummaryProps> = ({
  data,
  userRole,
  userTeam,
}) => {
  const { logoUrl } = useBranding();
  const { tournament, registrations, matches, eventPodiums, teamTally, isProvisional } = data;

  const isCoach = userRole === 'COACH';

  // Extract unique clubs from registrations
  const availableClubs = useMemo(() => {
    const set = new Set<string>();
    registrations.forEach((r) => {
      if (r.team_name) set.add(r.team_name);
    });
    return Array.from(set).sort();
  }, [registrations]);

  // Initial selected club: if coach, use userTeam; otherwise first available club
  const [selectedClub, setSelectedClub] = useState<string>(() => {
    if (isCoach && userTeam) return userTeam;
    return availableClubs[0] || '';
  });

  // Filter club registrations
  const clubRegistrations = useMemo(() => {
    if (!selectedClub) return [];
    return registrations.filter(
      (r) => (r.team_name || '').toLowerCase() === selectedClub.toLowerCase()
    );
  }, [registrations, selectedClub]);

  const clubRegIds = useMemo(() => {
    return new Set(clubRegistrations.map((r) => r.id));
  }, [clubRegistrations]);

  // Filter club matches
  const clubMatches = useMemo(() => {
    if (!selectedClub) return [];
    return matches.filter(
      (m) =>
        (m.red_corner_registration_id && clubRegIds.has(m.red_corner_registration_id)) ||
        (m.blue_corner_registration_id && clubRegIds.has(m.blue_corner_registration_id))
    );
  }, [matches, clubRegIds, selectedClub]);

  // Compute club podiums & medals from authoritative O-35 podiums
  const clubPodiumMedals = useMemo(() => {
    const list: Array<{
      eventName: string;
      category: string;
      division: string;
      medalType: 'GOLD' | 'SILVER' | 'BRONZE';
      athleteName: string;
    }> = [];

    eventPodiums.forEach((pod) => {
      const eventName = pod.event_name;
      const category = pod.is_anyo ? 'ANYO' : 'SPARRING';
      const division = pod.weight_category || 'OPEN';

      if (pod.gold_winner && (pod.gold_winner.team_name || '').toLowerCase() === selectedClub.toLowerCase()) {
        list.push({
          eventName,
          category,
          division,
          medalType: 'GOLD',
          athleteName: pod.gold_winner.athlete_name,
        });
      }
      if (pod.silver_winner && (pod.silver_winner.team_name || '').toLowerCase() === selectedClub.toLowerCase()) {
        list.push({
          eventName,
          category,
          division,
          medalType: 'SILVER',
          athleteName: pod.silver_winner.athlete_name,
        });
      }
      pod.bronze_winners?.forEach((b) => {
        if ((b.team_name || '').toLowerCase() === selectedClub.toLowerCase()) {
          list.push({
            eventName,
            category,
            division,
            medalType: 'BRONZE',
            athleteName: b.athlete_name,
          });
        }
      });
    });

    return list;
  }, [eventPodiums, selectedClub]);

  // Club summary KPIs
  const clubKPIs = useMemo(() => {
    const totalAthletes = new Set(clubRegistrations.map((r) => r.user_id)).size;
    const eventsEntered = new Set(clubRegistrations.map((r) => r.event_id)).size;

    const completedMatches = clubMatches.filter((m) => m.status === 'COMPLETED');
    let wins = 0;
    let losses = 0;

    completedMatches.forEach((m) => {
      if (m.winner_registration_id && clubRegIds.has(m.winner_registration_id)) {
        wins++;
      } else {
        losses++;
      }
    });

    const totalBouts = wins + losses;
    const winRate = totalBouts > 0 ? Math.round((wins / totalBouts) * 100) : 0;

    // Get medal counts from team tally if available, or derived from podiums
    const tallyRecord = teamTally.find((t) => t.team_name.toLowerCase() === selectedClub.toLowerCase());
    const gold = tallyRecord ? tallyRecord.gold_count : clubPodiumMedals.filter((m) => m.medalType === 'GOLD').length;
    const silver = tallyRecord ? tallyRecord.silver_count : clubPodiumMedals.filter((m) => m.medalType === 'SILVER').length;
    const bronze = tallyRecord ? tallyRecord.bronze_count : clubPodiumMedals.filter((m) => m.medalType === 'BRONZE').length;
    const totalMedals = gold + silver + bronze;
    const rank = tallyRecord ? tallyRecord.rank_display : '—';

    return {
      totalAthletes,
      eventsEntered,
      totalBouts,
      wins,
      losses,
      winRate,
      gold,
      silver,
      bronze,
      totalMedals,
      rank,
    };
  }, [clubRegistrations, clubMatches, clubRegIds, teamTally, clubPodiumMedals, selectedClub]);

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
              {isProvisional ? 'Provisional Team Digest' : 'Official Delegation Record'}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              Generated {new Date(data.generatedAt).toLocaleDateString()}
            </span>
          </div>
          <h2 className="text-xl font-black text-white uppercase tracking-tight mt-1 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-amber-400" />
            Club / Delegation Performance Digest
          </h2>
          <p className="text-xs text-slate-400">
            Authoritative performance report for coaches and delegation leaders covering entered athletes, match records, and podium placements.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Club selector for admins / multiple teams */}
          {!isCoach && (
            <select
              value={selectedClub}
              onChange={(e) => setSelectedClub(e.target.value)}
              className="bg-slate-950 border border-slate-700 text-white rounded-xl px-3 py-2 text-xs font-semibold focus:border-amber-500 focus:outline-none min-w-[200px]"
            >
              {availableClubs.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}

          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-amber-600/20 transition"
          >
            <Printer className="w-4 h-4" />
            <span>Print Club Digest</span>
          </button>

          <button
            onClick={() =>
              reportService.exportClubSummaryCSV(
                selectedClub,
                registrations,
                matches,
                eventPodiums,
                tournament.name
              )
            }
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold transition"
            title="Download CSV"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Screen KPIs Banner */}
      <div className="no-print grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <div className="text-[10px] uppercase font-bold text-slate-400">Overall Rank</div>
          <div className="text-xl font-black text-amber-400 mt-0.5">{clubKPIs.rank}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <div className="text-[10px] uppercase font-bold text-slate-400">Athletes</div>
          <div className="text-xl font-black text-white mt-0.5">{clubKPIs.totalAthletes}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <div className="text-[10px] uppercase font-bold text-slate-400">Events Entered</div>
          <div className="text-xl font-black text-white mt-0.5">{clubKPIs.eventsEntered}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <div className="text-[10px] uppercase font-bold text-slate-400">Match Record</div>
          <div className="text-xl font-black text-white mt-0.5">
            {clubKPIs.wins}W - {clubKPIs.losses}L
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <div className="text-[10px] uppercase font-bold text-cyan-400">Win Rate</div>
          <div className="text-xl font-black text-cyan-400 mt-0.5">{clubKPIs.winRate}%</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <div className="text-[10px] uppercase font-bold text-amber-400">Gold / Silver / Bronze</div>
          <div className="text-xl font-black text-white mt-0.5">
            {clubKPIs.gold} / {clubKPIs.silver} / {clubKPIs.bronze}
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <div className="text-[10px] uppercase font-bold text-amber-500">Total Medals</div>
          <div className="text-xl font-black text-amber-400 mt-0.5">{clubKPIs.totalMedals}</div>
        </div>
      </div>

      {/* Printable Sheet Canvas Container */}
      <div className="printable-club-canvas bg-slate-950 text-slate-100 border border-slate-800 rounded-2xl p-6 sm:p-10 space-y-8 shadow-2xl relative overflow-hidden print:p-0 print:m-0 print:border-none print:bg-white print:text-black">
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
                <div className="text-[10px] font-black uppercase text-amber-400 print:text-black">Delegation Report</div>
                <div className="text-sm font-black text-white print:text-black uppercase">{selectedClub || 'Official Club'}</div>
                <div className="text-[10px] text-slate-400 print:text-gray-600 font-mono">
                  {isProvisional ? 'PROVISIONAL SUMMARY' : 'FINAL DELEGATION DIGEST'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Section 1: Delegation Athletes Roster */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-white print:text-black flex items-center gap-2">
              <Users className="w-4 h-4 text-amber-400 print:text-black" />
              Delegation Athletes Roster & Event Entries
            </h3>
            <span className="text-xs text-slate-400 print:text-gray-600 font-mono">
              {clubRegistrations.length} Total Entries
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse border border-slate-800 print:border-black">
              <thead>
                <tr className="bg-slate-900 print:bg-gray-100 border-b border-slate-800 print:border-black text-slate-300 print:text-black text-[10px] uppercase font-bold tracking-wider">
                  <th className="py-2.5 px-3 border-r border-slate-800 print:border-black w-10 text-center">#</th>
                  <th className="py-2.5 px-3 border-r border-slate-800 print:border-black">Athlete Name</th>
                  <th className="py-2.5 px-3 border-r border-slate-800 print:border-black">Event Name</th>
                  <th className="py-2.5 px-3 border-r border-slate-800 print:border-black text-center">Division</th>
                  <th className="py-2.5 px-3 border-r border-slate-800 print:border-black text-center">Weight Class</th>
                  <th className="py-2.5 px-3 border-r border-slate-800 print:border-black text-center">Role</th>
                  <th className="py-2.5 px-3 text-center">Weigh-In Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 print:divide-black">
                {clubRegistrations.map((reg, idx) => {
                  const athleteName = reg.user_profile?.full_name || 'Athlete';
                  const eventName = reg.event?.name || 'Event';
                  const division = reg.event?.division || 'OPEN';
                  const weightClass = reg.event?.weight_class || 'Open Weight';
                  const lineup = reg.lineup_role || 'LINEUP';
                  const minW = reg.event?.min_weight;
                  const maxW = reg.event?.max_weight;
                  const status = getWeighInStatus(reg.weigh_in_weight, minW, maxW);

                  return (
                    <tr key={reg.id} className="hover:bg-slate-900/40 print:hover:bg-transparent">
                      <td className="py-2.5 px-3 border-r border-slate-800 print:border-black text-center text-slate-500 print:text-black font-mono">
                        {idx + 1}
                      </td>
                      <td className="py-2.5 px-3 border-r border-slate-800 print:border-black font-bold text-white print:text-black">
                        {athleteName}
                      </td>
                      <td className="py-2.5 px-3 border-r border-slate-800 print:border-black text-slate-300 print:text-black">
                        {eventName}
                      </td>
                      <td className="py-2.5 px-3 border-r border-slate-800 print:border-black text-center text-slate-400 print:text-black">
                        {division}
                      </td>
                      <td className="py-2.5 px-3 border-r border-slate-800 print:border-black text-center font-mono text-slate-300 print:text-black">
                        {weightClass}
                      </td>
                      <td className="py-2.5 px-3 border-r border-slate-800 print:border-black text-center">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 print:bg-transparent print:text-black">
                          {lineup}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          status === 'PASSED'
                            ? 'bg-emerald-500/20 text-emerald-300 print:bg-transparent print:text-black'
                            : 'bg-amber-500/20 text-amber-300 print:bg-transparent print:text-black'
                        }`}>
                          {status}
                        </span>
                      </td>
                    </tr>
                  );
                })}

                {clubRegistrations.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500 italic">
                      No athletes registered under this club.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Section 2: Club Podium Medals */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-white print:text-black flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-400 print:text-black" />
              Podium Placements & Medal Accomplishments
            </h3>
            <span className="text-xs text-slate-400 print:text-gray-600 font-mono">
              {clubPodiumMedals.length} Medals Won
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse border border-slate-800 print:border-black">
              <thead>
                <tr className="bg-slate-900 print:bg-gray-100 border-b border-slate-800 print:border-black text-slate-300 print:text-black text-[10px] uppercase font-bold tracking-wider">
                  <th className="py-2.5 px-3 border-r border-slate-800 print:border-black w-24 text-center">Medal</th>
                  <th className="py-2.5 px-3 border-r border-slate-800 print:border-black">Athlete Name</th>
                  <th className="py-2.5 px-3 border-r border-slate-800 print:border-black">Event Name</th>
                  <th className="py-2.5 px-3 border-r border-slate-800 print:border-black text-center">Discipline</th>
                  <th className="py-2.5 px-3 text-center">Division / Weight</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 print:divide-black">
                {clubPodiumMedals.map((med, idx) => (
                  <tr key={idx} className="hover:bg-slate-900/40 print:hover:bg-transparent">
                    <td className="py-2.5 px-3 border-r border-slate-800 print:border-black text-center">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        med.medalType === 'GOLD'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 print:bg-transparent print:border-black print:text-black'
                          : med.medalType === 'SILVER'
                          ? 'bg-slate-500/20 text-slate-300 border border-slate-500/30 print:bg-transparent print:border-black print:text-black'
                          : 'bg-amber-800/20 text-amber-600 border border-amber-800/30 print:bg-transparent print:border-black print:text-black'
                      }`}>
                        {med.medalType} MEDAL
                      </span>
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-800 print:border-black font-bold text-white print:text-black">
                      {med.athleteName}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-800 print:border-black text-slate-300 print:text-black">
                      {med.eventName}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-800 print:border-black text-center text-slate-400 print:text-black">
                      {med.category}
                    </td>
                    <td className="py-2.5 px-3 text-center text-slate-300 print:text-black font-mono">
                      {med.division}
                    </td>
                  </tr>
                ))}

                {clubPodiumMedals.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500 italic">
                      No podium finishes recorded yet for this club.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Section 3: Completed Match Bout Log */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-white print:text-black flex items-center gap-2">
              <Swords className="w-4 h-4 text-amber-400 print:text-black" />
              Tournament Bout Log & Competition Results
            </h3>
            <span className="text-xs text-slate-400 print:text-gray-600 font-mono">
              {clubMatches.length} Matches Contested
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse border border-slate-800 print:border-black">
              <thead>
                <tr className="bg-slate-900 print:bg-gray-100 border-b border-slate-800 print:border-black text-slate-300 print:text-black text-[10px] uppercase font-bold tracking-wider">
                  <th className="py-2.5 px-3 border-r border-slate-800 print:border-black w-10 text-center">#</th>
                  <th className="py-2.5 px-3 border-r border-slate-800 print:border-black">Event / Division</th>
                  <th className="py-2.5 px-3 border-r border-slate-800 print:border-black text-center">Round</th>
                  <th className="py-2.5 px-3 border-r border-slate-800 print:border-black">Club Athlete</th>
                  <th className="py-2.5 px-3 border-r border-slate-800 print:border-black">Opponent Athlete</th>
                  <th className="py-2.5 px-3 border-r border-slate-800 print:border-black text-center">Result</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 print:divide-black">
                {clubMatches.map((m, idx) => {
                  const isRedClub = m.red_corner_registration_id && clubRegIds.has(m.red_corner_registration_id);
                  const clubAthlete = isRedClub 
                    ? m.red_registration?.user_profile?.full_name || 'Club Athlete'
                    : m.blue_registration?.user_profile?.full_name || 'Club Athlete';
                  const oppAthlete = isRedClub
                    ? `${m.blue_registration?.user_profile?.full_name || 'TBD'} (${m.blue_registration?.team_name || 'Opponent'})`
                    : `${m.red_registration?.user_profile?.full_name || 'TBD'} (${m.red_registration?.team_name || 'Opponent'})`;

                  const isWinner = m.winner_registration_id && clubRegIds.has(m.winner_registration_id);
                  const isCompleted = m.status === 'COMPLETED';

                  return (
                    <tr key={m.id} className="hover:bg-slate-900/40 print:hover:bg-transparent">
                      <td className="py-2.5 px-3 border-r border-slate-800 print:border-black text-center text-slate-500 print:text-black font-mono">
                        {idx + 1}
                      </td>
                      <td className="py-2.5 px-3 border-r border-slate-800 print:border-black">
                        <div className="font-bold text-white print:text-black">{m.event?.name || 'Sparring'}</div>
                        <div className="text-[10px] text-slate-500 print:text-gray-600">{typeof m.event?.division === 'string' ? m.event.division : 'OPEN'}</div>
                      </td>
                      <td className="py-2.5 px-3 border-r border-slate-800 print:border-black text-center font-semibold text-slate-300 print:text-black">
                        {m.round_name || `Round ${m.round_number || idx + 1}`}
                      </td>
                      <td className="py-2.5 px-3 border-r border-slate-800 print:border-black font-bold text-white print:text-black">
                        {clubAthlete}
                      </td>
                      <td className="py-2.5 px-3 border-r border-slate-800 print:border-black text-slate-400 print:text-black">
                        {oppAthlete}
                      </td>
                      <td className="py-2.5 px-3 border-r border-slate-800 print:border-black text-center">
                        {isCompleted ? (
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            isWinner
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 print:bg-transparent print:border-black print:text-black'
                              : 'bg-red-500/20 text-red-300 border border-red-500/30 print:bg-transparent print:border-black print:text-black'
                          }`}>
                            {isWinner ? 'WIN' : 'LOSS'}
                          </span>
                        ) : (
                          <span className="text-slate-500 print:text-gray-600 italic text-[10px]">PENDING</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className="text-[10px] font-semibold text-slate-400 print:text-black">
                          {m.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}

                {clubMatches.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500 italic">
                      No matches contested yet by this club.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Official Signatures Block */}
        <div className="pt-8 border-t border-slate-800 print:border-black grid grid-cols-1 sm:grid-cols-2 gap-8 print:gap-4 print:pt-6">
          <div className="space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 print:text-black">
              Head Coach / Team Delegation Representative
            </div>
            <div className="h-12 border-b-2 border-slate-700 print:border-black"></div>
            <div className="text-[10px] text-slate-500 print:text-gray-600">Printed Name & Signature</div>
          </div>

          <div className="space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 print:text-black">
              Tournament Secretary / Records Officer
            </div>
            <div className="h-12 border-b-2 border-slate-700 print:border-black"></div>
            <div className="text-[10px] text-slate-500 print:text-gray-600">Official Stamp & Date</div>
          </div>
        </div>
      </div>
    </div>
  );
};
