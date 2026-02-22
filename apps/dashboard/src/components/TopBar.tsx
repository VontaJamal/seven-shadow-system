import type { DashboardMode, DashboardStatus } from "../lib/types";

interface TopBarProps {
  mode: DashboardMode;
  status: DashboardStatus | null;
  generatedAt: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenSettings: () => void;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "n/a";
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  return new Date(parsed).toLocaleString();
}

export function TopBar(props: TopBarProps): JSX.Element {
  const statusLabel = props.status?.stale ? "STALE" : "LIVE";

  return (
    <header className="top-bar" role="banner">
      <div>
        <p className="eyebrow">Sentinel Eye</p>
        <h1>Maintainer Dashboard</h1>
        <p className="meta-line">
          Repo: <strong>{props.status?.repo ?? "resolving..."}</strong> · Provider: <strong>{props.status?.provider ?? "github"}</strong>
        </p>
      </div>
      <div className="top-bar-actions">
        <p className={`status-pill status-pill-${statusLabel.toLowerCase()}`}>{statusLabel}</p>
        <p className="meta-line">Updated: {formatDate(props.generatedAt)}</p>
        <p className="meta-line">Profile: {props.mode === "civilian" ? "Civilian" : "Sovereign"}</p>
        <button type="button" className="button button-ghost" onClick={props.onRefresh} disabled={props.refreshing}>
          {props.refreshing ? "Refreshing..." : "Refresh"}
        </button>
        <button type="button" className="button" onClick={props.onOpenSettings} aria-label="Open dashboard settings">
          Settings
        </button>
      </div>
    </header>
  );
}
