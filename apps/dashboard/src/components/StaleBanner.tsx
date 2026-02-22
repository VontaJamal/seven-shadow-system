import type { DashboardError } from "../lib/types";

interface StaleBannerProps {
  stale: boolean;
  backoffSeconds: number;
  nextRefreshAt: string | null;
  error: DashboardError | null;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "pending";
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  return new Date(parsed).toLocaleString();
}

export function StaleBanner(props: StaleBannerProps): JSX.Element | null {
  if (!props.stale) {
    return null;
  }

  return (
    <div className="stale-banner" role="status" aria-live="polite">
      <p>
        Data is stale due to upstream/API pressure. Last refresh failed with <strong>{props.error?.code ?? "unknown"}</strong>.
      </p>
      <p>
        Next retry in ~{props.backoffSeconds}s at {formatDate(props.nextRefreshAt)}.
      </p>
      {props.error?.message ? <p className="meta-line">{props.error.message}</p> : null}
    </div>
  );
}
