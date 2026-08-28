import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { coachSuccessionService, validateClubLogo, MAX_CLUB_LOGO_SIZE_BYTES, MAX_CLUB_LOGO_DIMENSION } from '../../services/coachSuccessionService';
import { roleService } from '../../services/roleService';
import {
  Club,
  ActiveClubCoach,
  ClubCoachAssignment,
  CoachSuccessionRequest,
  ClubDeletionSafetyCheck,
} from '../../types/coachSuccession';
import { UserSearchResult } from '../../types/roles';
import {
  ShieldCheck,
  Users,
  UserCheck,
  UserX,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Search,
  Building,
  Building2,
  History,
  PlusCircle,
  ArrowRightLeft,
  Ban,
  Archive,
  Trash2,
  RotateCcw,
  ShieldAlert,
  AlertOctagon,
  Lock,
  Info,
  ChevronRight,
  Upload,
  Image as ImageIcon,
  X,
  MapPin,
  Edit3,
} from 'lucide-react';

export const CoachSuccessionManagement: React.FC = () => {
  const { user, roles } = useAuth();
  const isSuperAdmin = roles.includes('SUPER_ADMIN');
  const hasAdminAccess = roles.includes('SUPER_ADMIN') || roles.includes('ADMIN');

  const [clubs, setClubs] = useState<Club[]>([]);
  const [selectedClub, setSelectedClub] = useState<Club | null>(null);
  const [activeCoach, setActiveCoach] = useState<ActiveClubCoach | null>(null);
  const [coachHistory, setCoachHistory] = useState<ClubCoachAssignment[]>([]);
  const [pendingRequests, setPendingRequests] = useState<CoachSuccessionRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<'clubs' | 'governance' | 'successions' | 'create_club'>('clubs');

  // Search for new coach
  const [coachSearchQuery, setCoachSearchQuery] = useState('');
  const [coachSearchResults, setCoachSearchResults] = useState<UserSearchResult[]>([]);
  const [selectedIncomingCoach, setSelectedIncomingCoach] = useState<UserSearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [successionReason, setSuccessionReason] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');

  // Create club state
  const [newClubName, setNewClubName] = useState('');
  const [newClubCode, setNewClubCode] = useState('');
  const [newClubShortName, setNewClubShortName] = useState('');
  const [newClubStreetAddress, setNewClubStreetAddress] = useState('');
  const [newClubCity, setNewClubCity] = useState('');
  const [newClubProvince, setNewClubProvince] = useState('');
  const [newClubPostalCode, setNewClubPostalCode] = useState('');
  const [newClubLogoFile, setNewClubLogoFile] = useState<File | null>(null);
  const [newClubLogoPreview, setNewClubLogoPreview] = useState<string | null>(null);
  const [logoValidationError, setLogoValidationError] = useState<string | null>(null);
  const [isValidatingLogo, setIsValidatingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Edit Club Profile & Address Modal State
  const [showEditModal, setShowEditModal] = useState(false);
  const [editShortName, setEditShortName] = useState('');
  const [editStreetAddress, setEditStreetAddress] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editProvince, setEditProvince] = useState('');
  const [editPostalCode, setEditPostalCode] = useState('');
  const [editLogoFile, setEditLogoFile] = useState<File | null>(null);
  const [editLogoPreview, setEditLogoPreview] = useState<string | null>(null);
  const [editLogoError, setEditLogoError] = useState<string | null>(null);
  const [isEditValidatingLogo, setIsEditValidatingLogo] = useState(false);
  const editLogoInputRef = useRef<HTMLInputElement>(null);

  // Governance Modals State
  const [showBanModal, setShowBanModal] = useState(false);
  const [banDurationPreset, setBanDurationPreset] = useState<string>('7');
  const [customBanDays, setCustomBanDays] = useState<number>(14);
  const [banReason, setBanReason] = useState('');
  const [banNotes, setBanNotes] = useState('');

  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [restoreNotes, setRestoreNotes] = useState('');

  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletionSafety, setDeletionSafety] = useState<ClubDeletionSafetyCheck | null>(null);
  const [checkingSafety, setCheckingSafety] = useState(false);
  const [typedConfirmationName, setTypedConfirmationName] = useState('');

  const [modalError, setModalError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setLogoValidationError(null);
    if (!file) {
      return;
    }

    setIsValidatingLogo(true);
    try {
      const result = await validateClubLogo(file);
      if (!result.valid) {
        setLogoValidationError(result.error || 'Invalid logo file.');
        if (newClubLogoPreview) {
          URL.revokeObjectURL(newClubLogoPreview);
        }
        setNewClubLogoFile(null);
        setNewClubLogoPreview(null);
        if (logoInputRef.current) {
          logoInputRef.current.value = '';
        }
      } else {
        if (newClubLogoPreview) {
          URL.revokeObjectURL(newClubLogoPreview);
        }
        setNewClubLogoFile(file);
        setNewClubLogoPreview(URL.createObjectURL(file));
      }
    } finally {
      setIsValidatingLogo(false);
    }
  };

  const handleClearLogo = () => {
    if (newClubLogoPreview) {
      URL.revokeObjectURL(newClubLogoPreview);
    }
    setNewClubLogoFile(null);
    setNewClubLogoPreview(null);
    setLogoValidationError(null);
    if (logoInputRef.current) {
      logoInputRef.current.value = '';
    }
  };

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    try {
      const [fetchedClubs, fetchedRequests] = await Promise.all([
        coachSuccessionService.getAllClubs(),
        isSuperAdmin ? coachSuccessionService.getPendingSuccessions() : Promise.resolve([]),
      ]);
      setClubs(fetchedClubs);
      setPendingRequests(fetchedRequests);
      if (fetchedClubs.length > 0) {
        setSelectedClub((prev) => {
          if (!prev) return fetchedClubs[0];
          const exists = fetchedClubs.find((c) => c.id === prev.id);
          return exists || fetchedClubs[0];
        });
      }
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const loadClubDetails = useCallback(async (clubId: string) => {
    setLoading(true);
    try {
      const [currentActive, history] = await Promise.all([
        coachSuccessionService.getClubActiveCoach(clubId),
        coachSuccessionService.getClubCoachHistory(clubId),
      ]);
      setActiveCoach(currentActive);
      setCoachHistory(history);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedClub) {
      loadClubDetails(selectedClub.id);
    }
  }, [selectedClub, loadClubDetails]);

  const handleSearchCoach = async () => {
    if (!coachSearchQuery.trim()) return;
    setIsSearching(true);
    try {
      const results = await roleService.searchUsersForAdmin(coachSearchQuery.trim());
      setCoachSearchResults(results);
    } finally {
      setIsSearching(false);
    }
  };

  const handleOpenEditModal = (club: Club) => {
    setEditShortName(club.short_name || '');
    setEditStreetAddress(club.street_address || '');
    setEditCity(club.city || '');
    setEditProvince(club.province || '');
    setEditPostalCode(club.postal_code || '');
    setEditLogoFile(null);
    setEditLogoPreview(club.logo_url || null);
    setEditLogoError(null);
    setModalError(null);
    setShowEditModal(true);
  };

  const handleEditLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setEditLogoError(null);
    if (!file) return;

    setIsEditValidatingLogo(true);
    try {
      const result = await validateClubLogo(file);
      if (!result.valid) {
        setEditLogoError(result.error || 'Invalid logo file.');
        setEditLogoFile(null);
        if (editLogoInputRef.current) {
          editLogoInputRef.current.value = '';
        }
      } else {
        setEditLogoFile(file);
        setEditLogoPreview(URL.createObjectURL(file));
      }
    } finally {
      setIsEditValidatingLogo(false);
    }
  };

  const handleClearEditLogo = () => {
    setEditLogoFile(null);
    setEditLogoPreview(null);
    setEditLogoError(null);
    if (editLogoInputRef.current) {
      editLogoInputRef.current.value = '';
    }
  };

  const handleSaveClubProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClub) return;
    setActionLoading(true);
    setModalError(null);
    try {
      let finalLogoUrl = selectedClub.logo_url;
      if (editLogoFile) {
        const uploadRes = await coachSuccessionService.uploadClubLogo(selectedClub.id, editLogoFile);
        if (uploadRes.success && uploadRes.logoUrl) {
          finalLogoUrl = uploadRes.logoUrl;
        } else {
          setModalError(`Failed to upload logo: ${uploadRes.error || 'Storage error'}`);
          setActionLoading(false);
          return;
        }
      } else if (editLogoPreview === null) {
        finalLogoUrl = null;
      }

      const res = await coachSuccessionService.updateClubProfile({
        clubId: selectedClub.id,
        shortName: editShortName.trim() || null,
        streetAddress: editStreetAddress.trim() || null,
        city: editCity.trim() || null,
        province: editProvince.trim() || null,
        postalCode: editPostalCode.trim() || null,
        logoUrl: finalLogoUrl,
      });

      if (res.success) {
        setMessage({ type: 'success', text: `Club "${selectedClub.name}" profile updated successfully!` });
        setShowEditModal(false);
        await loadInitialData();
      } else {
        setModalError(res.error || 'Failed to update club profile');
      }
    } catch (err: any) {
      setModalError(err.message || 'An error occurred');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateClub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClubName.trim()) return;
    setActionLoading(true);
    setMessage(null);
    try {
      const res = await coachSuccessionService.createClub({
        name: newClubName.trim(),
        code: newClubCode.trim() || undefined,
        shortName: newClubShortName.trim() || undefined,
        streetAddress: newClubStreetAddress.trim() || undefined,
        city: newClubCity.trim() || undefined,
        province: newClubProvince.trim() || undefined,
        postalCode: newClubPostalCode.trim() || undefined,
        logoFile: newClubLogoFile,
      });
      if (res.success) {
        let successText = `Club "${newClubName}" successfully created!`;
        if (res.logoWarning) {
          successText += ` Note: ${res.logoWarning}`;
        } else if (res.logoUrl) {
          successText += ` (Logo uploaded and linked)`;
        }
        setMessage({ type: res.logoWarning ? 'error' : 'success', text: successText });
        setNewClubName('');
        setNewClubCode('');
        setNewClubShortName('');
        setNewClubStreetAddress('');
        setNewClubCity('');
        setNewClubProvince('');
        setNewClubPostalCode('');
        handleClearLogo();
        setActiveSubTab('clubs');
        await loadInitialData();
      } else {
        setMessage({ type: 'error', text: res.error || 'Failed to create club' });
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleRequestSuccession = async () => {
    if (!selectedClub || !selectedIncomingCoach) return;
    setActionLoading(true);
    setMessage(null);
    try {
      const res = await coachSuccessionService.requestSuccession(
        selectedClub.id,
        selectedIncomingCoach.id,
        'HEAD_COACH',
        successionReason.trim()
      );
      if (res.success) {
        setMessage({ type: 'success', text: `Succession request initiated for ${selectedIncomingCoach.full_name || selectedIncomingCoach.email}` });
        setSelectedIncomingCoach(null);
        setSuccessionReason('');
        setCoachSearchResults([]);
        await loadInitialData();
      } else {
        setMessage({ type: 'error', text: res.error || 'Failed to request succession' });
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleDirectAssignCoach = async () => {
    if (!selectedClub || !selectedIncomingCoach) return;
    setActionLoading(true);
    setMessage(null);
    try {
      const res = await coachSuccessionService.directAssignCoach(
        selectedClub.id,
        selectedIncomingCoach.id,
        'HEAD_COACH',
        'Direct appointment by Administrator'
      );
      if (res.success) {
        setMessage({ type: 'success', text: `Directly appointed ${selectedIncomingCoach.full_name || selectedIncomingCoach.email} as Head Coach!` });
        setSelectedIncomingCoach(null);
        setCoachSearchResults([]);
        await loadClubDetails(selectedClub.id);
      } else {
        setMessage({ type: 'error', text: res.error || 'Failed to appoint coach' });
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleApproveSuccession = async (requestId: string) => {
    setActionLoading(true);
    setMessage(null);
    try {
      const res = await coachSuccessionService.approveSuccession(requestId, reviewNotes.trim());
      if (res.success) {
        setMessage({ type: 'success', text: 'Succession request approved. New Head Coach is now active!' });
        setReviewNotes('');
        await loadInitialData();
        if (selectedClub) {
          await loadClubDetails(selectedClub.id);
        }
      } else {
        setMessage({ type: 'error', text: res.error || 'Approval failed' });
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectSuccession = async (requestId: string) => {
    setActionLoading(true);
    setMessage(null);
    try {
      const res = await coachSuccessionService.rejectSuccession(requestId, reviewNotes.trim());
      if (res.success) {
        setMessage({ type: 'success', text: 'Succession request rejected.' });
        setReviewNotes('');
        await loadInitialData();
      } else {
        setMessage({ type: 'error', text: res.error || 'Rejection failed' });
      }
    } finally {
      setActionLoading(false);
    }
  };

  // GOVERNANCE ACTIONS

  const handleSuspendClub = async () => {
    if (!selectedClub) return;
    setActionLoading(true);
    setModalError(null);
    setMessage(null);
    try {
      const days = banDurationPreset === 'indefinite' ? null : banDurationPreset === 'custom' ? customBanDays : parseInt(banDurationPreset, 10);
      const res = await coachSuccessionService.suspendClub(selectedClub.id, days, banReason, banNotes);
      if (res.success) {
        setMessage({ type: 'success', text: `Club "${selectedClub.name}" has been suspended.` });
        setShowBanModal(false);
        setBanReason('');
        setBanNotes('');
        setModalError(null);
        await loadInitialData();
      } else {
        setModalError(res.error || 'Failed to suspend club');
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestoreClub = async () => {
    if (!selectedClub) return;
    setActionLoading(true);
    setModalError(null);
    setMessage(null);
    try {
      const res = await coachSuccessionService.restoreClub(selectedClub.id, restoreNotes);
      if (res.success) {
        setMessage({ type: 'success', text: `Club "${selectedClub.name}" has been restored to Active status.` });
        setShowRestoreModal(false);
        setRestoreNotes('');
        setModalError(null);
        await loadInitialData();
      } else {
        setModalError(res.error || 'Failed to restore club');
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleArchiveClub = async () => {
    if (!selectedClub) return;
    setActionLoading(true);
    setModalError(null);
    setMessage(null);
    try {
      const res = await coachSuccessionService.archiveClub(selectedClub.id, archiveReason);
      if (res.success) {
        setMessage({ type: 'success', text: `Club "${selectedClub.name}" has been safely archived.` });
        setShowArchiveModal(false);
        setArchiveReason('');
        setModalError(null);
        await loadInitialData();
      } else {
        setModalError(res.error || 'Failed to archive club');
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenDeleteModal = async () => {
    if (!selectedClub) return;
    setModalError(null);
    setShowDeleteModal(true);
    setCheckingSafety(true);
    setTypedConfirmationName('');
    try {
      const check = await coachSuccessionService.checkDeletionSafety(selectedClub.id);
      setDeletionSafety(check);
    } finally {
      setCheckingSafety(false);
    }
  };

  const handleDeleteClub = async () => {
    if (!selectedClub) return;
    setActionLoading(true);
    setModalError(null);
    setMessage(null);
    try {
      const res = await coachSuccessionService.deleteClubPermanently(selectedClub.id, typedConfirmationName.trim());
      if (res.success) {
        setMessage({ type: 'success', text: `Club "${selectedClub.name}" permanently deleted.` });
        setShowDeleteModal(false);
        setSelectedClub(null);
        setModalError(null);
        await loadInitialData();
      } else {
        setModalError(res.error || 'Permanent deletion failed');
      }
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 shadow-xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center space-x-2">
            <Building className="w-6 h-6 text-amber-400" />
            <h2 className="text-xl font-bold text-white tracking-wide">Club & Coach Governance Management</h2>
            <span className="px-2 py-0.5 text-xs font-semibold rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
              PHASE 10
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Normalized Club registry, authoritative coach appointments, temporal suspension controls, and dependency safety.
          </p>
        </div>

        {/* Sub-nav Tabs */}
        <div className="flex items-center space-x-2 bg-slate-950 p-1 rounded-lg border border-slate-800 text-sm overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveSubTab('clubs')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors whitespace-nowrap ${
              activeSubTab === 'clubs'
                ? 'bg-amber-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Clubs & Coaches
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('governance')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center space-x-1.5 whitespace-nowrap ${
              activeSubTab === 'governance'
                ? 'bg-amber-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ShieldAlert className="w-4 h-4" />
            <span>Club Governance</span>
          </button>
          {isSuperAdmin && (
            <button
              type="button"
              onClick={() => setActiveSubTab('successions')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center space-x-1.5 whitespace-nowrap ${
                activeSubTab === 'successions'
                  ? 'bg-amber-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <span>Succession Requests</span>
              {pendingRequests.length > 0 && (
                <span className="px-1.5 py-0.2 bg-amber-400 text-slate-950 text-xs font-bold rounded-full">
                  {pendingRequests.length}
                </span>
              )}
            </button>
          )}
          {hasAdminAccess && (
            <button
              type="button"
              onClick={() => setActiveSubTab('create_club')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center space-x-1 whitespace-nowrap ${
                activeSubTab === 'create_club'
                  ? 'bg-amber-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <PlusCircle className="w-4 h-4" />
              <span>New Club / Team</span>
            </button>
          )}
        </div>
      </div>

      {/* Status Feedback */}
      {message && (
        <div
          className={`p-4 rounded-lg border flex items-start space-x-3 ${
            message.type === 'success'
              ? 'bg-emerald-950/60 border-emerald-800/70 text-emerald-300'
              : 'bg-red-950/60 border-red-800/70 text-red-300'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          )}
          <span className="text-sm font-medium">{message.text}</span>
        </div>
      )}

      {/* TAB 1: CLUBS & ACTIVE COACHES */}
      {activeSubTab === 'clubs' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Clubs List */}
          <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">Registered Clubs</h3>
              <button
                type="button"
                onClick={loadInitialData}
                disabled={loading}
                className="p-1 rounded text-slate-400 hover:text-white"
                title="Refresh Clubs"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {clubs.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-sm">
                No clubs registered yet.
              </div>
            ) : (
              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                {clubs.map((club) => {
                  const status = club.governance_status || (club.is_active ? 'ACTIVE' : 'SUSPENDED');
                  return (
                    <button
                      key={club.id}
                      type="button"
                      onClick={() => setSelectedClub(club)}
                      className={`w-full text-left p-3 rounded-lg border transition-all ${
                        selectedClub?.id === club.id
                          ? 'bg-amber-950/40 border-amber-500/60 text-white shadow-md'
                          : 'bg-slate-900/60 border-slate-800/60 text-slate-300 hover:bg-slate-800/60'
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <div className="w-9 h-9 rounded-lg bg-slate-950 border border-slate-700 flex items-center justify-center overflow-hidden flex-shrink-0">
                          {club.logo_url ? (
                            <img
                              src={club.logo_url}
                              alt={club.name}
                              className="w-full h-full object-contain"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <Building className="w-4 h-4 text-amber-400" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-sm truncate">{club.name}</span>
                            {club.code && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono ml-2 flex-shrink-0">
                                {club.code}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-xs text-slate-400 truncate">
                              {club.short_name || (club.city ? `${club.city}${club.province ? `, ${club.province}` : ''}` : 'No short name')}
                            </span>
                            <span
                              className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded ml-2 flex-shrink-0 ${
                                status === 'ACTIVE'
                                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                  : status === 'SUSPENDED'
                                  ? 'bg-rose-950 text-rose-300 border border-rose-800'
                                  : 'bg-slate-800 text-slate-400 border border-slate-700'
                              }`}
                            >
                              {status}
                            </span>
                          </div>
                          {(club.city || club.province) && (
                            <div className="flex items-center text-[11px] text-slate-500 mt-1 truncate">
                              <MapPin className="w-3 h-3 mr-1 text-slate-500 flex-shrink-0" />
                              <span className="truncate">
                                {[club.street_address, club.city, club.province].filter(Boolean).join(', ')}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Column: Selected Club Active Coach & Succession Controls */}
          <div className="lg:col-span-2 space-y-6">
            {selectedClub ? (
              <>
                {/* Active Coach Card */}
                <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="w-12 h-12 rounded-xl bg-slate-900 border border-amber-500/40 p-1 flex items-center justify-center shadow-lg overflow-hidden flex-shrink-0">
                        {selectedClub.logo_url ? (
                          <img
                            src={selectedClub.logo_url}
                            alt={selectedClub.name}
                            className="w-full h-full object-contain rounded-lg"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <Building className="w-6 h-6 text-amber-400" />
                        )}
                      </div>
                      <div>
                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                          Active Head Coach
                        </span>
                        <h3 className="text-lg font-bold text-white">{selectedClub.name}</h3>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center space-x-1">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Authoritative RLS Scope</span>
                    </span>
                  </div>

                  {activeCoach ? (
                    <div className="flex items-center space-x-4 bg-slate-900/80 p-4 rounded-lg border border-slate-800">
                      <div className="w-12 h-12 rounded-full bg-amber-600/30 border border-amber-500/40 flex items-center justify-center text-amber-300 font-bold text-lg">
                        {activeCoach.full_name ? activeCoach.full_name[0].toUpperCase() : 'C'}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center space-x-2">
                          <h4 className="text-base font-bold text-white">{activeCoach.full_name || 'Unnamed Coach'}</h4>
                          <span className="px-2 py-0.5 text-xs rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                            {activeCoach.role_type}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 font-mono mt-0.5">{activeCoach.email}</p>
                        <p className="text-xs text-slate-500 mt-1 flex items-center space-x-1">
                          <Clock className="w-3 h-3" />
                          <span>Appointed on: {new Date(activeCoach.effective_from).toLocaleDateString()}</span>
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 bg-slate-900/40 border border-dashed border-slate-800 rounded-lg text-center text-slate-400 text-sm">
                      No active Head Coach assigned yet to this club.
                    </div>
                  )}

                  {/* Institutional Profile & Address Summary */}
                  <div className="bg-slate-900/60 p-3.5 rounded-lg border border-slate-800 text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1.5 font-bold text-slate-300">
                        <Building2 className="w-3.5 h-3.5 text-amber-400" />
                        <span>Institutional Profile & Location</span>
                      </div>
                      {hasAdminAccess && (
                        <button
                          type="button"
                          onClick={() => handleOpenEditModal(selectedClub)}
                          className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-amber-400 hover:text-amber-300 rounded border border-slate-700 font-semibold flex items-center space-x-1 transition-colors"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>Edit Profile / Address</span>
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-slate-300 pt-1">
                      <div className="flex items-start space-x-2">
                        <span className="text-slate-500">Short Name:</span>
                        <span className="font-medium text-white">{selectedClub.short_name || 'None'}</span>
                      </div>
                      <div className="flex items-start space-x-2">
                        <span className="text-slate-500">Code:</span>
                        <span className="font-mono text-amber-300">{selectedClub.code || 'None'}</span>
                      </div>
                      <div className="flex items-start space-x-2 md:col-span-2">
                        <MapPin className="w-3.5 h-3.5 text-slate-500 flex-shrink-0 mt-0.5" />
                        <div className="text-slate-300">
                          {selectedClub.street_address || selectedClub.city || selectedClub.province || selectedClub.postal_code ? (
                            <span>
                              {[selectedClub.street_address, selectedClub.city, selectedClub.province, selectedClub.postal_code]
                                .filter(Boolean)
                                .join(', ')}
                            </span>
                          ) : (
                            <span className="text-slate-500 italic">No structured address on file</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Initiate Succession / Direct Assign Form */}
                <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-5 space-y-4">
                  <div className="flex items-center space-x-2">
                    <ArrowRightLeft className="w-5 h-5 text-amber-400" />
                    <h3 className="text-base font-bold text-white">
                      {hasAdminAccess ? 'Assign / Transfer Head Coach' : 'Request Coach Succession'}
                    </h3>
                  </div>

                  <div className="space-y-3">
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                      Search Incoming Coach Profile
                    </label>
                    <div className="flex space-x-2">
                      <div className="relative flex-1">
                        <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                        <input
                          type="text"
                          value={coachSearchQuery}
                          onChange={(e) => setCoachSearchQuery(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSearchCoach()}
                          placeholder="Search user by email or name..."
                          className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleSearchCoach}
                        disabled={isSearching || !coachSearchQuery.trim()}
                        className="px-4 py-2 bg-slate-800 text-slate-200 hover:bg-slate-700 font-semibold rounded-lg text-sm flex items-center space-x-1.5 disabled:opacity-50"
                      >
                        {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>Search</span>}
                      </button>
                    </div>

                    {/* Search Results */}
                    {coachSearchResults.length > 0 && (
                      <div className="p-2 bg-slate-900 border border-slate-800 rounded-lg space-y-1 max-h-48 overflow-y-auto">
                        {coachSearchResults.map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => setSelectedIncomingCoach(u)}
                            className={`w-full text-left p-2 rounded flex items-center justify-between text-xs transition-colors ${
                              selectedIncomingCoach?.id === u.id
                                ? 'bg-amber-600 text-white'
                                : 'text-slate-300 hover:bg-slate-800'
                            }`}
                          >
                            <span className="font-semibold">{u.full_name || 'No Name'} ({u.email})</span>
                            <span className="font-mono text-slate-400">{u.roles.join(', ') || 'PLAYER'}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {selectedIncomingCoach && (
                      <div className="p-3 bg-amber-950/30 border border-amber-500/40 rounded-lg space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-amber-300">Selected Candidate:</span>
                          <button
                            type="button"
                            onClick={() => setSelectedIncomingCoach(null)}
                            className="text-xs text-slate-400 hover:text-white"
                          >
                            Clear
                          </button>
                        </div>
                        <p className="text-sm font-bold text-white">
                          {selectedIncomingCoach.full_name || selectedIncomingCoach.email}
                        </p>
                      </div>
                    )}

                    <div className="space-y-1">
                      <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                        Reason for Succession / Appointment
                      </label>
                      <textarea
                        value={successionReason}
                        onChange={(e) => setSuccessionReason(e.target.value)}
                        placeholder="e.g. End of term appointment, organizational change..."
                        rows={2}
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </div>

                    <div className="flex space-x-3 pt-2">
                      {hasAdminAccess ? (
                        <button
                          type="button"
                          onClick={handleDirectAssignCoach}
                          disabled={actionLoading || !selectedIncomingCoach}
                          className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-lg text-sm flex items-center justify-center space-x-2 disabled:opacity-50"
                        >
                          {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
                          <span>Direct Appoint Head Coach</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleRequestSuccession}
                          disabled={actionLoading || !selectedIncomingCoach}
                          className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-lg text-sm flex items-center justify-center space-x-2 disabled:opacity-50"
                        >
                          {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />}
                          <span>Submit Succession Request</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Historical Roster */}
                <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-5 space-y-4">
                  <div className="flex items-center space-x-2">
                    <History className="w-5 h-5 text-amber-400" />
                    <h3 className="text-base font-bold text-white">Historical Coach Appointments</h3>
                  </div>

                  {coachHistory.length === 0 ? (
                    <div className="text-center py-6 text-slate-500 text-sm">
                      No appointment history found.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {coachHistory.map((item) => (
                        <div
                          key={item.id}
                          className="p-3 bg-slate-900/60 border border-slate-800/80 rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 min-w-0 text-xs"
                        >
                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                              <span className="font-semibold text-white break-words">{item.coach_name || 'Coach'}</span>
                              <span className="text-slate-400 font-mono text-[11px] truncate max-w-full sm:max-w-xs">
                                ({item.coach_email})
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-bold text-[10px] shrink-0">
                                {item.role_type}
                              </span>
                            </div>
                            <p className="text-slate-500 text-[11px] sm:text-xs">
                              Tenure: {new Date(item.effective_from).toLocaleDateString()} &rarr;{' '}
                              {item.effective_to ? new Date(item.effective_to).toLocaleDateString() : 'Present'}
                            </p>
                          </div>
                          <span
                            className={`self-start sm:self-auto px-2 py-0.5 rounded font-bold text-[10px] shrink-0 ${
                              item.status === 'ACTIVE'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : 'bg-slate-800 text-slate-400 border border-slate-700'
                            }`}
                          >
                            {item.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-12 text-center text-slate-400 space-y-2">
                <Building className="w-8 h-8 mx-auto text-slate-600" />
                <p>Select a club from the left column to view coach appointments and authority scoping.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: CLUB GOVERNANCE */}
      {activeSubTab === 'governance' && (
        <div className="space-y-6">
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
              <div>
                <h3 className="text-base font-bold text-white flex items-center space-x-2">
                  <ShieldAlert className="w-5 h-5 text-amber-400" />
                  <span>Institutional Club Governance & Disciplinary Controls</span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Manage active status, temporal suspension/ban controls, archival, and dependency-verified deletion.
                </p>
              </div>

              {selectedClub && (
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-slate-400">Target Club:</span>
                  <span className="px-2.5 py-1 rounded bg-slate-900 border border-slate-700 text-white font-bold text-xs">
                    {selectedClub.name}
                  </span>
                </div>
              )}
            </div>

            {/* Club Selector Header */}
            <div className="flex items-center space-x-2 overflow-x-auto py-2">
              {clubs.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedClub(c)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all whitespace-nowrap flex items-center space-x-2 ${
                    selectedClub?.id === c.id
                      ? 'bg-amber-600 border-amber-500 text-white shadow-md'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <span>{c.name}</span>
                  <span
                    className={`w-2 h-2 rounded-full ${
                      c.governance_status === 'ACTIVE'
                        ? 'bg-emerald-400'
                        : c.governance_status === 'SUSPENDED'
                        ? 'bg-rose-500'
                        : 'bg-slate-500'
                    }`}
                  />
                </button>
              ))}
            </div>

            {selectedClub ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                {/* Governance Status Card */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Current Status</span>
                    <span
                      className={`px-3 py-1 text-xs font-bold font-mono rounded-full border flex items-center space-x-1.5 ${
                        selectedClub.governance_status === 'ACTIVE'
                          ? 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
                          : selectedClub.governance_status === 'SUSPENDED'
                          ? 'bg-rose-950/80 border-rose-700 text-rose-300'
                          : 'bg-slate-800/80 border-slate-700 text-slate-300'
                      }`}
                    >
                      <span>●</span>
                      <span>{selectedClub.governance_status || (selectedClub.is_active ? 'ACTIVE' : 'SUSPENDED')}</span>
                    </span>
                  </div>

                  <div className="space-y-2 text-xs text-slate-300 bg-slate-950/60 p-4 rounded-lg border border-slate-800">
                    <div className="flex justify-between py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">Full Name:</span>
                      <span className="font-semibold text-white">{selectedClub.name}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">Code / Acronym:</span>
                      <span className="font-mono text-amber-300">{selectedClub.code || selectedClub.short_name || 'N/A'}</span>
                    </div>
                    {(selectedClub.street_address || selectedClub.city || selectedClub.province) && (
                      <div className="flex justify-between py-1 border-b border-slate-800/60">
                        <span className="text-slate-400">Location:</span>
                        <span className="text-slate-200 text-right">
                          {[selectedClub.street_address, selectedClub.city, selectedClub.province, selectedClub.postal_code]
                            .filter(Boolean)
                            .join(', ')}
                        </span>
                      </div>
                    )}
                    {selectedClub.banned_at && (
                      <div className="flex justify-between py-1 border-b border-slate-800/60">
                        <span className="text-slate-400">Suspension Started:</span>
                        <span className="text-rose-400">{new Date(selectedClub.banned_at).toLocaleString()}</span>
                      </div>
                    )}
                    {selectedClub.ban_until && (
                      <div className="flex justify-between py-1 border-b border-slate-800/60">
                        <span className="text-slate-400">Suspension Expires:</span>
                        <span className="font-bold text-amber-400">{new Date(selectedClub.ban_until).toLocaleString()}</span>
                      </div>
                    )}
                    {selectedClub.ban_reason && (
                      <div className="py-1">
                        <span className="text-slate-400 block mb-0.5">Suspension Reason:</span>
                        <p className="text-slate-200 bg-slate-900 p-2 rounded border border-slate-800 font-mono text-[11px]">
                          {selectedClub.ban_reason}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="p-3 bg-amber-950/20 border border-amber-800/40 rounded-lg text-xs text-amber-200/90 space-y-1">
                    <div className="flex items-center space-x-1.5 font-bold">
                      <Info className="w-3.5 h-3.5 text-amber-400" />
                      <span>Data Preservation Guarantee</span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-slate-300">
                      Suspensions block new athlete registrations and tournament entries, but historical match scores, brackets, and medals remain 100% intact.
                    </p>
                  </div>
                </div>

                {/* Governance Action Controls */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Available Governance Actions</span>

                  <div className="space-y-3">
                    {/* Action 1: Suspend / Ban (Super Admin) */}
                    {isSuperAdmin && (
                      <div className="p-3.5 bg-slate-950/60 border border-slate-800 rounded-lg flex items-center justify-between">
                        <div>
                          <h4 className="text-sm font-bold text-white flex items-center space-x-1.5">
                            <Ban className="w-4 h-4 text-rose-400" />
                            <span>Temporary Suspension / Ban</span>
                          </h4>
                          <p className="text-xs text-slate-400 mt-0.5">
                            Configure duration (1d to 90d, custom, or indefinite).
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setModalError(null);
                            setShowBanModal(true);
                          }}
                          disabled={actionLoading}
                          className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg text-xs transition-colors"
                        >
                          Suspend Club
                        </button>
                      </div>
                    )}

                    {/* Action 2: Restore to Active (Super Admin / Admin) */}
                    {hasAdminAccess && (
                      <div className="p-3.5 bg-slate-950/60 border border-slate-800 rounded-lg flex items-center justify-between">
                        <div>
                          <h4 className="text-sm font-bold text-white flex items-center space-x-1.5">
                            <RotateCcw className="w-4 h-4 text-emerald-400" />
                            <span>Restore to Active</span>
                          </h4>
                          <p className="text-xs text-slate-400 mt-0.5">
                            Clear suspension status and restore normal operational rights.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setModalError(null);
                            setShowRestoreModal(true);
                          }}
                          disabled={actionLoading}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs transition-colors"
                        >
                          Restore Club
                        </button>
                      </div>
                    )}

                    {/* Action 3: Archive (Super Admin) */}
                    {isSuperAdmin && (
                      <div className="p-3.5 bg-slate-950/60 border border-slate-800 rounded-lg flex items-center justify-between">
                        <div>
                          <h4 className="text-sm font-bold text-white flex items-center space-x-1.5">
                            <Archive className="w-4 h-4 text-slate-400" />
                            <span>Archive Club</span>
                          </h4>
                          <p className="text-xs text-slate-400 mt-0.5">
                            Retire inactive club while permanently preserving all history.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setModalError(null);
                            setShowArchiveModal(true);
                          }}
                          disabled={actionLoading}
                          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-lg text-xs transition-colors border border-slate-700"
                        >
                          Archive
                        </button>
                      </div>
                    )}

                    {/* Action 4: Permanent Delete (Super Admin Only with Safety Check) */}
                    {isSuperAdmin && (
                      <div className="p-3.5 bg-red-950/20 border border-red-900/40 rounded-lg flex items-center justify-between">
                        <div>
                          <h4 className="text-sm font-bold text-red-300 flex items-center space-x-1.5">
                            <Trash2 className="w-4 h-4 text-red-400" />
                            <span>Permanent Deletion</span>
                          </h4>
                          <p className="text-xs text-slate-400 mt-0.5">
                            Strictly blocked if any historical records exist.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={handleOpenDeleteModal}
                          disabled={actionLoading}
                          className="px-3 py-1.5 bg-red-900/80 hover:bg-red-800 text-red-100 font-bold rounded-lg text-xs transition-colors border border-red-700"
                        >
                          Delete...
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-slate-500 text-sm">
                No clubs available for governance.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: PENDING SUCCESSION REQUESTS */}
      {activeSubTab === 'successions' && isSuperAdmin && (
        <div className="space-y-4">
          <h3 className="text-base font-bold text-white">Pending Coach Succession Requests</h3>
          {pendingRequests.length === 0 ? (
            <div className="p-8 bg-slate-950/70 border border-slate-800 rounded-xl text-center text-slate-400 text-sm">
              No pending succession requests at this time.
            </div>
          ) : (
            <div className="space-y-4">
              {pendingRequests.map((req) => (
                <div
                  key={req.id}
                  className="bg-slate-950/70 border border-slate-800 rounded-xl p-5 space-y-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                    <div>
                      <span className="text-xs text-slate-400">Club:</span>
                      <h4 className="text-base font-bold text-white">{req.club_name}</h4>
                    </div>
                    <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      Pending Super Admin Approval
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800">
                      <span className="text-slate-400 block mb-1">Outgoing Head Coach:</span>
                      <span className="text-white font-semibold">
                        {req.outgoing_coach_name || 'None Assigned'}
                      </span>
                    </div>
                    <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800">
                      <span className="text-slate-400 block mb-1">Incoming Head Coach:</span>
                      <span className="text-amber-300 font-semibold">
                        {req.incoming_coach_name || req.incoming_coach_email}
                      </span>
                    </div>
                  </div>

                  {req.reason && (
                    <div className="p-3 bg-slate-900/40 rounded-lg border border-slate-800/80 text-xs">
                      <span className="text-slate-400 block mb-1">Stated Reason:</span>
                      <p className="text-slate-300 italic">{req.reason}</p>
                    </div>
                  )}

                  <div className="space-y-2 pt-2">
                    <input
                      type="text"
                      value={reviewNotes}
                      onChange={(e) => setReviewNotes(e.target.value)}
                      placeholder="Optional review notes or remarks..."
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                    <div className="flex space-x-3">
                      <button
                        type="button"
                        onClick={() => handleApproveSuccession(req.id)}
                        disabled={actionLoading}
                        className="flex-1 sm:flex-none px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs flex items-center justify-center space-x-1"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Approve Succession</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRejectSuccession(req.id)}
                        disabled={actionLoading}
                        className="flex-1 sm:flex-none px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg text-xs flex items-center justify-center space-x-1"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Reject</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: CREATE NEW CLUB */}
      {activeSubTab === 'create_club' && hasAdminAccess && (
        <div className="max-w-xl mx-auto bg-slate-950/80 border border-slate-800 rounded-xl p-6 space-y-4">
          <h3 className="text-base font-bold text-white flex items-center space-x-2">
            <PlusCircle className="w-5 h-5 text-amber-400" />
            <span>Register New Institutional Club / Team</span>
          </h3>
          <p className="text-xs text-slate-400">
            Create an official school or club delegation entity for coach scoping and athlete rosters.
          </p>

          <form onSubmit={handleCreateClub} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Club / School Full Name *
              </label>
              <input
                type="text"
                value={newClubName}
                onChange={(e) => setNewClubName(e.target.value)}
                placeholder="e.g. University of the Philippines Arnis Club"
                required
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Club Code
                </label>
                <input
                  type="text"
                  value={newClubCode}
                  onChange={(e) => setNewClubCode(e.target.value)}
                  placeholder="e.g. UP-ARNIS"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Short Name / Acronym
                </label>
                <input
                  type="text"
                  value={newClubShortName}
                  onChange={(e) => setNewClubShortName(e.target.value)}
                  placeholder="e.g. UP Diliman"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            {/* Structured Address Fields (Optional) */}
            <div className="space-y-3 pt-2 border-t border-slate-800/80">
              <div className="flex items-center space-x-1.5 text-xs font-semibold text-slate-300">
                <MapPin className="w-3.5 h-3.5 text-amber-400" />
                <span>Physical / Institutional Address</span>
                <span className="text-slate-500 font-normal">(Optional)</span>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Street Address
                </label>
                <input
                  type="text"
                  value={newClubStreetAddress}
                  onChange={(e) => setNewClubStreetAddress(e.target.value)}
                  placeholder="e.g. University Avenue, Diliman"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    City / Municipality
                  </label>
                  <input
                    type="text"
                    value={newClubCity}
                    onChange={(e) => setNewClubCity(e.target.value)}
                    placeholder="e.g. Quezon City"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Province / Region
                  </label>
                  <input
                    type="text"
                    value={newClubProvince}
                    onChange={(e) => setNewClubProvince(e.target.value)}
                    placeholder="e.g. Metro Manila"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Postal / ZIP Code
                  </label>
                  <input
                    type="text"
                    value={newClubPostalCode}
                    onChange={(e) => setNewClubPostalCode(e.target.value)}
                    placeholder="e.g. 1101"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>
            </div>

            {/* Club Logo Upload (Optional) */}
            <div className="space-y-2 pt-1 border-t border-slate-800/80">
              <label className="block text-xs font-semibold text-slate-300">
                Club / Team Logo <span className="text-slate-500 font-normal">(Optional)</span>
              </label>

              {newClubLogoPreview ? (
                <div className="flex items-center space-x-4 p-3 bg-slate-900 border border-slate-800 rounded-lg">
                  <div className="w-16 h-16 rounded-lg bg-slate-950 border border-amber-500/40 p-1 flex items-center justify-center overflow-hidden flex-shrink-0 shadow-inner">
                    <img
                      src={newClubLogoPreview}
                      alt="Logo Preview"
                      className="w-full h-full object-contain rounded"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-white truncate">
                      {newClubLogoFile?.name || 'Selected Logo'}
                    </p>
                    <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                      {newClubLogoFile ? `${(newClubLogoFile.size / 1024).toFixed(1)} KB` : ''} • Ready for upload
                    </p>
                    <span className="inline-flex items-center text-[10px] text-emerald-400 font-semibold mt-1">
                      <CheckCircle2 className="w-3 h-3 mr-1" /> Validated (≤ 512×512px, ≤ 1 MB)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleClearLogo}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/60 text-slate-400 hover:text-rose-300 border border-slate-700 transition-colors"
                    title="Remove selected logo"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="relative border-2 border-dashed border-slate-800 hover:border-amber-500/60 bg-slate-900/50 hover:bg-slate-900 rounded-lg p-4 text-center transition-all cursor-pointer">
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png, image/jpeg, image/webp"
                    onChange={handleLogoFileChange}
                    disabled={isValidatingLogo || actionLoading}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                  />
                  <div className="flex flex-col items-center justify-center space-y-1.5 pointer-events-none">
                    <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-amber-400">
                      {isValidatingLogo ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Upload className="w-4 h-4" />
                      )}
                    </div>
                    <div>
                      <span className="text-xs font-semibold text-amber-400 hover:underline">
                        Choose a Club Logo
                      </span>
                      <span className="text-xs text-slate-400"> or drag and drop</span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      PNG, JPEG, WebP • Max 1 MB • Max 512×512 pixels
                    </p>
                  </div>
                </div>
              )}

              {logoValidationError && (
                <div className="p-2.5 bg-rose-950/40 border border-rose-800/80 rounded-lg flex items-start space-x-2 text-rose-300 text-xs">
                  <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                  <span>{logoValidationError}</span>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={actionLoading || !newClubName.trim() || isValidatingLogo}
              className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-lg text-sm flex items-center justify-center space-x-2 disabled:opacity-50 shadow-lg"
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Building className="w-4 h-4" />}
              <span>Register Club</span>
            </button>
          </form>
        </div>
      )}

      {/* SUSPENSION / BAN MODAL */}
      {showBanModal && selectedClub && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center space-x-2 text-rose-400">
              <Ban className="w-6 h-6" />
              <h3 className="text-lg font-bold text-white">Temporary Suspension / Ban</h3>
            </div>

            <p className="text-xs text-slate-300">
              Suspend <span className="font-bold text-white">{selectedClub.name}</span>. This will prevent new memberships and tournament registrations until lifted or expired.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Ban Duration</label>
                <select
                  value={banDurationPreset}
                  onChange={(e) => {
                    setBanDurationPreset(e.target.value);
                    if (modalError) setModalError(null);
                  }}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                >
                  <option value="1">1 Day</option>
                  <option value="3">3 Days</option>
                  <option value="7">7 Days (1 Week)</option>
                  <option value="14">14 Days (2 Weeks)</option>
                  <option value="30">30 Days (1 Month)</option>
                  <option value="60">60 Days (2 Months)</option>
                  <option value="90">90 Days (3 Months)</option>
                  <option value="custom">Custom Duration in Days</option>
                  <option value="indefinite">Indefinite (Until Manually Restored)</option>
                </select>
              </div>

              {banDurationPreset === 'custom' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Number of Days</label>
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={customBanDays}
                    onChange={(e) => {
                      setCustomBanDays(Math.max(1, parseInt(e.target.value, 10) || 1));
                      if (modalError) setModalError(null);
                    }}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Official Reason *</label>
                <input
                  type="text"
                  value={banReason}
                  onChange={(e) => {
                    setBanReason(e.target.value);
                    if (modalError) setModalError(null);
                  }}
                  placeholder="e.g. Disciplinary review, ethics violation, administrative hold..."
                  required
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Internal Notes</label>
                <textarea
                  value={banNotes}
                  onChange={(e) => {
                    setBanNotes(e.target.value);
                    if (modalError) setModalError(null);
                  }}
                  placeholder="Additional governance remarks..."
                  rows={2}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>
            </div>

            {modalError && (
              <div className="p-3 bg-rose-950/80 border border-rose-800 rounded-lg flex items-start space-x-2 text-rose-300 text-xs">
                <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                <span>{modalError}</span>
              </div>
            )}

            <div className="flex space-x-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setModalError(null);
                  setShowBanModal(false);
                }}
                className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSuspendClub}
                disabled={actionLoading || !banReason.trim()}
                className="flex-1 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg text-sm flex items-center justify-center space-x-1.5 disabled:opacity-50"
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
                <span>Confirm Suspension</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RESTORE MODAL */}
      {showRestoreModal && selectedClub && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center space-x-2 text-emerald-400">
              <RotateCcw className="w-6 h-6" />
              <h3 className="text-lg font-bold text-white">Restore Club to Active</h3>
            </div>

            <p className="text-xs text-slate-300">
              Restore <span className="font-bold text-white">{selectedClub.name}</span> to full active standing.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Restoration Notes</label>
              <input
                type="text"
                value={restoreNotes}
                onChange={(e) => {
                  setRestoreNotes(e.target.value);
                  if (modalError) setModalError(null);
                }}
                placeholder="e.g. Sanction lifted, review resolved..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {modalError && (
              <div className="p-3 bg-rose-950/80 border border-rose-800 rounded-lg flex items-start space-x-2 text-rose-300 text-xs">
                <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                <span>{modalError}</span>
              </div>
            )}

            <div className="flex space-x-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setModalError(null);
                  setShowRestoreModal(false);
                }}
                className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRestoreClub}
                disabled={actionLoading}
                className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-sm flex items-center justify-center space-x-1.5"
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                <span>Restore to Active</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ARCHIVE MODAL */}
      {showArchiveModal && selectedClub && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center space-x-2 text-slate-300">
              <Archive className="w-6 h-6 text-amber-400" />
              <h3 className="text-lg font-bold text-white">Archive Club</h3>
            </div>

            <p className="text-xs text-slate-300">
              Archiving <span className="font-bold text-white">{selectedClub.name}</span> will retire it from new tournament operations while preserving 100% of historical rosters, matches, and medals.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Archive Reason</label>
              <input
                type="text"
                value={archiveReason}
                onChange={(e) => {
                  setArchiveReason(e.target.value);
                  if (modalError) setModalError(null);
                }}
                placeholder="e.g. Delegation disbanded, consolidated..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            {modalError && (
              <div className="p-3 bg-rose-950/80 border border-rose-800 rounded-lg flex items-start space-x-2 text-rose-300 text-xs">
                <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                <span>{modalError}</span>
              </div>
            )}

            <div className="flex space-x-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setModalError(null);
                  setShowArchiveModal(false);
                }}
                className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleArchiveClub}
                disabled={actionLoading}
                className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-lg text-sm flex items-center justify-center space-x-1.5"
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
                <span>Archive Club</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT CLUB PROFILE & ADDRESS MODAL */}
      {showEditModal && selectedClub && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5 text-amber-400">
                <Building2 className="w-6 h-6" />
                <h3 className="text-lg font-bold text-white">Edit Club Profile & Address</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setModalError(null);
                  setShowEditModal(false);
                }}
                className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Update institutional metadata, acronym, physical location, and official branding for{' '}
              <span className="text-white font-semibold">{selectedClub.name}</span>.
            </p>

            <form onSubmit={handleSaveClubProfile} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Short Name / Acronym
                </label>
                <input
                  type="text"
                  value={editShortName}
                  onChange={(e) => setEditShortName(e.target.value)}
                  placeholder="e.g. UP Diliman"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              {/* Structured Address */}
              <div className="space-y-3 pt-2 border-t border-slate-800/80">
                <div className="flex items-center space-x-1.5 text-xs font-semibold text-slate-300">
                  <MapPin className="w-3.5 h-3.5 text-amber-400" />
                  <span>Physical / Institutional Address</span>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Street Address
                  </label>
                  <input
                    type="text"
                    value={editStreetAddress}
                    onChange={(e) => setEditStreetAddress(e.target.value)}
                    placeholder="e.g. University Avenue, Diliman"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      City
                    </label>
                    <input
                      type="text"
                      value={editCity}
                      onChange={(e) => setEditCity(e.target.value)}
                      placeholder="e.g. Quezon City"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Province / Region
                    </label>
                    <input
                      type="text"
                      value={editProvince}
                      onChange={(e) => setEditProvince(e.target.value)}
                      placeholder="e.g. Metro Manila"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Postal Code
                    </label>
                    <input
                      type="text"
                      value={editPostalCode}
                      onChange={(e) => setEditPostalCode(e.target.value)}
                      placeholder="e.g. 1101"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                </div>
              </div>

              {/* Logo Update */}
              <div className="space-y-2 pt-2 border-t border-slate-800/80">
                <label className="block text-xs font-semibold text-slate-300">
                  Update Official Logo
                </label>

                {editLogoPreview ? (
                  <div className="flex items-center space-x-4 p-3 bg-slate-950 border border-slate-800 rounded-lg">
                    <div className="w-14 h-14 rounded-lg bg-slate-900 border border-amber-500/40 p-1 flex items-center justify-center overflow-hidden flex-shrink-0">
                      <img
                        src={editLogoPreview}
                        alt="Preview"
                        className="w-full h-full object-contain rounded"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-white truncate">
                        {editLogoFile ? editLogoFile.name : 'Current Logo'}
                      </p>
                      <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                        {editLogoFile ? `${(editLogoFile.size / 1024).toFixed(1)} KB` : 'Active on storage'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearEditLogo}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/60 text-slate-400 hover:text-rose-300 border border-slate-700"
                      title="Remove Logo"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="relative border-2 border-dashed border-slate-800 hover:border-amber-500/60 bg-slate-950/50 hover:bg-slate-950 rounded-lg p-3 text-center transition-all cursor-pointer">
                    <input
                      ref={editLogoInputRef}
                      type="file"
                      accept="image/png, image/jpeg, image/webp"
                      onChange={handleEditLogoFileChange}
                      disabled={isEditValidatingLogo || actionLoading}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                    />
                    <div className="flex flex-col items-center justify-center space-y-1">
                      <Upload className="w-5 h-5 text-slate-500" />
                      <span className="text-xs text-slate-300 font-medium">Click or drag new logo file</span>
                      <span className="text-[10px] text-slate-500">PNG, JPEG, WebP • Max 1 MB • Max 512×512px</span>
                    </div>
                  </div>
                )}
                {editLogoError && (
                  <div className="p-2 bg-rose-950/80 border border-rose-800 rounded-lg flex items-center space-x-2 text-rose-300 text-xs">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                    <span>{editLogoError}</span>
                  </div>
                )}
              </div>

              {modalError && (
                <div className="p-3 bg-rose-950/80 border border-rose-800 rounded-lg flex items-start space-x-2 text-rose-300 text-xs">
                  <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                  <span>{modalError}</span>
                </div>
              )}

              <div className="flex space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setModalError(null);
                    setShowEditModal(false);
                  }}
                  className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-lg text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || isEditValidatingLogo}
                  className="flex-1 py-2 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-lg text-sm flex items-center justify-center space-x-1.5 disabled:opacity-50"
                >
                  {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  <span>Save Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SAFE PERMANENT DELETE MODAL (SUPER ADMIN ONLY) */}
      {showDeleteModal && selectedClub && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-red-800/80 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center space-x-2.5 text-red-400">
              <AlertOctagon className="w-6 h-6" />
              <h3 className="text-lg font-bold text-white">Permanent Club Deletion Safety Check</h3>
            </div>

            {checkingSafety ? (
              <div className="py-8 flex flex-col items-center justify-center space-y-3">
                <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
                <p className="text-xs text-slate-400 font-mono">Running database dependency verification...</p>
              </div>
            ) : deletionSafety ? (
              <div className="space-y-4">
                {/* Dependency breakdown */}
                <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-2 text-xs">
                  <span className="font-bold text-slate-300 block mb-1">Protected Historical Records:</span>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="flex justify-between p-2 rounded bg-slate-900 border border-slate-800">
                      <span className="text-slate-400">Coach Assignments:</span>
                      <span className="font-bold text-white">{deletionSafety.dependencies.coaches}</span>
                    </div>
                    <div className="flex justify-between p-2 rounded bg-slate-900 border border-slate-800">
                      <span className="text-slate-400">Athlete Memberships:</span>
                      <span className="font-bold text-white">{deletionSafety.dependencies.memberships}</span>
                    </div>
                    <div className="flex justify-between p-2 rounded bg-slate-900 border border-slate-800">
                      <span className="text-slate-400">Player Transfers:</span>
                      <span className="font-bold text-white">{deletionSafety.dependencies.transfers}</span>
                    </div>
                    <div className="flex justify-between p-2 rounded bg-slate-900 border border-slate-800">
                      <span className="text-slate-400">Tournament Registrations:</span>
                      <span className="font-bold text-white">{deletionSafety.dependencies.registrations}</span>
                    </div>
                  </div>
                </div>

                {/* Status Result */}
                {!deletionSafety.can_delete ? (
                  <div className="p-4 bg-red-950/40 border border-red-800 rounded-xl space-y-2">
                    <div className="flex items-center space-x-2 text-red-400 font-bold text-sm">
                      <Lock className="w-4 h-4" />
                      <span>Deletion Strictly Blocked</span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {deletionSafety.recommendation}
                    </p>
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setModalError(null);
                          setShowDeleteModal(false);
                          setShowArchiveModal(true);
                        }}
                        className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-lg text-xs flex items-center justify-center space-x-1.5 border border-slate-700"
                      >
                        <Archive className="w-4 h-4 text-amber-400" />
                        <span>Archive This Club Instead</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="p-3 bg-amber-950/30 border border-amber-800/60 rounded-xl text-xs text-amber-200">
                      <p className="font-semibold">This Club has zero historical records and is safe to permanently delete.</p>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Type exact club name <span className="text-amber-400 font-mono">"{selectedClub.name}"</span> to confirm:
                      </label>
                      <input
                        type="text"
                        value={typedConfirmationName}
                        onChange={(e) => {
                          setTypedConfirmationName(e.target.value);
                          if (modalError) setModalError(null);
                        }}
                        placeholder={selectedClub.name}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-500 font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {modalError && (
              <div className="p-3 bg-rose-950/80 border border-rose-800 rounded-lg flex items-start space-x-2 text-rose-300 text-xs">
                <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                <span>{modalError}</span>
              </div>
            )}

            <div className="flex space-x-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setModalError(null);
                  setShowDeleteModal(false);
                }}
                className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-lg text-sm"
              >
                Close
              </button>
              {deletionSafety?.can_delete && (
                <button
                  type="button"
                  onClick={handleDeleteClub}
                  disabled={actionLoading || typedConfirmationName.trim() !== selectedClub.name.trim()}
                  className="flex-1 py-2 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg text-sm flex items-center justify-center space-x-1.5 disabled:opacity-50"
                >
                  {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  <span>Permanently Delete</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
