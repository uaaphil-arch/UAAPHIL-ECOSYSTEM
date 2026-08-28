export type AccountStatus = 'ACTIVE' | 'INACTIVE' | 'BLOCKED' | 'DEACTIVATED';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  phone?: string | null;
  phone_number?: string | null;
  preferences: Record<string, unknown>;
  status: AccountStatus;
  account_status?: AccountStatus;
  created_at: string;
  updated_at: string;
}

export interface ProfileUpdateInput {
  full_name?: string;
  avatar_url?: string;
  phone?: string;
  phone_number?: string;
  preferences?: Record<string, unknown>;
}
