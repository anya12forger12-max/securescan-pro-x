import React from "react";
import { useGamingContext } from "../context";
import { config } from "../config";

export default function Header() {
  const { user, balance, token, signIn, signUp, signOut, loadAudit, audit } = useGamingContext();
  const [mode, setMode] = React.useState<"login" | "register" | null>(null);
  const [identifier, setIdentifier] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    if (mode === "register") await signUp(identifier, email, password);
    else await signIn(identifier, password);
    setBusy(false);
    setMode(null);
    setPassword("");
  };

  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark">GP</span>
        <div>
          <strong>Gaming Platform</strong>
          <small>Secure play · gateway protected</small>
        </div>
      </div>

      <div className="header-right">
        <div className="balance" aria-label="Wallet balance">
          <small>Balance</small>
          <strong>{Number(balance || 0).toFixed(2)}</strong>
        </div>
        {user ? (
          <>
            <span className="username">{user.username}</span>
            {audit && <span className="badge ok">audit verified</span>}
            <button className="ghost-button" type="button" onClick={() => void loadAudit()}>
              Verify audit
            </button>
            <button className="ghost-button" type="button" onClick={() => void signOut()}>
              Sign out
            </button>
          </>
        ) : (
          <button className="primary-button" type="button" onClick={() => setMode("login")}>
            Sign in
          </button>
        )}
      </div>

      {mode && !token && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Authentication">
          <form className="auth-modal" onSubmit={(event) => void submit(event)}>
            <button
              className="modal-close"
              type="button"
              aria-label="Close"
              onClick={() => setMode(null)}
            >
              ×
            </button>
            <h2>{mode === "register" ? "Create account" : "Welcome back"}</h2>
            <p>All requests pass through the platform gateway.</p>
            <label>
              {mode === "register" ? "Username" : "Username or email"}
              <input
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                autoComplete="username"
                required
              />
            </label>
            {mode === "register" && (
              <label>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                />
              </label>
            )}
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                minLength={mode === "register" ? 12 : 1}
                required
              />
            </label>
            <button className="primary-button wide" type="submit" disabled={busy}>
              {busy ? "Please wait…" : mode === "register" ? "Register" : "Sign in"}
            </button>
            <button
              className="link-button"
              type="button"
              onClick={() => setMode(mode === "register" ? "login" : "register")}
            >
              {mode === "register"
                ? "Already have an account? Sign in"
                : "Need an account? Register"}
            </button>
            <small className="modal-footnote">Gateway: {config.gateway || "same origin"}</small>
          </form>
        </div>
      )}
    </header>
  );
}
