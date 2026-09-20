/**
 * Severity Chart — SVG-based donut chart for finding severities
 */
import React from "react";

interface SeverityData {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#3b82f6",
  info: "#6b7280",
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

export function SeverityChart({ data }: { data: SeverityData }): JSX.Element {
  const total = Object.values(data).reduce((a, b) => a + b, 0);
  if (total === 0) {
    return (
      <div className="severity-chart severity-chart--empty">
        <p className="severity-chart__empty">No findings</p>
      </div>
    );
  }

  const size = 160;
  const strokeWidth = 24;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let cumulativePercent = 0;
  const segments = Object.entries(data)
    .filter(([, v]) => v > 0)
    .map(([severity, count]) => {
      const percent = count / total;
      const offset = cumulativePercent;
      cumulativePercent += percent;
      return { severity, count, percent, offset };
    });

  return (
    <div className="severity-chart">
      <div className="severity-chart__visual">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Findings: ${total} total`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--border-primary)"
            strokeWidth={strokeWidth}
          />
          {segments.map((seg) => (
            <circle
              key={seg.severity}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={SEVERITY_COLORS[seg.severity]}
              strokeWidth={strokeWidth}
              strokeDasharray={`${seg.percent * circumference} ${circumference}`}
              strokeDashoffset={`${-seg.offset * circumference}`}
              style={{ transition: "stroke-dasharray 0.5s ease" }}
            />
          ))}
          <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="severity-chart__total">
            {total}
          </text>
        </svg>
      </div>
      <div className="severity-chart__legend">
        {Object.entries(data).map(([severity, count]) => (
          <div key={severity} className="severity-chart__legend-item">
            <span
              className="severity-chart__dot"
              style={{ backgroundColor: SEVERITY_COLORS[severity] }}
            />
            <span className="severity-chart__legend-label">
              {SEVERITY_LABELS[severity] || severity}
            </span>
            <span className="severity-chart__legend-count">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Bar Chart — Simple CSS bar chart
 */
export function BarChart({
  data,
  title,
}: {
  data: Array<{ label: string; value: number; color?: string }>;
  title?: string;
}): JSX.Element {
  const maxValue = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="bar-chart">
      {title && <h4 className="bar-chart__title">{title}</h4>}
      <div className="bar-chart__bars">
        {data.map((item, i) => (
          <div key={i} className="bar-chart__bar-wrapper">
            <span className="bar-chart__label">{item.label}</span>
            <div className="bar-chart__track">
              <div
                className="bar-chart__fill"
                style={{
                  width: `${(item.value / maxValue) * 100}%`,
                  backgroundColor: item.color || "var(--accent-primary)",
                }}
              />
            </div>
            <span className="bar-chart__value">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
