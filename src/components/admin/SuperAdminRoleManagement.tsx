import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { roleService } from '../../services/roleService';
import { AssignableRole, RoleManagementResult, UserSearchResult, AppRole } from '../../types/roles';
import { CopyableId } from '../common/CopyableId';
import { CoachSuccessionManagement } from './CoachSuccessionManagement';
import {
  ShieldAlert,
  UserPlus,
  UserMinus,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Clock,
  Lock,
  ShieldCheck,
  Search,
  User as UserIcon,
  X,
  RefreshCw,
  Info,
  Layers,
  ArrowRight,
  UserCheck,
  Building,
  Filter,
  Users,
  ChevronRight,
  RotateCcw
} from 'lucide-react';

interface AuditLogEntry extends RoleManagementResult {
  timestamp: string;
  targetEmail?: string;
  targetName?: string | null;
}

type RoleFilterType = 'ALL' | 'ADMIN' | 'ORGANIZER' | 'COACH' | 'SUPER_ADMIN';
type StatusFilterType = 'ALL' | 'ACTIVE' | 'SUSPENDED';

const ROLE_DEFINITIONS: Record<AssignableRole, { title: string; description: string; badgeColor: string }> = {
  ADMIN: {
    title: 'Administrator',
    description: 'Full tournament operations and event governance permissions.',
    badgeColor: 'bg-purple-950/70 text-purple-300 border-purple-800/70',
  },
  ORGANIZER: {
    title: 'Tournament Organizer',
    description: 'Tournament creation, schedule configuration, and assigned event authority.',
    badgeColor: 'bg-blue-950/70 text-blue-300 border-blue-800/70',
  },
  COACH: {
    title: 'Coach / Delegate',
    description: 'Team delegation, athlete roster submissions, and team management.',
    badgeColor: 'bg-emerald-950/70 text-emerald-300 border-emerald-800/70',
  },
};

/**
 * Translates known RPC error codes and messages into human-friendly explanations.
 */
function formatRpcError(errMsg: string): string {
  if (errMsg.includes('40100') || errMsg.includes('UNAUTHORIZED') || errMsg.includes('AUTH_REQUIRED')) {
    return 'Unauthorized: An active authenticated session is required.';
  }
  if (errMsg.includes('40300') || errMsg.includes('FORBIDDEN') || errMsg.includes('FORBIDDEN_NOT_SUPER_ADMIN')) {
    return 'Forbidden: Requester does not possess an active SUPER_ADMIN role.';
  }
  if (errMsg.includes('40400') || errMsg.includes('USER_NOT_FOUND')) {
    return 'Target User Not Found: The specified user profile does not exist in the database.';
  }
  if (errMsg.includes('42201')) {
    return 'Invalid Operation: SUPER_ADMIN role cannot be assigned or revoked through permanent role management.';
  }
  if (errMsg.includes('42200')) {
    return 'Invalid Role: Role must be one of ADMIN, ORGANIZER, or COACH.';
  }
  if (errMsg.includes('42202') || errMsg.includes('ACCOUNT_INACTIVE')) {
    return 'Account Inactive: Target user account status is not ACTIVE (suspended or deactivated).';
  }
  if (errMsg.includes('42203') || errMsg.includes('SELF_MUTATION_FORBIDDEN')) {
    return 'Self-Mutation Forbidden: Super Admins cannot assign or revoke roles on their own account.';
  }
  return errMsg;
}

