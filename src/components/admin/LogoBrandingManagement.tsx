import React, { useState, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useBranding } from '../../context/BrandingContext';
import {
  Image as ImageIcon,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  FileImage,
  Info,
  ShieldCheck,
  RotateCcw,
  Monitor,
  Trash2
} from 'lucide-react';

export const LogoBrandingManagement: React.FC = () => {
  const { user, roles, rolesLoading } = useAuth();
  const {
    branding,
    logoUrl,
    initializationBgUrl,
    isLoading: brandingLoading,
    updateLogo,
    resetLogo,
    updateInitializationBackground,
    removeInitializationBackground
  } = useBranding();
  const isAuthorized = roles.includes('SUPER_ADMIN') || roles.includes('ADMIN');

  // Official Logo Uploader State
  const logoFileInputRef = useRef<HTMLInputElement | null>(null);
  const [isLogoUploading, setIsLogoUploading] = useState<boolean>(false);
  const [isLogoResetting, setIsLogoResetting] = useState<boolean>(false);
  const [logoDragActive, setLogoDragActive] = useState<boolean>(false);
  const [logoFeedback, setLogoFeedback] = useState<{ type: 'success' | 'error'; text: string; details?: string } | null>(null);

  // Initialization Background Uploader State
  const bgFileInputRef = useRef<HTMLInputElement | null>(null);
  const [isBgUploading, setIsBgUploading] = useState<boolean>(false);
  const [isBgRemoving, setIsBgRemoving] = useState<boolean>(false);
  const [bgDragActive, setBgDragActive] = useState<boolean>(false);
  const [bgFeedback, setBgFeedback] = useState<{ type: 'success' | 'error'; text: string; details?: string } | null>(null);

  const formatBytes = (bytes?: number | null) => {
    if (!bytes) return 'N/A';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // --- Logo Handlers ---
  const handleLogoFile = async (file: File) => {
    if (!user) return;
    setLogoFeedback(null);

    const allowedTypes = ['image/png', 'image/webp', 'image/svg+xml', 'image/jpeg', 'image/jpg'];
    if (!allowedTypes.includes(file.type)) {
      setLogoFeedback({
        type: 'error',
        text: 'Invalid Logo File Type',
        details: `File type "${file.type || 'unknown'}" is not supported. Please upload a .png, .webp, .svg, or .jpeg image.`,
      });
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setLogoFeedback({
        type: 'error',
        text: 'Logo File Size Exceeded',
        details: `Selected file is ${(file.size / (1024 * 1024)).toFixed(2)}MB. Maximum allowed logo size is 2.0MB.`,
      });
      return;
    }

    setIsLogoUploading(true);
    try {
      await updateLogo(file, user.id);
      setLogoFeedback({
        type: 'success',
        text: 'Official Logo Updated Successfully',
        details: `Official logo stored and synchronized across login, navbar, and favicon.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to upload logo.';
      console.error('Logo upload error:', err);
      setLogoFeedback({
        type: 'error',
        text: 'Logo Upload Failed',
        details: msg,
      });
    } finally {
      setIsLogoUploading(false);
      if (logoFileInputRef.current) {
        logoFileInputRef.current.value = '';
      }
    }
  };

  const handleLogoReset = async () => {
    if (!user) return;
    setLogoFeedback(null);
    setIsLogoResetting(true);
    try {
      await resetLogo(user.id);
      setLogoFeedback({
        type: 'success',
        text: 'Official Logo Reset to Default',
        details: 'Logo has been reset to default /logo.webp asset.',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to reset logo.';
      setLogoFeedback({
        type: 'error',
        text: 'Logo Reset Failed',
        details: msg,
      });
    } finally {
      setIsLogoResetting(false);
    }
  };

  // --- Background Handlers ---
  const handleBgFile = async (file: File) => {
    if (!user) return;
    setBgFeedback(null);

    const allowedTypes = ['image/webp', 'image/jpeg', 'image/jpg', 'image/png'];
    if (!allowedTypes.includes(file.type)) {
      setBgFeedback({
        type: 'error',
        text: 'Invalid Background File Type',
        details: `File type "${file.type || 'unknown'}" is not supported. Please upload a .webp, .jpeg, or .png image.`,
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setBgFeedback({
        type: 'error',
        text: 'Background File Size Exceeded',
        details: `Selected file is ${(file.size / (1024 * 1024)).toFixed(2)}MB. Maximum allowed background size is 5.0MB.`,
      });
      return;
    }

    setIsBgUploading(true);
    try {
      await updateInitializationBackground(file, user.id);
      setBgFeedback({
        type: 'success',
        text: 'Initialization Background Updated Successfully',
        details: `New loading background saved and set as authoritative. Safe asset replacement lifecycle complete.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to upload initialization background.';
      console.error('Background upload error:', err);
      setBgFeedback({
        type: 'error',
        text: 'Background Upload Failed',
        details: msg,
      });
    } finally {
      setIsBgUploading(false);
      if (bgFileInputRef.current) {
        bgFileInputRef.current.value = '';
      }
    }
  };

  const handleBgRemove = async () => {
    if (!user) return;
    setBgFeedback(null);
    setIsBgRemoving(true);
    try {
      await removeInitializationBackground(user.id);
      setBgFeedback({
        type: 'success',
        text: 'Initialization Background Removed',
        details: 'Background setting cleared. The system initialization screen will display the default solid dark canvas.',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to remove background.';
      setBgFeedback({
        type: 'error',
        text: 'Removal Failed',
        details: msg,
      });
    } finally {
      setIsBgRemoving(false);
    }
  };

  if (rolesLoading || brandingLoading) {
    return (
      <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-8 flex flex-col items-center justify-center space-y-3 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
        <span className="text-xs">Loading branding settings...</span>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 sm:p-8 space-y-4">
        <div className="flex items-center space-x-3 text-slate-300 font-semibold text-sm">
          <div className="p-2 bg-slate-800 rounded-lg text-slate-400">
            <AlertTriangle className="w-5 h-5 text-rose-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Logo &amp; Branding (Restricted)</h3>
            <p className="text-xs text-slate-400">Access limited to Administrators and Super Administrators</p>
          </div>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed border-t border-slate-800 pt-4">
          Centralized brand assets and application logo configuration require <code className="font-mono text-amber-400">ADMIN</code> or <code className="font-mono text-amber-400">SUPER_ADMIN</code> authorization.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      {/* Header Banner */}
      <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-5 sm:p-6 space-y-3">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-xl">
            <ImageIcon className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white flex items-center space-x-2">
              <span>Logo &amp; Branding Management</span>
              <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded text-[10px] font-mono uppercase tracking-wider">
                Centralized Storage
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              Manage the official static logo and full-screen initialization loading background stored centrally in database settings.
            </p>
          </div>
        </div>

        <div className="text-xs text-slate-400 flex items-start space-x-2 border-t border-slate-700/60 pt-3">
          <Info className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            All brand assets are preserved in exact raw binary format without AI alterations. Settings persist in <code className="text-amber-300 font-mono">public.app_settings.branding</code> JSONB and synchronize across all authenticated client sessions.
          </p>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SECTION 1: OFFICIAL LOGO MANAGEMENT                                       */}
      {/* ========================================================================= */}
      <div className="space-y-4">
        <div className="flex items-center space-x-2">
          <FileImage className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            1. Official Logo Asset
          </h3>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Active Logo Live Preview Card */}
          <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-5 sm:p-6 space-y-5 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-2">
                  <FileImage className="w-4 h-4 text-amber-400" />
                  <span>Active Logo Preview</span>
                </h4>
                <span className="text-[11px] text-slate-400 font-mono">
                  {branding.mime_type || 'image/webp'}
                </span>
              </div>

              {/* Logo Display Stage */}
              <div className="p-6 bg-slate-950 rounded-xl border border-slate-800 flex flex-col items-center justify-center space-y-4">
                <div className="w-28 h-28 rounded-full p-1 bg-black border border-amber-500/40 flex items-center justify-center shadow-2xl overflow-hidden ring-4 ring-amber-500/20">
                  <img
                    src={logoUrl}
                    alt="Official UAAPHIL Logo"
                    className="w-full h-full object-cover rounded-full"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="text-center space-y-1">
                  <span className="text-xs font-bold text-white block">Official System Emblem</span>
                  <span className="text-[11px] text-slate-400 font-mono block truncate max-w-xs">
                    {branding.file_name || 'logo.webp'}
                  </span>
                </div>
              </div>

              {/* Asset Metadata Details */}
              <div className="space-y-2 text-xs bg-slate-900/60 p-4 rounded-lg border border-slate-800 text-slate-300">
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-500">File Size:</span>
                  <span className="font-mono text-slate-200">{formatBytes(branding.file_size)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-500">Last Synchronized:</span>
                  <span className="font-mono text-slate-200">
                    {branding.updated_at ? new Date(branding.updated_at).toLocaleString() : 'System Default'}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-500">Storage Target:</span>
                  <span className="font-mono text-amber-300">public.app_settings.branding</span>
                </div>
              </div>
            </div>

            {/* Reset Button */}
            <button
              type="button"
              disabled={isLogoResetting || isLogoUploading}
              onClick={handleLogoReset}
              className="w-full py-2 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center space-x-2 disabled:opacity-50"
            >
              {isLogoResetting ? (
                <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
              ) : (
                <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
              )}
              <span>Reset to Default Logo</span>
            </button>
          </div>

          {/* Logo Upload Control Card */}
          <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-5 sm:p-6 space-y-5 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-2">
                  <UploadCloud className="w-4 h-4 text-emerald-400" />
                  <span>Replace Official Logo</span>
                </h4>
                <span className="text-[11px] text-slate-400 font-mono">Max: 2MB</span>
              </div>

              {/* Hidden native input */}
              <input
                ref={logoFileInputRef}
                type="file"
                accept=".png,.webp,.svg,.jpeg,.jpg"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleLogoFile(e.target.files[0]);
                  }
                }}
              />

              {/* Drag & Drop Upload Zone */}
              <div
                onDragEnter={(e) => { e.preventDefault(); setLogoDragActive(true); }}
                onDragLeave={(e) => { e.preventDefault(); setLogoDragActive(false); }}
                onDragOver={(e) => { e.preventDefault(); setLogoDragActive(true); }}
                onDrop={(e) => {
                  e.preventDefault();
                  setLogoDragActive(false);
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    handleLogoFile(e.dataTransfer.files[0]);
                  }
                }}
                onClick={() => logoFileInputRef.current?.click()}
                className={`p-8 border-2 border-dashed rounded-xl flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                  logoDragActive
                    ? 'border-amber-400 bg-amber-500/10'
                    : 'border-slate-700 hover:border-amber-500/50 bg-slate-900/60 hover:bg-slate-900'
                }`}
              >
                <div className="w-12 h-12 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-amber-400 mb-3">
                  {isLogoUploading ? (
                    <Loader2 className="w-6 h-6 animate-spin" />
                  ) : (
                    <UploadCloud className="w-6 h-6" />
                  )}
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-bold text-white">
                    {isLogoUploading ? 'Uploading & saving to database...' : 'Click to browse or drag & drop logo file'}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Supports .png, .webp, .svg, .jpeg (Square Aspect Ratio)
                  </p>
                </div>

                <div className="mt-4 px-3 py-1 bg-slate-800 border border-slate-700 rounded text-[10px] font-mono text-slate-300">
                  Limit: 2.0 MB / Strict raw preservation
                </div>
              </div>

              {/* Guidelines */}
              <div className="p-3 bg-slate-900/50 border border-slate-800 rounded-lg text-[11px] text-slate-400 space-y-1">
                <div className="flex items-center space-x-1.5 text-slate-300 font-semibold">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Logo Requirements</span>
                </div>
                <p>• Formats: <strong>WebP, PNG, SVG, JPEG</strong></p>
                <p>• Recommended: <strong>512×512px</strong> square</p>
              </div>
            </div>

            <button
              type="button"
              disabled={isLogoUploading}
              onClick={() => logoFileInputRef.current?.click()}
              className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold shadow-md transition-colors flex items-center justify-center space-x-2 disabled:opacity-50"
            >
              {isLogoUploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Synchronizing Logo...</span>
                </>
              ) : (
                <>
                  <UploadCloud className="w-4 h-4" />
                  <span>Select &amp; Replace Logo</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Logo Feedback Banner */}
        {logoFeedback && (
          <div
            className={`p-4 rounded-xl border flex items-start space-x-3 text-xs ${
              logoFeedback.type === 'success'
                ? 'bg-emerald-950/60 border-emerald-800 text-emerald-200'
                : 'bg-rose-950/60 border-rose-800 text-rose-200'
            }`}
          >
            {logoFeedback.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
            )}
            <div className="space-y-1">
              <div className="font-bold text-sm">{logoFeedback.text}</div>
              {logoFeedback.details && (
                <p className="text-xs opacity-90 leading-relaxed font-mono">{logoFeedback.details}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* SECTION 2: INITIALIZATION BACKGROUND MANAGEMENT                           */}
      {/* ========================================================================= */}
      <div className="space-y-4 border-t border-slate-800 pt-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Monitor className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              2. Full-Screen Initialization Background
            </h3>
          </div>
          <span className="px-2 py-0.5 bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 rounded text-[10px] font-mono uppercase tracking-wider">
            Loading Canvas
          </span>
        </div>
        <p className="text-xs text-slate-400">
          Upload a high-resolution background image to display behind the official logo on the system loading screen during initialization (minimum 5-second display).
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Active Background Preview Card */}
          <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-5 sm:p-6 space-y-5 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-2">
                  <Monitor className="w-4 h-4 text-cyan-400" />
                  <span>Loading Screen Preview</span>
                </h4>
                <span className="text-[11px] text-slate-400 font-mono">
                  {initializationBgUrl ? (branding.initialization_bg_mime_type || 'Custom Image') : 'Solid Dark Fallback'}
                </span>
              </div>

              {/* Background Simulation Stage (16:9 Landscape Frame) */}
              <div className="relative w-full aspect-video rounded-xl overflow-hidden border border-slate-800 bg-slate-950 flex flex-col items-center justify-center shadow-2xl group">
                {initializationBgUrl ? (
                  <>
                    <img
                      src={initializationBgUrl}
                      alt="Initialization Background"
                      className="absolute inset-0 w-full h-full object-cover object-center pointer-events-none"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-slate-950/75 backdrop-blur-[1px]" />
                  </>
                ) : (
                  <div className="absolute inset-0 bg-slate-950 flex items-center justify-center text-slate-700 text-xs font-mono">
                    [Default Solid Dark Canvas #020617]
                  </div>
                )}

                {/* Foreground Simulated Elements */}
                <div className="relative z-10 flex flex-col items-center space-y-2 text-center p-4">
                  <div className="w-12 h-12 rounded-full p-0.5 bg-black border border-amber-500/40 flex items-center justify-center shadow-lg overflow-hidden ring-2 ring-amber-500/20">
                    <img
                      src={logoUrl}
                      alt="Logo"
                      className="w-full h-full object-cover rounded-full"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                  <span className="text-[10px] font-mono text-slate-300">Initializing UAAPHIL...</span>
                </div>

                <div className="absolute bottom-2 right-2 z-10 px-2 py-0.5 bg-black/60 rounded text-[9px] font-mono text-slate-400 border border-slate-800">
                  Preview Simulation (5s Minimum)
                </div>
              </div>

              {/* Background Metadata Details */}
              <div className="space-y-2 text-xs bg-slate-900/60 p-4 rounded-lg border border-slate-800 text-slate-300">
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-500">Configured State:</span>
                  <span className="font-mono text-slate-200">
                    {initializationBgUrl ? 'Custom Image Active' : 'Default Solid Slate-950'}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-500">File Name:</span>
                  <span className="font-mono text-slate-200 truncate max-w-[200px]">
                    {branding.initialization_bg_file_name || 'None'}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-500">File Size:</span>
                  <span className="font-mono text-slate-200">{formatBytes(branding.initialization_bg_file_size)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-500">Storage Target:</span>
                  <span className="font-mono text-cyan-300">branding/initialization/</span>
                </div>
              </div>
            </div>

            {/* Remove / Reset Background Button */}
            <button
              type="button"
              disabled={isBgRemoving || isBgUploading || !initializationBgUrl}
              onClick={handleBgRemove}
              className="w-full py-2 px-4 bg-slate-800 hover:bg-rose-950/40 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-800/50 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center space-x-2 disabled:opacity-40 disabled:hover:bg-slate-800 disabled:hover:text-slate-300 disabled:hover:border-slate-700"
            >
              {isBgRemoving ? (
                <Loader2 className="w-4 h-4 animate-spin text-rose-400" />
              ) : (
                <Trash2 className="w-3.5 h-3.5 text-rose-400" />
              )}
              <span>Remove Background (Restore Solid Dark Canvas)</span>
            </button>
          </div>

          {/* Background Upload Control Card */}
          <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-5 sm:p-6 space-y-5 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-2">
                  <UploadCloud className="w-4 h-4 text-cyan-400" />
                  <span>Upload Initialization Background</span>
                </h4>
                <span className="text-[11px] text-slate-400 font-mono">Max: 5MB</span>
              </div>

              {/* Hidden native input */}
              <input
                ref={bgFileInputRef}
                type="file"
                accept=".webp,.jpeg,.jpg,.png"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleBgFile(e.target.files[0]);
                  }
                }}
              />

              {/* Drag & Drop Upload Zone */}
              <div
                onDragEnter={(e) => { e.preventDefault(); setBgDragActive(true); }}
                onDragLeave={(e) => { e.preventDefault(); setBgDragActive(false); }}
                onDragOver={(e) => { e.preventDefault(); setBgDragActive(true); }}
                onDrop={(e) => {
                  e.preventDefault();
                  setBgDragActive(false);
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    handleBgFile(e.dataTransfer.files[0]);
                  }
                }}
                onClick={() => bgFileInputRef.current?.click()}
                className={`p-8 border-2 border-dashed rounded-xl flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                  bgDragActive
                    ? 'border-cyan-400 bg-cyan-500/10'
                    : 'border-slate-700 hover:border-cyan-500/50 bg-slate-900/60 hover:bg-slate-900'
                }`}
              >
                <div className="w-12 h-12 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-cyan-400 mb-3">
                  {isBgUploading ? (
                    <Loader2 className="w-6 h-6 animate-spin" />
                  ) : (
                    <UploadCloud className="w-6 h-6" />
                  )}
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-bold text-white">
                    {isBgUploading ? 'Uploading & saving background...' : 'Click to browse or drag & drop background image'}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Supports high-resolution .webp, .jpeg, .png
                  </p>
                </div>

                <div className="mt-4 px-3 py-1 bg-slate-800 border border-slate-700 rounded text-[10px] font-mono text-slate-300">
                  Limit: 5.0 MB / Safe replacement lifecycle
                </div>
              </div>

              {/* Guidelines */}
              <div className="p-3 bg-slate-900/50 border border-slate-800 rounded-lg text-[11px] text-slate-400 space-y-1">
                <div className="flex items-center space-x-1.5 text-slate-300 font-semibold">
                  <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Background Guidelines</span>
                </div>
                <p>• Accepted formats: <strong>WebP, JPEG, PNG</strong></p>
                <p>• Recommended resolution: <strong>1920×1080px</strong> (16:9) or 4K</p>
                <p>• Responsive display: Covers full viewport on portrait and landscape devices.</p>
                <p>• Safe asset lifecycle: Old assets deleted only after new background is saved.</p>
              </div>
            </div>

            <button
              type="button"
              disabled={isBgUploading}
              onClick={() => bgFileInputRef.current?.click()}
              className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold shadow-md transition-colors flex items-center justify-center space-x-2 disabled:opacity-50"
            >
              {isBgUploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Synchronizing Background...</span>
                </>
              ) : (
                <>
                  <UploadCloud className="w-4 h-4" />
                  <span>Select &amp; Replace Background</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Background Feedback Banner */}
        {bgFeedback && (
          <div
            className={`p-4 rounded-xl border flex items-start space-x-3 text-xs ${
              bgFeedback.type === 'success'
                ? 'bg-emerald-950/60 border-emerald-800 text-emerald-200'
                : 'bg-rose-950/60 border-rose-800 text-rose-200'
            }`}
          >
            {bgFeedback.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
            )}
            <div className="space-y-1">
              <div className="font-bold text-sm">{bgFeedback.text}</div>
              {bgFeedback.details && (
                <p className="text-xs opacity-90 leading-relaxed font-mono">{bgFeedback.details}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

