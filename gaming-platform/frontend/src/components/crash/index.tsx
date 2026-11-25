import { useEffect, useState } from 'react';
import './crash.scss';
import { useGamingContext } from '../../context';

function CardList({ label, cards }: { label: string; cards: string[] }) {
  return (
    <div className="card-group">
      <small>{label}</small>
      <div className="cards">
        {cards.length ? cards.map((card, index) => <span key={`${card}-${index}`}>{card}</span>) : <em>empty</em>}
      </div>
    </div>
  );
}

/**
 * The unified Aviator stage. The multiplier is derived from the server's
 * `startedAt` timestamp so every browser sees the same curve without a socket;
 * authoritative outcomes still come from the crash service over the gateway.
 */
function CrashStage() {
  const { crash, cashOutCrash, user } = useGamingContext();
  const { round, myBet, history } = crash;
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (round?.status !== 'running') return;
    const timer = setInterval(() => setNow(Date.now()), 80);
    return () => clearInterval(timer);
  }, [round?.status, round?.id]);

  if (!round) {
    return (
      <div className="stage-empty">
        <div className="stage-orbit" />
        <h2>Waiting for the next flight</h2>
        <p>The crash service will open betting shortly.</p>
      </div>
    );
  }

  const startedMs = round.startedAt ? new Date(round.startedAt).getTime() : NaN;
  const elapsed = Number.isFinite(startedMs) ? Math.max(0, now - startedMs) : 0;
  // The round payload may not carry these yet; fall back to the crash service
  // defaults (3s doubling, 100x maximum) rather than showing a wrong curve.
  const doublingRaw = Number(round.doublingSeconds);
  const doublingSeconds = Number.isFinite(doublingRaw) && doublingRaw > 0 ? doublingRaw : 3;
  const maxRaw = Number(round.maxMultiplier);
  const maxMultiplier = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : 100;
  // Mirror the server payout curve: 2^(elapsed / doublingSeconds), t in seconds,
  // capped at the authoritative crash point and the round's configured maximum.
  const t = elapsed / 1000;
  const crashCap = Number(round.crashPoint);
  const cap = Number.isFinite(crashCap) && crashCap > 0
    ? Math.min(crashCap, maxMultiplier)
    : maxMultiplier;
  const multiplierAt = (seconds: number) =>
    Math.max(1, Math.min(Math.pow(2, seconds / doublingSeconds), cap));
  const live = round.status === 'running'
    ? Math.round(multiplierAt(t) * 100) / 100
    : round.status === 'finished' ? Number(round.crashPoint ?? 1) : 1;
  const points = Array.from({ length: 28 }, (_, i) => {
    const x = (i / 27) * Math.min(Math.max(t, 4), 24);
    const y = multiplierAt(x);
    return `${(i / 27) * 100},${100 - Math.min(96, (y - 1) * 26)}`;
  }).join(' ');

  const phase = round.status === 'betting' ? 'BETTING OPEN'
    : round.status === 'running' ? 'FLYING'
      : round.status === 'finished' ? `CRASHED @ ${Number(round.crashPoint ?? 0).toFixed(2)}x`
        : 'CANCELLED';

  return (
    <div className="stage-game crash-stage">
      <div className="stage-title">
        <span>Aviator Crash</span>
        <span className={`badge ${round.status}`}>{phase}</span>
        {round.proof && (
          <span className={`proof ${round.proof.valid ? 'valid' : 'invalid'}`}
            title={`seed ${round.seedHash}`}>
            {round.proof.valid ? 'provably fair ✓' : 'proof mismatch'}
          </span>
        )}
      </div>

      <div className={`crash-multiplier ${round.status}`}>
        <strong>{live.toFixed(2)}x</strong>
        <small>{round.status === 'betting' ? 'place your stake' : round.status === 'running' ? 'cash out before the crash' : 'next round starting'}</small>
      </div>

      <svg className="crash-curve" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={points} fill="none" stroke={round.status === 'finished' ? '#FF00A8' : '#39FF14'} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>

      <div className="game-facts">
        <div><small>Round</small><code>{round.id.slice(0, 8)}</code></div>
        <div><small>Seed hash</small><code>{round.seedHash.slice(0, 12)}…</code></div>
        <div><small>Your stake</small><strong>{myBet ? `${Number(myBet.amount).toFixed(2)}` : '—'}</strong></div>
        <div><small>Status</small><strong>{myBet?.status ?? 'none'}</strong></div>
      </div>

      {myBet?.status === 'active' && round.status === 'running' && (
        <button className="crash-cashout" onClick={() => void cashOutCrash()} disabled={!user}>
          Cash out now
        </button>
      )}
      {myBet?.status === 'cashed_out' && (
        <p className="crash-result win">Cashed out at {Number(myBet.cashout_at).toFixed(2)}x — payout {Number(myBet.payout ?? 0).toFixed(2)}</p>
      )}
      {myBet?.status === 'lost' && (
        <p className="crash-result loss">Crashed at {Number(round.crashPoint ?? 0).toFixed(2)}x — stake lost. Better luck next flight.</p>
      )}

      {history.length > 0 && (
        <div className="crash-history" aria-label="Recent crash points">
          {history.slice(0, 10).map((item) => (
            <span key={item.id} className={Number(item.crashPoint ?? 0) >= 2 ? 'high' : ''}>
              {Number(item.crashPoint ?? 0).toFixed(2)}x
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Stage() {
  const {
    gameKind,
    codenames,
    ginRummy,
    pictionary,
    pictionaryWord,
    user,
    session,
  } = useGamingContext();

  if (gameKind === 'crash') return <CrashStage />;

  if (!session) {
    return (
      <div className="stage-empty">
        <div className="stage-orbit" />
        <h2>No active session</h2>
        <p>Create a game session from the control panel to begin.</p>
      </div>
    );
  }

  if (gameKind === 'codenames' && codenames) {
    const latestClue = codenames.clues?.[0];
    const lastGuess = codenames.guesses?.[codenames.guesses.length - 1];
    return (
      <div className="stage-game">
        <div className="stage-title">
          <span>Codenames</span>
          <span className={`badge ${codenames.status}`}>{codenames.status}</span>
          {codenames.winner && <strong>Winner: {codenames.winner}</strong>}
        </div>
        <div className="game-facts">
          <div><small>Turn</small><strong>{codenames.turn ?? '—'}</strong></div>
          <div><small>Game ID</small><code>{codenames.id.slice(0, 8)}</code></div>
        </div>
        {latestClue && (
          <p className="hint">
            <strong>Latest clue:</strong> {latestClue.word} · {latestClue.number}
            {latestClue.team ? ` · ${latestClue.team}` : ''}
          </p>
        )}
        {codenames.revealed && codenames.revealed.length > 0 && (
          <div className="revealed-list" aria-label="Revealed words">
            {codenames.revealed.map((item) => (
              <span key={`${item.word}-${item.revealed_at}`} className={item.team}>
                {item.word}
              </span>
            ))}
          </div>
        )}
        {lastGuess && (
          <p className="hint">
            Last guess: {lastGuess.word} · {lastGuess.outcome.replace(/_/g, ' ')}
          </p>
        )}
        <p className="hint">The board is secret. Submit a word from the board; the server reveals it and derives your team.</p>
      </div>
    );
  }

  if (gameKind === 'gin-rummy' && ginRummy) {
    return (
      <div className="stage-game">
        <div className="stage-title">
          <span>Gin-rummy</span>
          <span className={`badge ${ginRummy.status}`}>{ginRummy.status}</span>
          {ginRummy.winner_id && <strong>Winner: {ginRummy.winner_id.slice(0, 8)}</strong>}
        </div>
        <div className="game-facts">
          <div><small>Stock</small><strong>{ginRummy.stock_count ?? '—'}</strong></div>
          <div><small>Turn</small><strong>{ginRummy.turn_user_id === user?.id ? 'you' : 'opponent'}</strong></div>
        </div>
        <CardList label="Your hand" cards={ginRummy.hand ?? []} />
        <CardList label="Discard pile" cards={ginRummy.discard ?? []} />
      </div>
    );
  }

  if (gameKind === 'pictionary' && pictionary) {
    const isDrawer = pictionary.drawer_id === user?.id;
    // The service reveals the word only to the drawer on create and to the
    // player who wins the round. Show it in either case; everyone else keeps
    // seeing the masked placeholder.
    const canSeeWord = Boolean(pictionaryWord) && (isDrawer || Boolean(pictionary.winner_id));
    const shownWord = canSeeWord ? pictionaryWord : pictionary.masked_word ?? '•••••';
    return (
      <div className="stage-game">
        <div className="stage-title">
          <span>Pictionary</span>
          <span className={`badge ${pictionary.status}`}>{pictionary.status}</span>
          {pictionary.winner_id && <strong>Winner: {pictionary.winner_id.slice(0, 8)}</strong>}
        </div>
        <div className="word-placeholder" aria-label="Drawing area">
          <span>{shownWord}</span>
          <small>
            {isDrawer && canSeeWord
              ? 'Your word — draw it without saying it'
              : canSeeWord
                ? 'Word revealed — round complete'
                : 'draw on paper or your preferred canvas; submit guesses below'}
          </small>
        </div>
        <div className="guess-list">
          {(pictionary.guesses ?? []).slice(-5).map((guess, index) => {
            // While the word is hidden the service omits both the text and
            // its correctness for other players. Render that explicitly
            // instead of an empty chip that looks like a rendering failure.
            const hidden = typeof guess.guess !== 'string' || typeof guess.correct !== 'boolean';
            return (
              <span
                key={`${guess.user_id}-${index}`}
                className={hidden ? 'hidden' : guess.correct ? 'correct' : ''}
              >
                {hidden ? `${guess.username ?? 'player'}: hidden` : guess.guess}
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="stage-empty">
      <div className="stage-orbit" />
      <h2>Session ready</h2>
      <p>Start a game from the control panel.</p>
    </div>
  );
}

export default Stage;
