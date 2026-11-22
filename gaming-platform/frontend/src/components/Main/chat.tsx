import React from 'react';
import { useGamingContext } from '../../context';

export default function Chat() {
  const { rooms, room, messages, user, createRoom, loadMessages, sendMessage } = useGamingContext();
  const [draft, setDraft] = React.useState('');
  const [newRoom, setNewRoom] = React.useState('');

  return (
    <section className="chat-panel" aria-label="Chat">
      <div className="control-heading">
        <h2>Chat</h2>
        <select
          aria-label="Chat room"
          value={room}
          onChange={(event) => void loadMessages(event.target.value)}
        >
          {rooms.length === 0 && <option value={room}>{room}</option>}
          {rooms.map((item) => (
            <option key={item.id} value={item.name}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      <div className="chat-log" aria-live="polite">
        {messages.length === 0 && <p className="empty">No messages yet.</p>}
        {messages.map((message) => (
          <div key={message.id} className="chat-line">
            <strong>{message.username || message.user_id?.slice(0, 8) || 'system'}</strong>
            <span>{message.content}</span>
          </div>
        ))}
      </div>
      {user ? (
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.trim()) return;
            void sendMessage(room, draft.trim());
            setDraft('');
          }}
        >
          <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Message" />
          <button type="submit">Send</button>
        </form>
      ) : (
        <p className="empty">Sign in to post messages.</p>
      )}
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!newRoom.trim()) return;
          void createRoom(newRoom.trim());
          setNewRoom('');
        }}
      >
        <input value={newRoom} onChange={(event) => setNewRoom(event.target.value)} placeholder="New room" />
        <button type="button" onClick={() => void createRoom(newRoom.trim())} disabled={!newRoom.trim()}>
          Add room
        </button>
      </form>
    </section>
  );
}
