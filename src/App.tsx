import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { BrandingProvider, useBranding } from './context/BrandingContext';
import { AppLayout, NavigationTab } from './components/layout/AppLayout';
import { isTabAuthorized, isQaConsoleEnabled } from './utils/authorization';
import { ConciseDashboard } from './components/dashboard/ConciseDashboard';
import { AuthenticationView } from './components/auth/AuthenticationView';
import { MyProfileView } from './components/profile/MyProfileView';
import { SuperAdminRoleManagement } from './components/admin/SuperAdminRoleManagement';
import { LogoBrandingManagement } from './components/admin/LogoBrandingManagement';
import { SecurityInvariantsView } from './components/security/SecurityInvariantsView';
import { DatabaseDiagnosticsView } from './components/diagnostics/DatabaseDiagnosticsView';
import { TournamentManagementView } from './components/tournament/TournamentManagementView';
import { CourtControlDashboard } from './components/competition/CourtControlDashboard';
import { RegistrationManagementView } from './components/registration/RegistrationManagementView';
import { RankingsDashboard } from './components/rankings/RankingsDashboard';
import { ReportsDashboard } from './components/reports/ReportsDashboard';
import { CoachTeamManagementView } from './components/coach/CoachTeamManagementView';
import { PublicArenaScheduleHub } from './components/competition/PublicArenaScheduleHub';
import { AthletePortalView } from './components/athlete/AthletePortalView';
import { ChatHubView } from './components/chat/ChatHubView';
import { UnauthorizedAccessView } from './components/common/UnauthorizedAccessView';
import { GoogleLoginButton } from './components/auth/GoogleLoginButton';
import { QATestButtonTorture } from './pages/QATestButtonTorture';
import { Loader2, ShieldCheck } from 'lucide-react';

