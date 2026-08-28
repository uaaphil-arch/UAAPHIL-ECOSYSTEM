import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { BrandingSettings, DEFAULT_BRANDING } from '../types/branding';

const MAX_LOGO_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB
const ALLOWED_LOGO_MIME_TYPES = ['image/png', 'image/webp', 'image/svg+xml', 'image/jpeg', 'image/jpg'];

const MAX_BG_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB for high-resolution loading backgrounds
const ALLOWED_BG_MIME_TYPES = ['image/png', 'image/webp', 'image/jpeg', 'image/jpg'];

/**
 * Safely deletes an asset from Supabase Storage ONLY if it is positively
 * identified as an initialization background asset within the 'initialization/' directory.
 */
async function safeDeleteInitializationAsset(storagePath?: string | null): Promise<void> {
  if (!storagePath || !isSupabaseConfigured) return;
  // Security boundary: only delete from initialization/ directory, never official/ or root
  if (!storagePath.startsWith('initialization/')) {
    console.warn(`[BrandingService] Refused to delete non-initialization storage path: ${storagePath}`);
    return;
  }

  try {
    const { error } = await supabase.storage
      .from('branding')
      .remove([storagePath]);
    if (error) {
      console.warn(`[BrandingService] Non-fatal: Failed to remove old background asset ${storagePath}:`, error.message);
    }
  } catch (err) {
    console.warn(`[BrandingService] Non-fatal: Storage cleanup exception for ${storagePath}:`, err);
  }
}

