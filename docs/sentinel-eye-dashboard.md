# Sentinel Eye Dashboard

Sentinel Eye Dashboard is the local GUI for maintainer triage workflows.

It runs from the same deterministic report pipeline as `7s patterns`, `7s inbox`, `7s score`, and `7s digest`.

## Start

```bash
npm run sentinel:dashboard -- --repo owner/repo
```

Direct command:

```bash
7s dashboard --repo owner/repo
```

Dashboard verification shortcut:

```bash
npm run dashboard:verify
```

## Modes

The dashboard supports two presentation profiles:

- `civilian` (default on first launch)
- `sovereign`

Mode behavior:

- mode affects presentation only
- scoring and sorting remain identical across modes
- mode control lives in Settings
- last selected mode persists in browser local storage

## Shadow Controls (Settings)

Open **Settings** (top-right) to configure shadow behavior directly in the GUI.

Control groups:

- **Inbox Shadow**: notifications scope enforcement + read/default behavior + notification bounds
- **Patterns Shadow**: cluster threshold and title/path fingerprinting controls
- **Score Shadow**: deterministic weight tuning for risk/trust ranking signals
- **Digest + Execution Shadows**: digest cap and bounded processing limits

Save behavior:

- `Apply Shadow Controls` validates and writes canonical JSON to Sentinel config
- dashboard triggers refresh immediately after save
- save/write failures are explicit and deterministic (no silent fallback)

## Civilian-First Behavior

- startup defaults to civilian
- first-run callout explains mode choice
- plain-language triage labels are emphasized

## Refresh and Degraded Behavior

- default base refresh interval: `120s`
- auto-refresh is always enabled
- manual refresh button triggers immediate re-pull
- retry backoff is adaptive and capped
- stale banner appears when the server keeps last known good data during degraded refresh cycles

## Security and Auth

Dashboard tokens are never sent to the browser and are not written to repo files.

GitHub auth resolution order:

1. `GITHUB_TOKEN` env var
2. `gh auth token`
3. interactive `gh auth login --web`

## Server Endpoints

- `GET /healthz`
- `GET /api/v1/dashboard/status`
- `GET /api/v1/dashboard/snapshot`
- `POST /api/v1/dashboard/refresh`
- `GET /api/v1/dashboard/config`
- `PUT /api/v1/dashboard/config`

## CI/Headless Behavior

In CI or non-interactive environments, browser auto-open is disabled by default and the command prints the local URL.
