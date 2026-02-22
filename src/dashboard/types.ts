import type {
  SentinelDigestReport,
  SentinelInboxReport,
  SentinelPatternsReport,
  SentinelProviderName,
  SentinelScoreReport
} from "../commands/types";
import type { SentinelEyeConfig } from "../commands/shared/sentinelEyeConfig";

export type SentinelDashboardMode = "civilian" | "sovereign";

export interface SentinelDashboardError {
  code: string;
  message: string;
  remediation?: string;
  details?: Record<string, unknown>;
}

export interface SentinelDashboardSection<T> {
  status: "ok" | "error";
  data: T | null;
  error: SentinelDashboardError | null;
}

export interface SentinelDashboardMeta {
  repo: string;
  provider: SentinelProviderName;
  generatedAt: string;
  stale: boolean;
  backoffSeconds: number;
  nextRefreshAt: string | null;
  refreshIntervalSeconds: number;
}

export interface SentinelDashboardSections {
  digest: SentinelDashboardSection<SentinelDigestReport>;
  inbox: SentinelDashboardSection<SentinelInboxReport>;
  score: SentinelDashboardSection<SentinelScoreReport>;
  patterns: SentinelDashboardSection<SentinelPatternsReport>;
}

export interface SentinelDashboardSnapshot {
  meta: SentinelDashboardMeta;
  sections: SentinelDashboardSections;
}

export interface SentinelDashboardStatus {
  provider: SentinelProviderName;
  repo: string;
  ready: boolean;
  stale: boolean;
  generatedAt: string | null;
  lastSuccessAt: string | null;
  lastError: SentinelDashboardError | null;
  backoffSeconds: number;
  nextRefreshAt: string | null;
  refreshIntervalSeconds: number;
}

export interface SentinelDashboardConfigState {
  configPath: string;
  source: "default" | "file";
  config: SentinelEyeConfig;
}
