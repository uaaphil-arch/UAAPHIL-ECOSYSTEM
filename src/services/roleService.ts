import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { AppRole, AssignableRole, RoleManagementResult, UserRole, UserSearchResult } from '../types/roles';

export const roleService = {
  /**
   * Fetches the permanent roles assigned to the authenticated user.
   */
  async fetchMyRoles(userId: string): Promise<AppRole[]> {
    if (!isSupabaseConfigured || !userId) return [];

    const { data, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId);

    if (error) {
      console.error('Error fetching permanent user roles:', error.message);
      throw new Error(error.message);
    }

    if (!data) return [];

    return (data as Pick<UserRole, 'role'>[]).map((r) => r.role);
  },

  /**
   * Searches users for Super Admin directory and role management via
   * SECURITY DEFINER RPC `search_users_for_admin`.
   * Accepts email, full_name, or exact UUID. Empty query returns default top 25 users.
   */
  async searchUsersForAdmin(query: string = ''): Promise<UserSearchResult[]> {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase client is not configured.');
    }

    const { data, error } = await supabase.rpc('search_users_for_admin', {
      p_query: query.trim(),
    });

    if (error) {
      console.error('Error searching users via RPC search_users_for_admin:', error.message);
      throw new Error(error.message);
    }

    return (data as UserSearchResult[]) || [];
  },

  /**
   * Assigns a permanent role to a target user via the database-authoritative
   * SECURITY DEFINER RPC `assign_permanent_role`.
   * Strictly requires SUPER_ADMIN authority.
   */
  async assignPermanentRole(
    targetUserId: string,
    role: AssignableRole
  ): Promise<RoleManagementResult> {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase client is not configured.');
    }

    const { data, error } = await supabase.rpc('assign_permanent_role', {
      p_target_user_id: targetUserId,
      p_role: role,
    });

    if (error) {
      console.error('Error assigning permanent role via RPC:', error.message);
      throw new Error(error.message);
    }

    return data as RoleManagementResult;
  },

  /**
   * Revokes a permanent role from a target user via the database-authoritative
   * SECURITY DEFINER RPC `revoke_permanent_role`.
   * Strictly requires SUPER_ADMIN authority.
   */
  async revokePermanentRole(
    targetUserId: string,
    role: AssignableRole
  ): Promise<RoleManagementResult> {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase client is not configured.');
    }

    const { data, error } = await supabase.rpc('revoke_permanent_role', {
      p_target_user_id: targetUserId,
      p_role: role,
    });

    if (error) {
      console.error('Error revoking permanent role via RPC:', error.message);
      throw new Error(error.message);
    }

    return data as RoleManagementResult;
  },
};
