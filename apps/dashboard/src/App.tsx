import { useEffect, useMemo, useState } from "react";

import { DigestView } from "./components/DigestView";
import { InboxView } from "./components/InboxView";
import { PatternsView } from "./components/PatternsView";
import { ScoreView } from "./components/ScoreView";
import { SettingsPanel } from "./components/SettingsPanel";
import { StaleBanner } from "./components/StaleBanner";
import { TopBar } from "./components/TopBar";
import {
  getDashboardConfig,
  getDashboardSnapshot,
  getDashboardStatus,
  requestDashboardRefresh,
  updateDashboardConfig
} from "./lib/api";
import { dismissOnboarding, getInitialMode, isOnboardingDismissed, persistMode } from "./lib/mode";
import type { DashboardConfigState, DashboardMode, DashboardSnapshot, DashboardStatus, SentinelEyeConfig } from "./lib/types";

type DashboardTab = "digest" | "inbox" | "score" | "patterns";

export function App(): JSX.Element {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [status, setStatus] = useState<DashboardStatus | null>(null);
  const [activeTab, setActiveTab] = useState<DashboardTab>("digest");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mode, setMode] = useState<DashboardMode>(getInitialMode());
  const [errorText, setErrorText] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [onboardingVisible, setOnboardingVisible] = useState(!isOnboardingDismissed());
  const [configState, setConfigState] = useState<DashboardConfigState | null>(null);
  const [configDraft, setConfigDraft] = useState<SentinelEyeConfig | null>(null);
  const [configBusy, setConfigBusy] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configSavedAt, setConfigSavedAt] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-mode", mode);
    persistMode(mode);
  }, [mode]);

  useEffect(() => {
    let cancelled = false;

    async function load(includeConfig: boolean): Promise<void> {
      try {
        const [statusPayload, snapshotPayload] = await Promise.all([getDashboardStatus(), getDashboardSnapshot()]);
        if (cancelled) {
          return;
        }

        setStatus(statusPayload);
        setSnapshot(snapshotPayload);
        setErrorText(null);

        if (includeConfig) {
          try {
            const configPayload = await getDashboardConfig();
            if (cancelled) {
              return;
            }

            setConfigState(configPayload);
            setConfigDraft(configPayload.config);
            setConfigError(null);
          } catch (error) {
            if (cancelled) {
              return;
            }

            const message = error instanceof Error ? error.message : String(error);
            setConfigError(message.slice(0, 260));
          }
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        setErrorText(message.slice(0, 260));
      }
    }

    void load(true);
    const pollId = window.setInterval(() => {
      void load(false);
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
    };
  }, []);

  useEffect(() => {
    if (!settingsOpen || configState) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const configPayload = await getDashboardConfig();
        if (cancelled) {
          return;
        }

        setConfigState(configPayload);
        setConfigDraft(configPayload.config);
        setConfigError(null);
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        setConfigError(message.slice(0, 260));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [configState, settingsOpen]);

  const generatedAt = snapshot?.meta.generatedAt ?? status?.generatedAt ?? null;

  async function handleRefresh(): Promise<void> {
    setRefreshing(true);

    try {
      const payload = await requestDashboardRefresh();
      setStatus(payload.status);
      setSnapshot(payload.snapshot);
      setErrorText(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorText(message.slice(0, 260));
    } finally {
      setRefreshing(false);
    }
  }

  async function handleConfigSave(): Promise<void> {
    if (!configDraft) {
      return;
    }

    setConfigBusy(true);

    try {
      const saved = await updateDashboardConfig(configDraft);
      setConfigState(saved);
      setConfigDraft(saved.config);
      setConfigError(null);
      setConfigSavedAt(new Date().toISOString());

      const refreshed = await requestDashboardRefresh();
      setStatus(refreshed.status);
      setSnapshot(refreshed.snapshot);
      setErrorText(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setConfigError(message.slice(0, 260));
    } finally {
      setConfigBusy(false);
    }
  }

  function handleConfigReset(): void {
    setConfigDraft(configState?.config ?? null);
    setConfigError(null);
  }

  const hasSnapshot = snapshot !== null;

  const tabContent = useMemo(() => {
    if (!snapshot) {
      return (
        <section className="panel">
          <h2>Loading</h2>
          <p className="meta-line">Fetching dashboard snapshot...</p>
        </section>
      );
    }

    if (activeTab === "digest") {
      return <DigestView section={snapshot.sections.digest} mode={mode} />;
    }

    if (activeTab === "inbox") {
      return <InboxView section={snapshot.sections.inbox} mode={mode} />;
    }

    if (activeTab === "score") {
      return <ScoreView section={snapshot.sections.score} mode={mode} />;
    }

    return <PatternsView section={snapshot.sections.patterns} mode={mode} />;
  }, [activeTab, snapshot, mode]);

  return (
    <div className="app-shell">
      <TopBar
        mode={mode}
        status={status}
        generatedAt={generatedAt}
        refreshing={refreshing}
        onRefresh={() => {
          void handleRefresh();
        }}
        onOpenSettings={() => {
          setSettingsOpen(true);
        }}
      />

      <SettingsPanel
        open={settingsOpen}
        mode={mode}
        onModeChange={(nextMode) => {
          setMode(nextMode);
        }}
        onClose={() => {
          setSettingsOpen(false);
        }}
        configState={configState}
        configDraft={configDraft}
        onConfigChange={setConfigDraft}
        configBusy={configBusy}
        configError={configError}
        configSavedAt={configSavedAt}
        onSaveConfig={() => {
          void handleConfigSave();
        }}
        onResetConfig={handleConfigReset}
      />

      {onboardingVisible ? (
        <section className="onboarding-callout" role="note">
          <p>
            You are in <strong>Civilian</strong> mode. Use Settings to choose your preferred detail level. Data and scoring stay deterministic in both profiles.
          </p>
          <button
            type="button"
            className="button button-ghost"
            onClick={() => {
              dismissOnboarding();
              setOnboardingVisible(false);
            }}
          >
            Dismiss
          </button>
        </section>
      ) : null}

      <StaleBanner
        stale={Boolean(status?.stale ?? snapshot?.meta.stale)}
        backoffSeconds={status?.backoffSeconds ?? snapshot?.meta.backoffSeconds ?? 0}
        nextRefreshAt={status?.nextRefreshAt ?? snapshot?.meta.nextRefreshAt ?? null}
        error={status?.lastError ?? null}
      />

      {errorText ? <p className="error-line">{errorText}</p> : null}

      <nav className="tabs" aria-label="Dashboard sections">
        <button type="button" className={activeTab === "digest" ? "tab active" : "tab"} onClick={() => setActiveTab("digest")}>
          Digest
        </button>
        <button type="button" className={activeTab === "inbox" ? "tab active" : "tab"} onClick={() => setActiveTab("inbox")}>
          Inbox
        </button>
        <button type="button" className={activeTab === "score" ? "tab active" : "tab"} onClick={() => setActiveTab("score")}>
          Score
        </button>
        <button
          type="button"
          className={activeTab === "patterns" ? "tab active" : "tab"}
          onClick={() => setActiveTab("patterns")}
        >
          Patterns
        </button>
      </nav>

      <main>{tabContent}</main>

      {!hasSnapshot ? <p className="meta-line">Waiting for initial snapshot...</p> : null}
    </div>
  );
}
