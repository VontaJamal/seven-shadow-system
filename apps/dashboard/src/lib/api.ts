import type { DashboardConfigState, DashboardSnapshot, DashboardStatus, SentinelEyeConfig } from "./types";

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const payload = (await response.json()) as T;

  if (!response.ok) {
    const serialized = JSON.stringify(payload);
    throw new Error(`HTTP ${response.status}: ${serialized.slice(0, 320)}`);
  }

  return payload;
}

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  return fetchJson<DashboardSnapshot>("/api/v1/dashboard/snapshot");
}

export async function getDashboardStatus(): Promise<DashboardStatus> {
  return fetchJson<DashboardStatus>("/api/v1/dashboard/status");
}

export async function requestDashboardRefresh(): Promise<{
  status: DashboardStatus;
  snapshot: DashboardSnapshot;
}> {
  return fetchJson("/api/v1/dashboard/refresh", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    }
  });
}

export async function getDashboardConfig(): Promise<DashboardConfigState> {
  return fetchJson<DashboardConfigState>("/api/v1/dashboard/config");
}

export async function updateDashboardConfig(config: SentinelEyeConfig): Promise<DashboardConfigState> {
  return fetchJson<DashboardConfigState>("/api/v1/dashboard/config", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ config })
  });
}
