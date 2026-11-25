import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useGamingContext } from "../../context";
import { config } from "../../config";
import "./auth.scss";

export type AuthMode = "login" | "register";

interface AuthPageProps {
  mode: AuthMode;
}

/** Full-page authentication screen. The context owns the cookie/token
 * transition; this component only collects input and reports the result. */
export default function AuthPage({ mode }: AuthPageProps) {
  const { user, token, signIn, signUp } = useGamingContext();
  const navigate = useNavigate();
  const location = useLocation();
  const [identifier, setIdentifier] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const returnTo = (location.state as { from?: string } | null)?.from ?? "/";
  const registering = mode === "register";

  // A successful sign-in replaces the in-memory token, which is the single
  // source of truth for "authenticated". Redirect once that happens; a failed
  // attempt leaves the token untouched and the player can fix the form.
  React.useEffect(() => {
    if (token && user) navigate(returnTo, { replace: true });
  }, [token, user, returnTo, navigate]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (registering && password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const ok = registering
        ? await signUp(identifier.trim(), email.trim(), password)
        : await signIn(identifier.trim(), password);
      if (!ok) {
        setError(registering
          ? "Unable to create your account. Please check the details and try again."
          : "Unable to sign in with those details. Please try again.");
      }
    } catch {
      setError("The service is unavailable. Please try again.");
    } finally {
      // A rejected sign-in must never leave the button permanently disabled.
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-shell">
        <Link className="auth-brand" to="/" aria-label="Back to the gaming platform">
          <span className="auth-brand-mark">GP</span>
          <span>
            <strong>Gaming Platform</strong>
            <small>Secure play · gateway protected</small>
          </span>
        </Link>

        <section className="auth-card" aria-labelledby="auth-heading">
          <h1 id="auth-heading">{registering ? "Create your account" : "Welcome back"}</h1>
          <p className="auth-intro">
            {registering
              ? "Pick a username and a strong password to start playing."
              : "Sign in to see your balance, bets and live games."}
          </p>

          <form onSubmit={(event) => void submit(event)} noValidate={false}>
            <label className="auth-field">
              <span>{registering ? "Username" : "Username or email"}</span>
              <input
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                autoComplete="username"
                autoFocus
                required
                disabled={busy}
              />
            </label>

            {registering && (
              <label className="auth-field">
                <span>Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                  disabled={busy}
                />
              </label>
            )}

            <label className="auth-field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={registering ? "new-password" : "current-password"}
                minLength={registering ? 12 : 1}
                required
                disabled={busy}
              />
            </label>

            {registering && (
              <label className="auth-field">
                <span>Confirm password</span>
                <input
                  type="password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  autoComplete="new-password"
                  minLength={12}
                  required
                  disabled={busy}
                />
              </label>
            )}

            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}

            <button className="primary-button auth-submit" type="submit" disabled={busy}>
              {busy ? "Please wait…" : registering ? "Create account" : "Sign in"}
            </button>
          </form>

          <div className="auth-switch">
            {registering ? (
              <>
                Already have an account?{" "}
                <Link to="/login" state={location.state}>
                  Sign in
                </Link>
              </>
            ) : (
              <>
                Need an account?{" "}
                <Link to="/register" state={location.state}>
                  Register
                </Link>
              </>
            )}
          </div>

          <Link className="auth-back" to="/">
            ← Back to the game
          </Link>
        </section>

        <p className="auth-footnote">
          All requests pass through the platform gateway
          {config.gateway ? ` · ${config.gateway}` : ""}.
        </p>
      </div>
    </div>
  );
}
