import React from 'react';
import { ResultBookData } from '../../types/reports';
import { useBranding } from '../../context/BrandingContext';
import { reportService } from '../../services/reportService';
import { 
  Printer, 
  Download, 
  Trophy, 
  Medal, 
  Users, 
  CheckCircle2, 
  AlertTriangle,
  FileSpreadsheet,
  FileCode
} from 'lucide-react';

interface PrintableResultBookProps {
  data: ResultBookData;
  onOpenCertificateModal?: () => void;
}

export const PrintableResultBook: React.FC<PrintableResultBookProps> = ({
  data,
  onOpenCertificateModal,
}) => {
  const { logoUrl } = useBranding();
  const { tournament, summary, teamTally, athleteStandings, eventPodiums, registrations, isProvisional } = data;

  const anyoPodiums = eventPodiums.filter((e) => e.is_anyo);
  const sparringPodiums = eventPodiums.filter((e) => !e.is_anyo);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Top Action Bar - Screen Only */}
      <div className="no-print flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-4 sm:p-6 rounded-2xl">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider ${
                isProvisional
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              }`}
            >
              {isProvisional ? 'Official Provisional Report' : 'Official Final Result Book'}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              Generated {new Date(data.generatedAt).toLocaleDateString()}
            </span>
          </div>
          <h2 className="text-xl font-bold text-white mt-1">Official Tournament Result Book</h2>
          <p className="text-xs text-slate-400">
            A4 print-optimized documentation including medal tallies, podium winners, and athlete standings.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-amber-600/20 transition"
          >
            <Printer className="w-4 h-4" />
            <span>Print Result Book</span>
          </button>

          {onOpenCertificateModal && (
            <button
              onClick={onOpenCertificateModal}
              className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold transition"
            >
              <Medal className="w-4 h-4 text-amber-400" />
              <span>Generate Certificates</span>
            </button>
          )}

          <button
            onClick={() => reportService.exportMedalTallyCSV(teamTally, tournament.name)}
            className="flex items-center gap-1.5 px-3 py-2.5 bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl text-xs font-medium transition"
            title="Download Medal Tally as CSV"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
            <span>CSV Tally</span>
          </button>

          <button
            onClick={() => reportService.exportEventPodiumsCSV(eventPodiums, tournament.name)}
            className="flex items-center gap-1.5 px-3 py-2.5 bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl text-xs font-medium transition"
            title="Download Event Podiums as CSV"
          >
            <Trophy className="w-3.5 h-3.5 text-amber-400" />
            <span>Podiums CSV</span>
          </button>

          <button
            onClick={() => reportService.exportAthleteStandingsCSV(athleteStandings, tournament.name)}
            className="flex items-center gap-1.5 px-3 py-2.5 bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl text-xs font-medium transition"
            title="Download Athlete Standings as CSV"
          >
            <Users className="w-3.5 h-3.5 text-sky-400" />
            <span>Standings CSV</span>
          </button>

          <button
            onClick={() => reportService.exportResultBookJSON(data)}
            className="flex items-center gap-1.5 px-3 py-2.5 bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl text-xs font-medium transition"
            title="Download Complete Result Book as JSON"
          >
            <FileCode className="w-3.5 h-3.5 text-cyan-400" />
            <span>Export JSON</span>
          </button>
        </div>
      </div>

      {/* Printable Result Document Container */}
      <div className="result-book-document bg-slate-950 text-slate-100 border border-slate-800 rounded-2xl p-6 sm:p-10 space-y-10 shadow-2xl relative overflow-hidden">
        {/* Provisional Diagonal Watermark across the document if provisional */}
        {isProvisional && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
            <div className="transform -rotate-45 text-red-500/5 font-black text-7xl sm:text-9xl uppercase tracking-widest border-12 border-red-500/5 px-12 py-6 rounded-3xl select-none">
              PROVISIONAL REPORT
            </div>
          </div>
        )}

        {/* 1. Official Document Header */}
        <div className="border-b border-slate-800 pb-6 relative z-10">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full p-0.5 bg-black border border-amber-500/40 flex items-center justify-center flex-shrink-0 shadow-lg">
                <img
                  src={logoUrl}
                  alt="UAAPhil Logo"
                  className="w-full h-full object-contain rounded-full"
                  referrerPolicy="no-referrer"
                />
              </div>
              <div>
                <div className="text-xs font-black tracking-widest text-amber-400 uppercase">
                  Unified Arnis Association of the Philippines
                </div>
                <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight uppercase">
                  {tournament.name}
                </h1>
                <div className="text-xs text-slate-400 flex flex-wrap items-center gap-2 mt-1">
                  <span>Dates: <strong>{tournament.start_date} to {tournament.end_date}</strong></span>
                  <span>•</span>
                  <span>Status: <strong>{tournament.status}</strong></span>
                  <span>•</span>
                  <span>Discipline: <strong>Arnis (Anyo & Full Contact Sparring)</strong></span>
                </div>
              </div>
            </div>

            <div className="sm:text-right">
              <div className="inline-block px-3 py-1 rounded bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-300">
                Doc Ref: {tournament.slug.toUpperCase()}-RB
              </div>
              <div className="text-[10px] text-slate-500 mt-1 font-mono">
                {isProvisional ? 'PRELIMINARY STANDINGS' : 'AUTHORITATIVE FINAL RECORD'}
              </div>
            </div>
          </div>
        </div>

        {/* 2. Executive Summary Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 relative z-10">
          <div className="bg-slate-900/60 border border-slate-800/80 p-4 rounded-xl">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Competition Events</div>
            <div className="text-2xl font-black text-white mt-1">
              {summary.finalized_events} <span className="text-sm font-normal text-slate-500">/ {summary.total_events}</span>
            </div>
            <div className="text-[10px] text-emerald-400 font-mono mt-0.5">
              {summary.finalized_events === summary.total_events ? '100% Completed' : `${summary.total_events - summary.finalized_events} In Progress`}
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/80 p-4 rounded-xl">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Medals Awarded</div>
            <div className="text-2xl font-black text-amber-400 mt-1">{summary.total_medals_awarded}</div>
            <div className="text-[10px] text-slate-400 font-mono mt-0.5">Gold, Silver & Bronze</div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/80 p-4 rounded-xl">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Delegations / Clubs</div>
            <div className="text-2xl font-black text-cyan-400 mt-1">{teamTally.length}</div>
            <div className="text-[10px] text-slate-400 font-mono mt-0.5">Participating Teams</div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/80 p-4 rounded-xl">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Registered Athletes</div>
            <div className="text-2xl font-black text-purple-400 mt-1">{summary.total_participants}</div>
            <div className="text-[10px] text-slate-400 font-mono mt-0.5">Official Competitors</div>
          </div>
        </div>

        {/* 3. Official Olympic Team Medal Tally */}
        <div className="space-y-3 relative z-10 page-break-inside-avoid">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-400" />
              <h3 className="text-base font-bold text-white uppercase tracking-tight">
                Team & Delegation Medal Tally (Olympic Standard)
              </h3>
            </div>
            <span className="text-xs text-slate-400">Ranked by Gold → Silver → Bronze</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px]">
                  <th className="py-2.5 px-3 w-16 text-center font-bold">Rank</th>
                  <th className="py-2.5 px-3 font-bold">Team / School Club</th>
                  <th className="py-2.5 px-3 text-center font-bold text-amber-400">Gold</th>
                  <th className="py-2.5 px-3 text-center font-bold text-slate-300">Silver</th>
                  <th className="py-2.5 px-3 text-center font-bold text-amber-600">Bronze</th>
                  <th className="py-2.5 px-3 text-center font-bold text-white">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {teamTally.map((t, idx) => (
                  <tr
                    key={t.team_name}
                    className={`hover:bg-slate-900/40 transition ${
                      idx < 3 ? 'bg-slate-900/20' : ''
                    }`}
                  >
                    <td className="py-2.5 px-3 text-center font-bold">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[11px] ${
                          idx === 0
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            : idx === 1
                            ? 'bg-slate-500/20 text-slate-300 border border-slate-500/30'
                            : idx === 2
                            ? 'bg-amber-800/20 text-amber-600 border border-amber-800/30'
                            : 'text-slate-400'
                        }`}
                      >
                        {t.rank_display}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-sans font-semibold text-slate-200">
                      {t.team_name}
                    </td>
                    <td className="py-2.5 px-3 text-center font-bold text-amber-400">{t.gold_count}</td>
                    <td className="py-2.5 px-3 text-center font-bold text-slate-300">{t.silver_count}</td>
                    <td className="py-2.5 px-3 text-center font-bold text-amber-600">{t.bronze_count}</td>
                    <td className="py-2.5 px-3 text-center font-black text-white text-sm">
                      {t.total_medals}
                    </td>
                  </tr>
                ))}
                {teamTally.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-slate-500 font-sans italic">
                      No finalized team results recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 4. Event Podiums: Anyo Division Results */}
        {anyoPodiums.length > 0 && (
          <div className="space-y-3 relative z-10 page-break-inside-avoid">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2">
                <Medal className="w-5 h-5 text-cyan-400" />
                <h3 className="text-base font-bold text-white uppercase tracking-tight">
                  Anyo Category Podium Results
                </h3>
              </div>
              <span className="text-xs text-slate-400">{anyoPodiums.length} Form Events</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px]">
                    <th className="py-2.5 px-3 font-bold">Event & Division</th>
                    <th className="py-2.5 px-3 font-bold text-amber-400">Gold Medalist</th>
                    <th className="py-2.5 px-3 font-bold text-slate-300">Silver Medalist</th>
                    <th className="py-2.5 px-3 font-bold text-amber-600">Bronze Medalist</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {anyoPodiums.map((podium) => (
                    <tr key={podium.event_id} className="hover:bg-slate-900/40">
                      <td className="py-3 px-3">
                        <div className="font-bold text-slate-200">{podium.event_name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {podium.gender_category || 'OPEN'} • {podium.weight_category || 'ANYO'}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        {podium.gold_winner ? (
                          <div>
                            <div className="font-bold text-amber-400">{podium.gold_winner.athlete_name}</div>
                            <div className="text-[10px] text-slate-400">{podium.gold_winner.team_name}</div>
                            {podium.gold_winner.final_score && (
                              <div className="text-[9px] font-mono text-amber-500/80">
                                Score: {podium.gold_winner.final_score}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-500 italic">—</span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        {podium.silver_winner ? (
                          <div>
                            <div className="font-bold text-slate-300">{podium.silver_winner.athlete_name}</div>
                            <div className="text-[10px] text-slate-400">{podium.silver_winner.team_name}</div>
                            {podium.silver_winner.final_score && (
                              <div className="text-[9px] font-mono text-slate-400">
                                Score: {podium.silver_winner.final_score}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-500 italic">—</span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        {podium.bronze_winners && podium.bronze_winners.length > 0 ? (
                          <div className="space-y-1">
                            {podium.bronze_winners.map((bronze, i) => (
                              <div key={i}>
                                <div className="font-bold text-amber-600">{bronze.athlete_name}</div>
                                <div className="text-[10px] text-slate-400">{bronze.team_name}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-500 italic">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 5. Event Podiums: Full Contact Sparring Division Results */}
        {sparringPodiums.length > 0 && (
          <div className="space-y-3 relative z-10 page-break-inside-avoid">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2">
                <Medal className="w-5 h-5 text-red-400" />
                <h3 className="text-base font-bold text-white uppercase tracking-tight">
                  Full Contact Sparring Podium Results
                </h3>
              </div>
              <span className="text-xs text-slate-400">{sparringPodiums.length} Combat Brackets</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px]">
                    <th className="py-2.5 px-3 font-bold">Division & Weight</th>
                    <th className="py-2.5 px-3 font-bold text-amber-400">Gold Medalist</th>
                    <th className="py-2.5 px-3 font-bold text-slate-300">Silver Medalist</th>
                    <th className="py-2.5 px-3 font-bold text-amber-600">Bronze Medalist(s)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {sparringPodiums.map((podium) => (
                    <tr key={podium.event_id} className="hover:bg-slate-900/40">
                      <td className="py-3 px-3">
                        <div className="font-bold text-slate-200">{podium.event_name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {podium.gender_category || 'OPEN'} • {podium.weight_category || 'SPARRING'}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        {podium.gold_winner ? (
                          <div>
                            <div className="font-bold text-amber-400">{podium.gold_winner.athlete_name}</div>
                            <div className="text-[10px] text-slate-400">{podium.gold_winner.team_name}</div>
                          </div>
                        ) : (
                          <span className="text-slate-500 italic">—</span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        {podium.silver_winner ? (
                          <div>
                            <div className="font-bold text-slate-300">{podium.silver_winner.athlete_name}</div>
                            <div className="text-[10px] text-slate-400">{podium.silver_winner.team_name}</div>
                          </div>
                        ) : (
                          <span className="text-slate-500 italic">—</span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        {podium.bronze_winners && podium.bronze_winners.length > 0 ? (
                          <div className="space-y-1.5">
                            {podium.bronze_winners.map((bronze, i) => (
                              <div key={i}>
                                <div className="font-bold text-amber-600">{bronze.athlete_name}</div>
                                <div className="text-[10px] text-slate-400">{bronze.team_name}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-500 italic">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 6. Top Individual Athlete Standings */}
        {athleteStandings.length > 0 && (
          <div className="space-y-3 relative z-10 page-break-inside-avoid">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-purple-400" />
                <h3 className="text-base font-bold text-white uppercase tracking-tight">
                  Top Individual Athlete Standings
                </h3>
              </div>
              <span className="text-xs text-slate-400">Multi-event medalists</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px]">
                    <th className="py-2.5 px-3 w-16 text-center font-bold">Rank</th>
                    <th className="py-2.5 px-3 font-bold">Athlete Name</th>
                    <th className="py-2.5 px-3 font-bold">School / Club</th>
                    <th className="py-2.5 px-3 text-center font-bold text-amber-400">Gold</th>
                    <th className="py-2.5 px-3 text-center font-bold text-slate-300">Silver</th>
                    <th className="py-2.5 px-3 text-center font-bold text-amber-600">Bronze</th>
                    <th className="py-2.5 px-3 text-center font-bold text-white">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {athleteStandings.slice(0, 10).map((a, idx) => (
                    <tr key={a.athlete_id || idx} className="hover:bg-slate-900/40">
                      <td className="py-2.5 px-3 text-center font-bold text-slate-400">
                        {a.rank_display}
                      </td>
                      <td className="py-2.5 px-3 font-sans font-bold text-slate-200">
                        {a.athlete_name}
                      </td>
                      <td className="py-2.5 px-3 font-sans text-slate-400">{a.team_name}</td>
                      <td className="py-2.5 px-3 text-center font-bold text-amber-400">{a.gold_count}</td>
                      <td className="py-2.5 px-3 text-center font-bold text-slate-300">{a.silver_count}</td>
                      <td className="py-2.5 px-3 text-center font-bold text-amber-600">{a.bronze_count}</td>
                      <td className="py-2.5 px-3 text-center font-black text-white">{a.total_medals}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 7. Official Sign-off & Certification Block */}
        <div className="border-t border-slate-800 pt-8 mt-12 relative z-10 page-break-inside-avoid">
          <div className="text-center max-w-2xl mx-auto mb-8">
            <div className="text-xs font-bold uppercase tracking-widest text-slate-300">
              Official Certification of Tournament Results
            </div>
            <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
              We hereby certify that the scores, brackets, match outcomes, and medal standings recorded in this Official Result Book represent the authoritative competition proceedings conducted under the rules of UAAPHIL.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
            <div>
              <div className="h-10 flex items-end justify-center mb-1">
                <span className="font-serif italic text-xs text-slate-500">Official Signature</span>
              </div>
              <div className="border-t border-slate-700 w-44 mx-auto" />
              <div className="text-xs font-bold text-slate-200 uppercase mt-1">Tournament Director</div>
              <div className="text-[10px] text-slate-500">Organizing Committee</div>
            </div>

            <div>
              <div className="h-10 flex items-end justify-center mb-1">
                <span className="font-serif italic text-xs text-slate-500">Official Signature</span>
              </div>
              <div className="border-t border-slate-700 w-44 mx-auto" />
              <div className="text-xs font-bold text-slate-200 uppercase mt-1">Chief Referee</div>
              <div className="text-[10px] text-slate-500">Technical Officials Panel</div>
            </div>

            <div>
              <div className="h-10 flex items-end justify-center mb-1">
                <span className="font-serif italic text-xs text-slate-500">Official Signature</span>
              </div>
              <div className="border-t border-slate-700 w-44 mx-auto" />
              <div className="text-xs font-bold text-slate-200 uppercase mt-1">UAAPHIL President</div>
              <div className="text-[10px] text-slate-500">Board of Directors</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
