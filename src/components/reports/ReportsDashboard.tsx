import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { tournamentService } from '../../services/tournamentService';
import { reportService } from '../../services/reportService';
import { Tournament } from '../../types/tournament';
import { ResultBookData, CertificateRecipient, ReportSubTab } from '../../types/reports';
import { PrintableResultBook } from './PrintableResultBook';
import { PrintableWeighInSheet } from './PrintableWeighInSheet';
import { PrintableMatchSchedule } from './PrintableMatchSchedule';
import { PrintableClubSummary } from './PrintableClubSummary';
import { CertificateGeneratorModal } from './CertificateGeneratorModal';
import { InteractiveBracketViewer } from '../tournament/InteractiveBracketViewer';
import { NavigationTab } from '../layout/AppLayout';
import { 
  FileText, 
  Award, 
  Users, 
  Download, 
  RefreshCw, 
  Loader2, 
  AlertCircle, 
  CheckCircle2, 
  Trophy, 
  Medal, 
  Printer, 
  FileSpreadsheet, 
  ShieldCheck, 
  Scale, 
  Swords, 
  Building2,
  GitBranch
} from 'lucide-react';

interface ReportsDashboardProps {
  initialTournamentId?: string;
  onNavigateTab?: (tab: NavigationTab) => void;
}

