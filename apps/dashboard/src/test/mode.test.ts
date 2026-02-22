import { describe, expect, test } from "vitest";

import { dismissOnboarding, getInitialMode, isOnboardingDismissed, persistMode } from "../lib/mode";

describe("mode persistence", () => {
  test("defaults to civilian", () => {
    window.localStorage.clear();
    expect(getInitialMode()).toBe("civilian");
  });

  test("persists sovereign mode", () => {
    window.localStorage.clear();
    persistMode("sovereign");
    expect(getInitialMode()).toBe("sovereign");
  });

  test("tracks onboarding dismissal", () => {
    window.localStorage.clear();
    expect(isOnboardingDismissed()).toBe(false);
    dismissOnboarding();
    expect(isOnboardingDismissed()).toBe(true);
  });
});
