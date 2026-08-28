import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { brandingService } from '../services/brandingService';
import { BrandingSettings, DEFAULT_BRANDING } from '../types/branding';

interface BrandingContextType {
  branding: BrandingSettings;
  logoUrl: string;
  initializationBgUrl: string | null;
  isLoading: boolean;
  refreshBranding: () => Promise<void>;
  updateLogo: (file: File, userId: string) => Promise<BrandingSettings>;
  resetLogo: (userId: string) => Promise<BrandingSettings>;
  updateInitializationBackground: (file: File, userId: string) => Promise<BrandingSettings>;
  removeInitializationBackground: (userId: string) => Promise<BrandingSettings>;
}

const BrandingContext = createContext<BrandingContextType | undefined>(undefined);

export const BrandingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [branding, setBranding] = useState<BrandingSettings>(DEFAULT_BRANDING);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refreshBranding = useCallback(async () => {
    try {
      const settings = await brandingService.getBrandingSettings();
      setBranding(settings);

      // Update favicon dynamically if in browser environment
      if (typeof document !== 'undefined' && settings.logo_url) {
        const favicon = document.querySelector<HTMLLinkElement>("link[rel*='icon']");
        if (favicon) {
          favicon.href = settings.logo_url;
        }
      }
    } catch (err) {
      console.warn('Failed to load branding in context:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshBranding();
  }, [refreshBranding]);

  const updateLogo = async (file: File, userId: string): Promise<BrandingSettings> => {
    const updated = await brandingService.uploadLogo(file, userId);
    setBranding(updated);
    if (typeof document !== 'undefined' && updated.logo_url) {
      const favicon = document.querySelector<HTMLLinkElement>("link[rel*='icon']");
      if (favicon) {
        favicon.href = updated.logo_url;
      }
    }
    return updated;
  };

  const resetLogo = async (userId: string): Promise<BrandingSettings> => {
    const reset = await brandingService.resetToDefault(userId);
    setBranding(reset);
    if (typeof document !== 'undefined') {
      const favicon = document.querySelector<HTMLLinkElement>("link[rel*='icon']");
      if (favicon) {
        favicon.href = reset.logo_url;
      }
    }
    return reset;
  };

  const updateInitializationBackground = async (file: File, userId: string): Promise<BrandingSettings> => {
    const updated = await brandingService.uploadInitializationBackground(file, userId);
    setBranding(updated);
    return updated;
  };

  const removeInitializationBackground = async (userId: string): Promise<BrandingSettings> => {
    const updated = await brandingService.removeInitializationBackground(userId);
    setBranding(updated);
    return updated;
  };

  return (
    <BrandingContext.Provider
      value={{
        branding,
        logoUrl: branding.logo_url || DEFAULT_BRANDING.logo_url,
        initializationBgUrl: branding.initialization_bg_url ?? null,
        isLoading,
        refreshBranding,
        updateLogo,
        resetLogo,
        updateInitializationBackground,
        removeInitializationBackground,
      }}
    >
      {children}
    </BrandingContext.Provider>
  );
};

export const useBranding = (): BrandingContextType => {
  const context = useContext(BrandingContext);
  if (!context) {
    throw new Error('useBranding must be used within a BrandingProvider');
  }
  return context;
};
