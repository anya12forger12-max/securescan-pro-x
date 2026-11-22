import React from 'react';
import { useGamingContext } from '../../context';
import type { GameKind } from '../../types';

/** The Aviator client calls this component "bet". It is the primary action
 * panel: here it creates sessions and submits game moves instead of wagers. */
export default function Bet() {
  const {
    gameKind,
    session,
    gameId: activeGameFromContext,
    update,
    createSession,
    joinSession,
    createCodenames,
    startCodenames,
    guessCodenames,
    clueCodenames,
    createGinRummy,
    joinGinRummy,
    drawGinRummy,
    discardGinRummy,
    meldGinRummy,
    createPictionary,
    guessPictionary,
    loadGame,
  } = useGamingContext();

  const [kind, setKind] = React.useState<GameKind>(gameKind);
  const [sessionId, setSessionId] = React.useState('');
  const [gameId, setGameId] = React.useState('');
  const [word, setWord] = React.useState('');
  const [clueNumber, setClueNumber] = React.useState(2);
  const [card, setCard] = React.useState('');
  const [melds, setMelds] = React.useState('');

  const activeSessionId = sessionId || session?.id || '';
  const activeGameId = gameId || activeGameFromContext;

  const makeSession = async () => {
    update({ gameKind: kind });
    const created = await createSession(kind);
    if (created) setSessionId(created.id);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeGameId) return;
    if (kind === 'codenames') {
      if (word) void guessCodenames(activeGameId, word);
      setWord('');
    } else if (kind === 'pictionary') {
      if (word) void guessPictionary(activeGameId, word);
      setWord('');
    }
  };

  return (
    <section className="bet-control" aria-label="Game controls">
      <div className="control-heading">
        <h2>Controls</h2>
        <select
          aria-label="Game type"
          value={kind}
          onChange={(event) => {
            const next = event.target.value as GameKind;
            setKind(next);
            update({ gameKind: next });
          }}
        >
          <option value="codenames">Codenames</option>
          <option value="gin-rummy">Gin-rummy</option>
          <option value="pictionary">Pictionary</option>
        </select>
      </div>

      <div className="control-grid">
        <label>
          Session ID
          <input
            value={sessionId}
            onChange={(event) => setSessionId(event.target.value)}
            placeholder={session?.id ?? 'create or paste a UUID'}
          />
        </label>
        <button type="button" onClick={() => void makeSession()}>
          Create session
        </button>
        <button type="button" disabled={!sessionId} onClick={() => void joinSession(sessionId)}>
          Join session
        </button>
      </div>

      <div className="control-grid">
        <label>
          Game ID
          <input
            value={gameId}
            onChange={(event) => setGameId(event.target.value)}
            placeholder="game UUID"
          />
        </label>
        <button
          type="button"
          disabled={!activeSessionId}
          onClick={() => {
            if (kind === 'codenames') {
              void createCodenames(activeSessionId);
            } else if (kind === 'gin-rummy') {
              void createGinRummy(activeSessionId);
            } else {
              void createPictionary(activeSessionId);
            }
          }}
        >
          Create game
        </button>
        <button
          type="button"
          disabled={!activeGameId}
          onClick={() => void loadGame(kind, activeGameId)}
        >
          Refresh
        </button>
      </div>

      {kind === 'codenames' && (
        <div className="control-actions">
          <button type="button" disabled={!activeGameId} onClick={() => void startCodenames(activeGameId)}>
            Start
          </button>
          <form className="inline-form" onSubmit={submit}>
            <input value={word} onChange={(event) => setWord(event.target.value)} placeholder="Guess a word" />
            <button type="submit" disabled={!activeGameId}>Guess</button>
          </form>
          <div className="inline-form">
            <input value={word} onChange={(event) => setWord(event.target.value)} placeholder="Clue word" />
            <input
              type="number"
              min={1}
              max={100}
              value={clueNumber}
              onChange={(event) => setClueNumber(Number(event.target.value))}
              aria-label="Clue number"
            />
            <button type="button" disabled={!activeGameId} onClick={() => void clueCodenames(activeGameId, word, clueNumber)}>
              Clue
            </button>
          </div>
        </div>
      )}

      {kind === 'gin-rummy' && (
        <div className="control-actions">
          <button type="button" disabled={!activeGameId} onClick={() => void joinGinRummy(activeGameId)}>
            Join game
          </button>
          <button type="button" disabled={!activeGameId} onClick={() => void drawGinRummy(activeGameId, 'stock')}>
            Draw stock
          </button>
          <button type="button" disabled={!activeGameId} onClick={() => void drawGinRummy(activeGameId, 'discard')}>
            Draw discard
          </button>
          <div className="inline-form">
            <input value={card} onChange={(event) => setCard(event.target.value)} placeholder="10H" />
            <button type="button" disabled={!activeGameId} onClick={() => void discardGinRummy(activeGameId, card)}>
              Discard
            </button>
          </div>
          <div className="inline-form">
            <input
              value={melds}
              onChange={(event) => setMelds(event.target.value)}
              placeholder="7H,8H,9H | 2S,2D,2C"
            />
            <button
              type="button"
              disabled={!activeGameId}
              onClick={() => {
                const groups = melds
                  .split('|')
                  .map((group) => group.split(',').map((item) => item.trim()).filter(Boolean))
                  .filter((group) => group.length > 0);
                void meldGinRummy(activeGameId, groups);
              }}
            >
              Meld
            </button>
          </div>
        </div>
      )}

      {kind === 'pictionary' && (
        <div className="control-actions">
          <form className="inline-form" onSubmit={submit}>
            <input value={word} onChange={(event) => setWord(event.target.value)} placeholder="Your guess" />
            <button type="submit" disabled={!activeGameId}>Guess</button>
          </form>
        </div>
      )}
    </section>
  );
}
