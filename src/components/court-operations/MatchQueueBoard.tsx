import React, { useState, useMemo } from 'react';
import { EnrichedQueueMatch, QueueItemState } from '../../types/courtOperations';
import { 
  Search, 
  Filter, 
  Swords, 
  Clock, 
  ShieldAlert, 
  CheckCircle2, 
  Flame, 
  PlusCircle, 
  ChevronRight,
  RefreshCw
} from 'lucide-react';

interface MatchQueueBoardProps {
  queue: EnrichedQueueMatch[];
  events: Array<{ id: string; name: string }>;
  canManage: boolean;
  canScore: boolean;
  onAssignMatch: (matchId: string) => void;
  onOpenScoringConsole: (matchId: string, assignmentId: string) => void;
  onRefresh: () => void;
}

export const MatchQueueBoard: React.FC<MatchQueueBoardProps> = ({
  queue,
  events,
  canManage,
  canScore,
  onAssignMatch,
  onOpenScoringConsole,
  onRefresh
}) => {
  const [statusFilter, setStatusFilter] = useState<string>('READY');
  const [eventFilter, setEventFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const filteredMatches = useMemo(() => {
    return queue.filter(item => {
      // Status Filter
      if (statusFilter === 'READY' && item.queueState !== 'READY') return false;
      if (statusFilter === 'ASSIGNED' && item.queueState !== 'ASSIGNED') return false;
      if (statusFilter === 'LIVE' && item.queueState !== 'LIVE') return false;
      if (statusFilter === 'COMPLETED' && item.queueState !== 'COMPLETED') return false;
      if (statusFilter === 'WAITING' && item.queueState !== 'WAITING' && item.queueState !== 'BLOCKED') return false;
      
      // Event Filter
      if (eventFilter !== 'ALL' && item.eventId !== eventFilter) {
        return false;
      }
      
      // Search Query: Athlete name, Club/School, Match Number, Event
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const redAthleteName = item.redAthlete?.athleteName?.toLowerCase() || '';
        const redTeamName = item.redAthlete?.teamName?.toLowerCase() || '';
        const blueAthleteName = item.blueAthlete?.athleteName?.toLowerCase() || '';
        const blueTeamName = item.blueAthlete?.teamName?.toLowerCase() || '';
        const eventName = item.eventName?.toLowerCase() || '';
        const division = item.division?.toLowerCase() || '';
        const weightClass = item.weightClass?.toLowerCase() || '';
        const matchNumStr = item.matchNumber.toString();
        const courtIdStr = item.assignedCourtIdentifier?.toLowerCase() || '';

        const matchesQuery = 
          redAthleteName.includes(query) ||
          redTeamName.includes(query) ||
          blueAthleteName.includes(query) ||
          blueTeamName.includes(query) ||
          eventName.includes(query) ||
          division.includes(query) ||
          weightClass.includes(query) ||
          matchNumStr.includes(query) ||
          courtIdStr.includes(query);

        if (!matchesQuery) return false;
      }
      return true;
    });
  }, [queue, statusFilter, eventFilter, searchQuery]);

  const getStateBadge = (state: QueueItemState) => {
    switch (state) {
      case 'READY':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
            <Swords className="w-3 h-3 text-emerald-600" />
            READY
          </span>
        );
      case 'ASSIGNED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-sky-100 text-sky-800 border border-sky-300">
            <Clock className="w-3 h-3 text-sky-600" />
            ASSIGNED
          </span>
        );
      case 'LIVE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-red-600 text-white shadow-xs animate-pulse">
            <Flame className="w-3 h-3" />
            LIVE
          </span>
        );
      case 'WAITING':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 text-amber-800 border border-amber-300">
            <Clock className="w-3 h-3 text-amber-600" />
            WAITING
          </span>
        );
      case 'BLOCKED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-300">
            <ShieldAlert className="w-3 h-3 text-slate-500" />
            BLOCKED
          </span>
        );
      case 'COMPLETED':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-500">
            <CheckCircle2 className="w-3 h-3 text-slate-400" />
            COMPLETED
          </span>
        );
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
      {/* Filters Header */}
      <div className="p-3 sm:p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-2.5 sm:gap-3 bg-slate-50/50">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {/* Status Tabs */}
          {[
            { id: 'ALL', label: 'ALL' },
            { id: 'READY', label: 'READY FOR DISPATCH' },
            { id: 'ASSIGNED', label: 'ON-DECK ASSIGNED' },
            { id: 'LIVE', label: 'IN PROGRESS' },
            { id: 'COMPLETED', label: 'COMPLETED' },
            { id: 'WAITING', label: 'AWAITING FEEDER' }
          ].map(tab => {
            const count = queue.filter(item => {
              if (tab.id === 'ALL') return true;
              if (tab.id === 'READY') return item.queueState === 'READY';
              if (tab.id === 'ASSIGNED') return item.queueState === 'ASSIGNED';
              if (tab.id === 'LIVE') return item.queueState === 'LIVE';
              if (tab.id === 'COMPLETED') return item.queueState === 'COMPLETED';
              if (tab.id === 'WAITING') return item.queueState === 'WAITING' || item.queueState === 'BLOCKED';
              return false;
            }).length;

            return (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-bold transition-all flex items-center gap-1 sm:gap-1.5 min-h-[32px] sm:min-h-0 ${
                  statusFilter === tab.id
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                <span>{tab.label}</span>
                <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                  statusFilter === tab.id
                    ? 'bg-slate-800 text-amber-400'
                    : 'bg-slate-100 text-slate-500'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap sm:flex-nowrap">
          {/* Search Box */}
          <div className="relative flex-1 md:w-64 min-w-[160px]">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search athlete, club/school, #..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-7 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                title="Clear search"
              >
                ×
              </button>
            )}
          </div>

          {/* Event Dropdown */}
          <select
            value={eventFilter}
            onChange={(e) => setEventFilter(e.target.value)}
            className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 font-medium focus:outline-none focus:ring-1 focus:ring-slate-900"
          >
            <option value="ALL">All Events</option>
            {events.map(ev => (
              <option key={ev.id} value={ev.id}>{ev.name}</option>
            ))}
          </select>

          {/* Refresh Button */}
          <button
            onClick={onRefresh}
            title="Refresh Queue"
            className="p-1.5 bg-white hover:bg-slate-100 text-slate-500 border border-slate-200 rounded-lg transition-colors min-h-[32px] sm:min-h-0 flex items-center justify-center"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-600">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
            <tr>
              <th className="py-2.5 px-3 sm:px-4">#</th>
              <th className="py-2.5 px-3 sm:px-4">Event &amp; Weight Class</th>
              <th className="py-2.5 px-3 sm:px-4">Round</th>
              <th className="py-2.5 px-3 sm:px-4">Red Corner</th>
              <th className="py-2.5 px-3 sm:px-4">Blue Corner</th>
              <th className="py-2.5 px-3 sm:px-4">Status</th>
              <th className="py-2.5 px-3 sm:px-4">Court</th>
              <th className="py-2.5 px-3 sm:px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredMatches.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-400">
                  No matches match the current filter criteria.
                </td>
              </tr>
            ) : (
              filteredMatches.map(match => (
                <tr key={match.matchId} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-2.5 sm:py-3 px-3 sm:px-4 font-mono font-bold text-slate-900">
                    #{match.matchNumber}
                  </td>
                  <td className="py-2.5 sm:py-3 px-3 sm:px-4">
                    <p className="font-semibold text-slate-900">{match.eventName}</p>
                    <p className="text-[11px] text-slate-400">{match.division} • {match.weightClass}</p>
                  </td>
                  <td className="py-2.5 sm:py-3 px-3 sm:px-4 font-medium text-slate-700">
                    {match.roundName}
                  </td>
                  <td className="py-2.5 sm:py-3 px-3 sm:px-4">
                    {match.redAthlete ? (
                      <div>
                        <span className="font-semibold text-red-700">{match.redAthlete.athleteName}</span>
                        <p className="text-[10px] text-slate-400">{match.redAthlete.teamName}</p>
                      </div>
                    ) : (
                      <span className="italic text-slate-400 text-[11px]">Winner of preceding match</span>
                    )}
                  </td>
                  <td className="py-2.5 sm:py-3 px-3 sm:px-4">
                    {match.blueAthlete ? (
                      <div>
                        <span className="font-semibold text-blue-700">{match.blueAthlete.athleteName}</span>
                        <p className="text-[10px] text-slate-400">{match.blueAthlete.teamName}</p>
                      </div>
                    ) : (
                      <span className="italic text-slate-400 text-[11px]">Winner of preceding match</span>
                    )}
                  </td>
                  <td className="py-2.5 sm:py-3 px-3 sm:px-4">
                    {getStateBadge(match.queueState)}
                  </td>
                  <td className="py-2.5 sm:py-3 px-3 sm:px-4 font-medium text-slate-800">
                    {match.assignedCourtIdentifier ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-semibold">
                        {match.assignedCourtIdentifier}
                      </span>
                    ) : (
                      <span className="text-slate-400 text-[11px]">—</span>
                    )}
                  </td>
                  <td className="py-2.5 sm:py-3 px-3 sm:px-4 text-right">
                    {match.queueState === 'READY' && canManage && (
                      <button
                        onClick={() => onAssignMatch(match.matchId)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded-md text-[11px] font-bold shadow-xs transition-colors min-h-[30px]"
                      >
                        <PlusCircle className="w-3 h-3" />
                        Assign Court
                      </button>
                    )}
                    {match.queueState === 'LIVE' && match.assignmentId && canScore && (
                      <button
                        onClick={() => onOpenScoringConsole(match.matchId, match.assignmentId!)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded-md text-[11px] font-bold shadow-xs transition-colors min-h-[30px]"
                      >
                        <Flame className="w-3 h-3" />
                        Score
                      </button>
                    )}
                    {(match.queueState === 'WAITING' || match.queueState === 'BLOCKED') && (
                      <span className="text-[11px] text-slate-400 italic">
                        {match.dependencyNote || 'Pending'}
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
