/**
 * SecureScan Pro X — Root Application Component
 *
 * Renders the main application with theme support and routing.
 */

import React from "react";
import { AppLayout } from "./components/layout/app-layout";
import { Button } from "./components/ui/button";
import { Card, CardHeader, CardBody } from "./components/ui/card";
import { StatusBadge } from "./components/status/status-badge";

export function App(): JSX.Element {
  return (
    <AppLayout
      header={
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-3)" }}>
            <span style={{ fontSize: "var(--font-size-xl)", fontWeight: "var(--font-weight-bold)" }}>
              SecureScan Pro X
            </span>
            <StatusBadge status="info" label="v0.1.0" size="sm" />
          </div>
          <div style={{ display: "flex", gap: "var(--spacing-2)" }}>
            <Button variant="ghost" size="sm">Settings</Button>
            <Button variant="ghost" size="sm">Help</Button>
          </div>
        </>
      }
      sidebar={
        <nav aria-label="Main menu">
          <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "var(--spacing-1)" }}>
            <li><Button variant="ghost" style={{ width: "100%", justifyContent: "flex-start" }}>Dashboard</Button></li>
            <li><Button variant="ghost" style={{ width: "100%", justifyContent: "flex-start" }}>Workspaces</Button></li>
            <li><Button variant="ghost" style={{ width: "100%", justifyContent: "flex-start" }}>Assets</Button></li>
            <li><Button variant="ghost" style={{ width: "100%", justifyContent: "flex-start" }}>Assessments</Button></li>
            <li><Button variant="ghost" style={{ width: "100%", justifyContent: "flex-start" }}>Findings</Button></li>
            <li><Button variant="ghost" style={{ width: "100%", justifyContent: "flex-start" }}>Reports</Button></li>
            <li><Button variant="ghost" style={{ width: "100%", justifyContent: "flex-start" }}>Plugins</Button></li>
          </ul>
        </nav>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-6)" }}>
        <div>
          <h1>Dashboard</h1>
          <p style={{ color: "var(--text-secondary)", marginTop: "var(--spacing-2)" }}>
            Welcome to SecureScan Pro X — Enterprise-Grade Defensive Security Assessment Platform
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "var(--spacing-4)" }}>
          <Card variant="elevated">
            <CardHeader title="Workspaces" subtitle="Manage your assessment workspaces" />
            <CardBody>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "var(--font-size-3xl)", fontWeight: "var(--font-weight-bold)" }}>0</span>
                <Button variant="primary" size="sm">Create Workspace</Button>
              </div>
            </CardBody>
          </Card>

          <Card variant="elevated">
            <CardHeader title="Assets" subtitle="Assessable targets" />
            <CardBody>
              <span style={{ fontSize: "var(--font-size-3xl)", fontWeight: "var(--font-weight-bold)" }}>0</span>
            </CardBody>
          </Card>

          <Card variant="elevated">
            <CardHeader title="Assessments" subtitle="Security assessments" />
            <CardBody>
              <span style={{ fontSize: "var(--font-size-3xl)", fontWeight: "var(--font-weight-bold)" }}>0</span>
            </CardBody>
          </Card>

          <Card variant="elevated">
            <CardHeader title="Findings" subtitle="Security findings" />
            <CardBody>
              <div style={{ display: "flex", gap: "var(--spacing-3)" }}>
                <StatusBadge status="critical" size="sm" />
                <StatusBadge status="high" size="sm" />
                <StatusBadge status="medium" size="sm" />
                <StatusBadge status="low" size="sm" />
              </div>
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Getting Started"
            subtitle="Follow these steps to begin your first security assessment"
          />
          <CardBody>
            <ol style={{ paddingLeft: "var(--spacing-6)", display: "flex", flexDirection: "column", gap: "var(--spacing-3)" }}>
              <li>Create a workspace to organize your assessments</li>
              <li>Add assets (hosts, networks, web applications) to your workspace</li>
              <li>Create an assessment targeting your assets</li>
              <li>Review findings and generate reports</li>
            </ol>
          </CardBody>
        </Card>
      </div>
    </AppLayout>
  );
}