export const ReportsDashboard: React.FC<ReportsDashboardProps> = ({ initialTournamentId, onNavigateTab }) => {
  const { user, profile, roles } = useAuth();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string>(initialTournamentId || '');
  const [activeSubTab, setActiveSubTab] = useState<ReportSubTab>('RESULT_BOOK');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Data payloads
  const [resultBookData, setResultBookData] = useState<ResultBookData | null>(null);
  const [awardCerts, setAwardCerts] = useState<CertificateRecipient[]>([]);
  const [participationCerts, setParticipationCerts] = useState<CertificateRecipient[]>([]);

  // Certificate Modal State
  const [isCertModalOpen, setIsCertModalOpen] = useState(false);

  const isCoach = roles.includes('COACH') && !roles.includes('SUPER_ADMIN') && !roles.includes('ADMIN') && !roles.includes('ORGANIZER');
  const userTeam = (profile?.preferences?.school_club as string) || '';

  useEffect(() => {
    loadTournaments();
  }, []);

  useEffect(() => {
    if (selectedTournamentId) {
      loadReportData(selectedTournamentId);
    }
  }, [selectedTournamentId]);

  const loadTournaments = async () => {
    try {
      const list = await tournamentService.getTournaments();
      setTournaments(list || []);
      if (list && list.length > 0 && !selectedTournamentId) {
        setSelectedTournamentId(initialTournamentId || list[0].id);
      }
    } catch (err: any) {
      console.error('Failed to load tournaments:', err);
      setError(err.message || 'Failed to load tournament list');
    }
  };

  const loadReportData = async (tournamentId: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await reportService.compileResultBookData(tournamentId);
      setResultBookData(data);

      // Generate award & participation certs using authoritative O-35 data
      const awards = reportService.generateAwardCertificates(
        data.eventPodiums,
        data.tournament,
        data.isProvisional
      );
      const parts = reportService.generateParticipationCertificates(
        data.registrations,
        data.tournament,
        data.isProvisional
      );

      setAwardCerts(awards);
      setParticipationCerts(parts);
    } catch (err: any) {
      console.error('Failed to load report data:', err);
      setError(err.message || 'Failed to load report and certificate data.');
    } finally {
      setLoading(false);
    }
  };

  const allCerts = [...awardCerts, ...participationCerts];
  const goldCount = awardCerts.filter((c) => c.medalType === 'GOLD').length;
  const silverCount = awardCerts.filter((c) => c.medalType === 'SILVER').length;
  const bronzeCount = awardCerts.filter((c) => c.medalType === 'BRONZE').length;

  return (
    <div className="space-y-6">
      {/* Header & Tournament Selector */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-4 sm:p-6 rounded-2xl shadow-xl">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="p-3 bg-amber-500/10 text-amber-400 rounded-xl border border-amber-500/20 shrink-0">
            <FileText className="w-6 h-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg sm:text-xl md:text-2xl font-black tracking-tight text-white uppercase break-words">
                Official Reports &amp; Certificates
              </h1>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 shrink-0">
                O-36
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
              Printable Result Books, Weigh-In Sheets, Match Schedules, Club Performance Digests &amp; CSV Data.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto min-w-0">
          <select
            value={selectedTournamentId}
            onChange={(e) => setSelectedTournamentId(e.target.value)}
            className="w-full sm:w-auto sm:max-w-xs md:max-w-sm bg-slate-950 border border-slate-700 text-white rounded-xl px-4 py-2.5 text-xs sm:text-sm font-medium focus:outline-none focus:border-amber-500 min-w-0 truncate"
          >
            {tournaments.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.status})
              </option>
            ))}
          </select>

          <button
            onClick={() => selectedTournamentId && loadReportData(selectedTournamentId)}
            disabled={loading}
            className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl border border-slate-700 transition shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
            title="Refresh Report Data"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-amber-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="no-print flex items-center gap-1.5 sm:gap-2 border-b border-slate-800 overflow-x-auto pb-2 text-xs font-semibold">
        <button
          onClick={() => setActiveSubTab('RESULT_BOOK')}
          className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition flex-shrink-0 ${
            activeSubTab === 'RESULT_BOOK'
              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 font-bold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
          }`}
        >
          <FileText className="w-4 h-4 shrink-0" />
          <span className="hidden xl:inline">Official Result Book</span>
          <span className="xl:hidden">Result Book</span>
        </button>

        <button
          onClick={() => setActiveSubTab('BRACKETS')}
          className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition flex-shrink-0 ${
            activeSubTab === 'BRACKETS'
              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 font-bold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
          }`}
        >
          <GitBranch className="w-4 h-4 shrink-0" />
          <span className="hidden xl:inline">Tournament Brackets</span>
          <span className="xl:hidden">Brackets</span>
        </button>

        <button
          onClick={() => setActiveSubTab('WEIGH_IN_SHEET')}
          className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition flex-shrink-0 ${
            activeSubTab === 'WEIGH_IN_SHEET'
              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 font-bold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
          }`}
        >
          <Scale className="w-4 h-4 shrink-0" />
          <span>Weigh-In Sheet</span>
        </button>

        <button
          onClick={() => setActiveSubTab('MATCH_SCHEDULE')}
          className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition flex-shrink-0 ${
            activeSubTab === 'MATCH_SCHEDULE'
              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 font-bold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
          }`}
        >
          <Swords className="w-4 h-4 shrink-0" />
          <span>Match Schedule</span>
        </button>

        <button
          onClick={() => setActiveSubTab('CLUB_SUMMARY')}
          className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition flex-shrink-0 ${
            activeSubTab === 'CLUB_SUMMARY'
              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 font-bold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
          }`}
        >
          <Building2 className="w-4 h-4 shrink-0" />
          <span>Club Digest</span>
        </button>

        <button
          onClick={() => setActiveSubTab('CERTIFICATES')}
          className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition flex-shrink-0 ${
            activeSubTab === 'CERTIFICATES'
              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 font-bold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
          }`}
        >
          <Award className="w-4 h-4 shrink-0" />
          <span>Certificates Hub</span>
          <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-slate-800 text-slate-300 font-mono">
            {allCerts.length}
          </span>
        </button>

        <button
          onClick={() => setActiveSubTab('DELEGATION_ROSTER')}
          className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition flex-shrink-0 ${
            activeSubTab === 'DELEGATION_ROSTER'
              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 font-bold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
          }`}
        >
          <Users className="w-4 h-4 shrink-0" />
          <span className="hidden xl:inline">Delegation Rosters</span>
          <span className="xl:hidden">Rosters</span>
        </button>

        <button
          onClick={() => setActiveSubTab('CSV_EXPORT')}
          className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition flex-shrink-0 ${
            activeSubTab === 'CSV_EXPORT'
              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 font-bold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
          }`}
        >
          <Download className="w-4 h-4 shrink-0" />
          <span className="hidden xl:inline">Data &amp; CSV Exports</span>
          <span className="xl:hidden">CSV Exports</span>
        </button>
      </div>

      {/* Main Content View */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center space-y-3 bg-slate-900/40 rounded-2xl border border-slate-800 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-amber-400" />
          <span className="text-xs font-mono">Compiling authoritative tournament report...</span>
        </div>
      ) : error ? (
        <div className="p-6 bg-red-950/20 border border-red-900/40 rounded-2xl text-red-300 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-400" />
          <div>
            <h3 className="font-bold text-sm">Error Compiling Report</h3>
            <p className="text-xs text-red-400/90 mt-1">{error}</p>
          </div>
        </div>
      ) : !resultBookData ? (
        <div className="py-16 text-center text-slate-500 bg-slate-900/30 border border-slate-800 rounded-2xl">
          Please select a tournament to view and generate official reports.
        </div>
      ) : (
        <>
          {/* Sub-Tab 1: Result Book */}
          {activeSubTab === 'RESULT_BOOK' && (
            <PrintableResultBook
              data={resultBookData}
              onOpenCertificateModal={() => setIsCertModalOpen(true)}
            />
          )}

          {/* Sub-Tab: Tournament Brackets */}
          {activeSubTab === 'BRACKETS' && (
            <div className="space-y-4">
              <InteractiveBracketViewer
                tournament={resultBookData.tournament}
                canManage={!isCoach}
                onOpenCourtOperations={onNavigateTab ? () => onNavigateTab('competition') : undefined}
                onRefresh={() => loadReportData(selectedTournamentId)}
              />
            </div>
          )}

          {/* Sub-Tab 2: Official Weigh-In Sheet */}
          {activeSubTab === 'WEIGH_IN_SHEET' && (
            <PrintableWeighInSheet data={resultBookData} />
          )}

          {/* Sub-Tab 3: Court Match Schedule */}
          {activeSubTab === 'MATCH_SCHEDULE' && (
            <PrintableMatchSchedule data={resultBookData} />
          )}

          {/* Sub-Tab 4: Club Performance Digest */}
          {activeSubTab === 'CLUB_SUMMARY' && (
            <PrintableClubSummary
              data={resultBookData}
              userRole={isCoach ? 'COACH' : undefined}
              userTeam={userTeam}
            />
          )}

          {/* Sub-Tab 5: Certificates Hub */}
          {activeSubTab === 'CERTIFICATES' && (
            <div className="space-y-6">
              {/* Summary KPIs */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                  <div className="text-[11px] font-bold text-amber-400 uppercase tracking-wider">Gold Awards</div>
                  <div className="text-2xl font-black text-amber-400 mt-1">{goldCount}</div>
                  <div className="text-[10px] text-slate-400">1st Place Certificates</div>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                  <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">Silver Awards</div>
                  <div className="text-2xl font-black text-slate-200 mt-1">{silverCount}</div>
                  <div className="text-[10px] text-slate-400">2nd Place Certificates</div>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                  <div className="text-[11px] font-bold text-amber-600 uppercase tracking-wider">Bronze Awards</div>
                  <div className="text-2xl font-black text-amber-600 mt-1">{bronzeCount}</div>
                  <div className="text-[10px] text-slate-400">3rd Place (Dual/Single)</div>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                  <div className="text-[11px] font-bold text-cyan-400 uppercase tracking-wider">Participation</div>
                  <div className="text-2xl font-black text-cyan-400 mt-1">{participationCerts.length}</div>
                  <div className="text-[10px] text-slate-400">Athletes & Delegates</div>
                </div>
              </div>

              {/* Action Banner */}
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-white">Generate Official UAAPHIL Certificates</h3>
                  <p className="text-xs text-slate-400 max-w-xl mt-0.5">
                    Launch the interactive certificate viewer to preview, filter, and batch print high-resolution certificates with official signatures and verification codes.
                  </p>
                </div>

                <button
                  onClick={() => setIsCertModalOpen(true)}
                  className="flex items-center justify-center gap-2 px-5 py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-amber-600/20 transition flex-shrink-0"
                >
                  <Award className="w-4 h-4" />
                  <span>Launch Certificate Generator ({allCerts.length})</span>
                </button>
              </div>

              {/* Quick Certificate Listing */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h4 className="text-sm font-bold text-white uppercase tracking-wider">
                    Authoritative Certificate Register
                  </h4>
                  <span className="text-xs text-slate-400 font-mono">
                    {allCerts.length} Issued Records
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px]">
                        <th className="py-2.5 px-3 font-bold">Recipient</th>
                        <th className="py-2.5 px-3 font-bold">School / Club</th>
                        <th className="py-2.5 px-3 font-bold">Designation</th>
                        <th className="py-2.5 px-3 font-bold">Event Details</th>
                        <th className="py-2.5 px-3 font-bold font-mono">Verification Code</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-sans">
                      {allCerts.slice(0, 15).map((cert) => (
                        <tr key={cert.id} className="hover:bg-slate-800/30">
                          <td className="py-2.5 px-3 font-bold text-white">{cert.recipientName}</td>
                          <td className="py-2.5 px-3 text-slate-300">{cert.teamName}</td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                cert.medalType === 'GOLD'
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                  : cert.medalType === 'SILVER'
                                  ? 'bg-slate-500/20 text-slate-300 border border-slate-500/30'
                                  : cert.medalType === 'BRONZE'
                                  ? 'bg-amber-800/20 text-amber-600 border border-amber-800/30'
                                  : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                              }`}
                            >
                              {cert.medalType ? `${cert.medalType} MEDAL` : 'PARTICIPATION'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-400 text-[11px]">
                            {cert.eventName || 'Official Tournament Delegate'}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[10px] text-slate-500">
                            {cert.verificationHash}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Sub-Tab 6: Delegation Rosters */}
          {activeSubTab === 'DELEGATION_ROSTER' && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                <div>
                  <h3 className="text-lg font-bold text-white">Delegation Athlete Rosters</h3>
                  <p className="text-xs text-slate-400">
                    Official participant list categorized by delegation, school/club, and lineup status.
                  </p>
                </div>

                <button
                  onClick={() =>
                    reportService.exportDelegationRosterCSV(
                      resultBookData.registrations,
                      resultBookData.tournament.name
                    )
                  }
                  className="flex items-center gap-2 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition"
                >
                  <Download className="w-4 h-4 text-emerald-400" />
                  <span>Export Delegation CSV</span>
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px]">
                      <th className="py-2.5 px-3 font-bold">Athlete Name</th>
                      <th className="py-2.5 px-3 font-bold">School / Delegation</th>
                      <th className="py-2.5 px-3 font-bold text-center">Lineup Role</th>
                      <th className="py-2.5 px-3 font-bold">Division</th>
                      <th className="py-2.5 px-3 font-bold">Weight Class</th>
                      <th className="py-2.5 px-3 font-bold text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-sans">
                    {resultBookData.registrations.map((reg) => {
                      const athleteName = reg.user_profile?.full_name || 'Athlete';
                      const school = reg.team_name || 'Independent Club';
                      const division = reg.event?.division || 'OPEN';
                      const weight = reg.weigh_in_weight ? `${reg.weigh_in_weight} kg` : (reg.event?.weight_class || 'N/A');
                      const lineup = reg.lineup_role || 'LINEUP';

                      return (
                        <tr key={reg.id} className="hover:bg-slate-800/30">
                          <td className="py-2.5 px-3 font-bold text-white">{athleteName}</td>
                          <td className="py-2.5 px-3 text-slate-300">{school}</td>
                          <td className="py-2.5 px-3 text-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              lineup === 'LINEUP' 
                                ? 'bg-amber-500/20 text-amber-300' 
                                : lineup === 'RESERVE'
                                ? 'bg-purple-500/20 text-purple-300'
                                : 'bg-red-500/20 text-red-300'
                            }`}>
                              {lineup}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-400">{division}</td>
                          <td className="py-2.5 px-3 text-slate-400 font-mono">
                            {weight}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                              {reg.is_approved ? 'APPROVED' : 'PENDING'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {resultBookData.registrations.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-500 italic">
                          No registered athletes recorded for this tournament.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Sub-Tab 7: CSV & Data Exports */}
          {activeSubTab === 'CSV_EXPORT' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-amber-500/10 text-amber-400 rounded-xl">
                    <Trophy className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-white text-sm">Team Medal Tally CSV</h4>
                    <p className="text-xs text-slate-400">Olympic ranked gold, silver, bronze counts</p>
                  </div>
                </div>
                <button
                  onClick={() =>
                    reportService.exportMedalTallyCSV(
                      resultBookData.teamTally,
                      resultBookData.tournament.name
                    )
                  }
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                  <span>Download Medal Tally CSV</span>
                </button>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-purple-500/10 text-purple-400 rounded-xl">
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-white text-sm">Athlete Standings CSV</h4>
                    <p className="text-xs text-slate-400">Individual multi-event athlete rankings</p>
                  </div>
                </div>
                <button
                  onClick={() =>
                    reportService.exportAthleteStandingsCSV(
                      resultBookData.athleteStandings,
                      resultBookData.tournament.name
                    )
                  }
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                  <span>Download Athlete Standings CSV</span>
                </button>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-cyan-500/10 text-cyan-400 rounded-xl">
                    <Medal className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-white text-sm">Event Podiums CSV</h4>
                    <p className="text-xs text-slate-400">Full Anyo & Sparring category winners</p>
                  </div>
                </div>
                <button
                  onClick={() =>
                    reportService.exportEventPodiumsCSV(
                      resultBookData.eventPodiums,
                      resultBookData.tournament.name
                    )
                  }
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                  <span>Download Event Podiums CSV</span>
                </button>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-rose-500/10 text-rose-400 rounded-xl">
                    <Swords className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-white text-sm">Match Results CSV</h4>
                    <p className="text-xs text-slate-400">Court-by-court match logs & declared winners</p>
                  </div>
                </div>
                <button
                  onClick={() =>
                    reportService.exportMatchResultsCSV(
                      resultBookData.matches,
                      resultBookData.tournament.name
                    )
                  }
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                  <span>Download Match Results CSV</span>
                </button>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-amber-500/10 text-amber-400 rounded-xl">
                    <Scale className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-white text-sm">Weigh-In Records CSV</h4>
                    <p className="text-xs text-slate-400">Official scale weights & division eligibility</p>
                  </div>
                </div>
                <button
                  onClick={() =>
                    reportService.exportWeighInRecordsCSV(
                      resultBookData.registrations,
                      resultBookData.tournament.name
                    )
                  }
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                  <span>Download Weigh-In CSV</span>
                </button>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-xl">
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-white text-sm">Delegation Roster CSV</h4>
                    <p className="text-xs text-slate-400">Full roster of registered athletes & roles</p>
                  </div>
                </div>
                <button
                  onClick={() =>
                    reportService.exportDelegationRosterCSV(
                      resultBookData.registrations,
                      resultBookData.tournament.name
                    )
                  }
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                  <span>Download Delegation CSV</span>
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Certificate Generator Modal */}
      {resultBookData && (
        <CertificateGeneratorModal
          isOpen={isCertModalOpen}
          onClose={() => setIsCertModalOpen(false)}
          certificates={allCerts}
          tournamentName={resultBookData.tournament.name}
          isProvisional={resultBookData.isProvisional}
          userRole={isCoach ? 'COACH' : undefined}
          userTeam={userTeam}
        />
      )}
    </div>
  );
};

