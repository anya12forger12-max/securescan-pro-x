import { useGamingContext } from '../../context';

export default function AllData() {
  const { events, sessions, streamReady } = useGamingContext();

  return (
    <div className="data-list">
      <div className="list-heading">
        <span>Live events</span>
        <small>{streamReady ? 'connected' : 'reconnecting'}</small>
      </div>
      {events.length === 0 && <p className="empty">Waiting for platform events…</p>}
      {events.map((event) => (
        <div className="data-row" key={event.seq}>
          <span className="seq">#{event.seq}</span>
          <span className="topic">{event.topic}</span>
          <time>{new Date(event.published_at).toLocaleTimeString()}</time>
        </div>
      ))}

      <div className="list-heading spaced">
        <span>Game sessions</span>
        <small>{sessions.length}</small>
      </div>
      {sessions.slice(0, 6).map((session) => (
        <div className="data-row" key={session.id}>
          <span className="topic">{session.game_type}</span>
          <code>{session.id.slice(0, 8)}</code>
          <small>{session.status}</small>
        </div>
      ))}
    </div>
  );
}
