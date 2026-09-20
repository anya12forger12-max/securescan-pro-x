/**
 * Dashboard Page — Main overview with stats, charts, recent activity
 */
import React, { useEffect } from "react";
import { useAuthStore, useScanStore } from "../stores";
import { authApi, assessmentApi, workspaceApi } from "../utils/api";
import { SeverityChart, BarChart } from "../components/charts";
import { StatCard, SeverityBadge, LoadingSpinner, EmptyState } from "../components/ui/utility-components";
import { ShieldIcon, SearchIcon, GlobeIcon, ServerIcon, AlertTriangleIcon, ClockIcon } from "../components/icons";

export function DashboardPage(): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const [stats, setStats] = React.useState({
    workspaces: 0,
    assessments: 0,
    findings: 0,
    assets: 0,
  });
  const [severityData, setSeverityData] = React.useState({ critical: 0, high: 0, medium: 0, low: 0, info: 0 });
  const [recentAssessments, setRecentAssessments] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const [workspaces, assessments] = await Promise.allSettled([
        workspaceApi.list(),
        assessmentApi.list(),
      ]);

      const ws = workspaces.status === "fulfilled" ? workspaces.value : [];
      const as = assessments.status === "fulfilled" ? assessments.value : [];

      setStats({
        workspaces: ws.length,
        assessments: as.length,
        findings: as.reduce((sum: number, a: any) => sum + (a.finding_count || 0), 0),
        assets: 0,
      });

      const sev = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
      as.forEach((a: any) => {
        if (a.severity_breakdown) {
          Object.entries(a.severity_breakdown).forEach(([k, v]) => {
            if (k in sev) sev[k as keyof typeof sev] += v as number;
          });
        }
      });
      setSeverityData(sev);
      setRecentAssessments(as.slice(0, 5));
    } catch {
      // Dashboard loads gracefully even if API is down
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <LoadingSpinner size="lg" label="Loading dashboard..." />;
  }

  return (
    <div className="dashboard">
      <div className="dashboard__welcome">
        <h1>Welcome back, {user?.display_name || user?.username || "User"}</h1>
        <p>Here's an overview of your security assessments.</p>
      </div>

      <div className="dashboard__stats">
        <StatCard label="Workspaces" value={stats.workspaces} icon={<ServerIcon size={24} />} color="var(--accent-primary)" />
        <StatCard label="Assessments" value={stats.assessments} icon={<SearchIcon size={24} />} color="var(--accent-secondary)" />
        <StatCard label="Findings" value={stats.findings} icon={<AlertTriangleIcon size={24} />} color="var(--severity-high)" />
        <StatCard label="Assets" value={stats.assets} icon={<GlobeIcon size={24} />} color="var(--accent-tertiary)" />
      </div>

      <div className="dashboard__grid">
        <div className="dashboard__card">
          <h2>Findings by Severity</h2>
          <SeverityChart data={severityData} />
        </div>

        <div className="dashboard__card">
          <h2>Recent Assessments</h2>
          {recentAssessments.length === 0 ? (
            <EmptyState
              icon={<ShieldIcon size={48} />}
              title="No assessments yet"
              description="Create your first assessment to get started."
            />
          ) : (
            <div className="dashboard__list">
              {recentAssessments.map((a) => (
                <div key={a.id} className="dashboard__list-item">
                  <div className="dashboard__list-item-main">
                    <span className="dashboard__list-item-title">{a.name}</span>
                    <span className="dashboard__list-item-meta">
                      <ClockIcon size={14} />
                      {new Date(a.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <span className={`status-dot status-dot--${a.status}`} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
