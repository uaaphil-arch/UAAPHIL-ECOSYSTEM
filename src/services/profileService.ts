import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Profile, ProfileUpdateInput } from '../types/profile';

function normalizeProfile(raw: any): Profile | null {
  if (!raw) return null;
  return {
    ...raw,
    status: raw.status || raw.account_status || 'ACTIVE',
    account_status: raw.status || raw.account_status || 'ACTIVE',
    phone: raw.phone ?? raw.phone_number ?? null,
    phone_number: raw.phone ?? raw.phone_number ?? null,
  };
}

export const profileService = {
  async fetchMyProfile(userId: string): Promise<Profile | null> {
    if (!isSupabaseConfigured || !userId) return null;

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching profile:', error.message);
      throw new Error(error.message);
    }

    return normalizeProfile(data);
  },

  async updateMyProfile(userId: string, input: ProfileUpdateInput): Promise<Profile> {
    if (!isSupabaseConfigured || !userId) {
      throw new Error('Supabase client is not configured or user is not authenticated.');
    }

    // Explicitly construct update payload with ONLY allowed user-managed fields
    const allowedPayload: Record<string, unknown> = {};
    if (input.full_name !== undefined) allowedPayload.full_name = input.full_name;
    if (input.avatar_url !== undefined) allowedPayload.avatar_url = input.avatar_url;
    if (input.phone !== undefined) allowedPayload.phone = input.phone;
    else if (input.phone_number !== undefined) allowedPayload.phone = input.phone_number;
    if (input.preferences !== undefined) allowedPayload.preferences = input.preferences;

    const { data, error } = await supabase
      .from('profiles')
      .update(allowedPayload)
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      console.error('Error updating profile:', error.message);
      throw new Error(error.message);
    }

    return normalizeProfile(data) as Profile;
  },
};
