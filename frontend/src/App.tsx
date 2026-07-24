/**
 * SecureScan Pro X — Main Application
 */
import React, { useEffect } from "react";
import { BrowserRouter, Routes, Route, NavLink, Navigate, useNavigate } from "react-router-dom";
import { AppLayout } from "./components/layout/app-layout";
import { Button } from "./components/ui/button";
import { ToastContainer } from "./components/ui/utility-components";
import {
  HomeIcon, SearchIcon, ServerIcon, GlobeIcon, ShieldIcon,
  SettingsIcon, LogOutIcon, BarChartIcon, UserIcon,
} from "./components/icons";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ScannerPage } from "./pages/ScannerPage";
import { WorkspacesPage } from "./pages/WorkspacesPage";
import { AssetsPage } from "./pages/AssetsPage";
import { AssessmentsPage } from "./pages/AssessmentsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { useAuthStore, useUIStore } from "./stores";
import { authApi } from "./utils/api";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();
  if (isLoading) return <div className="loading-screen">Loading...</div>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppHeader() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  const handleLogout = async () => {
    try { await authApi.logout(); } catch { /* ok */ }
    logout();
    navigate("/login");
  };

  return (
    <>
      <div className="header-brand">
        <ShieldIcon size={28} />
        <h1>SecureScan Pro X</h1>
      </div>
      <div className="header-actions">
        <div className="header-user">
          <UserIcon size={18} />
          <span>{user?.display_name || user?.username}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={handleLogout} aria-label="Sign out">
          Sign Out
        </Button>
      </div>
    </>
  );
}

function AppSidebar() {
  const links = [
    { to: "/", icon: <HomeIcon size={18} />, label: "Dashboard" },
    { to: "/scanner", icon: <SearchIcon size={18} />, label: "Scanner" },
    { to: "/workspaces", icon: <ServerIcon size={18} />, label: "Workspaces" },
    { to: "/assets", icon: <GlobeIcon size={18} />, label: "Assets" },
    { to: "/assessments", icon: <BarChartIcon size={18} />, label: "Assessments" },
    { to: "/settings", icon: <SettingsIcon size={18} />, label: "Settings" },
  ];

  return (
    <nav className="sidebar-nav" aria-label="Main navigation">
      <ul className="sidebar-nav__list">
        {links.map((link) => (
          <li key={link.to}>
            <NavLink
              to={link.to}
              end={link.to === "/"}
              className={({ isActive }) =>
                `sidebar-nav__link ${isActive ? "sidebar-nav__link--active" : ""}`
              }
            >
              {link.icon}
              <span>{link.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="sidebar-footer">
        <p className="sidebar-version">v0.1.0</p>
      </div>
    </nav>
  );
}

function AppShell() {
  const notifications = useUIStore((s) => s.notifications);
  const removeNotification = useUIStore((s) => s.removeNotification);

  return (
    <AppLayout
      header={<AppHeader />}
      sidebar={<AppSidebar />}
    >
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/scanner" element={<ScannerPage />} />
        <Route path="/workspaces" element={<WorkspacesPage />} />
        <Route path="/assets" element={<AssetsPage />} />
        <Route path="/assessments" element={<AssessmentsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastContainer toasts={notifications} onDismiss={removeNotification} />
    </AppLayout>
  );
}

function AppContent() {
  const { isAuthenticated, isLoading, setUser, setLoading } = useAuthStore();
  const setTheme = useUIStore((s) => s.setTheme);
  const theme = useUIStore((s) => s.theme);

  useEffect(() => {
    setTheme(theme);
  }, []);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const user = await authApi.me();
        setUser(user);
      } catch {
        setUser(null);
      }
    };
    checkAuth();
  }, []);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
