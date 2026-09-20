/**
 * Settings Page
 */
import React from "react";
import { useAuthStore, useUIStore } from "../stores";
import { authApi } from "../utils/api";
import { Button } from "../components/ui/button";
import { Select } from "../components/forms";
import { ShieldIcon, UserIcon } from "../components/icons";

export function SettingsPage(): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const { theme, setTheme } = useUIStore();
  const logout = useAuthStore((s) => s.logout);

  const THEMES = [
    { value: "dark", label: "Dark" },
    { value: "light", label: "Light" },
    { value: "high-contrast", label: "High Contrast" },
    { value: "colorblind", label: "Colorblind Safe" },
  ];

  const handleLogout = async () => {
    try { await authApi.logout(); } catch { /* ignore */ }
    logout();
  };

  return (
    <div className="page">
      <h1>Settings</h1>

      <div className="settings-section">
        <h2><UserIcon size={20} /> Account</h2>
        <div className="settings-card">
          <div className="settings-field">
            <span className="settings-label">Username</span>
            <span className="settings-value">{user?.username}</span>
          </div>
          <div className="settings-field">
            <span className="settings-label">Email</span>
            <span className="settings-value">{user?.email}</span>
          </div>
          <div className="settings-field">
            <span className="settings-label">Role</span>
            <span className="settings-value">{user?.role}</span>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h2><ShieldIcon size={20} /> Appearance</h2>
        <div className="settings-card">
          <Select
            label="Theme"
            options={THEMES}
            value={theme}
            onChange={setTheme}
          />
        </div>
      </div>

      <div className="settings-section">
        <h2>Security</h2>
        <div className="settings-card">
          <Button variant="danger" onClick={handleLogout}>
            Sign Out
          </Button>
        </div>
      </div>
    </div>
  );
}
