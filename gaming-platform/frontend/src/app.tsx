import React from "react";
import Header from "./components/header";
import BetsUsers from "./components/bet-users";
import Main from "./components/Main";
import { useGamingContext } from "./context";

export default function App() {
  const { ready, streamReady } = useGamingContext();

  return (
    <div className="main-container">
      {!ready && (
        <div className="myloading" role="status" aria-live="polite">
          <div className="loading-container">
            <div className="loading-spinner" />
            <p>Connecting to the gaming platform…</p>
          </div>
        </div>
      )}
      <Header />
      <div className="connection-pill" aria-live="polite">
        <span className={streamReady ? "dot online" : "dot"} />
        {streamReady ? "live events" : "events offline"}
      </div>
      <main className="game-container">
        <BetsUsers />
        <Main />
      </main>
    </div>
  );
}
