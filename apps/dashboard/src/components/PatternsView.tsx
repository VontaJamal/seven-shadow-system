import type { DashboardMode, DashboardSection, PatternsReport } from "../lib/types";

interface PatternsViewProps {
  section: DashboardSection<PatternsReport>;
  mode: DashboardMode;
}

export function PatternsView(props: PatternsViewProps): JSX.Element {
  if (props.section.status === "error" || !props.section.data) {
    return (
      <section className="panel">
        <h2>Patterns</h2>
        <p className="error-line">
          {props.section.error?.code ?? "E_DASHBOARD_SECTION"}: {props.section.error?.message ?? "Patterns unavailable"}
        </p>
      </section>
    );
  }

  const report = props.section.data;

  return (
    <section className="panel">
      <h2>{props.mode === "civilian" ? "Repeated Work Patterns" : "Pattern Clusters"}</h2>
      <p className="meta-line">PRs analyzed: {report.totalPullRequests}</p>

      {report.clusters.length === 0 ? (
        <p className="meta-line">No clusters met threshold.</p>
      ) : (
        <ul className="stack-list">
          {report.clusters.map((cluster) => (
            <li key={`${cluster.type}:${cluster.key}`}>
              <p>
                <strong>[{cluster.type}]</strong> {cluster.key} ({cluster.size})
              </p>
              <ul className="sub-list">
                {cluster.pullRequests.map((pr) => (
                  <li key={`${pr.repo}#${pr.prNumber}`}>
                    <a href={pr.htmlUrl} target="_blank" rel="noreferrer">
                      #{pr.prNumber} {pr.title}
                    </a>{" "}
                    · priority {pr.priorityScore}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
