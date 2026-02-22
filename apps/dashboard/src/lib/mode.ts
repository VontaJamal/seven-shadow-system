import type { DashboardMode } from "./types";

const MODE_KEY = "sentinel-eye-dashboard-mode";
const ONBOARDING_KEY = "sentinel-eye-dashboard-onboarding-dismissed";

export function getInitialMode(): DashboardMode {
  if (typeof window === "undefined") {
    return "civilian";
  }

  const raw = window.localStorage.getItem(MODE_KEY);
  if (raw === "sovereign") {
    return "sovereign";
  }

  return "civilian";
}

export function persistMode(mode: DashboardMode): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(MODE_KEY, mode);
}

export function isOnboardingDismissed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(ONBOARDING_KEY) === "1";
}

export function dismissOnboarding(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(ONBOARDING_KEY, "1");
}
