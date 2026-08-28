export interface BrandingSettings {
  logo_url: string;
  app_title?: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
  // Centralized Initialization Background Settings
  initialization_bg_url?: string | null;
  initialization_bg_file_name?: string | null;
  initialization_bg_file_size?: number | null;
  initialization_bg_mime_type?: string | null;
  initialization_bg_storage_path?: string | null;
  updated_at?: string;
  updated_by?: string | null;
}

export const DEFAULT_BRANDING: BrandingSettings = {
  logo_url: '/logo.webp',
  app_title: 'UAAPHIL Tournament System',
  initialization_bg_url: null,
  initialization_bg_file_name: null,
  initialization_bg_file_size: null,
  initialization_bg_mime_type: null,
  initialization_bg_storage_path: null,
};