export const SuperAdminRoleManagement: React.FC = () => {
  const { user, roles, rolesLoading } = useAuth();
  const isSuperAdmin = roles.includes('SUPER_ADMIN');

  const [adminSection, setAdminSection] = useState<'roles' | 'clubs'>('roles');

  // Search & Directory state
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null);

  // In-memory Filter state
  const [roleFilter, setRoleFilter] = useState<RoleFilterType>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilterType>('ALL');

  // Assignment / Revocation state
  const [selectedRoleToAssign, setSelectedRoleToAssign] = useState<AssignableRole>('ADMIN');
  const [roleToRevoke, setRoleToRevoke] = useState<AssignableRole | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [activeAction, setActiveAction] = useState<'ASSIGN' | 'REVOKE' | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string; details?: string } | null>(null);
  const [sessionLogs, setSessionLogs] = useState<AuditLogEntry[]>([]);

  // Mobile scroll reference
  const managementPanelRef = useRef<HTMLDivElement>(null);

  // Authoritative Search function using search_users_for_admin RPC
  const performSearch = useCallback(async (query: string, shouldResetFeedback: boolean = true) => {
    setIsSearching(true);
    if (shouldResetFeedback) {
      setFeedbackMessage(null);
    }
    setHasSearched(true);

    try {
      const results = await roleService.searchUsersForAdmin(query);
      setSearchResults(results);

      // If a user was selected, update their snapshot with the latest from the database RPC
      setSelectedUser((prevSelected) => {
        if (!prevSelected) return null;
        const fresh = results.find((u) => u.id === prevSelected.id);
        return fresh || prevSelected;
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to search user directory.';
      console.error('User search failed:', err);
      setFeedbackMessage({
        type: 'error',
        text: 'User Search Failed',
        details: formatRpcError(msg),
      });
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Initial user list load on mount (empty query returns top 25 users from RPC)
  useEffect(() => {
    if (isSuperAdmin) {
      performSearch('');
    }
  }, [isSuperAdmin, performSearch]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    performSearch(searchQuery);
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    performSearch('');
  };

  const handleSelectUser = (prof: UserSearchResult) => {
    setSelectedUser(prof);
    setRoleToRevoke(null);
    // On mobile / small viewports, smoothly scroll management panel into view
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setTimeout(() => {
        managementPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    }
  };

  // In-memory Filtered Users Computation
  const filteredUsers = useMemo(() => {
    return searchResults.filter((u) => {
      // Role filter
      if (roleFilter !== 'ALL') {
        if (!u.roles.includes(roleFilter as AppRole)) {
          return false;
        }
      }
      // Status filter
      if (statusFilter === 'ACTIVE' && u.account_status !== 'ACTIVE') {
        return false;
      }
      if (statusFilter === 'SUSPENDED' && u.account_status === 'ACTIVE') {
        return false;
      }
      return true;
    });
  }, [searchResults, roleFilter, statusFilter]);

  const hasActiveFilters = roleFilter !== 'ALL' || statusFilter !== 'ALL';

  const handleResetFilters = () => {
    setRoleFilter('ALL');
    setStatusFilter('ALL');
  };

  // Assign Role RPC Handler
  const handleAssignRole = async (targetUser: UserSearchResult) => {
    if (user && targetUser.id === user.id) {
      setFeedbackMessage({
        type: 'error',
        text: 'Self-Mutation Forbidden',
        details: 'Super Admins cannot assign roles to their own account.',
      });
      return;
    }

    if (targetUser.account_status !== 'ACTIVE') {
      setFeedbackMessage({
        type: 'error',
        text: 'Account Inactive',
        details: `Cannot assign roles to a user with account status: ${targetUser.account_status}.`,
      });
      return;
    }

    setIsExecuting(true);
    setActiveAction('ASSIGN');
    setFeedbackMessage(null);

    try {
      const result = await roleService.assignPermanentRole(targetUser.id, selectedRoleToAssign);

      const targetLabel = targetUser.full_name
        ? `${targetUser.full_name} (${targetUser.email})`
        : targetUser.email;

      const successText = result.action === 'ALREADY_ASSIGNED'
        ? `Target: ${targetLabel} — Role ${selectedRoleToAssign} is already possessed.`
        : `Target: ${targetLabel} — Successfully assigned permanent ${selectedRoleToAssign} role.`;

      setFeedbackMessage({
        type: 'success',
        text: `Role ${result.action}: ${selectedRoleToAssign}`,
        details: successText,
      });

      setSessionLogs((prev) => [
        {
          ...result,
          timestamp: new Date().toLocaleTimeString(),
          targetEmail: targetUser.email,
          targetName: targetUser.full_name,
        },
        ...prev,
      ]);

      // Refresh data from authoritative RPC without clearing the newly set feedbackMessage
      await performSearch(searchQuery, false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Role assignment failed.';
      console.error('Role assignment RPC failed:', err);
      setFeedbackMessage({
        type: 'error',
        text: 'Assignment Rejection',
        details: formatRpcError(msg),
      });
    } finally {
      setIsExecuting(false);
      setActiveAction(null);
    }
  };

  // Revoke Role RPC Handler
  const confirmRevokeRole = async () => {
    if (!selectedUser || !roleToRevoke) return;

    if (user && selectedUser.id === user.id) {
      setFeedbackMessage({
        type: 'error',
        text: 'Self-Mutation Forbidden',
        details: 'Super Admins cannot revoke roles from their own account.',
      });
      setRoleToRevoke(null);
      return;
    }

    setIsExecuting(true);
    setActiveAction('REVOKE');
    setFeedbackMessage(null);

    try {
      const result = await roleService.revokePermanentRole(selectedUser.id, roleToRevoke);

      const targetLabel = selectedUser.full_name
        ? `${selectedUser.full_name} (${selectedUser.email})`
        : selectedUser.email;

      const successText = result.action === 'NOT_FOUND'
        ? `Target: ${targetLabel} — Role ${roleToRevoke} was not currently assigned.`
        : `Target: ${targetLabel} — Successfully revoked permanent ${roleToRevoke} role.`;

      setFeedbackMessage({
        type: 'success',
        text: `Role ${result.action}: ${roleToRevoke}`,
        details: successText,
      });

      setSessionLogs((prev) => [
        {
          ...result,
          timestamp: new Date().toLocaleTimeString(),
          targetEmail: selectedUser.email,
          targetName: selectedUser.full_name,
        },
        ...prev,
      ]);

      // Refresh data from authoritative RPC without clearing the newly set feedbackMessage
      await performSearch(searchQuery, false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Role revocation failed.';
      console.error('Role revocation RPC failed:', err);
      setFeedbackMessage({
        type: 'error',
        text: 'Revocation Rejection',
        details: formatRpcError(msg),
      });
    } finally {
      setIsExecuting(false);
      setActiveAction(null);
      setRoleToRevoke(null);
    }
  };

  if (rolesLoading) {
    return (
      <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-8 flex flex-col items-center justify-center space-y-3 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
        <span className="text-xs">Verifying Super Admin permissions...</span>
      </div>
    );
  }

  if (!isSuperAdmin) {
    return (
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 sm:p-8 space-y-4">
        <div className="flex items-center space-x-3 text-slate-300 font-semibold text-sm">
          <div className="p-2 bg-slate-800 rounded-lg text-slate-400">
            <Lock className="w-5 h-5 text-rose-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Role Management (Restricted)</h3>
            <p className="text-xs text-slate-400">Access strictly limited to active Super Administrators</p>
          </div>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed border-t border-slate-800 pt-4">
          Permanent role assignment (<code className="font-mono text-slate-300">ADMIN</code>, <code className="font-mono text-slate-300">ORGANIZER</code>, <code className="font-mono text-slate-300">COACH</code>) and revocation are protected by database-level RLS and SECURITY DEFINER RPC policies. Your current profile does not hold <code className="font-mono text-amber-400">SUPER_ADMIN</code> authorization.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top View Selector */}
      <div className="flex items-center space-x-2 bg-slate-900/90 p-1.5 rounded-xl border border-slate-800">
        <button
          type="button"
          onClick={() => setAdminSection('roles')}
          className={`flex-1 py-2.5 px-4 rounded-lg font-bold text-xs sm:text-sm transition-all flex items-center justify-center space-x-2 ${
            adminSection === 'roles'
              ? 'bg-amber-600 text-white shadow-lg shadow-amber-600/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>System Roles (RBAC)</span>
        </button>
        <button
          type="button"
          onClick={() => setAdminSection('clubs')}
          className={`flex-1 py-2.5 px-4 rounded-lg font-bold text-xs sm:text-sm transition-all flex items-center justify-center space-x-2 ${
            adminSection === 'clubs'
              ? 'bg-amber-600 text-white shadow-lg shadow-amber-600/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <Building className="w-4 h-4" />
          <span>Clubs & Coach Succession</span>
        </button>
      </div>

      {adminSection === 'clubs' ? (
        <CoachSuccessionManagement />
      ) : (
        <>
          {/* Header Banner */}
          <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-5 sm:p-6 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-700/60">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-xl">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-white flex items-center space-x-2">
                    <span>Super Admin Role Management</span>
                    <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded text-[10px] font-mono uppercase tracking-wider">
                      Role Authority
                    </span>
                  </h2>
                  <p className="text-xs text-slate-400">
                    Search user directory to delegate or revoke permanent system roles.
                  </p>
                </div>
              </div>
            </div>

            <div className="text-xs text-slate-400 flex items-start space-x-2">
              <Info className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                Directory searches and role mutations execute strictly against secure server-side role management handlers.
              </p>
            </div>
          </div>

          {/* Master / Detail Grid Container */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Column: User Directory & Search (lg:col-span-5) */}
            <div className="lg:col-span-5 space-y-4">
              <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-4 sm:p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-2">
                    <Search className="w-4 h-4 text-amber-400" />
                    <span>User Directory</span>
                  </h3>
                  <span className="text-[11px] text-slate-400">
                    Email, Name, or UUID
                  </span>
                </div>

                {/* Accessible Search Form */}
                <form onSubmit={handleSearchSubmit} className="space-y-2.5">
                  <label htmlFor="user-directory-search" className="sr-only">
                    Search users by email, full name, or Account ID
                  </label>
                  <div className="relative">
                    <input
                      id="user-directory-search"
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search email, name, or User ID..."
                      aria-label="Search users by email, full name, or Account ID"
                      className="w-full pl-9 pr-8 py-2.5 bg-slate-900 text-slate-100 placeholder-slate-500 border border-slate-700 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500"
                    />
                    <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3 pointer-events-none" />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={handleClearSearch}
                        aria-label="Clear search query"
                        className="absolute right-2.5 top-2.5 p-1 text-slate-500 hover:text-slate-300 focus:outline-none focus:ring-1 focus:ring-amber-500 rounded"
                        title="Clear search"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      type="submit"
                      disabled={isSearching}
                      className="flex-1 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold shadow-md transition-colors flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                    >
                      {isSearching ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Searching...</span>
                        </>
                      ) : (
                        <span>Search Directory</span>
                      )}
                    </button>
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={handleClearSearch}
                        aria-label="Clear search and view default users"
                        className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </form>

                {/* Quick Filters Toolbar */}
                <div className="pt-2 border-t border-slate-700/60 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center space-x-1.5">
                      <Filter className="w-3 h-3 text-amber-400" />
                      <span>Quick Filters</span>
                    </span>
                    {hasActiveFilters && (
                      <button
                        type="button"
                        onClick={handleResetFilters}
                        aria-label="Reset all active filters"
                        className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center space-x-1 underline"
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        <span>Reset filters</span>
                      </button>
                    )}
                  </div>

                  {/* Role filter chips */}
                  <div className="space-y-1">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">By Role</span>
                    <div className="flex flex-wrap gap-1">
                      {(['ALL', 'ADMIN', 'ORGANIZER', 'COACH', 'SUPER_ADMIN'] as RoleFilterType[]).map((r) => {
                        const active = roleFilter === r;
                        return (
                          <button
                            key={r}
                            type="button"
                            onClick={() => setRoleFilter(r)}
                            aria-pressed={active}
                            className={`px-2 py-1 rounded text-[10px] font-mono font-medium transition-all ${
                              active
                                ? 'bg-amber-600 text-white shadow-sm ring-1 ring-amber-400'
                                : 'bg-slate-900 text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-800'
                            }`}
                          >
                            {r === 'SUPER_ADMIN' ? 'SUPER ADMIN' : r}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Status filter chips */}
                  <div className="space-y-1">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">By Account Status</span>
                    <div className="flex flex-wrap gap-1">
                      {(['ALL', 'ACTIVE', 'SUSPENDED'] as StatusFilterType[]).map((s) => {
                        const active = statusFilter === s;
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setStatusFilter(s)}
                            aria-pressed={active}
                            className={`px-2 py-1 rounded text-[10px] font-mono font-medium transition-all ${
                              active
                                ? s === 'ACTIVE'
                                  ? 'bg-emerald-700 text-white shadow-sm ring-1 ring-emerald-400'
                                  : s === 'SUSPENDED'
                                  ? 'bg-rose-700 text-white shadow-sm ring-1 ring-rose-400'
                                  : 'bg-amber-600 text-white shadow-sm ring-1 ring-amber-400'
                                : 'bg-slate-900 text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-800'
                            }`}
                          >
                            {s}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Directory Results List */}
                {hasSearched && (
                  <div className="space-y-3 pt-2 border-t border-slate-700/60">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>
                        {hasActiveFilters ? (
                          <>
                            Showing <strong className="text-amber-300">{filteredUsers.length}</strong> of{' '}
                            <strong className="text-slate-200">{searchResults.length}</strong> users
                          </>
                        ) : (
                          <>
                            Users found: <strong className="text-slate-200">{searchResults.length}</strong>
                            {searchQuery ? ` for "${searchQuery}"` : ' (active directory)'}
                          </>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => performSearch(searchQuery)}
                        disabled={isSearching}
                        aria-label="Refresh user list from database"
                        className="inline-flex items-center space-x-1 text-[11px] text-slate-400 hover:text-slate-200 disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3 h-3 ${isSearching ? 'animate-spin' : ''}`} />
                        <span>Refresh</span>
                      </button>
                    </div>

                    {filteredUsers.length === 0 ? (
                      <div className="p-6 bg-slate-900/60 rounded-lg border border-slate-800 text-center space-y-2">
                        <UserIcon className="w-8 h-8 text-slate-600 mx-auto" />
                        <p className="text-xs text-slate-400">
                          {hasActiveFilters
                            ? 'No users match your active role or status filters.'
                            : searchQuery
                            ? `No user profiles matched "${searchQuery}".`
                            : 'No user profiles found in the database.'}
                        </p>
                        {hasActiveFilters ? (
                          <button
                            type="button"
                            onClick={handleResetFilters}
                            className="text-xs text-amber-400 hover:underline pt-1"
                          >
                            Reset filters
                          </button>
                        ) : (
                          <p className="text-[11px] text-slate-500">
                            Ensure the user has signed in at least once to initialize their profile.
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-[580px] overflow-y-auto pr-1">
                        {filteredUsers.map((prof) => {
                          const isSelected = selectedUser?.id === prof.id;
                          const isSelf = user?.id === prof.id;

                          return (
                            <div
                              key={prof.id}
                              onClick={() => handleSelectUser(prof)}
                              className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                                isSelected
                                  ? 'bg-slate-900 border-amber-500 ring-2 ring-amber-500/40 shadow-lg shadow-amber-950/20'
                                  : 'bg-slate-900/60 border-slate-700/70 hover:border-slate-600 hover:bg-slate-900/90'
                              }`}
                            >
                              <div className="space-y-2">
                                {/* User Top Bar */}
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex items-center space-x-2.5 min-w-0">
                                    <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 font-bold text-xs flex-shrink-0">
                                      {prof.avatar_url ? (
                                        <img
                                          src={prof.avatar_url}
                                          alt=""
                                          className="w-full h-full rounded-full object-cover"
                                          referrerPolicy="no-referrer"
                                        />
                                      ) : prof.full_name ? (
                                        prof.full_name[0].toUpperCase()
                                      ) : (
                                        <UserIcon className="w-3.5 h-3.5" />
                                      )}
                                    </div>
                                    <div className="min-w-0">
                                      <div className="flex items-center space-x-1.5 flex-wrap">
                                        <span className="font-bold text-xs text-white truncate max-w-[140px] sm:max-w-[180px]">
                                          {prof.full_name || 'No Display Name'}
                                        </span>
                                        {isSelf && (
                                          <span className="px-1.5 py-0.2 bg-blue-950 text-blue-300 border border-blue-800 rounded text-[9px] font-mono font-bold">
                                            YOU
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-[11px] text-slate-400 font-mono truncate max-w-[160px] sm:max-w-[200px]">
                                        {prof.email}
                                      </div>
                                    </div>
                                  </div>

                                  <span className={`px-2 py-0.5 rounded text-[9px] font-mono border flex-shrink-0 ${
                                    prof.account_status === 'ACTIVE'
                                      ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                                      : 'bg-rose-950/80 text-rose-300 border-rose-800'
                                  }`}>
                                    {prof.account_status}
                                  </span>
                                </div>

                                {/* Roles & Manage Action Row */}
                                <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 gap-2">
                                  <div className="flex flex-wrap items-center gap-1 min-w-0">
                                    {prof.roles.length === 0 ? (
                                      <span className="text-[10px] text-slate-500 italic">No roles</span>
                                    ) : (
                                      prof.roles.map((r) => (
                                        <span
                                          key={r}
                                          className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold border ${
                                            r === 'SUPER_ADMIN'
                                              ? 'bg-amber-950/80 text-amber-300 border-amber-700/80'
                                              : r === 'ADMIN'
                                              ? 'bg-purple-950/80 text-purple-300 border-purple-800'
                                              : r === 'ORGANIZER'
                                              ? 'bg-blue-950/80 text-blue-300 border-blue-800'
                                              : 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                                          }`}
                                        >
                                          {r}
                                        </span>
                                      ))
                                    )}
                                  </div>

                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSelectUser(prof);
                                    }}
                                    className={`px-2.5 py-1 rounded text-[11px] font-semibold border transition-all flex items-center space-x-1 flex-shrink-0 ${
                                      isSelected
                                        ? 'bg-amber-500 text-slate-950 font-bold border-amber-400 shadow'
                                        : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                                    }`}
                                  >
                                    <span>{isSelected ? 'Selected' : 'Manage'}</span>
                                    <ChevronRight className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Selected User Management Panel (lg:col-span-7, sticky) */}
            <div ref={managementPanelRef} className="lg:col-span-7 lg:sticky lg:top-4 space-y-4">
              {selectedUser ? (
                <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-5 sm:p-6 space-y-6 shadow-xl">
                  {/* Top Bar with user identity, email, status, clear button */}
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-slate-700/60">
                    <div className="space-y-1.5">
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Target User</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                          selectedUser.account_status === 'ACTIVE'
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                            : 'bg-rose-950 text-rose-300 border-rose-800'
                        }`}>
                          Status: {selectedUser.account_status}
                        </span>
                      </div>
                      <h3 className="text-base sm:text-lg font-bold text-white">
                        {selectedUser.full_name || selectedUser.email}
                      </h3>
                      <div className="text-xs text-slate-300 font-mono">
                        {selectedUser.email}
                      </div>
                      <div className="pt-0.5">
                        <CopyableId id={selectedUser.id} label="User Account ID" />
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setSelectedUser(null);
                        setRoleToRevoke(null);
                      }}
                      className="self-start text-xs text-slate-400 hover:text-slate-200 px-3 py-1.5 bg-slate-900 rounded-lg border border-slate-700 transition-colors flex items-center space-x-1.5 focus:outline-none focus:ring-2 focus:ring-slate-500"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Clear Selection</span>
                    </button>
                  </div>

                  {/* Current Assigned Roles Overview */}
                  <div className="p-3.5 bg-slate-900/80 rounded-xl border border-slate-800 space-y-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Current Permanent Roles
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      {selectedUser.roles.length === 0 ? (
                        <span className="text-xs text-slate-500 italic">No permanent system roles currently assigned</span>
                      ) : (
                        selectedUser.roles.map((r) => (
                          <span
                            key={r}
                            className={`px-3 py-1 rounded-md text-xs font-mono font-bold border ${
                              r === 'SUPER_ADMIN'
                                ? 'bg-amber-950/90 text-amber-300 border-amber-700/80 ring-1 ring-amber-500/30'
                                : r === 'ADMIN'
                                ? 'bg-purple-950/90 text-purple-300 border-purple-800 ring-1 ring-purple-500/30'
                                : r === 'ORGANIZER'
                                ? 'bg-blue-950/90 text-blue-300 border-blue-800 ring-1 ring-blue-500/30'
                                : 'bg-emerald-950/90 text-emerald-300 border-emerald-800 ring-1 ring-emerald-500/30'
                            }`}
                          >
                            {r}
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Self-Mutation Warning if Super Admin selects their own account */}
                  {user?.id === selectedUser.id ? (
                    <div className="p-4 bg-amber-950/40 border border-amber-800/60 rounded-xl flex items-start space-x-3 text-amber-200 text-xs">
                      <ShieldAlert className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <span className="font-semibold text-amber-100">Self-Mutation Protected</span>
                        <p className="text-amber-300/90 leading-relaxed">
                          You are viewing your own profile. Per database security invariants, Super Admins are strictly forbidden from assigning or revoking roles on their own accounts.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-5">
                      {/* Feedback Banner (Inline in active viewport with ARIA live regions) */}
                      {feedbackMessage && (
                        <div
                          role={feedbackMessage.type === 'success' ? 'status' : 'alert'}
                          aria-live={feedbackMessage.type === 'success' ? 'polite' : 'assertive'}
                          className={`p-4 rounded-xl border flex items-start space-x-3 text-xs ${
                            feedbackMessage.type === 'success'
                              ? 'bg-emerald-950/70 border-emerald-700/80 text-emerald-200 shadow-md'
                              : 'bg-rose-950/70 border-rose-700/80 text-rose-200 shadow-md'
                          }`}
                        >
                          {feedbackMessage.type === 'success' ? (
                            <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                          ) : (
                            <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
                          )}
                          <div className="space-y-1 flex-1">
                            <div className="font-bold text-sm">{feedbackMessage.text}</div>
                            {feedbackMessage.details && (
                              <p className="text-xs opacity-90 leading-relaxed font-mono">{feedbackMessage.details}</p>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                        {/* Assign Role Section */}
                        <div className="space-y-3 bg-slate-900/60 p-4 sm:p-5 rounded-xl border border-slate-800">
                          <div className="flex items-center space-x-2 text-xs font-bold text-slate-200 uppercase tracking-wider">
                            <UserPlus className="w-4 h-4 text-emerald-400" />
                            <span>Assign Role</span>
                          </div>

                          <p className="text-xs text-slate-400">
                            Role assignment is strictly additive; existing roles are preserved.
                          </p>

                          <div className="space-y-2">
                            {(['ADMIN', 'ORGANIZER', 'COACH'] as AssignableRole[]).map((rKey) => {
                              const def = ROLE_DEFINITIONS[rKey];
                              const isAlreadyAssigned = selectedUser.roles.includes(rKey);
                              const isSelected = selectedRoleToAssign === rKey;

                              return (
                                <button
                                  key={rKey}
                                  type="button"
                                  onClick={() => setSelectedRoleToAssign(rKey)}
                                  className={`w-full p-3 rounded-lg border text-left transition-all ${
                                    isSelected
                                      ? 'bg-slate-950 border-emerald-500 ring-1 ring-emerald-500/50'
                                      : 'bg-slate-950/40 border-slate-800 hover:border-slate-700'
                                  }`}
                                >
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="font-mono font-bold text-xs text-slate-100">{rKey}</span>
                                    <div className="flex items-center space-x-1.5">
                                      {isAlreadyAssigned && (
                                        <span className="px-2 py-0.5 bg-slate-800 text-slate-400 border border-slate-700 rounded text-[9px] font-mono">
                                          Assigned
                                        </span>
                                      )}
                                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${def.badgeColor}`}>
                                        {def.title}
                                      </span>
                                    </div>
                                  </div>
                                  <p className="text-[11px] text-slate-400">{def.description}</p>
                                </button>
                              );
                            })}
                          </div>

                          <button
                            type="button"
                            disabled={isExecuting || selectedUser.account_status !== 'ACTIVE'}
                            onClick={() => handleAssignRole(selectedUser)}
                            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-md transition-colors flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          >
                            {isExecuting && activeAction === 'ASSIGN' ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span>Updating Role...</span>
                              </>
                            ) : (
                              <>
                                <UserPlus className="w-4 h-4" />
                                <span>Assign Role ({selectedRoleToAssign})</span>
                              </>
                            )}
                          </button>
                        </div>

                        {/* Revoke Role Section */}
                        <div className="space-y-3 bg-slate-900/60 p-4 sm:p-5 rounded-xl border border-slate-800">
                          <div className="flex items-center space-x-2 text-xs font-bold text-slate-200 uppercase tracking-wider">
                            <UserMinus className="w-4 h-4 text-rose-400" />
                            <span>Revoke Role</span>
                          </div>

                          <p className="text-xs text-slate-400">
                            Select an assigned permanent role to revoke. Requires explicit confirmation.
                          </p>

                          {selectedUser.roles.filter((r) => r !== 'SUPER_ADMIN').length === 0 ? (
                            <div className="p-6 bg-slate-950/60 rounded-lg border border-slate-800 text-center text-xs text-slate-500 italic space-y-1">
                              <UserCheck className="w-6 h-6 text-slate-600 mx-auto" />
                              <p>
                                {selectedUser.roles.includes('SUPER_ADMIN')
                                  ? 'Target possesses SUPER_ADMIN which cannot be revoked via RPC.'
                                  : 'Target currently holds no revokable permanent roles.'}
                              </p>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {selectedUser.roles
                                .filter((r): r is AssignableRole => r !== 'SUPER_ADMIN')
                                .map((rKey) => {
                                  const def = ROLE_DEFINITIONS[rKey];
                                  return (
                                    <div
                                      key={rKey}
                                      className="p-3 bg-slate-950 rounded-lg border border-slate-800 flex items-center justify-between"
                                    >
                                      <div>
                                        <div className="font-mono font-bold text-xs text-slate-200">{rKey}</div>
                                        <div className="text-[11px] text-slate-400">{def?.title}</div>
                                      </div>

                                      <button
                                        type="button"
                                        disabled={isExecuting}
                                        onClick={() => setRoleToRevoke(rKey)}
                                        className="px-3 py-1.5 bg-rose-600/90 hover:bg-rose-500 text-white rounded text-xs font-semibold transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-rose-500"
                                      >
                                        Revoke
                                      </button>
                                    </div>
                                  );
                                })}
                            </div>
                          )}

                          {/* Revocation Confirmation Box */}
                          {roleToRevoke && (
                            <div className="p-4 bg-rose-950/60 border border-rose-800 rounded-xl space-y-3">
                              <div className="flex items-center space-x-2 text-rose-200 font-bold text-xs">
                                <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                                <span>Confirm Role Revocation</span>
                              </div>
                              <p className="text-xs text-rose-300/90 leading-relaxed">
                                Are you sure you want to revoke <strong className="font-mono text-white">{roleToRevoke}</strong> from <strong className="text-white">{selectedUser.full_name || selectedUser.email}</strong>?
                              </p>
                              <div className="flex items-center space-x-2 pt-1">
                                <button
                                  type="button"
                                  disabled={isExecuting}
                                  onClick={confirmRevokeRole}
                                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded text-xs font-semibold transition-colors flex items-center space-x-1.5 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-rose-400"
                                >
                                  {isExecuting && activeAction === 'REVOKE' ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <UserMinus className="w-3.5 h-3.5" />
                                  )}
                                  <span>Yes, Revoke Role</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={isExecuting}
                                  onClick={() => setRoleToRevoke(null)}
                                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* Empty Selected-User State Card */
                <div className="space-y-4">
                  {/* Feedback Banner if no user is selected but previous action feedback exists */}
                  {feedbackMessage && (
                    <div
                      role={feedbackMessage.type === 'success' ? 'status' : 'alert'}
                      aria-live={feedbackMessage.type === 'success' ? 'polite' : 'assertive'}
                      className={`p-4 rounded-xl border flex items-start space-x-3 text-xs ${
                        feedbackMessage.type === 'success'
                          ? 'bg-emerald-950/60 border-emerald-800 text-emerald-200'
                          : 'bg-rose-950/60 border-rose-800 text-rose-200'
                      }`}
                    >
                      {feedbackMessage.type === 'success' ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
                      )}
                      <div className="space-y-1">
                        <div className="font-bold text-sm">{feedbackMessage.text}</div>
                        {feedbackMessage.details && (
                          <p className="text-xs opacity-90 leading-relaxed font-mono">{feedbackMessage.details}</p>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="bg-slate-800/50 border border-slate-700/60 border-dashed rounded-xl p-8 sm:p-12 text-center space-y-4 flex flex-col items-center justify-center">
                    <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-700/80 flex items-center justify-center text-slate-400 shadow-inner">
                      <UserCheck className="w-7 h-7 text-amber-400" />
                    </div>
                    <div className="space-y-1.5 max-w-sm">
                      <h4 className="text-sm font-bold text-white">Select a user to manage roles</h4>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Choose a user from the directory on the left to view current roles and manage permanent role assignments.
                      </p>
                    </div>
                    {searchResults.length > 0 && (
                      <div className="pt-2 text-[11px] text-slate-500 font-mono">
                        {searchResults.length} user{searchResults.length === 1 ? '' : 's'} available in directory
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* In-Session RPC Log Feed */}
              {sessionLogs.length > 0 && (
                <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-4 sm:p-5 space-y-3">
                  <div className="flex items-center space-x-2 text-xs font-bold text-slate-200 uppercase tracking-wider">
                    <Clock className="w-4 h-4 text-amber-400" />
                    <span>Active Session Role Audit Log ({sessionLogs.length})</span>
                  </div>

                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {sessionLogs.map((log, idx) => (
                      <div
                        key={idx}
                        className="p-3 bg-slate-900 rounded-lg border border-slate-800 text-xs font-mono flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-slate-300"
                      >
                        <div className="flex items-center space-x-2 truncate">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            log.action.includes('ASSIGN')
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : 'bg-rose-950 text-rose-300 border border-rose-800'
                          }`}>
                            {log.action}
                          </span>
                          <span className="text-white font-bold">{log.role}</span>
                          <ArrowRight className="w-3.5 h-3.5 text-slate-600" />
                          <span className="text-slate-400 truncate">{log.targetName || log.targetEmail || log.user_id}</span>
                        </div>
                        <span className="text-[10px] text-slate-500">{log.timestamp}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Security Architecture Summary */}
          <div className="bg-slate-900/60 rounded-xl p-4 border border-slate-800 text-xs text-slate-400 space-y-1.5">
            <div className="flex items-center space-x-1.5 text-slate-200 font-semibold mb-1">
              <Layers className="w-4 h-4 text-amber-400" />
              <span>Permanent RBAC Security Invariants</span>
            </div>
            <p>• <strong>Strict RPC Execution:</strong> UI invokes <code className="font-mono text-slate-300">assign_permanent_role</code> and <code className="font-mono text-slate-300">revoke_permanent_role</code> with server-side authorization.</p>
            <p>• <strong>Directory Search RPC:</strong> User search routes exclusively through <code className="font-mono text-slate-300">search_users_for_admin</code>, preserving RLS on <code className="font-mono text-slate-300">public.profiles</code>.</p>
            <p>• <strong>Immutable Super Admin Boundary:</strong> <code className="font-mono text-slate-300">SUPER_ADMIN</code> cannot be assigned or revoked via permanent role management RPCs.</p>
            <p>• <strong>Account Status Requirement:</strong> Target accounts must hold <code className="font-mono text-emerald-400">account_status = 'ACTIVE'</code> to receive or revoke permanent roles.</p>
          </div>
        </>
      )}
    </div>
  );
};
