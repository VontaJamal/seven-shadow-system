import type { Dispatch, SetStateAction } from "react";

import type { DashboardConfigState, DashboardMode, SentinelEyeConfig } from "../lib/types";

interface SettingsPanelProps {
  open: boolean;
  mode: DashboardMode;
  onClose: () => void;
  onModeChange: (mode: DashboardMode) => void;
  configState: DashboardConfigState | null;
  configDraft: SentinelEyeConfig | null;
  onConfigChange: Dispatch<SetStateAction<SentinelEyeConfig | null>>;
  configBusy: boolean;
  configError: string | null;
  configSavedAt: string | null;
  onSaveConfig: () => void;
  onResetConfig: () => void;
}

function parseNumericInput(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (parsed < min) {
    return min;
  }

  if (parsed > max) {
    return max;
  }

  return parsed;
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "not saved this session";
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  return new Date(parsed).toLocaleString();
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

      <section>
        <h3>Triage Settings</h3>
        <p className="meta-line">
          Configure deterministic Sentinel Eye behavior with clear triage settings. Changes are saved to{" "}
          <code>{props.configState?.configPath ?? ".seven-shadow/sentinel-eye.json"}</code>.
        </p>
        <p className="meta-line">Source: {props.configState?.source ?? "loading"} · Last saved: {formatTimestamp(props.configSavedAt)}</p>
      </section>

      {!props.configDraft ? (
        <section>
          <p className="meta-line">Loading configuration controls...</p>
        </section>
      ) : (
        <>
          <section className="settings-grid">
            <article className="settings-card">
              <h4>Inbox</h4>
              <label className="check-option" htmlFor="cfg-require-scope">
                <input
                  id="cfg-require-scope"
                  type="checkbox"
                  checked={props.configDraft.inbox.requireNotificationsScope}
                  onChange={(event) => {
                    props.onConfigChange((current) =>
                      current
                        ? {
                            ...current,
                            inbox: {
                              ...current.inbox,
                              requireNotificationsScope: event.target.checked
                            }
                          }
                        : current
                    );
                  }}
                />
                <span>Fail closed when notifications scope is missing</span>
              </label>
              <label className="check-option" htmlFor="cfg-include-read">
                <input
                  id="cfg-include-read"
                  type="checkbox"
                  checked={props.configDraft.inbox.includeReadByDefault}
                  onChange={(event) => {
                    props.onConfigChange((current) =>
                      current
                        ? {
                            ...current,
                            inbox: {
                              ...current.inbox,
                              includeReadByDefault: event.target.checked
                            }
                          }
                        : current
                    );
                  }}
                />
                <span>Include read notifications by default</span>
              </label>
              <label htmlFor="cfg-max-notifications">
                Max notifications (1-500)
                <input
                  id="cfg-max-notifications"
                  type="number"
                  min={1}
                  max={500}
                  value={props.configDraft.limits.maxNotifications}
                  onChange={(event) => {
                    props.onConfigChange((current) =>
                      current
                        ? {
                            ...current,
                            limits: {
                              ...current.limits,
                              maxNotifications: parseNumericInput(
                                event.target.value,
                                current.limits.maxNotifications,
                                1,
                                500
                              )
                            }
                          }
                        : current
                    );
                  }}
                />
              </label>
            </article>

            <article className="settings-card">
              <h4>Patterns</h4>
              <label htmlFor="cfg-min-cluster-size">
                Min cluster size (2-50)
                <input
                  id="cfg-min-cluster-size"
                  type="number"
                  min={2}
                  max={50}
                  value={props.configDraft.patterns.minClusterSize}
                  onChange={(event) => {
                    props.onConfigChange((current) =>
                      current
                        ? {
                            ...current,
                            patterns: {
                              ...current.patterns,
                              minClusterSize: parseNumericInput(
                                event.target.value,
                                current.patterns.minClusterSize,
                                2,
                                50
                              )
                            }
                          }
                        : current
                    );
                  }}
                />
              </label>
              <label htmlFor="cfg-path-depth">
                Path depth (1-6)
                <input
                  id="cfg-path-depth"
                  type="number"
                  min={1}
                  max={6}
                  value={props.configDraft.patterns.pathDepth}
                  onChange={(event) => {
                    props.onConfigChange((current) =>
                      current
                        ? {
                            ...current,
                            patterns: {
                              ...current.patterns,
                              pathDepth: parseNumericInput(event.target.value, current.patterns.pathDepth, 1, 6)
                            }
                          }
                        : current
                    );
                  }}
                />
              </label>
              <label htmlFor="cfg-max-title-tokens">
                Max title tokens (1-12)
                <input
                  id="cfg-max-title-tokens"
                  type="number"
                  min={1}
                  max={12}
                  value={props.configDraft.patterns.maxTitleTokens}
                  onChange={(event) => {
                    props.onConfigChange((current) =>
                      current
                        ? {
                            ...current,
                            patterns: {
                              ...current.patterns,
                              maxTitleTokens: parseNumericInput(
                                event.target.value,
                                current.patterns.maxTitleTokens,
                                1,
                                12
                              )
                            }
                          }
                        : current
                    );
                  }}
                />
              </label>
              <label htmlFor="cfg-min-title-token-length">
                Min title token length (1-20)
                <input
                  id="cfg-min-title-token-length"
                  type="number"
                  min={1}
                  max={20}
                  value={props.configDraft.patterns.minTitleTokenLength}
                  onChange={(event) => {
                    props.onConfigChange((current) =>
                      current
                        ? {
                            ...current,
                            patterns: {
                              ...current.patterns,
                              minTitleTokenLength: parseNumericInput(
                                event.target.value,
                                current.patterns.minTitleTokenLength,
                                1,
                                20
                              )
                            }
                          }
                        : current
                    );
                  }}
                />
              </label>
            </article>

            <article className="settings-card">
              <h4>Scoring</h4>
              <label htmlFor="cfg-weight-failures">
                Weight: failing runs (0-100)
                <input
                  id="cfg-weight-failures"
                  type="number"
                  min={0}
                  max={100}
                  value={props.configDraft.scoring.weights.failingRuns}
                  onChange={(event) => {
                    props.onConfigChange((current) =>
                      current
                        ? {
                            ...current,
                            scoring: {
                              ...current.scoring,
                              weights: {
                                ...current.scoring.weights,
                                failingRuns: parseNumericInput(
                                  event.target.value,
                                  current.scoring.weights.failingRuns,
                                  0,
                                  100
                                )
                              }
                            }
                          }
                        : current
                    );
                  }}
                />
              </label>
              <label htmlFor="cfg-weight-unresolved">
                Weight: unresolved comments (0-100)
                <input
                  id="cfg-weight-unresolved"
                  type="number"
                  min={0}
                  max={100}
                  value={props.configDraft.scoring.weights.unresolvedComments}
                  onChange={(event) => {
                    props.onConfigChange((current) =>
                      current
                        ? {
                            ...current,
                            scoring: {
                              ...current.scoring,
                              weights: {
                                ...current.scoring.weights,
                                unresolvedComments: parseNumericInput(
                                  event.target.value,
                                  current.scoring.weights.unresolvedComments,
                                  0,
                                  100
                                )
                              }
                            }
                          }
                        : current
                    );
                  }}
                />
              </label>
              <label htmlFor="cfg-weight-changed-files">
                Weight: changed files (0-100)
                <input
                  id="cfg-weight-changed-files"
                  type="number"
                  min={0}
                  max={100}
                  value={props.configDraft.scoring.weights.changedFiles}
                  onChange={(event) => {
                    props.onConfigChange((current) =>
                      current
                        ? {
                            ...current,
                            scoring: {
                              ...current.scoring,
                              weights: {
                                ...current.scoring.weights,
                                changedFiles: parseNumericInput(
                                  event.target.value,
                                  current.scoring.weights.changedFiles,
                                  0,
                                  100
                                )
                              }
                            }
                          }
                        : current
                    );
                  }}
                />
              </label>
              <label htmlFor="cfg-weight-lines-changed">
                Weight: lines changed (0-100)
                <input
                  id="cfg-weight-lines-changed"
                  type="number"
                  min={0}
                  max={100}
                  value={props.configDraft.scoring.weights.linesChanged}
                  onChange={(event) => {
                    props.onConfigChange((current) =>
                      current
                        ? {
                            ...current,
                            scoring: {
                              ...current.scoring,
                              weights: {
                                ...current.scoring.weights,
                                linesChanged: parseNumericInput(
                                  event.target.value,
                                  current.scoring.weights.linesChanged,
                                  0,
                                  100
                                )
                              }
                            }
                          }
                        : current
                    );
                  }}
                />
              </label>
              <label htmlFor="cfg-weight-duplicate-peers">
                Weight: duplicate peers (0-100)
                <input
                  id="cfg-weight-duplicate-peers"
                  type="number"
                  min={0}
                  max={100}
                  value={props.configDraft.scoring.weights.duplicatePeers}
                  onChange={(event) => {
                    props.onConfigChange((current) =>
                      current
                        ? {
                            ...current,
                            scoring: {
                              ...current.scoring,
                              weights: {
                                ...current.scoring.weights,
                                duplicatePeers: parseNumericInput(
                                  event.target.value,
                                  current.scoring.weights.duplicatePeers,
                                  0,
                                  100
                                )
                              }
                            }
                          }
                        : current
                    );
                  }}
                />
              </label>
            </article>

            <article className="settings-card">
              <h4>Processing Limits</h4>
              <label htmlFor="cfg-max-digest-items">
                Max digest items (1-100)
                <input
                  id="cfg-max-digest-items"
                  type="number"
                  min={1}
                  max={100}
                  value={props.configDraft.limits.maxDigestItems}
                  onChange={(event) => {
                    props.onConfigChange((current) =>
                      current
                        ? {
                            ...current,
                            limits: {
                              ...current.limits,
                              maxDigestItems: parseNumericInput(event.target.value, current.limits.maxDigestItems, 1, 100)
                            }
                          }
                        : current
                    );
                  }}
                />
              </label>
              <label htmlFor="cfg-max-pull-requests">
                Max open PRs to process (1-500)
                <input
                  id="cfg-max-pull-requests"
                  type="number"
                  min={1}
                  max={500}
                  value={props.configDraft.limits.maxPullRequests}
                  onChange={(event) => {
                    props.onConfigChange((current) =>
                      current
                        ? {
                            ...current,
                            limits: {
                              ...current.limits,
                              maxPullRequests: parseNumericInput(event.target.value, current.limits.maxPullRequests, 1, 500)
                            }
                          }
                        : current
                    );
                  }}
                />
              </label>
              <label htmlFor="cfg-max-files-pr">
                Max PR files to inspect (1-2000)
                <input
                  id="cfg-max-files-pr"
                  type="number"
                  min={1}
                  max={2000}
                  value={props.configDraft.limits.maxFilesPerPullRequest}
                  onChange={(event) => {
                    props.onConfigChange((current) =>
                      current
                        ? {
                            ...current,
                            limits: {
                              ...current.limits,
                              maxFilesPerPullRequest: parseNumericInput(
                                event.target.value,
                                current.limits.maxFilesPerPullRequest,
                                1,
                                2000
                              )
                            }
                          }
                        : current
                    );
                  }}
                />
              </label>
              <label htmlFor="cfg-max-failure-runs">
                Max failing runs per PR (1-50)
                <input
                  id="cfg-max-failure-runs"
                  type="number"
                  min={1}
                  max={50}
                  value={props.configDraft.limits.maxFailureRunsPerPullRequest}
                  onChange={(event) => {
                    props.onConfigChange((current) =>
                      current
                        ? {
                            ...current,
                            limits: {
                              ...current.limits,
                              maxFailureRunsPerPullRequest: parseNumericInput(
                                event.target.value,
                                current.limits.maxFailureRunsPerPullRequest,
                                1,
                                50
                              )
                            }
                          }
                        : current
                    );
                  }}
                />
              </label>
              <label htmlFor="cfg-max-log-bytes">
                Max log bytes per job (1024-20000000)
                <input
                  id="cfg-max-log-bytes"
                  type="number"
                  min={1024}
                  max={20000000}
                  value={props.configDraft.limits.maxLogBytesPerJob}
                  onChange={(event) => {
                    props.onConfigChange((current) =>
                      current
                        ? {
                            ...current,
                            limits: {
                              ...current.limits,
                              maxLogBytesPerJob: parseNumericInput(
                                event.target.value,
                                current.limits.maxLogBytesPerJob,
                                1024,
                                20000000
                              )
                            }
                          }
                        : current
                    );
                  }}
                />
              </label>
            </article>
          </section>

          <section className="settings-footer">
            {props.configError ? <p className="error-line">{props.configError}</p> : null}
            <div className="settings-actions">
              <button type="button" className="button button-ghost" onClick={props.onResetConfig} disabled={props.configBusy}>
                Reset Draft
              </button>
              <button type="button" className="button" onClick={props.onSaveConfig} disabled={props.configBusy}>
                {props.configBusy ? "Saving..." : "Apply Settings"}
              </button>
            </div>
          </section>
        </>
      )}
    </aside>
  );
}
