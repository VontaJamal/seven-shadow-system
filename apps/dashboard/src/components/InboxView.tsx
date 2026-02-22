import type { DashboardMode, DashboardSection, InboxReport } from "../lib/types";

interface InboxViewProps {
  section: DashboardSection<InboxReport>;
  mode: DashboardMode;
}

export function InboxView(props: InboxViewProps): JSX.Element {
  if (props.section.status === "error" || !props.section.data) {
    return (
      <section className="panel">
        <h2>Inbox</h2>
        <p className="error-line">
          {props.section.error?.code ?? "E_DASHBOARD_SECTION"}: {props.section.error?.message ?? "Inbox unavailable"}
        </p>
      </section>
    );
  }

  const report = props.section.data;

  return (
    <section className="panel">
      <h2>{props.mode === "civilian" ? "Maintainer Queue" : "Maintainer Inbox"}</h2>
      <p className="meta-line">
        Notifications scanned: {report.totalNotifications} · Considered: {report.notificationsConsidered} · Skipped non-PR: {report.skippedNonPullRequest}
      </p>

      {report.items.length === 0 ? (
        <p className="meta-line">No PR notifications are currently queued.</p>
      ) : (
        <ul className="stack-list">
          {report.items.map((item) => (
            <li key={`${item.repo}#${item.prNumber}`}>
              <a href={item.htmlUrl} target="_blank" rel="noreferrer">
                #{item.prNumber} {item.title}
              </a>
              <p className="meta-line">
                Priority {item.priorityScore} · Trust {item.trustScore} · Notification {item.notification?.reason ?? "n/a"} · Unread{" "}
                {item.notification?.unread ? "yes" : "no"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
