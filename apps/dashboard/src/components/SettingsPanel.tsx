import type { DashboardMode } from "../lib/types";

interface SettingsPanelProps {
  open: boolean;
  mode: DashboardMode;
  onClose: () => void;
  onModeChange: (mode: DashboardMode) => void;
}

export function SettingsPanel(props: SettingsPanelProps): JSX.Element | null {
  if (!props.open) {
    return null;
  }

  return (
    <aside className="settings-panel" aria-label="Dashboard settings">
      <div className="settings-header">
        <h2>Settings</h2>
        <button type="button" className="button button-ghost" onClick={props.onClose}>
          Close
        </button>
      </div>

      <section>
        <h3>Display Profile</h3>
        <p className="meta-line">
          Civilian starts simple and plain-language. Sovereign keeps the same data but increases operational density.
        </p>
        <label className="mode-option" htmlFor="mode-civilian">
          <input
            id="mode-civilian"
            type="radio"
            name="dashboard-mode"
            value="civilian"
            checked={props.mode === "civilian"}
            onChange={() => props.onModeChange("civilian")}
          />
          <span>
            <strong>Civilian</strong>
            <small>Plain-language triage framing.</small>
          </span>
        </label>
        <label className="mode-option" htmlFor="mode-sovereign">
          <input
            id="mode-sovereign"
            type="radio"
            name="dashboard-mode"
            value="sovereign"
            checked={props.mode === "sovereign"}
            onChange={() => props.onModeChange("sovereign")}
          />
          <span>
            <strong>Sovereign</strong>
            <small>High-density operational framing.</small>
          </span>
        </label>
      </section>
    </aside>
  );
}
