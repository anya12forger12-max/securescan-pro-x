import React from "react";
import './bets.scss';
import AllData from './all-data';
import MyBets from './my-bets';
import TopHistory from './top-history';
import { useGamingContext } from '../../context';

type Tab = 'all' | 'my' | 'top';

export default function BetsUsers() {
  const [tab, setTab] = React.useState<Tab>('all');
  const { loadDashboard, loadLeaderboard, claimPromotion, promotions } = useGamingContext();

  const select = (next: Tab) => {
    setTab(next);
    if (next === 'my') void loadDashboard();
    if (next === 'top') void loadLeaderboard('codenames');
  };

  return (
    <aside className="info-board" aria-label="Platform activity">
      <div className="info-tabs" role="tablist">
        {(['all', 'my', 'top'] as Tab[]).map((name) => (
          <button
            key={name}
            role="tab"
            aria-selected={tab === name}
            className={tab === name ? 'active' : ''}
            type="button"
            onClick={() => select(name)}
          >
            {name === 'all' ? 'Live' : name === 'my' ? 'My activity' : 'Top'}
          </button>
        ))}
      </div>

      <div className="info-body" role="tabpanel">
        {tab === 'all' && <AllData />}
        {tab === 'my' && <MyBets />}
        {tab === 'top' && <TopHistory />}
      </div>

      <div className="promo-strip">
        {promotions.length === 0 ? (
          <span>No promotions available</span>
        ) : (
          promotions.slice(0, 3).map((promotion) => (
            <button
              key={promotion.id}
              type="button"
              disabled={promotion.claimed}
              onClick={() => void claimPromotion(promotion.code)}
              title={promotion.description}
            >
              {promotion.claimed ? '✓ ' : ''}
              {promotion.title}
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
