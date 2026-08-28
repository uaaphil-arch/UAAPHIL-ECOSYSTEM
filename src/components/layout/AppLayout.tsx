import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useBranding } from '../../context/BrandingContext';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { isTabAuthorized, NavigationTab } from '../../utils/authorization';
import { SignOutConfirmModal } from '../common/SignOutConfirmModal';
import { GlobalNotificationDrawer } from '../common/GlobalNotificationDrawer';
import { UserAvatar } from '../common/UserAvatar';
import { 
  LayoutDashboard, 
  Key, 
  User, 
  ShieldCheck, 
  Trophy, 
  Users, 
  Menu, 
  X, 
  LogOut,
  Image as ImageIcon,
  Radio,
  Medal,
  FileText,
  UserCheck,
  Award,
  Flame,
  WifiOff,
  Bell,
  MessageSquare
} from 'lucide-react';

export type { NavigationTab };

interface AppLayoutProps {
  activeTab: NavigationTab;
  onTabChange: (tab: NavigationTab) => void;
  children: React.ReactNode;
}

interface NavItem {
  id: NavigationTab;
  label: string;
  icon: React.ElementType;
  badge?: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'athlete_hub', label: 'My Athlete Hub', icon: Award, badge: 'ATHLETE' },
  { id: 'arena_schedule', label: 'Live Arena Schedule', icon: Radio, badge: 'ARENA' },
  { id: 'chat', label: 'Live Chat & Channels', icon: MessageSquare, badge: 'COMMUNITY' },
  { id: 'rankings', label: 'Rankings & Medals', icon: Medal, badge: 'OFFICIAL' },
  { id: 'team_management', label: 'Club & Team Management', icon: UserCheck, badge: 'DELEGATION' },
  { id: 'tournaments', label: 'Tournament Management', icon: Trophy },
  { id: 'competition', label: 'Live Competition', icon: Radio, badge: 'OFFICIAL' },
  { id: 'registrations', label: 'Registrations', icon: Users },
  { id: 'reports', label: 'Reports & Books', icon: FileText },
  { id: 'roles', label: 'Role Management', icon: ShieldCheck, badge: 'ADMIN' },
  { id: 'branding', label: 'Logo & Branding', icon: ImageIcon, badge: 'ADMIN' },
  { id: 'qa_torture', label: 'QA Button Torture', icon: Flame, badge: 'STAGING' },
  { id: 'profile', label: 'My Profile', icon: User },
  { id: 'auth', label: 'Account Session', icon: Key },
];

