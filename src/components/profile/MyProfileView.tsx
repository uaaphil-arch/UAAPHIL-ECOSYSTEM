import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { profileService } from '../../services/profileService';
import { CopyableId } from '../common/CopyableId';
import { UserAvatar } from '../common/UserAvatar';
import { User, Edit3, Save, Loader2, CheckCircle2, AlertTriangle, Phone, Mail } from 'lucide-react';

export const MyProfileView: React.FC = () => {
  const { user, profile, roles, refreshProfile } = useAuth();

  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [phoneNumber, setPhoneNumber] = useState(profile?.phone_number || '');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Sync state when profile loads
  React.useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || '');
      setPhoneNumber(profile.phone_number || '');
    }
  }, [profile]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setIsSaving(true);
    setStatusMessage(null);

    try {
      await profileService.updateMyProfile(user.id, {
        full_name: fullName.trim() || undefined,
        phone: phoneNumber.trim() || undefined,
        phone_number: phoneNumber.trim() || undefined,
      });

      await refreshProfile();
      setIsEditing(false);
      setStatusMessage({ type: 'success', text: 'Profile updated successfully.' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update profile.';
      setStatusMessage({ type: 'error', text: msg });
    } finally {
      setIsSaving(false);
    }
  };

  const activeStatus = profile?.status || profile?.account_status || 'ACTIVE';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-5 sm:p-6 space-y-2">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-xl">
            <User className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white flex items-center space-x-2">
              <span>My Profile</span>
            </h2>
            <p className="text-xs text-slate-400">
              Manage your personal information and official delegation profile.
            </p>
          </div>
        </div>
      </div>

      {/* Profile Card */}
      <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-5 sm:p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-700/60">
          <div className="flex items-center space-x-3.5">
            <UserAvatar
              avatarUrl={profile?.avatar_url}
              name={profile?.full_name || user?.email}
              role={roles[0] || 'USER'}
              size="xl"
            />
            <div>
              <div className="font-bold text-base text-white">
                {profile?.full_name || 'No Name Set'}
              </div>
              <div className="text-xs text-slate-400 font-mono flex items-center space-x-1.5 mt-0.5">
                <Mail className="w-3.5 h-3.5 text-slate-500" />
                <span>{user?.email}</span>
              </div>
            </div>
          </div>

          <div>
            <span className={`px-2.5 py-1 rounded-full text-xs font-mono font-semibold border ${
              activeStatus === 'ACTIVE'
                ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                : 'bg-amber-950 text-amber-300 border-amber-800'
            }`}>
              STATUS: {activeStatus}
            </span>
          </div>
        </div>

        {/* User Account ID Display with Copy */}
        <div className="bg-slate-900/80 p-3.5 rounded-lg border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-400">User Account ID</span>
          {user && <CopyableId id={user.id} label="Account ID" />}
        </div>

        {/* Profile Form */}
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Full Display Name
              </label>
              <input
                type="text"
                disabled={!isEditing}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. John Doe"
                className="w-full px-3.5 py-2.5 rounded-lg bg-slate-900 text-slate-100 border border-slate-700 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/50 disabled:opacity-60 disabled:bg-slate-950"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Phone Number
              </label>
              <div className="relative">
                <input
                  type="text"
                  disabled={!isEditing}
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="e.g. +63 912 345 6789"
                  className="w-full pl-9 pr-3.5 py-2.5 rounded-lg bg-slate-900 text-slate-100 border border-slate-700 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/50 disabled:opacity-60 disabled:bg-slate-950"
                />
                <Phone className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-3 flex items-center justify-end space-x-3">
            {!isEditing ? (
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold transition-all flex items-center space-x-2"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Edit Profile</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => {
                    setIsEditing(false);
                    setFullName(profile?.full_name || '');
                    setPhoneNumber(profile?.phone_number || '');
                  }}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-lg text-xs font-semibold transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow transition-all flex items-center space-x-2 disabled:opacity-50"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      <span>Save Changes</span>
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </form>

        {/* Status Message */}
        {statusMessage && (
          <div className={`p-4 rounded-xl border flex items-start space-x-2.5 text-xs ${
            statusMessage.type === 'success'
              ? 'bg-emerald-950/60 border-emerald-800 text-emerald-200'
              : 'bg-rose-950/60 border-rose-800 text-rose-200'
          }`}>
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        )}
      </div>
    </div>
  );
};
