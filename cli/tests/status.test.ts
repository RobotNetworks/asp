import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  describeEntry,
  formatDuration,
  formatTable,
  type NetworkStatus,
} from "../src/commands/status.js";
import type { RegistryEntry } from "../src/registry.js";

const NOW = 1_777_000_000_000;

describe("status/describeEntry", () => {
  it("marks a live PID as running", () => {
    const entry: RegistryEntry = {
      name: "default",
      pid: process.pid,
      host: "127.0.0.1",
      port: 8723,
      startedAt: NOW - 5000,
      version: "0.0.0",
    };
    const s = describeEntry(entry, NOW);
    assert.equal(s.state, "running");
    assert.equal(s.uptimeMs, 5000);
  });

  it("marks an unknown PID as stale", () => {
    const entry: RegistryEntry = {
      name: "old",
      pid: 0x7fff_ffff, // synthetic, definitely not a real process
      host: "127.0.0.1",
      port: 8724,
      startedAt: NOW - 1000,
      version: "0.0.0",
    };
    assert.equal(describeEntry(entry, NOW).state, "stale");
  });

  it("clamps uptime at 0 if startedAt is in the future", () => {
    const entry: RegistryEntry = {
      name: "n",
      pid: process.pid,
      host: "127.0.0.1",
      port: 8723,
      startedAt: NOW + 1000,
      version: "0.0.0",
    };
    assert.equal(describeEntry(entry, NOW).uptimeMs, 0);
  });
});

describe("status/formatDuration", () => {
  it("formats sub-minute as seconds", () => {
    assert.equal(formatDuration(500), "0s");
    assert.equal(formatDuration(45_000), "45s");
  });
  it("formats sub-hour as minutes", () => {
    assert.equal(formatDuration(60_000), "1m 0s");
    assert.equal(formatDuration(125_000), "2m 5s");
  });
  it("formats sub-day as hours+minutes", () => {
    assert.equal(formatDuration(3_600_000), "1h 0m");
    assert.equal(formatDuration(2 * 3_600_000 + 5 * 60_000), "2h 5m");
  });
  it("formats >=day as days+hours", () => {
    assert.equal(formatDuration(86_400_000), "1d 0h");
    assert.equal(formatDuration(86_400_000 + 3_600_000 * 5), "1d 5h");
  });
  it("returns '-' for negative or non-finite", () => {
    assert.equal(formatDuration(-1), "-");
    assert.equal(formatDuration(Number.POSITIVE_INFINITY), "-");
  });
});

describe("status/formatTable", () => {
  it("renders an empty list as just the header row", () => {
    const out = formatTable([]);
    const [header] = out.split("\n");
    assert.match(header ?? "", /^NAME\s+STATE\s+URL\s+PID\s+UPTIME\s+VERSION$/);
  });

  it("aligns columns so each cell is at least as wide as the header", () => {
    const status: NetworkStatus = {
      name: "n",
      state: "running",
      host: "127.0.0.1",
      port: 1,
      pid: 2,
      startedAt: NOW,
      uptimeMs: 1000,
      version: "0.0.0",
    };
    const lines = formatTable([status]).split("\n").filter(Boolean);
    assert.equal(lines.length, 2, "header + one row");
    // Header columns are wider than these cells, so the row should be padded
    // out to at least the header widths.
    assert.ok(lines[1]!.length >= (lines[0]!.length - 6 /* trailing pad trims */));
  });

  it("uses dashes for stale entries' uptime and pid", () => {
    const status: NetworkStatus = {
      name: "old",
      state: "stale",
      host: "127.0.0.1",
      port: 1,
      pid: 99999,
      startedAt: NOW,
      uptimeMs: 10_000,
      version: "0.0.0",
    };
    const out = formatTable([status]);
    const dataRow = out.split("\n")[1] ?? "";
    // Two of the cells should be just "-"
    const dashCount = dataRow.split(/\s+/).filter((c) => c === "-").length;
    assert.equal(dashCount, 2);
  });
});
