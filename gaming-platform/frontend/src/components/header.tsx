import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useGamingContext } from "../context";

export default function Header() {
  const { user, balance, token, signOut, loadAudit, audit } = useGamingContext();
  const navigate = useNavigate();
  const location = useLocation();
  const openAuth = () =>
    navigate(token ? "/" : "/login", { state: token ? undefined : { from: location.pathname } });

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
        {user && token ? (
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
          <>
            <button className="ghost-button" type="button" onClick={() => navigate("/register", { state: { from: location.pathname } })}>
              Register
            </button>
            <button className="primary-button" type="button" onClick={openAuth}>
              Sign in
            </button>
          </>
        )}
      </div>
    </header>
  );
}
