import React from "react";
import './bets.scss';
import AllData from './all-data';
import MyBets from './my-bets';
import TopHistory from './top-history';
import { useGamingContext } from '../../context';

type Tab = 'all' | 'my' | 'top';

export default function BetsUsers() {
  const [tab, setTab] = React.useState<Tab>('all');
  // Keep the selected leaderboard game above the tab panels; TopHistory
  // unmounts on tab switches and a defaultValue desyncs the select from data.
  const [leaderboardGame, setLeaderboardGame] = React.useState('codenames');
  const tabsRef = React.useRef<HTMLDivElement>(null);
  const { loadDashboard, loadLeaderboard, claimPromotion, promotions } = useGamingContext();

  const select = (next: Tab) => {
    setTab(next);
    if (next === 'my') void loadDashboard();
    if (next === 'top') void loadLeaderboard(leaderboardGame);
  };

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const tabs = ['all', 'my', 'top'] as Tab[];
    const current = tabs.indexOf(tab);
    const next = tabs[(current + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    select(next);
    tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[tabs.indexOf(next)]?.focus();
  };

  return (
    <aside className="info-board" aria-label="Platform activity">
      <div className="info-tabs" role="tablist" ref={tabsRef} onKeyDown={onTabKeyDown}>
        {(['all', 'my', 'top'] as Tab[]).map((name) => (
          <button
            key={name}
            id={`activity-tab-${name}`}
            role="tab"
            aria-selected={tab === name}
            aria-controls="activity-panel"
            tabIndex={tab === name ? 0 : -1}
            className={tab === name ? 'active' : ''}
            type="button"
            onClick={() => select(name)}
          >
            {name === 'all' ? 'Live' : name === 'my' ? 'My activity' : 'Top'}
          </button>
        ))}
      </div>

      <div className="info-body" role="tabpanel" id="activity-panel" aria-labelledby={`activity-tab-${tab}`} tabIndex={0}>
        {tab === 'all' && <AllData />}
        {tab === 'my' && <MyBets />}
        {tab === 'top' && (
          <TopHistory
            game={leaderboardGame}
            onGameChange={(game) => {
              setLeaderboardGame(game);
              void loadLeaderboard(game);
            }}
          />
        )}
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
