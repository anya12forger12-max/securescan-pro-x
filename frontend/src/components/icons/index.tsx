/**
 * Icon Components — SVG icons for SecureScan Pro X
 * All icons use aria-hidden="true" for screen readers.
 */
import React from "react";

interface IconProps {
  size?: number;
  className?: string;
}

function icon(size: number, className: string, d: string, viewBox = "0 0 24 24"): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}

function iconPaths(
  size: number,
  className: string,
  paths: JSX.Element[],
  viewBox = "0 0 24 24",
): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {paths}
    </svg>
  );
}

export const ShieldIcon = ({ size = 20, className = "" }: IconProps) =>
  icon(size, className, "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z");

export const SearchIcon = ({ size = 20, className = "" }: IconProps) =>
  iconPaths(size, className, [
    <circle key="c" cx="11" cy="11" r="8" />,
    <path key="p" d="M21 21l-4.35-4.35" />,
  ]);

export const LockIcon = ({ size = 20, className = "" }: IconProps) =>
  iconPaths(size, className, [
    <rect key="r" x="3" y="11" width="18" height="11" rx="2" ry="2" />,
    <path key="p" d="M7 11V7a5 5 0 0 1 10 0v4" />,
  ]);

export const GlobeIcon = ({ size = 20, className = "" }: IconProps) =>
  iconPaths(size, className, [
    <circle key="c" cx="12" cy="12" r="10" />,
    <path key="p1" d="M2 12h20" />,
    <path key="p2" d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />,
  ]);

export const ServerIcon = ({ size = 20, className = "" }: IconProps) =>
  iconPaths(size, className, [
    <rect key="r1" x="2" y="2" width="20" height="8" rx="2" ry="2" />,
    <rect key="r2" x="2" y="14" width="20" height="8" rx="2" ry="2" />,
    <line key="l1" x1="6" y1="6" x2="6.01" y2="6" />,
    <line key="l2" x1="6" y1="18" x2="6.01" y2="18" />,
  ]);

export const AlertTriangleIcon = ({ size = 20, className = "" }: IconProps) =>
  iconPaths(size, className, [
    <path key="p" d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />,
    <line key="l1" x1="12" y1="9" x2="12" y2="13" />,
    <line key="l2" x1="12" y1="17" x2="12.01" y2="17" />,
  ]);

export const CheckCircleIcon = ({ size = 20, className = "" }: IconProps) =>
  iconPaths(size, className, [
    <path key="p" d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />,
    <polyline key="pl" points="22 4 12 14.01 9 11.01" />,
  ]);

export const XCircleIcon = ({ size = 20, className = "" }: IconProps) =>
  iconPaths(size, className, [
    <circle key="c" cx="12" cy="12" r="10" />,
    <line key="l1" x1="15" y1="9" x2="9" y2="15" />,
    <line key="l2" x1="9" y1="9" x2="15" y2="15" />,
  ]);

export const PlusIcon = ({ size = 20, className = "" }: IconProps) =>
  iconPaths(size, className, [
    <line key="l1" x1="12" y1="5" x2="12" y2="19" />,
    <line key="l2" x1="5" y1="12" x2="19" y2="12" />,
  ]);

export const EditIcon = ({ size = 20, className = "" }: IconProps) =>
  icon(size, className, "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z");

export const TrashIcon = ({ size = 20, className = "" }: IconProps) =>
  iconPaths(size, className, [
    <polyline key="p" points="3 6 5 6 21 6" />,
    <path key="p1" d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />,
  ]);

export const DownloadIcon = ({ size = 20, className = "" }: IconProps) =>
  iconPaths(size, className, [
    <path key="p" d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />,
    <polyline key="pl" points="7 10 12 15 17 10" />,
    <line key="l" x1="12" y1="15" x2="12" y2="3" />,
  ]);

export const RefreshIcon = ({ size = 20, className = "" }: IconProps) =>
  iconPaths(size, className, [
    <polyline key="p1" points="23 4 23 10 17 10" />,
    <path key="p2" d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />,
  ]);

