import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  BookOpen,
  X,
  Search,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  Wifi,
  Lock,
  Users,
  Award,
  Crown,
  Layers,
  Scale,
  Cpu,
  Flame,
  ArrowRight,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Info,
  Radio,
  FileCheck,
} from 'lucide-react';
import {
  COMMAND_CENTER_SOPS,
  SopItem,
  SopCategory,
} from '../../constants/commandCenterSopRegistry';
import { OperationalStationId, OPERATIONAL_STATIONS_METADATA } from '../../types/commandCenter';
import { AppRole } from '../../types/roles';

export interface CommandCenterSopDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeStation?: OperationalStationId;
  userRoles?: AppRole[];
}

const STATION_ICONS: Record<OperationalStationId, React.ComponentType<{ className?: string }>> = {
  DIRECTOR_HUB: Crown,
  COURT_OPERATIONS: Layers,
  SCORING_DESK: Award,
  REGISTRATION_WEIGHIN: Scale,
  TECH_AUDIT: Cpu,
  INCIDENT_RECOVERY: ShieldAlert,
};

const CATEGORY_LABELS: Record<SopCategory, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  PRE_OPENING: { label: 'Pre-Opening Checks', icon: FileCheck },
  NETWORK_TELEMETRY: { label: 'Network & Telemetry', icon: Wifi },
  CONCURRENCY_LOCK: { label: '40902 Active-Bout Lock', icon: Lock },
  SECURITY_AUTH: { label: 'Security & Auth (403/425)', icon: ShieldAlert },
  OFFICIAL_STAFFING: { label: 'Official Shifts & Rotation', icon: Users },
  INCIDENT_EMERGENCY: { label: 'Emergency & Incidents', icon: Flame },
  CLOSURE_SEAL: { label: 'Closure & SHA-256 Seal', icon: CheckCircle2 },
};

