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

function Stage() {
  const { gameKind, codenames, ginRummy, pictionary, user, session } = useGamingContext();

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
    return (
      <div className="stage-game">
        <div className="stage-title">
          <span>Pictionary</span>
          <span className={`badge ${pictionary.status}`}>{pictionary.status}</span>
          {pictionary.winner_id && <strong>Winner: {pictionary.winner_id.slice(0, 8)}</strong>}
        </div>
        <div className="word-placeholder" aria-label="Drawing area">
          <span>{pictionary.masked_word ?? '•••••'}</span>
          <small>draw on paper or your preferred canvas; submit guesses below</small>
        </div>
        <div className="guess-list">
          {(pictionary.guesses ?? []).slice(-5).map((guess, index) => (
            <span key={`${guess.user_id}-${index}`} className={guess.correct ? 'correct' : ''}>
              {guess.guess}
            </span>
          ))}
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
