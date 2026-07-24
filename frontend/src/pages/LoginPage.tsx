/**
 * Login Page
 */
import React, { useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/forms";
import { ShieldIcon } from "../components/icons";
import { authApi } from "../utils/api";
import { useAuthStore } from "../stores";

export function LoginPage(): JSX.Element {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const setUser = useAuthStore((s) => s.setUser);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await authApi.login(username, password);
      if (res.success && res.user) {
        setUser(res.user);
      } else {
        setError("Login failed");
      }
    } catch (err: any) {
      setError(err.detail || "Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <ShieldIcon size={48} className="login-logo" />
          <h1>SecureScan Pro X</h1>
          <p>Enterprise Security Assessment Platform</p>
        </div>
        <form onSubmit={handleSubmit} className="login-form" noValidate>
          <Input
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter your username"
            required
            autoComplete="username"
            autoFocus
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            required
            autoComplete="current-password"
          />
          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" size="lg" loading={loading} className="login-btn">
            Sign In
          </Button>
        </form>
        <p className="login-demo">
          Demo: admin / admin123!@#SecureScan
        </p>
      </div>
    </div>
  );
}
