import React from 'react';
import './main.scss';
import History from './history';
import Stage from '../crash';
import AviatorStage from '../crash/AviatorStage';
import Bet from './bet';
import Chat from './chat';
import { useGamingContext } from '../../context';

export default function Main() {
  const { gameKind, session } = useGamingContext();

  // The reference Aviator surface owns its own history, bet panels and chat.
  // Every other game keeps the original board untouched.
  if (gameKind === 'crash') return <AviatorStage />;

  return (
    <section className="game-play" aria-label="Game area">
      <History />
      <div className="stage-board">
        <div className="stage-meta">
          <span className="badge">{gameKind}</span>
          <code>{session ? session.id.slice(0, 8) : 'no session'}</code>
        </div>
        <Stage />
      </div>
      <div className="control-column">
        <Bet />
        <Chat />
      </div>
    </section>
  );
}
