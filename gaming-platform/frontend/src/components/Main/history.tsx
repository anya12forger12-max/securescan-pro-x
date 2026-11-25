import React from 'react';
import { useGamingContext } from '../../context';

export default function History() {
  const { history, events } = useGamingContext();
  const [open, setOpen] = React.useState(false);

  return (
    <div className="history-board">
      <button className="history-toggle" type="button" onClick={() => setOpen((value) => !value)}>
        Recent events <span aria-hidden="true">{open ? '▵' : '▿'}</span>
      </button>
      <div className="history-strip" aria-label="Recent event sequence numbers">
        {history.slice(0, 12).map((seq, index) => (
          <span key={`${seq}-${index}`} className={index === 0 ? 'latest' : ''}>
            <span className="seq-number">{seq}</span>
          </span>
        ))}
        {history.length === 0 && <span className="empty">no events</span>}
      </div>
      {open && (
        <div className="history-dropdown">
          {events.slice(0, 30).map((event) => (
            <div key={event.seq} className="history-entry">
              <span className="seq-number">{event.seq}</span>
              <strong>{event.topic}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
