/**
 * Scanner Page — Interactive vulnerability scanner with real-time results
 */
import React, { useState } from "react";
import { clsx } from "clsx";
import { Button } from "../components/ui/button";
import { Input, Select, Textarea } from "../components/forms";
import { SeverityChart } from "../components/charts";
import { SeverityBadge, LoadingSpinner, EmptyState, ProgressBar } from "../components/ui/utility-components";
import {
  SearchIcon, GlobeIcon, LockIcon, ShieldIcon, AlertTriangleIcon,
  CheckCircleIcon, TerminalIcon, PlayIcon,
} from "../components/icons";
import { scanApi } from "../utils/api";
import { useScanStore, useUIStore } from "../stores";

type ScanType = "port" | "header" | "password" | "ssl" | "full";

interface ScanResult {
  scan_type: string;
  target: string;
  status: string;
  findings: Array<{
    id: string;
    title: string;
    description: string;
    severity: string;
    category: string;
    evidence: string;
    recommendation: string;
    cwe_id?: string;
  }>;
  evidence: string[];
  duration_seconds: number;
  error: string | null;
  metadata: Record<string, unknown>;
}

const SCAN_TABS: Array<{ id: ScanType; label: string; icon: React.ReactNode; description: string }> = [
  { id: "port", label: "Port Scan", icon: <TerminalIcon size={18} />, description: "Discover open ports and services" },
  { id: "header", label: "Header Check", icon: <GlobeIcon size={18} />, description: "Check HTTP security headers" },
  { id: "password", label: "Password Check", icon: <LockIcon size={18} />, description: "Evaluate password strength" },
  { id: "ssl", label: "SSL Check", icon: <ShieldIcon size={18} />, description: "Analyze SSL/TLS configuration" },
  { id: "full", label: "Full Scan", icon: <SearchIcon size={18} />, description: "Run all checks against a target" },
];

export function ScannerPage(): JSX.Element {
  const [activeTab, setActiveTab] = useState<ScanType>("port");
  const [target, setTarget] = useState("");
  const [url, setUrl] = useState("");
  const [hostname, setHostname] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState("");
  const addNotification = useUIStore((s) => s.addNotification);

  const runScan = async () => {
    setIsScanning(true);
    setError("");
    setResult(null);

    try {
      let res: ScanResult;
      switch (activeTab) {
        case "port":
          if (!target) { setError("Enter a target host"); setIsScanning(false); return; }
          res = await scanApi.portScan(target);
          break;
        case "header":
          if (!url) { setError("Enter a URL to check"); setIsScanning(false); return; }
          res = await scanApi.headerCheck(url);
          break;
        case "password":
          res = await scanApi.passwordCheck(true);
          break;
        case "ssl":
          if (!hostname) { setError("Enter a hostname"); setIsScanning(false); return; }
          res = await scanApi.sslCheck(hostname);
          break;
        case "full":
          if (!target) { setError("Enter a target"); setIsScanning(false); return; }
          res = await scanApi.fullScan(target);
          break;
        default:
          return;
      }
      setResult(res);
      addNotification({
        type: "success",
        title: "Scan Complete",
        message: `${res.findings.length} findings in ${res.duration_seconds.toFixed(1)}s`,
      });
    } catch (err: any) {
      setError(err.detail || err.message || "Scan failed");
    } finally {
      setIsScanning(false);
    }
  };

  const severityCounts = result?.findings.reduce(
    (acc, f) => {
      acc[f.severity as keyof typeof acc] = (acc[f.severity as keyof typeof acc] || 0) + 1;
      return acc;
    },
    { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  ) || { critical: 0, high: 0, medium: 0, low: 0, info: 0 };

  return (
    <div className="scanner-page">
      <div className="scanner-page__header">
        <h1>Security Scanner</h1>
        <p>Run security checks against your targets. Only scan systems you own or have authorization to test.</p>
      </div>

      <div className="scanner-page__tabs" role="tablist">
        {SCAN_TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            className={clsx("scanner-tab", activeTab === tab.id && "scanner-tab--active")}
            onClick={() => { setActiveTab(tab.id); setResult(null); setError(""); }}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="scanner-page__form" role="tabpanel">
        {(activeTab === "port" || activeTab === "full") && (
          <div className="scanner-form-row">
            <Input
              label="Target Host"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="e.g., 192.168.1.1 or example.com"
              icon={<TerminalIcon size={16} />}
            />
          </div>
        )}
        {activeTab === "header" && (
          <div className="scanner-form-row">
            <Input
              label="URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="e.g., https://example.com"
              icon={<GlobeIcon size={16} />}
            />
          </div>
        )}
        {activeTab === "ssl" && (
          <div className="scanner-form-row">
            <Input
              label="Hostname"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="e.g., example.com"
              icon={<LockIcon size={16} />}
            />
          </div>
        )}
        {activeTab === "password" && (
          <div className="scanner-form-row scanner-info-box">
            <AlertTriangleIcon size={20} />
            <p>Demo mode: checks sample passwords to demonstrate the password strength checker.</p>
          </div>
        )}

        {error && (
          <p className="scanner-error" role="alert">
            <AlertTriangleIcon size={16} /> {error}
          </p>
        )}

        <Button
          variant="primary"
          size="lg"
          onClick={runScan}
          loading={isScanning}
          disabled={isScanning}
        >
          <PlayIcon size={18} /> Run {SCAN_TABS.find((t) => t.id === activeTab)?.label}
        </Button>
      </div>

      {isScanning && (
        <div className="scanner-page__scanning">
          <LoadingSpinner size="lg" label="Scanning..." />
          <p>Running {SCAN_TABS.find((t) => t.id === activeTab)?.label}...</p>
        </div>
      )}

      {result && !isScanning && (
        <div className="scanner-page__results">
          <div className="scanner-results__header">
            <h2>Results</h2>
            <div className="scanner-results__meta">
              <span>{result.findings.length} findings</span>
              <span>{result.duration_seconds.toFixed(1)}s</span>
            </div>
          </div>

          <div className="scanner-results__severity">
            <SeverityChart data={severityCounts} />
          </div>

          {result.findings.length === 0 ? (
            <EmptyState
              icon={<CheckCircleIcon size={48} />}
              title="No issues found"
              description="The scan completed without detecting any security issues."
            />
          ) : (
            <div className="scanner-results__list">
              {result.findings.map((finding) => (
                <div key={finding.id} className="finding-card">
                  <div className="finding-card__header">
                    <SeverityBadge severity={finding.severity} />
                    <h3 className="finding-card__title">{finding.title}</h3>
                  </div>
                  <p className="finding-card__description">{finding.description}</p>
                  {finding.evidence && (
                    <div className="finding-card__evidence">
                      <strong>Evidence:</strong>
                      <pre>{finding.evidence}</pre>
                    </div>
                  )}
                  {finding.recommendation && (
                    <div className="finding-card__recommendation">
                      <strong>Recommendation:</strong>
                      <p>{finding.recommendation}</p>
                    </div>
                  )}
                  {finding.cwe_id && (
                    <span className="finding-card__cwe">{finding.cwe_id}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {result.evidence.length > 0 && (
            <div className="scanner-results__raw">
              <h3>Evidence Log</h3>
              <pre className="scanner-results__log">
                {result.evidence.join("\n")}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