export const brandingService = {
  /**
   * Fetches the current branding settings from public.app_settings.
   * Falls back gracefully to DEFAULT_BRANDING.
   */
  async getBrandingSettings(): Promise<BrandingSettings> {
    if (!isSupabaseConfigured) {
      return DEFAULT_BRANDING;
    }

    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value, updated_at, updated_by')
        .eq('key', 'branding')
        .maybeSingle();

      if (error) {
        console.warn('Could not load branding settings from DB, using fallback:', error.message);
        return DEFAULT_BRANDING;
      }

      if (data && data.value) {
        const val = data.value as BrandingSettings;
        return {
          ...DEFAULT_BRANDING,
          ...val,
          updated_at: data.updated_at || val.updated_at,
          updated_by: data.updated_by || val.updated_by,
        };
      }

      return DEFAULT_BRANDING;
    } catch (err) {
      console.warn('Error fetching branding settings:', err);
      return DEFAULT_BRANDING;
    }
  },

  /**
   * Uploads the raw logo file to Supabase Storage ('branding' bucket)
   * or converts to raw Data URL and updates public.app_settings.
   * Preserves any existing initialization background settings.
   */
  async uploadLogo(file: File, userId: string): Promise<BrandingSettings> {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase is not configured.');
    }

    // 1. Validation: File size
    if (file.size > MAX_LOGO_FILE_SIZE_BYTES) {
      throw new Error(`File size (${(file.size / (1024 * 1024)).toFixed(2)}MB) exceeds maximum limit of 2MB.`);
    }

    // 2. Validation: MIME Type
    if (!ALLOWED_LOGO_MIME_TYPES.includes(file.type)) {
      throw new Error(`Invalid file type (${file.type || 'unknown'}). Only .png, .webp, .svg, and .jpeg are allowed.`);
    }

    // Read current settings to preserve background and other keys
    const currentSettings = await this.getBrandingSettings();

    let publicLogoUrl: string = '';

    // 3. Try upload to Supabase Storage bucket 'branding'
    try {
      const fileExt = file.name.split('.').pop() || 'webp';
      const cleanFileName = `logo_${Date.now()}.${fileExt}`;
      const filePath = `official/${cleanFileName}`;

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
        console.warn('Storage bucket upload failed, using direct data encoding fallback:', uploadError.message);
      }
    } catch (storageErr) {
      console.warn('Storage service unavailable, fallback to direct encoded asset:', storageErr);
    }

    // 4. Fallback if storage bucket is not provisioned or failed: read raw as data URL
    if (!publicLogoUrl) {
      publicLogoUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read logo file.'));
        reader.readAsDataURL(file);
      });
    }

    const brandingPayload: BrandingSettings = {
      ...currentSettings,
      logo_url: publicLogoUrl,
      app_title: 'UAAPHIL Tournament System',
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    };

    // 5. Update app_settings database record
    const { error: dbError } = await supabase
      .from('app_settings')
      .upsert({
        key: 'branding',
        value: brandingPayload,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      });

    if (dbError) {
      throw new Error(`Failed to save branding in database: ${dbError.message}`);
    }

    return brandingPayload;
  },

  /**
   * Resets official logo back to default '/logo.webp'
   * Preserves existing initialization background.
   */
  async resetToDefault(userId: string): Promise<BrandingSettings> {
    if (!isSupabaseConfigured) {
      return DEFAULT_BRANDING;
    }

    const currentSettings = await this.getBrandingSettings();

    const resetPayload: BrandingSettings = {
      ...currentSettings,
      logo_url: DEFAULT_BRANDING.logo_url,
      file_name: undefined,
      file_size: undefined,
      mime_type: undefined,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    };

    const { error } = await supabase
      .from('app_settings')
      .upsert({
        key: 'branding',
        value: resetPayload,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      });

    if (error) {
      throw new Error(`Failed to reset branding: ${error.message}`);
    }

    return resetPayload;
  },

  /**
   * Uploads and replaces the full-screen initialization background image.
   * Follows the Safe Replacement Algorithm:
   * 1. Read current/old background path.
   * 2. Validate new file.
   * 3. Upload new file to 'initialization/' storage namespace.
   * 4. Obtain public URL.
   * 5. Persist updated branding payload in public.app_settings JSONB.
   * 6. ONLY AFTER DB persistence succeeds, safely clean up old background asset.
   */
  async uploadInitializationBackground(file: File, userId: string): Promise<BrandingSettings> {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase is not configured.');
    }

    // Step 1: Read current settings to preserve logo and get old storage path
    const currentSettings = await this.getBrandingSettings();
    const oldStoragePath = currentSettings.initialization_bg_storage_path;

    // Step 2: Validation
    if (file.size > MAX_BG_FILE_SIZE_BYTES) {
      throw new Error(`Background file size (${(file.size / (1024 * 1024)).toFixed(2)}MB) exceeds maximum limit of 5.0MB.`);
    }

    if (!ALLOWED_BG_MIME_TYPES.includes(file.type)) {
      throw new Error(`Invalid background file type (${file.type || 'unknown'}). Allowed formats: .webp, .jpeg, .jpg, .png.`);
    }

    let publicBgUrl: string = '';
    let newStoragePath: string | null = null;

    // Step 3: Upload new asset to 'initialization/' namespace
    const fileExt = file.name.split('.').pop() || 'webp';
    const cleanFileName = `bg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${fileExt}`;
    const filePath = `initialization/${cleanFileName}`;

    try {
      const { error: uploadError } = await supabase.storage
        .from('branding')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true,
          contentType: file.type,
        });

      if (!uploadError) {
        newStoragePath = filePath;
        const { data: urlData } = supabase.storage
          .from('branding')
          .getPublicUrl(filePath);

        if (urlData?.publicUrl) {
          publicBgUrl = urlData.publicUrl;
        }
      } else {
        console.warn('Storage bucket upload for initialization background failed, using fallback data URL:', uploadError.message);
      }
    } catch (storageErr) {
      console.warn('Storage service unavailable for background upload, using fallback:', storageErr);
    }

    // Step 4: Fallback data URL if storage upload failed
    if (!publicBgUrl) {
      publicBgUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read background image file.'));
        reader.readAsDataURL(file);
      });
    }

    // Step 5: Construct updated payload preserving official logo
    const updatedPayload: BrandingSettings = {
      ...currentSettings,
      initialization_bg_url: publicBgUrl,
      initialization_bg_file_name: file.name,
      initialization_bg_file_size: file.size,
      initialization_bg_mime_type: file.type,
      initialization_bg_storage_path: newStoragePath,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    };

    // Step 6: Persist in public.app_settings database record
    const { error: dbError } = await supabase
      .from('app_settings')
      .upsert({
        key: 'branding',
        value: updatedPayload,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      });

    if (dbError) {
      // Best-effort cleanup of orphaned newly uploaded asset if DB persistence fails
      if (newStoragePath) {
        safeDeleteInitializationAsset(newStoragePath).catch(() => {});
      }
      throw new Error(`Failed to save initialization background setting: ${dbError.message}`);
    }

    // Step 8: ONLY AFTER successful persistence, clean up old background asset if present
    if (oldStoragePath && oldStoragePath !== newStoragePath) {
      safeDeleteInitializationAsset(oldStoragePath).catch((cleanupErr) => {
        console.warn('[BrandingService] Non-fatal old background cleanup error:', cleanupErr);
      });
    }

    return updatedPayload;
  },

  /**
   * Explicitly removes the initialization background setting and restores
   * the default solid dark canvas in App.tsx.
   * Safely cleans up the old storage asset after persistence succeeds.
   */
  async removeInitializationBackground(userId: string): Promise<BrandingSettings> {
    if (!isSupabaseConfigured) {
      return DEFAULT_BRANDING;
    }

    // Step 1: Read current settings
    const currentSettings = await this.getBrandingSettings();
    const oldStoragePath = currentSettings.initialization_bg_storage_path;

    // Step 2: Prepare payload clearing background fields while preserving official logo
    const updatedPayload: BrandingSettings = {
      ...currentSettings,
      initialization_bg_url: null,
      initialization_bg_file_name: null,
      initialization_bg_file_size: null,
      initialization_bg_mime_type: null,
      initialization_bg_storage_path: null,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    };

    // Step 3: Persist in database
    const { error: dbError } = await supabase
      .from('app_settings')
      .upsert({
        key: 'branding',
        value: updatedPayload,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      });

    if (dbError) {
      throw new Error(`Failed to remove initialization background setting: ${dbError.message}`);
    }

    // Step 4: ONLY AFTER successful persistence, clean up old storage asset
    if (oldStoragePath) {
      safeDeleteInitializationAsset(oldStoragePath).catch((cleanupErr) => {
        console.warn('[BrandingService] Non-fatal background cleanup error during removal:', cleanupErr);
      });
    }

    return updatedPayload;
  },
};