export const CommandCenterSopDrawer: React.FC<CommandCenterSopDrawerProps> = ({
  isOpen,
  onClose,
  activeStation,
  userRoles = [],
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<SopCategory | 'ALL'>('ALL');
  const [stationFilter, setStationFilter] = useState<OperationalStationId | 'ALL'>('ALL');
  const [expandedSopId, setExpandedSopId] = useState<string | null>(null);

  const drawerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Set default station filter when activeStation changes and drawer opens
  useEffect(() => {
    if (isOpen) {
      if (activeStation) {
        setStationFilter(activeStation);
      } else {
        setStationFilter('ALL');
      }
      // Focus search input on open
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [isOpen, activeStation]);

  // Keyboard 'Escape' key listener to close drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  // Filter SOPs based on search query, category, and station
  const filteredSops = useMemo(() => {
    return COMMAND_CENTER_SOPS.filter((sop) => {
      // Category filter
      if (selectedCategory !== 'ALL' && sop.category !== selectedCategory) {
        return false;
      }

      // Station filter
      if (stationFilter !== 'ALL' && !sop.stationIds.includes(stationFilter)) {
        return false;
      }

      // Text search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesTitle = sop.title.toLowerCase().includes(query);
        const matchesCode = sop.code.toLowerCase().includes(query);
        const matchesSummary = sop.summary.toLowerCase().includes(query);
        const matchesError = sop.errorCode?.toLowerCase().includes(query);
        const matchesSteps = sop.steps.some(
          (s) =>
            s.title.toLowerCase().includes(query) ||
            s.instruction.toLowerCase().includes(query)
        );

        if (!matchesTitle && !matchesCode && !matchesSummary && !matchesError && !matchesSteps) {
          return false;
        }
      }

      return true;
    });
  }, [searchQuery, selectedCategory, stationFilter]);

  // Default expand the first matching SOP if none is expanded
  useEffect(() => {
    if (filteredSops.length > 0 && !expandedSopId) {
      setExpandedSopId(filteredSops[0].id);
    }
  }, [filteredSops, expandedSopId]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sop-drawer-title"
    >
      {/* Backdrop with blur */}
      <div
        className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm transition-opacity duration-300 animate-fadeIn"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over Content Drawer */}
      <div
        ref={drawerRef}
        className="relative w-full max-w-2xl bg-slate-900 border-l border-slate-800 shadow-2xl z-10 flex flex-col h-full overflow-hidden text-slate-100 animate-slideInRight"
      >
        {/* Drawer Header */}
        <div className="p-5 sm:p-6 border-b border-slate-800 bg-slate-950 flex-shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 bg-amber-500/15 border border-amber-500/30 text-amber-400 rounded-xl">
                <BookOpen className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h2 id="sop-drawer-title" className="text-lg font-bold text-white tracking-tight">
                    Command Center SOP Reference
                  </h2>
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] font-mono font-bold">
                    P8-02 RUNBOOK
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Authoritative operational procedures, recovery workflows &amp; error boundary guidelines.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition-all focus:outline-none focus:ring-2 focus:ring-amber-400/50"
              aria-label="Close SOP Drawer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Operational Safety Notice */}
          <div className="mt-3.5 px-3.5 py-2 rounded-xl bg-slate-900/90 border border-slate-800 text-[11px] text-slate-400 flex items-center space-x-2">
            <Info className="w-4 h-4 text-sky-400 shrink-0" />
            <span>
              <strong className="text-slate-300">Read-Only Reference:</strong> Guides operator workflows. Does not mutate database records or bypass server-side RBAC.
            </span>
          </div>

          {/* Search Bar */}
          <div className="mt-4 relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search SOP by code (e.g. 40902, SOP-RT-01), keyword, or step..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
              >
                Clear
              </button>
            )}
          </div>

          {/* Station Quick Filter Tabs */}
          <div className="mt-3 flex items-center space-x-1.5 overflow-x-auto pb-1 text-xs">
            <button
              type="button"
              onClick={() => setStationFilter('ALL')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap transition-all ${
                stationFilter === 'ALL'
                  ? 'bg-amber-500 text-slate-950 font-bold'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              All Stations ({COMMAND_CENTER_SOPS.length})
            </button>
            {(Object.keys(OPERATIONAL_STATIONS_METADATA) as OperationalStationId[]).map((stId) => {
              const meta = OPERATIONAL_STATIONS_METADATA[stId];
              const Icon = STATION_ICONS[stId] || Radio;
              const isSelected = stationFilter === stId;
              const count = COMMAND_CENTER_SOPS.filter((s) => s.stationIds.includes(stId)).length;

              return (
                <button
                  key={stId}
                  type="button"
                  onClick={() => setStationFilter(stId)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap flex items-center space-x-1.5 transition-all ${
                    isSelected
                      ? 'bg-amber-500 text-slate-950 font-bold'
                      : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  <span>{meta.shortLabel}</span>
                  <span className={`text-[10px] ${isSelected ? 'text-slate-950 font-mono' : 'text-slate-500 font-mono'}`}>
                    ({count})
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Drawer Body — Scrollable SOP Items */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {filteredSops.length === 0 ? (
            <div className="text-center py-12 px-4">
              <BookOpen className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <h3 className="text-sm font-bold text-slate-300">No matching SOPs found</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                No standard operating procedures matched your search query or station filter. Try resetting filters.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('ALL');
                  setStationFilter('ALL');
                }}
                className="mt-4 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-400 rounded-lg text-xs font-semibold"
              >
                Reset All Filters
              </button>
            </div>
          ) : (
            filteredSops.map((sop) => {
              const isExpanded = expandedSopId === sop.id;
              const catMeta = CATEGORY_LABELS[sop.category] || { label: sop.category, icon: BookOpen };
              const CatIcon = catMeta.icon;

              return (
                <div
                  key={sop.id}
                  className={`border rounded-2xl transition-all overflow-hidden ${
                    isExpanded
                      ? 'bg-slate-950 border-amber-500/40 shadow-lg ring-1 ring-amber-500/20'
                      : 'bg-slate-950/60 border-slate-800/90 hover:border-slate-700'
                  }`}
                >
                  {/* SOP Accordion Header */}
                  <button
                    type="button"
                    onClick={() => setExpandedSopId(isExpanded ? null : sop.id)}
                    className="w-full p-4 text-left flex items-start justify-between gap-3 focus:outline-none cursor-pointer"
                  >
                    <div className="space-y-1.5 flex-1">
                      <div className="flex items-center flex-wrap gap-2">
                        <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-amber-400 text-[11px] font-mono font-bold">
                          {sop.code}
                        </span>

                        <span className="px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-slate-300 text-[10px] font-medium flex items-center space-x-1">
                          <CatIcon className="w-3 h-3 text-amber-400" />
                          <span>{catMeta.label}</span>
                        </span>

                        {sop.errorCode && (
                          <span className="px-2 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[10px] font-mono font-bold">
                            {sop.errorCode}
                          </span>
                        )}

                        {sop.severity && (
                          <span
                            className={`px-1.5 py-0.2 rounded text-[9px] font-bold font-mono uppercase ${
                              sop.severity === 'CRITICAL'
                                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                                : sop.severity === 'HIGH'
                                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                : 'bg-slate-800 text-slate-300'
                            }`}
                          >
                            {sop.severity}
                          </span>
                        )}
                      </div>

                      <h3 className="text-sm font-bold text-white tracking-tight">
                        {sop.title}
                      </h3>

                      <p className="text-xs text-slate-400 line-clamp-2">
                        {sop.summary}
                      </p>
                    </div>

                    <div className="p-1 text-slate-400 hover:text-white shrink-0 mt-1">
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-amber-400" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </button>

                  {/* Expanded SOP Details & Step-by-Step Instructions */}
                  {isExpanded && (
                    <div className="p-4 sm:p-5 pt-0 border-t border-slate-800/80 space-y-4">
                      {/* Warnings Banner */}
                      {sop.warnings.length > 0 && (
                        <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-500/30 space-y-1.5">
                          <div className="flex items-center space-x-1.5 text-amber-300 font-bold text-xs">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            <span>Operational Warnings &amp; Invariant Boundaries</span>
                          </div>
                          <ul className="list-disc list-inside text-[11px] text-amber-200/90 space-y-1">
                            {sop.warnings.map((w, idx) => (
                              <li key={idx}>{w}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Step-by-Step Procedure */}
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between text-xs font-bold text-slate-300 pb-1 border-b border-slate-800">
                          <span>STEP-BY-STEP OPERATOR PROCEDURE</span>
                          <span className="text-[11px] text-slate-500 font-mono font-normal">
                            {sop.steps.length} Steps
                          </span>
                        </div>

                        <div className="space-y-2.5">
                          {sop.steps.map((step) => (
                            <div
                              key={step.stepNumber}
                              className="p-3 rounded-xl bg-slate-900/80 border border-slate-800/90 flex items-start space-x-3"
                            >
                              <div className="w-6 h-6 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-mono font-bold flex items-center justify-center shrink-0 mt-0.5">
                                {step.stepNumber}
                              </div>
                              <div className="space-y-1 flex-1">
                                <div className="text-xs font-bold text-white flex items-center justify-between">
                                  <span>{step.title}</span>
                                </div>
                                <p className="text-xs text-slate-300 leading-relaxed">
                                  {step.instruction}
                                </p>
                                {step.warning && (
                                  <div className="p-2 rounded-lg bg-rose-950/40 border border-rose-800/40 text-[11px] text-rose-300 mt-1 flex items-start space-x-1.5">
                                    <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                                    <span>{step.warning}</span>
                                  </div>
                                )}
                                {step.expectedOutcome && (
                                  <div className="text-[11px] text-emerald-400/90 font-mono mt-1 flex items-center space-x-1">
                                    <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                                    <span>Expected: {step.expectedOutcome}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Escalation & Metadata Footer */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-slate-800/80 text-[11px]">
                        <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                          <span className="text-slate-500 uppercase tracking-wider font-semibold text-[10px] block">
                            Escalation Authority
                          </span>
                          <span className="text-slate-200 font-medium mt-0.5 block">
                            {sop.escalationAuthority}
                          </span>
                        </div>

                        {sop.relatedRpcOrService && (
                          <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                            <span className="text-slate-500 uppercase tracking-wider font-semibold text-[10px] block">
                              Authoritative RPC / Service
                            </span>
                            <span className="text-amber-400 font-mono font-medium mt-0.5 block truncate">
                              {sop.relatedRpcOrService}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Drawer Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950 flex items-center justify-between text-xs text-slate-400 flex-shrink-0">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span className="font-mono text-[11px]">UAAPHIL RUNBOOK v1.0 (P8-02 / P9-02A)</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition-all"
          >
            Close Guide
          </button>
        </div>
      </div>
    </div>
  );
};