export const AppLayout: React.FC<AppLayoutProps> = ({
  activeTab,
  onTabChange,
  children,
}) => {
  const { user, profile, roles, hasActiveOperationalAssignment, signOut } = useAuth();
  const { logoUrl } = useBranding();
  const { isOnline } = useNetworkStatus();
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isNotificationDrawerOpen, setIsNotificationDrawerOpen] = useState(false);
  const [unreadAlertCounts, setUnreadAlertCounts] = useState<{ unread: number; critical: number }>({
    unread: 0,
    critical: 0,
  });

  const isSuperAdmin = roles.includes('SUPER_ADMIN');

  const hamburgerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasDrawerOpenRef = useRef<boolean>(false);

  // Filter items based on authoritative role authorization & active operational assignments
  const visibleNavItems = NAV_ITEMS.filter((item) =>
    isTabAuthorized(item.id, roles, hasActiveOperationalAssignment)
  );

  // Focus management & Escape key listener for mobile drawer
  useEffect(() => {
    if (mobileDrawerOpen) {
      wasDrawerOpenRef.current = true;

      // Programmatic initial focus target: drawer close button
      const focusTimer = requestAnimationFrame(() => {
        closeButtonRef.current?.focus();
      });

      // Escape key listener
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          setMobileDrawerOpen(false);
        }
      };

      window.addEventListener('keydown', handleKeyDown);

      return () => {
        cancelAnimationFrame(focusTimer);
        window.removeEventListener('keydown', handleKeyDown);
      };
    } else if (wasDrawerOpenRef.current) {
      wasDrawerOpenRef.current = false;
      // Focus restoration to the hamburger trigger that opened the drawer
      hamburgerTriggerRef.current?.focus();
    }
  }, [mobileDrawerOpen]);

  const handleSelectTab = (tab: NavigationTab) => {
    onTabChange(tab);
    setMobileDrawerOpen(false);
  };

  const handleConfirmSignOut = async () => {
    try {
      setIsSigningOut(true);
      await signOut();
    } finally {
      setIsSigningOut(false);
      setShowSignOutConfirm(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col antialiased">
      {/* Top Header Bar */}
      <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between">
          {/* Brand & Mobile Hamburger Toggle */}
          <div className="flex items-center space-x-2 sm:space-x-3 min-w-0 flex-1 mr-2">
            <button
              ref={hamburgerTriggerRef}
              id="mobile-nav-toggle"
              type="button"
              onClick={() => setMobileDrawerOpen(!mobileDrawerOpen)}
              className="lg:hidden p-1.5 sm:p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 shrink-0 min-h-[40px] min-w-[40px] flex items-center justify-center"
              aria-label="Toggle Navigation Menu"
              aria-expanded={mobileDrawerOpen}
              aria-controls="mobile-nav-drawer"
            >
              {mobileDrawerOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            <div className="flex items-center space-x-2 sm:space-x-2.5 min-w-0">
              <div className="w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center shrink-0 rounded-full overflow-hidden">
                <img
                  src={logoUrl}
                  alt="UAAPhil Official Logo"
                  className="w-full h-full object-cover rounded-full"
                  referrerPolicy="no-referrer"
                />
              </div>
              <div className="min-w-0">
                <h1 className="text-xs sm:text-base font-bold text-white tracking-tight leading-tight truncate">
                  UAAPHIL Tournament System
                </h1>
                <div className="flex items-center space-x-1.5 text-[10px] sm:text-[11px] text-slate-400">
                  <span className="font-semibold text-amber-400 shrink-0">Official</span>
                  <span>•</span>
                  <span className="truncate">Championship Platform</span>
                </div>
              </div>
            </div>
          </div>

          {/* User Quick Info & Network Status & Notifications */}
          <div className="flex items-center space-x-2 sm:space-x-3">
            {!isOnline && (
              <div 
                className="flex items-center space-x-1.5 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full bg-rose-950/80 border border-rose-800/80 text-rose-300 text-[11px] sm:text-xs font-medium animate-pulse"
                title="Device is currently offline. Internet connection unavailable."
                role="status"
                aria-live="polite"
              >
                <WifiOff className="w-3.5 h-3.5 text-rose-400" />
                <span className="hidden xs:inline text-[11px]">Offline</span>
              </div>
            )}

            {/* Global Notification Bell Trigger */}
            <button
              type="button"
              onClick={() => setIsNotificationDrawerOpen(true)}
              className="relative p-1.5 sm:p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/80 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 min-h-[40px] min-w-[40px] flex items-center justify-center"
              title="Open Operational Notifications & Alerts"
              aria-label={`Open Operational Notifications ${unreadAlertCounts.unread > 0 ? `(${unreadAlertCounts.unread} unread alerts)` : '(All read)'}`}
            >
              <Bell className="w-4 h-4" />
              {unreadAlertCounts.unread > 0 && (
                <span
                  className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center text-white ${
                    unreadAlertCounts.critical > 0
                      ? 'bg-rose-600 animate-pulse ring-2 ring-slate-900'
                      : 'bg-amber-500 ring-2 ring-slate-900'
                  }`}
                >
                  {unreadAlertCounts.unread > 99 ? '99+' : unreadAlertCounts.unread}
                </span>
              )}
            </button>

            {user && (
              <div className="hidden sm:flex items-center space-x-2 text-xs">
                <div className="text-right">
                  <div className="font-semibold text-slate-200 truncate max-w-[150px]">
                    {profile?.full_name || user.email}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono flex items-center justify-end space-x-1">
                    {isSuperAdmin && (
                      <span className="text-amber-400 font-bold">SUPER_ADMIN</span>
                    )}
                    {!isSuperAdmin && roles.length > 0 && (
                      <span className="text-purple-300">{roles[0]}</span>
                    )}
                    {roles.length === 0 && <span>Authenticated</span>}
                  </div>
                </div>
                <UserAvatar
                  avatarUrl={profile?.avatar_url}
                  name={profile?.full_name || user.email}
                  role={isSuperAdmin ? 'SUPER ADMIN' : roles[0] || 'USER'}
                  size="md"
                />
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main App Body */}
      <div className="flex-1 max-w-7xl w-full mx-auto px-2.5 sm:px-6 lg:px-8 py-2.5 sm:py-6 flex flex-col lg:flex-row gap-3 sm:gap-6 min-h-0">
        {/* Desktop Sidebar Navigation */}
        <aside className="hidden lg:block w-64 flex-shrink-0 space-y-4">
          <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-3 space-y-1 sticky top-22">
            <div className="px-3 py-2 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Navigation
            </div>

            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectTab(item.id)}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all text-left ${
                    isActive
                      ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                      : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                  }`}
                >
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-amber-400' : 'text-slate-400'}`} />
                    <span className="truncate">{item.label}</span>
                  </div>
                  {item.badge && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-slate-800 text-slate-300 border border-slate-700">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}

            {user && (
              <div className="pt-3 border-t border-slate-800 mt-2">
                <button
                  type="button"
                  onClick={() => setShowSignOutConfirm(true)}
                  className="w-full flex items-center space-x-2.5 px-3.5 py-2 rounded-xl text-xs font-medium text-rose-400 hover:bg-rose-950/40 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out</span>
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* Mobile Navigation Drawer Backdrop & Modal */}
        {mobileDrawerOpen && (
          <div
            id="mobile-nav-drawer"
            className="lg:hidden fixed inset-0 z-50 flex h-[100dvh] max-h-[100dvh] overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation Menu"
          >
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity animate-in fade-in duration-200"
              onClick={() => setMobileDrawerOpen(false)}
              aria-hidden="true"
            />

            {/* Drawer */}
            <div className="relative w-4/5 max-w-xs bg-slate-900 border-r border-slate-800 h-full max-h-[100dvh] flex flex-col shadow-2xl z-10 animate-in slide-in-from-left duration-200 overscroll-contain pb-[env(safe-area-inset-bottom,0px)]">
              {/* Header */}
              <div className="px-4 py-3 flex items-center justify-between border-b border-slate-800 shrink-0">
                <div className="flex items-center space-x-2.5">
                  <div className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center shrink-0 rounded-full overflow-hidden">
                    <img
                      src={logoUrl}
                      alt="UAAPhil Official Logo"
                      className="w-full h-full object-cover rounded-full"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <span className="font-bold text-sm text-white">Menu</span>
                </div>
                <button
                  ref={closeButtonRef}
                  type="button"
                  onClick={() => setMobileDrawerOpen(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors shrink-0 min-h-[36px] min-w-[36px] flex items-center justify-center"
                  aria-label="Close navigation menu"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Independently Scrollable Navigation List */}
              <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-0.5 overscroll-contain">
                {visibleNavItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelectTab(item.id)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition-all text-left ${
                        isActive
                          ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                          : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-amber-400' : 'text-slate-400'}`} />
                        <span className="truncate">{item.label}</span>
                      </div>
                      {item.badge && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-slate-800 text-slate-300 border border-slate-700 shrink-0">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* User / Sign Out Footer */}
              {user && (
                <div className="p-3 border-t border-slate-800 shrink-0 bg-slate-900">
                  <button
                    type="button"
                    onClick={() => {
                      setMobileDrawerOpen(false);
                      setShowSignOutConfirm(true);
                    }}
                    className="w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium text-rose-400 hover:bg-rose-950/40 transition-colors min-h-[40px]"
                  >
                    <LogOut className="w-4 h-4 shrink-0" />
                    <span>Sign Out</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Dynamic Content Panel */}
        <main className="flex-1 min-w-0 min-h-0">
          {children}
        </main>
      </div>

      {/* Global Read-Only Operational Notification Drawer */}
      <GlobalNotificationDrawer
        isOpen={isNotificationDrawerOpen}
        onClose={() => setIsNotificationDrawerOpen(false)}
        onCountUpdate={(unread, critical) => setUnreadAlertCounts({ unread, critical })}
        onNavigate={handleSelectTab}
      />

      {/* Sign Out Confirmation Modal */}
      <SignOutConfirmModal
        isOpen={showSignOutConfirm}
        onClose={() => setShowSignOutConfirm(false)}
        onConfirm={handleConfirmSignOut}
        isSigningOut={isSigningOut}
      />

      {/* Footer */}
      <footer className="mt-auto bg-slate-900/60 border-t border-slate-800/80 py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2">
          <span>UAAPHIL Official Tournament Management System</span>
          <span className="font-mono text-[11px] text-slate-500">Official Tournament Operations Portal</span>
        </div>
      </footer>
    </div>
  );
};
