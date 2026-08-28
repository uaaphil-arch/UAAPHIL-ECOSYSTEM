import { supabase } from '../lib/supabase';
import {
  Club,
  ClubCoachAssignment,
  ActiveClubCoach,
  CoachSuccessionRequest,
  SuccessionOperationResult,
  CoachRoleType,
  AssignedCoachClub,
  ClubDeletionSafetyCheck,
  UpdateClubProfilePayload,
  CreateClubPayload,
} from '../types/coachSuccession';

export const MAX_CLUB_LOGO_SIZE_BYTES = 1024 * 1024; // 1 MB
export const MAX_CLUB_LOGO_DIMENSION = 512; // 512px
export const ALLOWED_CLUB_LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * Validates a candidate Club/Team Logo file against strict constraints:
 * - MIME type: image/png, image/jpeg, image/webp (SVG, GIF, PDF rejected)
 * - Extension: .png, .jpg, .jpeg, .webp
 * - File size: <= 1 MB (1,048,576 bytes)
 * - Dimensions: <= 512x512 pixels
 */
export async function validateClubLogo(file: File): Promise<{ valid: boolean; error?: string }> {
  if (!file) {
    return { valid: false, error: 'No file provided.' };
  }

  // 1. Check MIME type (SVG, GIF, PDF, executables rejected)
  if (!ALLOWED_CLUB_LOGO_MIME_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: `Invalid file format (${file.type || 'unknown'}). Only PNG, JPEG, and WebP raster images are allowed. SVG and GIF files are not permitted.`,
    };
  }

  // 2. Check File Extension against allowed list
  const ext = file.name.split('.').pop()?.toLowerCase();
  const allowedExtensions = ['png', 'jpg', 'jpeg', 'webp'];
  if (!ext || !allowedExtensions.includes(ext)) {
    return {
      valid: false,
      error: `Invalid file extension (.${ext || 'unknown'}). Allowed extensions: .png, .jpg, .jpeg, .webp`,
    };
  }

  // 3. Check File Size (Max 1MB)
  if (file.size > MAX_CLUB_LOGO_SIZE_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
    return {
      valid: false,
      error: `File size (${sizeMb} MB) exceeds the maximum limit of 1 MB (1,048,576 bytes).`,
    };
  }

  // 4. Validate Dimensions by decoding the image
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      if (img.naturalWidth > MAX_CLUB_LOGO_DIMENSION || img.naturalHeight > MAX_CLUB_LOGO_DIMENSION) {
        resolve({
          valid: false,
          error: `Image dimensions (${img.naturalWidth}×${img.naturalHeight}px) exceed the maximum allowed resolution of 512×512 pixels.`,
        });
      } else {
        resolve({ valid: true });
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({
        valid: false,
        error: 'Failed to decode image file. File may be corrupted or not a valid image.',
      });
    };

    img.src = objectUrl;
  });
}

