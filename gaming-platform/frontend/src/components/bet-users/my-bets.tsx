import { useGamingContext } from '../../context';

export default function MyBets() {
  const { myBets, balance } = useGamingContext();

  return (
    <div className="data-list">
      <div className="list-heading">
        <span>My activity</span>
        <strong>{Number(balance || 0).toFixed(2)}</strong>
      </div>
      {myBets.length === 0 && <p className="empty">No wallet activity yet.</p>}
      {myBets.map((transaction) => (
        <div className="data-row" key={transaction.id}>
          <span className={Number(transaction.amount) >= 0 ? 'positive' : 'negative'}>
            {Number(transaction.amount) >= 0 ? '+' : ''}
            {Number(transaction.amount).toFixed(2)}
          </span>
          <span className="topic">{transaction.type}</span>
          <time>{new Date(transaction.created_at).toLocaleDateString()}</time>
        </div>
      ))}
    </div>
  );
}