const AppContent: React.FC = () => {
  const { user, roles, loading, rolesLoading, assignmentsLoading, hasActiveOperationalAssignment } = useAuth();
  const { logoUrl, initializationBgUrl, isLoading: brandingLoading } = useBranding();
  const [minTimeElapsed, setMinTimeElapsed] = useState<boolean>(false);
  const [bgLoadError, setBgLoadError] = useState<boolean>(false);

  // 5-second minimum presentation timer (runs in parallel with background async tasks)
  useEffect(() => {
    const timer = setTimeout(() => {
      setMinTimeElapsed(true);
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  const [activeTab, setActiveTab] = useState<NavigationTab>(() => {
    if (typeof window !== 'undefined' && isQaConsoleEnabled()) {
      const path = window.location.pathname;
      if (path.startsWith('/qa/torture') || path.startsWith('/qa')) {
        return 'qa_torture';
      }
    }
    return 'dashboard';
  });

  // Listen for browser URL changes (e.g. /qa/torture) in staging/dev
  useEffect(() => {
    const handleLocation = () => {
      if (typeof window !== 'undefined' && isQaConsoleEnabled() && (window.location.pathname.startsWith('/qa/torture') || window.location.pathname.startsWith('/qa'))) {
        setActiveTab('qa_torture');
      }
    };
    window.addEventListener('popstate', handleLocation);
    return () => window.removeEventListener('popstate', handleLocation);
  }, []);

  // Full-Screen Initialization Gate (enforces 5s minimum display while all async loads complete)
  const isInitializing = !minTimeElapsed || loading || rolesLoading || assignmentsLoading || brandingLoading;

  if (isInitializing) {
    const hasCustomBg = Boolean(initializationBgUrl) && !bgLoadError;

    return (
      <div className="fixed inset-0 w-full h-full min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-300 select-none overflow-hidden z-50">
        {/* Full-Screen Initialization Background Image */}
        {hasCustomBg && (
          <div className="absolute inset-0 w-full h-full pointer-events-none">
            <img
              src={initializationBgUrl!}
              alt="UAAPHIL Initialization Background"
              className="w-full h-full object-cover object-center"
              referrerPolicy="no-referrer"
              onError={() => setBgLoadError(true)}
            />
            {/* High-clarity backdrop overlay & soft ambient gradient */}
            <div className="absolute inset-0 bg-slate-950/35" />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/60 via-transparent to-slate-950/30" />
          </div>
        )}

        {/* Center Loading Card */}
        <div className="relative z-10 flex flex-col items-center justify-center space-y-6 max-w-sm px-6 text-center animate-fade-in">
          <div className="space-y-2">
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight drop-shadow-md">
              UAAPHIL Tournament System
            </h1>
            <p className="text-xs text-amber-400/90 font-medium tracking-wide uppercase">
              Official Management Platform
            </p>
          </div>

          {/* Loading status & progress indicator */}
          <div className="flex flex-col items-center space-y-3 pt-2">
            <div className="flex items-center space-x-2.5 px-4 py-1.5 bg-slate-900/80 border border-slate-800 rounded-full shadow-inner">
              <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
              <span className="text-xs font-mono text-slate-300">
                Initializing System Environment...
              </span>
            </div>

            <span className="text-[10px] text-slate-500 font-mono tracking-wider">
              Verifying Security &amp; Tournament State
            </span>
          </div>
        </div>

        {/* Bottom Footer Badge */}
        <div className="absolute bottom-6 z-10 text-center">
          <span className="text-[11px] text-slate-500/80 font-mono">
            UAAPHIL Centralized Platform
          </span>
        </div>
      </div>
    );
  }

  // If not authenticated, render welcoming auth screen with Google Login
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl">
          <div className="text-center space-y-3">
            <div className="w-24 h-24 rounded-full p-0.5 bg-black border border-amber-500/40 flex items-center justify-center mx-auto shadow-2xl overflow-hidden ring-4 ring-amber-500/20">
              <img
                src={logoUrl}
                alt="UAAPhil Official Logo"
                className="w-full h-full object-cover rounded-full"
                referrerPolicy="no-referrer"
              />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">UAAPHIL Tournament System</h1>
              <p className="text-xs text-slate-400">Official Tournament Management Platform</p>
            </div>
          </div>

          <div className="p-4 bg-slate-950/70 border border-slate-800/80 rounded-xl space-y-2 text-xs text-slate-400">
            <div className="flex items-center space-x-2 text-slate-300 font-semibold">
              <ShieldCheck className="w-4 h-4 text-amber-400" />
              <span>Secure Google Sign-In &amp; Verified Access</span>
            </div>
            <p className="leading-relaxed">
              Sign in with your authorized Google credentials to access tournament operations, delegation rosters, and administrative role management.
            </p>
          </div>

          <div className="space-y-3">
            <GoogleLoginButton />
          </div>

          <div className="text-center">
            <span className="text-[11px] text-slate-500 font-mono">
              Official UAAPHIL Platform
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Verify route / tab authorization with dual-authority model
  const authorized = isTabAuthorized(activeTab, roles, hasActiveOperationalAssignment);

  return (
    <AppLayout activeTab={activeTab} onTabChange={setActiveTab}>
      {!authorized ? (
        <UnauthorizedAccessView
          attemptedTab={activeTab}
          onReturnToDashboard={() => setActiveTab('dashboard')}
        />
      ) : (
        <>
          {activeTab === 'dashboard' && <ConciseDashboard onNavigate={(t) => setActiveTab(t as NavigationTab)} />}
          {activeTab === 'athlete_hub' && <AthletePortalView />}
          {activeTab === 'arena_schedule' && (
            <PublicArenaScheduleHub
              onNavigateToTournamentManagement={() => setActiveTab('tournaments')}
            />
          )}
          {activeTab === 'chat' && <ChatHubView />}
          {activeTab === 'rankings' && <RankingsDashboard onNavigateToReports={() => setActiveTab('reports')} />}
          {activeTab === 'reports' && <ReportsDashboard onNavigateTab={(t) => setActiveTab(t)} />}
          {activeTab === 'team_management' && <CoachTeamManagementView onNavigateTab={(t) => setActiveTab(t)} />}
          {activeTab === 'auth' && <AuthenticationView />}
          {activeTab === 'profile' && <MyProfileView />}
          {activeTab === 'roles' && <SuperAdminRoleManagement />}
          {activeTab === 'branding' && <LogoBrandingManagement />}
          {activeTab === 'tournaments' && <TournamentManagementView onNavigateTab={(t) => setActiveTab(t)} />}
          {activeTab === 'competition' && <CourtControlDashboard />}
          {activeTab === 'registrations' && <RegistrationManagementView onNavigateTab={(t) => setActiveTab(t)} />}
          {activeTab === 'security' && <SecurityInvariantsView />}
          {activeTab === 'diagnostics' && <DatabaseDiagnosticsView />}
          {activeTab === 'qa_torture' && <QATestButtonTorture />}
        </>
      )}
    </AppLayout>
  );
};

export function App() {
  return (
    <AuthProvider>
      <BrandingProvider>
        <AppContent />
      </BrandingProvider>
    </AuthProvider>
  );
}

export default App;
