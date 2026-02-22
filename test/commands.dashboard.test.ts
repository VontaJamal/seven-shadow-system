import assert from "node:assert/strict";
import test from "node:test";

import { parseDashboardArgs } from "../src/commands/dashboard";

test("parseDashboardArgs applies deterministic defaults", () => {
  const parsed = parseDashboardArgs([]);

  assert.equal(parsed.providerName, "github");
  assert.equal(parsed.limit, 20);
  assert.equal(parsed.host, "127.0.0.1");
  assert.equal(parsed.port, 7777);
  assert.equal(parsed.refreshSec, 120);
  assert.equal(parsed.openMode, "auto");
});

test("parseDashboardArgs reads explicit flags", () => {
  const parsed = parseDashboardArgs([
    "--repo",
    "acme/repo",
    "--provider",
    "bitbucket",
    "--limit",
    "15",
    "--config",
    "config/sentinel-eye.sample.json",
    "--host",
    "0.0.0.0",
    "--port",
    "8811",
    "--refresh-sec",
    "240",
    "--open"
  ]);

  assert.equal(parsed.repoArg, "acme/repo");
  assert.equal(parsed.providerName, "bitbucket");
  assert.equal(parsed.limit, 15);
  assert.equal(parsed.configPath, "config/sentinel-eye.sample.json");
  assert.equal(parsed.host, "0.0.0.0");
  assert.equal(parsed.port, 8811);
  assert.equal(parsed.refreshSec, 240);
  assert.equal(parsed.openMode, "open");
});

test("parseDashboardArgs rejects unknown flag", () => {
  assert.throws(() => {
    parseDashboardArgs(["--mystery"]);
  }, /E_SENTINEL_ARG_UNKNOWN/);
});