export const EyeIcon = ({ size = 20, className = "" }: IconProps) =>
  iconPaths(size, className, [
    <path key="p1" d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />,
    <circle key="c" cx="12" cy="12" r="3" />,
  ]);

export const EyeOffIcon = ({ size = 20, className = "" }: IconProps) =>
  iconPaths(size, className, [
    <path key="p1" d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />,
    <line key="l1" x1="1" y1="1" x2="23" y2="23" />,
  ]);

export const SettingsIcon = ({ size = 20, className = "" }: IconProps) =>
  iconPaths(size, className, [
    <circle key="c" cx="12" cy="12" r="3" />,
    <path key="p" d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />,
  ]);

export const HomeIcon = ({ size = 20, className = "" }: IconProps) =>
  icon(size, className, "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z");

export const BarChartIcon = ({ size = 20, className = "" }: IconProps) =>
  iconPaths(size, className, [
    <line key="l1" x1="12" y1="20" x2="12" y2="10" />,
    <line key="l2" x1="18" y1="20" x2="18" y2="4" />,
    <line key="l3" x1="6" y1="20" x2="6" y2="16" />,
  ]);

export const FileTextIcon = ({ size = 20, className = "" }: IconProps) =>
  iconPaths(size, className, [
    <path key="p1" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />,
    <polyline key="pl" points="14 2 14 8 20 8" />,
    <line key="l1" x1="16" y1="13" x2="8" y2="13" />,
    <line key="l2" x1="16" y1="17" x2="8" y2="17" />,
  ]);

export const ChevronRightIcon = ({ size = 20, className = "" }: IconProps) =>
  icon(size, className, "M9 18l6-6-6-6");

export const ChevronLeftIcon = ({ size = 20, className = "" }: IconProps) =>
  icon(size, className, "M15 18l-6-6 6-6");

export const ChevronDownIcon = ({ size = 20, className = "" }: IconProps) =>
  icon(size, className, "M6 9l6 6 6-6");

export const PlayIcon = ({ size = 20, className = "" }: IconProps) =>
  icon(size, className, "M5 3l14 9-14 9V3z");

export const PauseIcon = ({ size = 20, className = "" }: IconProps) =>
  iconPaths(size, className, [
    <rect key="r1" x="6" y="4" width="4" height="16" />,
    <rect key="r2" x="14" y="4" width="4" height="16" />,
  ]);

export const StopIcon = ({ size = 20, className = "" }: IconProps) =>
  icon(size, className, "M6 6h12v12H6z");

export const ZapIcon = ({ size = 20, className = "" }: IconProps) =>
  icon(size, className, "M13 2L3 14h9l-1 8 10-12h-9l1-8z");

export const DatabaseIcon = ({ size = 20, className = "" }: IconProps) =>
  iconPaths(size, className, [
    <ellipse key="e1" cx="12" cy="5" rx="9" ry="3" />,
    <path key="p1" d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />,
    <path key="p2" d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />,
  ]);

export const UserIcon = ({ size = 20, className = "" }: IconProps) =>
  iconPaths(size, className, [
    <path key="p" d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />,
    <circle key="c" cx="12" cy="7" r="4" />,
  ]);

export const ClockIcon = ({ size = 20, className = "" }: IconProps) =>
  iconPaths(size, className, [
    <circle key="c" cx="12" cy="12" r="10" />,
    <polyline key="pl" points="12 6 12 12 16 14" />,
  ]);

export const TerminalIcon = ({ size = 20, className = "" }: IconProps) =>
  icon(size, className, "M4 17l6-5-6-5M12 19h8");

export const LayersIcon = ({ size = 20, className = "" }: IconProps) =>
  iconPaths(size, className, [
    <polygon key="p1" points="12 2 2 7 12 12 22 7 12 2" />,
    <polyline key="pl" points="2 17 12 22 22 17" />,
    <polyline key="pl2" points="2 12 12 17 22 12" />,
  ]);
