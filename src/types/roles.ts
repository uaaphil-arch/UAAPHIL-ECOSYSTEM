export type AppRole = 'SUPER_ADMIN' | 'ADMIN' | 'ORGANIZER' | 'COACH';

export type AssignableRole = 'ADMIN' | 'ORGANIZER' | 'COACH';

export interface UserRole {
  id: string;
  user_id: string;
  role: AppRole;
  assigned_by: string | null;
  created_at: string;
}

export interface UserSearchResult {
  id: string;
  email: string;
  full_name: string | null;
  account_status: 'ACTIVE' | 'INACTIVE' | 'BLOCKED' | 'DEACTIVATED';
  avatar_url: string | null;
  roles: AppRole[];
}

export interface RoleManagementResult {
  success: boolean;
  action: 'ASSIGNED' | 'ALREADY_ASSIGNED' | 'REVOKED' | 'NOT_FOUND';
  user_id: string;
  role: AppRole;
  assigned_by?: string;
  revoked_by?: string;
}
