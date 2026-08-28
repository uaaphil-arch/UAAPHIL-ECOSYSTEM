import React, { useState } from 'react';
import { CertificateRecipient } from '../../types/reports';
import { useBranding } from '../../context/BrandingContext';
import { 
  X, 
  Printer, 
  ChevronLeft, 
  ChevronRight, 
  Award, 
  Medal, 
  Search, 
  ShieldCheck, 
  Filter, 
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

interface CertificateGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  certificates: CertificateRecipient[];
  tournamentName: string;
  isProvisional: boolean;
  defaultRecipientId?: string;
  userRole?: string;
  userTeam?: string;
}

export const CertificateGeneratorModal: React.FC<CertificateGeneratorModalProps> = ({
  isOpen,
  onClose,
  certificates,
  tournamentName,
  isProvisional,
  defaultRecipientId,
  userRole,
  userTeam,
}) => {
  const { logoUrl } = useBranding();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [filterType, setFilterType] = useState<string>('ALL');
  const [filterTeam, setFilterTeam] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isBatchPrinting, setIsBatchPrinting] = useState(false);

  if (!isOpen) return null;

  // Filter certificates based on role (Coaches can only see their own club)
  let accessibleCerts = certificates;
  if (userRole === 'COACH' && userTeam) {
    accessibleCerts = accessibleCerts.filter(
      (c) => c.teamName.toLowerCase() === userTeam.toLowerCase()
    );
  }

  // Apply UI filters
  const filteredCerts = accessibleCerts.filter((cert) => {
    // Type filter
    if (filterType === 'GOLD' && cert.medalType !== 'GOLD') return false;
    if (filterType === 'SILVER' && cert.medalType !== 'SILVER') return false;
    if (filterType === 'BRONZE' && cert.medalType !== 'BRONZE') return false;
    if (filterType === 'PARTICIPATION' && cert.certificateType !== 'PARTICIPATION') return false;
    if (filterType === 'AWARD' && cert.certificateType !== 'AWARD') return false;

    // Team filter
    if (filterTeam !== 'ALL' && cert.teamName !== filterTeam) return false;

    // Search query
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchName = cert.recipientName.toLowerCase().includes(q);
      const matchTeam = cert.teamName.toLowerCase().includes(q);
      const matchEvent = (cert.eventName || '').toLowerCase().includes(q);
      if (!matchName && !matchTeam && !matchEvent) return false;
    }

    return true;
  });

  const currentCert = filteredCerts[currentIndex] || filteredCerts[0];

  const uniqueTeams = Array.from(new Set(accessibleCerts.map((c) => c.teamName))).sort();

  const handlePrintSingle = () => {
    setIsBatchPrinting(false);
    setTimeout(() => {
      window.print();
    }, 100);
  };

  const handlePrintBatch = () => {
    setIsBatchPrinting(true);
    setTimeout(() => {
      window.print();
    }, 100);
  };

  const getMedalColor = (medal?: string) => {
    switch (medal) {
      case 'GOLD':
        return {
          border: 'border-amber-400',
          text: 'text-amber-400',
          bg: 'bg-amber-500/10',
          label: 'FIRST PLACE (GOLD MEDALIST)',
        };
      case 'SILVER':
        return {
          border: 'border-slate-300',
          text: 'text-slate-200',
          bg: 'bg-slate-500/10',
          label: 'SECOND PLACE (SILVER MEDALIST)',
        };
      case 'BRONZE':
        return {
          border: 'border-amber-700',
          text: 'text-amber-600',
          bg: 'bg-amber-700/10',
          label: 'THIRD PLACE (BRONZE MEDALIST)',
        };
      default:
        return {
          border: 'border-cyan-500',
          text: 'text-cyan-400',
          bg: 'bg-cyan-500/10',
          label: 'OFFICIAL PARTICIPANT',
        };
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4">
      {/* Container */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-5xl overflow-hidden shadow-2xl flex flex-col max-h-[95vh]">
        {/* Header - Screen Only */}
        <div className="no-print p-4 sm:p-6 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500/10 text-amber-400 rounded-xl border border-amber-500/20">
              <Award className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight flex items-center gap-2">
                Official Certificate Generator
                {isProvisional && (
                  <span className="text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    Provisional
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400">
                {tournamentName} — {accessibleCerts.length} total certificates available
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrintSingle}
              disabled={!currentCert}
              className="flex items-center gap-2 px-3.5 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-semibold shadow-lg transition"
            >
              <Printer className="w-4 h-4" />
              <span>Print This Certificate</span>
            </button>
            <button
              onClick={handlePrintBatch}
              disabled={filteredCerts.length === 0}
              className="flex items-center gap-2 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition"
            >
              <Printer className="w-4 h-4" />
              <span>Batch Print ({filteredCerts.length})</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-xl bg-slate-800/80 hover:bg-slate-700 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filter Controls - Screen Only */}
        <div className="no-print p-4 border-b border-slate-800/80 bg-slate-900/40 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search athlete, event, or club..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentIndex(0);
              }}
              className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <select
              value={filterType}
              onChange={(e) => {
                setFilterType(e.target.value);
                setCurrentIndex(0);
              }}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-amber-500"
            >
              <option value="ALL">All Certificate Types</option>
              <option value="AWARD">Medal Awards Only</option>
              <option value="GOLD">Gold Medalists Only</option>
              <option value="SILVER">Silver Medalists Only</option>
              <option value="BRONZE">Bronze Medalists Only</option>
              <option value="PARTICIPATION">Participation Only</option>
            </select>
          </div>

          <div>
            <select
              value={filterTeam}
              onChange={(e) => {
                setFilterTeam(e.target.value);
                setCurrentIndex(0);
              }}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-amber-500"
            >
              <option value="ALL">All Delegations / Clubs</option>
              {uniqueTeams.map((team) => (
                <option key={team} value={team}>
                  {team}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Certificate Display Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 flex flex-col items-center justify-center bg-slate-950/90">
          {filteredCerts.length === 0 ? (
            <div className="text-center py-16 space-y-3">
              <AlertCircle className="w-10 h-10 text-slate-600 mx-auto" />
              <div className="text-slate-300 font-semibold text-sm">No certificates match your search filters</div>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Try selecting "All Certificate Types" or clearing your search term.
              </p>
            </div>
          ) : (
            <div className="w-full flex flex-col items-center">
              {/* Pagination Controls - Screen Only */}
              <div className="no-print w-full max-w-3xl flex items-center justify-between mb-4 text-xs text-slate-400">
                <span>
                  Showing Certificate <strong className="text-white">{currentIndex + 1}</strong> of{' '}
                  <strong className="text-white">{filteredCerts.length}</strong>
                </span>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                    disabled={currentIndex === 0}
                    className="p-1.5 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setCurrentIndex((prev) => Math.min(filteredCerts.length - 1, prev + 1))}
                    disabled={currentIndex === filteredCerts.length - 1}
                    className="p-1.5 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Printable Single Certificate Canvas */}
              <div className="w-full max-w-3xl flex justify-center overflow-x-auto px-0.5">
                {isBatchPrinting ? (
                  // Batch Print Mode: Render all filtered certs
                  <div className="space-y-8 w-full">
                    {filteredCerts.map((cert) => (
                      <SingleCertificateCard
                        key={cert.id}
                        cert={cert}
                        logoUrl={logoUrl}
                        getMedalColor={getMedalColor}
                      />
                    ))}
                  </div>
                ) : (
                  // Single Certificate View
                  <SingleCertificateCard
                    cert={currentCert}
                    logoUrl={logoUrl}
                    getMedalColor={getMedalColor}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface SingleCertificateCardProps {
  cert: CertificateRecipient;
  logoUrl: string;
  getMedalColor: (medal?: string) => {
    border: string;
    text: string;
    bg: string;
    label: string;
  };
}

const SingleCertificateCard: React.FC<SingleCertificateCardProps> = ({ cert, logoUrl, getMedalColor }) => {
  const styling = getMedalColor(cert.medalType);
  const isAward = cert.certificateType === 'AWARD';

  return (
    <div
      className={`certificate-page relative w-full min-w-[290px] aspect-[1.414/1] bg-white text-slate-900 p-3.5 sm:p-8 md:p-12 rounded-xl shadow-2xl border-4 sm:border-8 ${styling.border} flex flex-col justify-between overflow-hidden`}
      style={{
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
      }}
    >
      {/* Background Security Watermark */}
      <div className="absolute inset-0 flex items-center justify-center opacity-5 pointer-events-none">
        <img
          src={logoUrl}
          alt="UAAPhil Watermark"
          className="w-48 h-48 sm:w-96 sm:h-96 object-contain"
          referrerPolicy="no-referrer"
        />
      </div>

      {/* Provisional Watermark */}
      {cert.isProvisional && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="transform -rotate-45 text-red-600/20 font-black text-2xl sm:text-5xl md:text-7xl uppercase tracking-widest border-4 sm:border-8 border-red-600/20 px-4 py-2 sm:px-8 sm:py-4 rounded-2xl sm:rounded-3xl">
            PROVISIONAL
          </div>
        </div>
      )}

      {/* Certificate Header */}
      <div className="text-center relative z-10">
        <div className="flex items-center justify-center gap-2 sm:gap-3 mb-1 sm:mb-2">
          <div className="w-8 h-8 sm:w-14 sm:h-14 rounded-full p-0.5 bg-black border border-amber-500/40 flex items-center justify-center shadow-md shrink-0">
            <img
              src={logoUrl}
              alt="UAAPhil Crest"
              className="w-full h-full object-contain rounded-full"
              referrerPolicy="no-referrer"
            />
          </div>
          <div className="text-left sm:text-center">
            <h3 className="text-[9px] sm:text-xs md:text-sm font-black tracking-wider sm:tracking-widest text-slate-800 uppercase leading-tight">
              Unified Arnis Association of the Philippines
            </h3>
            <p className="text-[7px] sm:text-[10px] md:text-xs text-slate-500 font-serif tracking-normal sm:tracking-wider leading-tight">
              National Governing Body for Arnis in the Philippines
            </p>
          </div>
        </div>

        <div className="h-0.5 w-24 sm:w-48 mx-auto bg-gradient-to-r from-transparent via-amber-500 to-transparent my-1 sm:my-2" />

        <h1 className="text-sm sm:text-2xl md:text-3xl font-black text-slate-900 tracking-tight font-serif uppercase leading-tight">
          {isAward ? 'Certificate of Award' : 'Certificate of Participation'}
        </h1>
        <p className="text-[8px] sm:text-xs text-slate-500 italic mt-0.5">This official certificate is proudly presented to</p>
      </div>

      {/* Recipient Body */}
      <div className="text-center my-auto py-1 sm:py-2 relative z-10">
        <h2 className="text-base sm:text-2xl md:text-4xl font-bold text-slate-950 tracking-tight font-serif underline decoration-amber-500/60 decoration-1 sm:decoration-2 underline-offset-4 sm:underline-offset-8">
          {cert.recipientName}
        </h2>
        <p className="text-xs sm:text-sm md:text-base font-semibold text-slate-700 mt-1 sm:mt-3 font-sans">
          {cert.teamName}
        </p>

        <div className="mt-1 sm:mt-4 max-w-xl mx-auto text-[9px] sm:text-xs md:text-sm text-slate-600 leading-tight sm:leading-relaxed font-serif">
          {isAward ? (
            <>
              For demonstrating exceptional skill and martial spirit, achieving{' '}
              <strong className={`font-sans font-black ${styling.text}`}>
                {styling.label}
              </strong>{' '}
              in the{' '}
              <strong className="text-slate-900 font-sans">{cert.eventName}</strong>{' '}
              {cert.eventWeightClass ? `(${cert.eventWeightClass})` : ''} competition.
            </>
          ) : (
            <>
              For active and honorable participation in the official tournament events of{' '}
              <strong className="text-slate-900 font-sans">{cert.tournamentName}</strong>, held on{' '}
              <span className="font-semibold text-slate-800">{cert.tournamentDate}</span>.
            </>
          )}
        </div>
      </div>

      {/* Certificate Footer: Signatures & Verification */}
      <div className="relative z-10 pt-2 sm:pt-4 border-t border-slate-200">
        <div className="grid grid-cols-3 gap-1.5 sm:gap-4 items-end text-center">
          {/* Verification Code */}
          <div className="text-left">
            <div className="text-[7px] sm:text-[9px] font-mono text-slate-400 uppercase tracking-wider leading-none">
              Verification Code
            </div>
            <div className="text-[8px] sm:text-[10px] font-mono font-bold text-slate-700 tracking-wider truncate leading-tight">
              {cert.verificationHash}
            </div>
            <div className="text-[6px] sm:text-[8px] text-slate-400 font-mono leading-none">
              Status: {cert.isProvisional ? 'PROVISIONAL' : 'OFFICIAL FINAL'}
            </div>
          </div>

          {/* Tournament Director Signature */}
          <div>
            <div className="h-4 sm:h-8 flex items-end justify-center mb-0.5 sm:mb-1">
              <span className="font-serif italic text-[8px] sm:text-sm text-slate-500">Official Signature</span>
            </div>
            <div className="border-t border-slate-400 w-full max-w-[140px] mx-auto" />
            <div className="text-[7px] sm:text-[10px] font-bold text-slate-800 uppercase mt-0.5 sm:mt-1 leading-tight">Tournament Director</div>
            <div className="text-[6px] sm:text-[8px] text-slate-500 leading-tight">UAAPHIL Organizing Committee</div>
          </div>

          {/* President Signature */}
          <div>
            <div className="h-4 sm:h-8 flex items-end justify-center mb-0.5 sm:mb-1">
              <span className="font-serif italic text-[8px] sm:text-sm text-slate-500">Official Signature</span>
            </div>
            <div className="border-t border-slate-400 w-full max-w-[140px] mx-auto" />
            <div className="text-[7px] sm:text-[10px] font-bold text-slate-800 uppercase mt-0.5 sm:mt-1 leading-tight">President / Chief Referee</div>
            <div className="text-[6px] sm:text-[8px] text-slate-500 leading-tight">UAAPHIL Board of Officials</div>
          </div>
        </div>
      </div>
    </div>
  );
};