export const coachSuccessionService = {
  /**
   * Evaluates if a suspended club's ban has temporally expired and atomically restores it in DB.
   */
  async evaluateBanExpiry(clubId: string): Promise<Club | null> {
    try {
      const { data, error } = await supabase.rpc('evaluate_club_ban_expiry', {
        p_club_id: clubId,
      });

      if (error) {
        console.warn(`[BanExpiry] evaluate_club_ban_expiry returned notice for club ${clubId}:`, error.message);
        return null;
      }
      return data as Club;
    } catch (err) {
      console.warn(`[BanExpiry] RPC error evaluating ban expiry for club ${clubId}:`, err);
      return null;
    }
  },

  /**
   * Fetch active clubs assigned to the authenticated coach
   * Lazily checks if an assigned suspended club has expired and auto-restores it.
   */
  async getMyAssignedClubs(coachUserId: string): Promise<AssignedCoachClub[]> {
    const { data, error } = await supabase
      .from('club_coaches')
      .select('id, club_id, role_type, status, effective_from, effective_to, club:clubs(*)')
      .eq('coach_user_id', coachUserId)
      .eq('status', 'ACTIVE');

    if (error) {
      console.error('Failed to fetch assigned clubs:', error);
      return [];
    }

    const now = new Date();
    const evaluatedItems = await Promise.all(
      (data || []).map(async (item: any) => {
        let club = item.club;
        if (
          club &&
          club.governance_status === 'SUSPENDED' &&
          club.ban_until &&
          new Date(club.ban_until) <= now
        ) {
          const restored = await this.evaluateBanExpiry(club.id);
          if (restored) {
            club = restored;
          }
        }
        return {
          ...item,
          club,
        };
      })
    );

    return evaluatedItems
      .filter((item: any) => item.club && item.club.is_active)
      .map((item: any) => ({
        assignment_id: item.id,
        club_id: item.club_id,
        role_type: item.role_type,
        status: item.status,
        effective_from: item.effective_from,
        effective_to: item.effective_to,
        club: item.club,
      }));
  },

  /**
   * Fetch all active clubs
   * Lazily evaluates any expired suspensions first so newly restored clubs become immediately selectable.
   */
  async getClubs(): Promise<Club[]> {
    const allClubs = await this.getAllClubs();
    return allClubs.filter(
      (c) => c.is_active && c.governance_status !== 'SUSPENDED' && c.governance_status !== 'ARCHIVED'
    );
  },

  /**
   * Uploads a validated club logo file to Supabase Storage 'branding' bucket
   * under path `clubs/${clubId}/logo_${Date.now()}.${ext}`.
   * Falls back gracefully to inline data URL if storage upload is unavailable.
   */
  async uploadClubLogo(clubId: string, file: File): Promise<{ success: boolean; logoUrl?: string; error?: string }> {
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const sanitizedExt = ['png', 'jpg', 'jpeg', 'webp'].includes(ext) ? ext : 'png';
      const filePath = `clubs/${clubId}/logo_${Date.now()}.${sanitizedExt}`;

      let publicLogoUrl: string | null = null;

      const { error: uploadError } = await supabase.storage
        .from('branding')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true,
          contentType: file.type,
        });

      if (!uploadError) {
        const { data: urlData } = supabase.storage
          .from('branding')
          .getPublicUrl(filePath);

        if (urlData?.publicUrl) {
          publicLogoUrl = urlData.publicUrl;
        }
      } else {
        console.warn('Storage upload error, using data URL fallback:', uploadError.message);
      }

      // Fallback to data URL if storage bucket upload failed or offline
      if (!publicLogoUrl) {
        publicLogoUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = (e) => reject(e);
          reader.readAsDataURL(file);
        });
      }

      // Update club logo_url in public.clubs
      const { error: updateError } = await supabase
        .from('clubs')
        .update({
          logo_url: publicLogoUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', clubId);

      if (updateError) {
        console.warn('Failed to update clubs.logo_url:', updateError.message);
        return { success: false, error: updateError.message, logoUrl: publicLogoUrl };
      }

      return { success: true, logoUrl: publicLogoUrl };
    } catch (err: any) {
      console.error('Club logo upload error:', err);
      return { success: false, error: err.message || 'Logo upload failed' };
    }
  },

  /**
   * Create a new club (Super Admin / Admin) with optional Logo File & structured address fields
   */
  async createClub(
    nameOrPayload: string | CreateClubPayload,
    code?: string,
    shortName?: string,
    logoFile?: File | null,
    streetAddress?: string,
    city?: string,
    province?: string,
    postalCode?: string
  ): Promise<{ success: boolean; clubId?: string; logoUrl?: string; error?: string; logoWarning?: string }> {
    let name: string;
    let finalCode: string | undefined;
    let finalShortName: string | undefined;
    let finalLogoFile: File | null | undefined;
    let finalStreetAddress: string | undefined;
    let finalCity: string | undefined;
    let finalProvince: string | undefined;
    let finalPostalCode: string | undefined;

    if (typeof nameOrPayload === 'string') {
      name = nameOrPayload;
      finalCode = code;
      finalShortName = shortName;
      finalLogoFile = logoFile;
      finalStreetAddress = streetAddress;
      finalCity = city;
      finalProvince = province;
      finalPostalCode = postalCode;
    } else {
      name = nameOrPayload.name;
      finalCode = nameOrPayload.code;
      finalShortName = nameOrPayload.shortName;
      finalLogoFile = nameOrPayload.logoFile;
      finalStreetAddress = nameOrPayload.streetAddress;
      finalCity = nameOrPayload.city;
      finalProvince = nameOrPayload.province;
      finalPostalCode = nameOrPayload.postalCode;
    }

    // 1. Create club in DB via secure authoritative RPC
    const { data, error } = await supabase.rpc('create_club', {
      p_name: name,
      p_code: finalCode ? finalCode.trim() : null,
      p_short_name: finalShortName ? finalShortName.trim() : null,
      p_street_address: finalStreetAddress ? finalStreetAddress.trim() : null,
      p_city: finalCity ? finalCity.trim() : null,
      p_province: finalProvince ? finalProvince.trim() : null,
      p_postal_code: finalPostalCode ? finalPostalCode.trim() : null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const clubId = data?.club_id;
    let finalLogoUrl: string | undefined;
    let logoWarningMsg: string | undefined;

    // 2. If logo file provided, upload and link
    if (clubId && finalLogoFile) {
      const uploadRes = await this.uploadClubLogo(clubId, finalLogoFile);
      if (uploadRes.success && uploadRes.logoUrl) {
        finalLogoUrl = uploadRes.logoUrl;
      } else {
        logoWarningMsg = `Club "${name}" was registered successfully, but the logo upload failed: ${uploadRes.error || 'Unknown storage error'}. You can update the logo later.`;
      }
    }

    return {
      success: true,
      clubId,
      logoUrl: finalLogoUrl,
      logoWarning: logoWarningMsg,
    };
  },

  /**
   * Update institutional Club Profile and Address metadata (Super Admin / Admin)
   */
  async updateClubProfile(
    payload: UpdateClubProfilePayload
  ): Promise<{ success: boolean; error?: string; club?: Club }> {
    const { data, error } = await supabase.rpc('update_club_profile', {
      p_club_id: payload.clubId,
      p_short_name: payload.shortName !== undefined ? (payload.shortName ? payload.shortName.trim() : null) : null,
      p_street_address: payload.streetAddress !== undefined ? (payload.streetAddress ? payload.streetAddress.trim() : null) : null,
      p_city: payload.city !== undefined ? (payload.city ? payload.city.trim() : null) : null,
      p_province: payload.province !== undefined ? (payload.province ? payload.province.trim() : null) : null,
      p_postal_code: payload.postalCode !== undefined ? (payload.postalCode ? payload.postalCode.trim() : null) : null,
      p_logo_url: payload.logoUrl !== undefined ? (payload.logoUrl ? payload.logoUrl.trim() : null) : null,
    });

    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true, club: data as Club };
  },

  /**
   * Get currently active coach for a club
   */
  async getClubActiveCoach(clubId: string): Promise<ActiveClubCoach | null> {
    const { data, error } = await supabase.rpc('get_club_active_coach', {
      p_club_id: clubId,
    });

    if (error) {
      console.error('Failed to fetch active coach:', error);
      return null;
    }
    return data;
  },

  /**
   * Get full historical coach roster for a club
   */
  async getClubCoachHistory(clubId: string): Promise<ClubCoachAssignment[]> {
    const { data, error } = await supabase.rpc('get_club_coach_history', {
      p_club_id: clubId,
    });

    if (error) {
      console.error('Failed to fetch coach history:', error);
      return [];
    }
    return data || [];
  },

  /**
   * Check if a coach has active authoritative permission for a club
   */
  async checkCoachAuthority(coachUserId: string, clubId: string): Promise<boolean> {
    const { data, error } = await supabase.rpc('get_coach_team_authority', {
      p_coach_user_id: coachUserId,
      p_club_id: clubId,
    });

    if (error) {
      console.error('Failed to check coach authority:', error);
      return false;
    }
    return Boolean(data);
  },

  /**
   * Get all pending coach succession requests
   */
  async getPendingSuccessions(): Promise<CoachSuccessionRequest[]> {
    const { data, error } = await supabase.rpc('get_pending_coach_successions');

    if (error) {
      console.error('Failed to fetch pending successions:', error);
      return [];
    }
    return data || [];
  },

  /**
   * Request coach succession
   */
  async requestSuccession(
    clubId: string,
    incomingCoachId: string,
    roleType: CoachRoleType = 'HEAD_COACH',
    reason?: string
  ): Promise<SuccessionOperationResult> {
    const { data, error } = await supabase.rpc('request_coach_succession', {
      p_club_id: clubId,
      p_incoming_coach_id: incomingCoachId,
      p_role_type: roleType,
      p_reason: reason || null,
    });

    if (error) {
      return { success: false, action: 'ERROR', error: error.message };
    }
    return data;
  },

  /**
   * Approve a coach succession request (Super Admin)
   */
  async approveSuccession(requestId: string, reviewNotes?: string): Promise<SuccessionOperationResult> {
    const { data, error } = await supabase.rpc('approve_coach_succession', {
      p_request_id: requestId,
      p_review_notes: reviewNotes || null,
    });

    if (error) {
      return { success: false, action: 'ERROR', error: error.message };
    }
    return data;
  },

  /**
   * Reject a coach succession request (Super Admin)
   */
  async rejectSuccession(requestId: string, reviewNotes?: string): Promise<SuccessionOperationResult> {
    const { data, error } = await supabase.rpc('reject_coach_succession', {
      p_request_id: requestId,
      p_review_notes: reviewNotes || null,
    });

    if (error) {
      return { success: false, action: 'ERROR', error: error.message };
    }
    return data;
  },

  /**
   * Fetch all clubs (including inactive/suspended/archived for governance view)
   * Lazily evaluates temporally expired suspensions and synchronizes DB.
   */
  async getAllClubs(): Promise<Club[]> {
    const { data, error } = await supabase
      .from('clubs')
      .select('*')
      .order('name');

    if (error) {
      console.error('Failed to fetch all clubs:', error);
      return [];
    }

    const clubs = (data || []) as Club[];
    const now = new Date();

    // Lazy evaluation for expired suspensions
    const evaluatedClubs = await Promise.all(
      clubs.map(async (club) => {
        if (
          club.governance_status === 'SUSPENDED' &&
          club.ban_until &&
          new Date(club.ban_until) <= now
        ) {
          const restored = await this.evaluateBanExpiry(club.id);
          return restored || club;
        }
        return club;
      })
    );

    return evaluatedClubs;
  },

  /**
   * Direct assign coach to club (Super Admin / Admin)
   */
  async directAssignCoach(
    clubId: string,
    coachUserId: string,
    roleType: CoachRoleType = 'HEAD_COACH',
    notes?: string
  ): Promise<SuccessionOperationResult> {
    const { data, error } = await supabase.rpc('direct_assign_club_coach', {
      p_club_id: clubId,
      p_coach_user_id: coachUserId,
      p_role_type: roleType,
      p_notes: notes || null,
    });

    if (error) {
      return { success: false, action: 'ERROR', error: error.message };
    }
    return data;
  },

  /**
   * Temporarily Suspend / Ban Club (Super Admin)
   */
  async suspendClub(
    clubId: string,
    durationDays: number | null,
    reason?: string,
    notes?: string
  ): Promise<{ success: boolean; error?: string; data?: any }> {
    const { data, error } = await supabase.rpc('suspend_club', {
      p_club_id: clubId,
      p_duration_days: durationDays,
      p_reason: reason || null,
      p_notes: notes || null,
    });

    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true, data };
  },

  /**
   * Restore Club to Active (Super Admin / Admin)
   */
  async restoreClub(
    clubId: string,
    notes?: string
  ): Promise<{ success: boolean; error?: string; data?: any }> {
    const { data, error } = await supabase.rpc('restore_club', {
      p_club_id: clubId,
      p_notes: notes || null,
    });

    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true, data };
  },

  /**
   * Archive Club (Super Admin)
   */
  async archiveClub(
    clubId: string,
    reason?: string
  ): Promise<{ success: boolean; error?: string; data?: any }> {
    const { data, error } = await supabase.rpc('archive_club', {
      p_club_id: clubId,
      p_reason: reason || null,
    });

    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true, data };
  },

  /**
   * Check Club Deletion Safety (Super Admin)
   */
  async checkDeletionSafety(clubId: string): Promise<ClubDeletionSafetyCheck | null> {
    const { data, error } = await supabase.rpc('check_club_deletion_safety', {
      p_club_id: clubId,
    });

    if (error) {
      console.error('Failed to check deletion safety:', error);
      return null;
    }
    return data;
  },

  /**
   * Permanently Delete Club (Super Admin)
   */
  async deleteClubPermanently(
    clubId: string,
    confirmedName: string
  ): Promise<{ success: boolean; error?: string; data?: any }> {
    const { data, error } = await supabase.rpc('delete_club_permanently', {
      p_club_id: clubId,
      p_confirmed_name: confirmedName,
    });

    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true, data };
  },
};
