import { githubProvider } from "./github";
import { gitlabProvider } from "./gitlab";
import type { ProviderAdapter } from "./types";

const PROVIDERS: Record<string, ProviderAdapter> = {
  github: githubProvider,
  gitlab: gitlabProvider
};

export const providerRegistry: Readonly<Record<string, ProviderAdapter>> = Object.freeze({ ...PROVIDERS });

export function getProviderByName(name: string): ProviderAdapter | null {
  return providerRegistry[name.trim().toLowerCase()] ?? null;
}

export function listProviders(): ProviderAdapter[] {
  return Object.keys(providerRegistry)
    .sort()
    .map((key) => providerRegistry[key]);
}

export function listProviderNames(): string[] {
  return Object.keys(providerRegistry).sort();
}
