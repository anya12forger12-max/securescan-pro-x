/**
 * AppLayout Component
 *
 * Main application layout with header, sidebar, and content area.
 * Handles keyboard navigation and responsive behavior.
 */

import React from "react";

export interface AppLayoutProps {
  header: React.ReactNode;
  sidebar: React.ReactNode;
  children: React.ReactNode;
}

export function AppLayout({
  header,
  sidebar,
  children,
}: AppLayoutProps): JSX.Element {
  return (
    <div className="app-layout">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <header className="app-header" role="banner">
        {header}
      </header>

      <nav className="app-sidebar" role="navigation" aria-label="Main navigation">
        {sidebar}
      </nav>

      <main id="main-content" className="app-main" role="main">
        {children}
      </main>
    </div>
  );
}
