import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Profile, ProfileUpdateInput } from '../types/profile';
import { AppRole } from '../types/roles';
import { EventAssignment } from '../types/eventAssignment';
import { profileService } from '../services/profileService';
import { roleService } from '../services/roleService';
import { eventAssignmentService } from '../services/eventAssignmentService';
import { clearIdentityCache } from '../services/chatIdentityResolver';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: AppRole[];
  activeAssignments: EventAssignment[];
  hasActiveOperationalAssignment: boolean;
  loading: boolean;
  profileLoading: boolean;
  rolesLoading: boolean;
  assignmentsLoading: boolean;
  error: string | null;
  profileError: string | null;
  rolesError: string | null;
  assignmentsError: string | null;
  lastAssignmentsSyncedAt: string | null;
  isConfigured: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  updateProfile: (input: ProfileUpdateInput) => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshAssignments: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [activeAssignments, setActiveAssignments] = useState<EventAssignment[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [profileLoading, setProfileLoading] = useState<boolean>(false);
  const [rolesLoading, setRolesLoading] = useState<boolean>(false);
  const [assignmentsLoading, setAssignmentsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [assignmentsError, setAssignmentsError] = useState<string | null>(null);
  const [lastAssignmentsSyncedAt, setLastAssignmentsSyncedAt] = useState<string | null>(null);

  const hasActiveOperationalAssignment = activeAssignments.length > 0;

  const loadProfileAndRoles = useCallback(async (userId: string, authUser?: User | null) => {
    setProfileLoading(true);
    setRolesLoading(true);
    setAssignmentsLoading(true);
    setProfileError(null);
    setRolesError(null);
    setAssignmentsError(null);

    // Fetch profile
    let fetchedProfile: Profile | null = null;
    try {
      fetchedProfile = await profileService.fetchMyProfile(userId);
      setProfile(fetchedProfile);
    } catch (err: unknown) {
      setProfileError(err instanceof Error ? err.message : 'Failed to load profile');
    } finally {
      setProfileLoading(false);
    }

    // Google OAuth Avatar Lifecycle Reconciliation (P11-AVATAR-SYNC-04)
    // Non-blocking background sync if OAuth avatar differs from canonical profile.avatar_url
    if (fetchedProfile && authUser) {
      const rawOAuthAvatar =
        authUser.user_metadata?.avatar_url ||
        authUser.user_metadata?.picture ||
        null;
      const sanitizedOAuthAvatar = typeof rawOAuthAvatar === 'string' && rawOAuthAvatar.trim() !== ''
        ? rawOAuthAvatar.trim()
        : null;

      if (sanitizedOAuthAvatar && sanitizedOAuthAvatar !== fetchedProfile.avatar_url) {
        profileService
          .updateMyProfile(userId, { avatar_url: sanitizedOAuthAvatar })
          .then((updatedProfile) => {
            setProfile((prev) => (prev ? { ...prev, avatar_url: updatedProfile.avatar_url } : prev));
          })
          .catch((syncErr) => {
            console.warn('[AuthContext] Background OAuth avatar reconciliation failed (non-blocking):', syncErr);
          });
      }
    }

    // Fetch permanent roles
    try {
      const userRoles = await roleService.fetchMyRoles(userId);
      setRoles(userRoles);
      setRolesError(null);
    } catch (err: unknown) {
      console.error('Failed to load user roles:', err);
      setRoles([]);
      setRolesError(err instanceof Error ? err.message : 'Failed to load user roles');
    } finally {
      setRolesLoading(false);
    }

    // Fetch active operational assignments (temporary tournament/court authority)
    try {
      const myAssignments = await eventAssignmentService.fetchMyAssignments(userId);
      setActiveAssignments(myAssignments);
      setLastAssignmentsSyncedAt(new Date().toISOString());
      setAssignmentsError(null);
    } catch (err: unknown) {
      console.error('Failed to load active event assignments:', err);
      setActiveAssignments([]);
      setAssignmentsError(err instanceof Error ? err.message : 'Failed to load operational assignments');
    } finally {
      setAssignmentsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initialize session state
    const initSession = async () => {
      try {
        if (!isSupabaseConfigured) {
          setLoading(false);
          return;
        }

        const { data: { session: initialSession }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          setError(sessionError.message);
        } else {
          setSession(initialSession);
          const currentUser = initialSession?.user ?? null;
          setUser(currentUser);
          if (currentUser) {
            await loadProfileAndRoles(currentUser.id, currentUser);
          }
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to retrieve session');
      } finally {
        setLoading(false);
      }
    };

    initSession();

    // Listen to session changes
    if (isSupabaseConfigured) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, currentSession) => {
        // Invalidate in-memory chat identity cache on every auth lifecycle transition
        clearIdentityCache();

        setSession(currentSession);
        const currentUser = currentSession?.user ?? null;
        setUser(currentUser);
        setLoading(false);

        if (currentUser) {
          await loadProfileAndRoles(currentUser.id, currentUser);
        } else {
          setProfile(null);
          setRoles([]);
        }
      });

      return () => {
        subscription.unsubscribe();
      };
    }
  }, [loadProfileAndRoles]);

  const getOAuthRedirectUrl = () => {
    if (typeof window !== 'undefined' && window.location && window.location.origin) {
      // In web browser context, redirect back to the exact current origin
      // from which authentication was initiated to preserve PKCE verification state.
      return `${window.location.origin}/`;
    }

    const configuredAppUrl = import.meta.env.VITE_APP_URL;
    if (configuredAppUrl) {
      return configuredAppUrl.endsWith('/') ? configuredAppUrl : `${configuredAppUrl}/`;
    }

    return typeof window !== 'undefined' ? window.location.origin : '';
  };

  const signInWithGoogle = async () => {
    setError(null);
    if (!isSupabaseConfigured) {
      setError('Supabase credentials (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY) are not configured.');
      return;
    }

    try {
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: getOAuthRedirectUrl(),
          queryParams: {
            access_type: 'offline',
            prompt: 'select_account',
          },
        },
      });

      if (signInError) {
        setError(signInError.message);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred during Google sign in');
    }
  };

  const signOut = async () => {
    setError(null);
    clearIdentityCache();
    if (!isSupabaseConfigured) return;

    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        setError(signOutError.message);
      } else {
        setUser(null);
        setSession(null);
        setProfile(null);
        setRoles([]);
        setActiveAssignments([]);
        setRolesError(null);
        setProfileError(null);
        setAssignmentsError(null);
        setLastAssignmentsSyncedAt(null);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred during sign out');
    }
  };

  const updateProfile = async (input: ProfileUpdateInput) => {
    setProfileError(null);
    if (!user) {
      setProfileError('User is not authenticated');
      return;
    }

    try {
      setProfileLoading(true);
      const updated = await profileService.updateMyProfile(user.id, input);
      setProfile(updated);
    } catch (err: unknown) {
      setProfileError(err instanceof Error ? err.message : 'Failed to update profile');
      throw err;
    } finally {
      setProfileLoading(false);
    }
  };

  const refreshProfile = async () => {
    if (user) {
      await loadProfileAndRoles(user.id, user);
    }
  };

  const refreshAssignments = useCallback(async () => {
    if (!user) {
      setActiveAssignments([]);
      return;
    }
    setAssignmentsLoading(true);
    setAssignmentsError(null);
    try {
      const myAssignments = await eventAssignmentService.fetchMyAssignments(user.id);
      setActiveAssignments(myAssignments);
      setLastAssignmentsSyncedAt(new Date().toISOString());
    } catch (err: unknown) {
      console.error('Failed to refresh active event assignments:', err);
      setAssignmentsError(err instanceof Error ? err.message : 'Failed to refresh assignments');
    } finally {
      setAssignmentsLoading(false);
    }
  }, [user]);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        roles,
        activeAssignments,
        hasActiveOperationalAssignment,
        loading,
        profileLoading,
        rolesLoading,
        assignmentsLoading,
        error,
        profileError,
        rolesError,
        assignmentsError,
        lastAssignmentsSyncedAt,
        isConfigured: isSupabaseConfigured,
        signInWithGoogle,
        signOut,
        updateProfile,
        refreshProfile,
        refreshAssignments,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

