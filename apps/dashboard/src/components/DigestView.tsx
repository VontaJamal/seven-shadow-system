import type { DashboardMode, DashboardSection, DigestReport } from "../lib/types";

interface DigestViewProps {
  section: DashboardSection<DigestReport>;
  mode: DashboardMode;
}

export function DigestView(props: DigestViewProps): JSX.Element {
  if (props.section.status === "error" || !props.section.data) {
    return (
      <section className="panel">
        <h2>Digest</h2>
        <p className="error-line">
          {props.section.error?.code ?? "E_DASHBOARD_SECTION"}: {props.section.error?.message ?? "Digest unavailable"}
        </p>
      </section>
    );
  }

  const report = props.section.data;

  return (
    <section className="panel">
      <h2>{props.mode === "civilian" ? "What Needs Attention" : "Priority Digest"}</h2>
      <p className="meta-line">
        Notifications scanned: {report.totalNotifications} · PR notifications: {report.notificationsConsidered} · Skipped non-PR: {report.skippedNonPullRequest}
      </p>

      <h3>Top Priorities</h3>
      {report.topPriorities.length === 0 ? (
        <p className="meta-line">No priority pull requests identified.</p>
      ) : (
        <ul className="stack-list">
          {report.topPriorities.map((item) => (
            <li key={`${item.repo}#${item.prNumber}`}>
              <a href={item.htmlUrl} target="_blank" rel="noreferrer">
                #{item.prNumber} {item.title}
              </a>
              <p className="meta-line">
                Priority {item.priorityScore} · Trust {item.trustScore} · Failures {item.failingRuns} · Unresolved {item.unresolvedComments}
              </p>
            </li>
          ))}
        </ul>
      )}

      <h3>Pattern Highlights</h3>
      {report.topPatterns.length === 0 ? (
        <p className="meta-line">No clusters met threshold.</p>
      ) : (
        <ul className="stack-list">
          {report.topPatterns.map((cluster) => (
            <li key={`${cluster.type}:${cluster.key}`}>
              <strong>[{cluster.type}]</strong> {cluster.key} ({cluster.size})
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
