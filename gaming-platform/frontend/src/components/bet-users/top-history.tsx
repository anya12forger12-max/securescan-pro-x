import { useGamingContext } from '../../context';
import type { LeaderboardEntry, Tournament } from '../../types';

function TournamentRow({ tournament }: { tournament: Tournament }) {
  const { joinTournament } = useGamingContext();
  return (
    <div className="data-row">
      <span className="topic">{tournament.title}</span>
      <small>{tournament.status}</small>
      <button type="button" onClick={() => void joinTournament(tournament.id)}>
        Join
      </button>
    </div>
  );
}

function LeaderboardRow({ entry, rank }: { entry: LeaderboardEntry; rank: number }) {
  return (
    <div className="data-row">
      <span className="seq">#{rank + 1}</span>
      <span className="topic">{entry.username || entry.user_id.slice(0, 8)}</span>
      <strong>{entry.score}</strong>
    </div>
  );
}

export default function TopHistory({
  game,
  onGameChange,
}: {
  game: string;
  onGameChange: (game: string) => void;
}) {
  const { leaderboard, tournaments } = useGamingContext();

  return (
    <div className="data-list">
      <div className="list-heading">
        <span>Leaderboard</span>
        <select
          aria-label="Leaderboard game"
          value={game}
          onChange={(event) => onGameChange(event.target.value)}
        >
          <option value="codenames">Codenames</option>
          <option value="gin-rummy">Gin-rummy</option>
          <option value="pictionary">Pictionary</option>
          <option value="crash">Aviator Crash</option>
        </select>
      </div>
      {leaderboard.slice(0, 8).map((entry, index) => (
        <LeaderboardRow key={`${entry.user_id}-${index}`} entry={entry} rank={index} />
      ))}
      {leaderboard.length === 0 && <p className="empty">No scores recorded yet.</p>}

      <div className="list-heading spaced">
        <span>Tournaments</span>
      </div>
      {tournaments.slice(0, 5).map((tournament) => (
        <TournamentRow key={tournament.id} tournament={tournament} />
      ))}
      {tournaments.length === 0 && <p className="empty">No tournaments announced.</p>}
    </div>
  );
}
