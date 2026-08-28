import React, { useState, useEffect } from 'react';
import { User as UserIcon } from 'lucide-react';

export type UserAvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface UserAvatarProps {
  avatarUrl?: string | null;
  name?: string | null;
  role?: string | null;
  size?: UserAvatarSize;
  className?: string;
  showRoleBorder?: boolean;
  alt?: string;
}

/**
 * Extracts clean, deterministic 1-2 letter initials from a display name.
 */
function getInitials(name?: string | null): string {
  if (!name) return '';
  const trimmed = name.trim();
  if (!trimmed) return '';

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) {
    return words[0].slice(0, 1).toUpperCase();
  }
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * Maps role to consistent border and fallback background colors
 * matching the UAAPHIL role color palette.
 */
function getRoleBorderClasses(role?: string | null, showRoleBorder = true): string {
  if (!showRoleBorder || !role) {
    return 'border-slate-700 bg-slate-800 text-slate-200';
  }

  const normalized = role.toUpperCase().replace(/_/g, ' ');
  switch (normalized) {
    case 'SUPER ADMIN':
      return 'border-amber-500/80 bg-amber-950/80 text-amber-200';
    case 'ADMIN':
      return 'border-indigo-500/80 bg-indigo-950/80 text-indigo-200';
    case 'ORGANIZER':
      return 'border-purple-500/80 bg-purple-950/80 text-purple-200';
    case 'REFEREE':
    case 'TECHNICAL OFFICIAL':
    case 'TABLE OFFICIAL':
    case 'MEDICAL OFFICIAL':
      return 'border-emerald-500/80 bg-emerald-950/80 text-emerald-200';
    case 'COACH':
      return 'border-sky-500/80 bg-sky-950/80 text-sky-200';
    case 'ATHLETE':
      return 'border-cyan-500/80 bg-cyan-950/80 text-cyan-200';
    case 'USER':
    default:
      return 'border-slate-700 bg-slate-800 text-slate-200';
  }
}

/**
 * Maps standard size variants to dimensions, font sizes, and icon sizes.
 */
function getSizeClasses(size?: string | null): { container: string; icon: string; text: string } {
  switch (size) {
    case 'xs':
      return { container: 'w-6 h-6', icon: 'w-3 h-3', text: 'text-[10px]' };
    case 'sm':
      return { container: 'w-7 h-7', icon: 'w-3.5 h-3.5', text: 'text-[11px]' };
    case 'lg':
      return { container: 'w-10 h-10', icon: 'w-5 h-5', text: 'text-sm' };
    case 'xl':
      return { container: 'w-16 h-16 sm:w-20 sm:h-20', icon: 'w-8 h-8 sm:w-10 sm:h-10', text: 'text-xl sm:text-2xl' };
    case 'md':
    default:
      return { container: 'w-8 h-8', icon: 'w-4 h-4', text: 'text-xs' };
  }
}

/**
 * Canonical UserAvatar primitive for system-wide UAAPHIL user identity rendering.
 * 
 * Supports:
 * 1. Valid avatar image URLs with referrerPolicy="no-referrer" for Google OAuth / external CDNs.
 * 2. Automatic, deterministic initials fallback when avatar is null, empty, or fails to load.
 * 3. Graceful generic UserIcon fallback when name is also missing.
 * 4. Zero backend/network side-effects.
 */
export const UserAvatar: React.FC<UserAvatarProps> = ({
  avatarUrl,
  name,
  role,
  size = 'md',
  className = '',
  showRoleBorder = true,
  alt,
}) => {
  const [imageError, setImageError] = useState(false);

  // Reset error state whenever the avatarUrl prop changes
  useEffect(() => {
    setImageError(false);
  }, [avatarUrl]);

  const sanitizedUrl = avatarUrl?.trim();
  const shouldRenderImage = Boolean(sanitizedUrl) && !imageError;
  const initials = getInitials(name);
  const sizeConfig = getSizeClasses(size);
  const roleBorderClasses = getRoleBorderClasses(role, showRoleBorder);
  const accessibleAlt = alt || (name ? `${name}'s avatar` : 'User avatar');

  return (
    <div
      className={`relative inline-flex items-center justify-center rounded-full border flex-shrink-0 select-none overflow-hidden font-bold ${sizeConfig.container} ${roleBorderClasses} ${className}`}
      title={name || undefined}
      aria-label={accessibleAlt}
    >
      {shouldRenderImage ? (
        <img
          src={sanitizedUrl!}
          alt={accessibleAlt}
          className="w-full h-full object-cover rounded-full"
          referrerPolicy="no-referrer"
          onError={() => setImageError(true)}
        />
      ) : initials ? (
        <span className={`tracking-tight ${sizeConfig.text} font-semibold leading-none`}>
          {initials}
        </span>
      ) : (
        <UserIcon className={sizeConfig.icon} aria-hidden="true" />
      )}
    </div>
  );
};
