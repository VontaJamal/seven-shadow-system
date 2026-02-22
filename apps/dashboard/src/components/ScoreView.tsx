import type { DashboardMode, DashboardSection, ScoreReport } from "../lib/types";

interface ScoreViewProps {
  section: DashboardSection<ScoreReport>;
  mode: DashboardMode;
}

export function ScoreView(props: ScoreViewProps): JSX.Element {
  if (props.section.status === "error" || !props.section.data) {
    return (
      <section className="panel">
        <h2>Score</h2>
        <p className="error-line">
          {props.section.error?.code ?? "E_DASHBOARD_SECTION"}: {props.section.error?.message ?? "Score unavailable"}
        </p>
      </section>
    );
  }

  const report = props.section.data;

  return (
    <section className="panel">
      <h2>{props.mode === "civilian" ? "Trust and Risk" : "Priority Scoring Matrix"}</h2>
      <p className="meta-line">PRs analyzed: {report.totalPullRequests}</p>

      {report.items.length === 0 ? (
        <p className="meta-line">No open pull requests were scored.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>PR</th>
                <th>Priority</th>
                <th>Trust</th>
                <th>Unresolved</th>
                <th>Failures</th>
                <th>Files</th>
              </tr>
            </thead>
            <tbody>
              {report.items.map((item) => (
                <tr key={`${item.repo}#${item.prNumber}`}>
                  <td>
                    <a href={item.htmlUrl} target="_blank" rel="noreferrer">
                      #{item.prNumber} {item.title}
                    </a>
                  </td>
                  <td>{item.priorityScore}</td>
                  <td>{item.trustScore}</td>
                  <td>{item.unresolvedComments}</td>
                  <td>{item.failingRuns}</td>
                  <td>{item.changedFiles}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
