import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock node:child_process so no real notify-panel/npm spawns. We drive behavior
// by reconfiguring proc.spawnSync / proc.spawn per test.
vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
  spawn: vi.fn(),
}));

// Mock node:fs so the port-file fallback is deterministic and never touches disk.
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
}));

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { ensureNotifyPanel, proc, resolveDaemonUrl } from "./ensure-notify-panel.js";

const mockSpawnSync = spawnSync as unknown as ReturnType<typeof vi.fn>;
const mockExists = existsSync as unknown as ReturnType<typeof vi.fn>;
const mockRead = readFileSync as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  mockSpawnSync.mockReset();
  mockExists.mockReturnValue(false);
  mockRead.mockReturnValue("");
  proc.spawnSync = mockSpawnSync;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Program a sequence of spawnSync results keyed by the subcommand. */
function programSpawnSync(cases: Record<string, { status?: number; stdout?: string }>): void {
  mockSpawnSync.mockImplementation((_bin: string, args: string[]) => {
    const sub = args[0];
    const c = cases[sub];
    if (!c) return { status: 1, stdout: "" };
    return { status: c.status ?? 0, stdout: c.stdout ?? "" };
  });
}

describe("resolveDaemonUrl", () => {
  it("uses notify-panel url --json when available", () => {
    programSpawnSync({
      url: { status: 0, stdout: JSON.stringify({ url: "http://127.0.0.1:9999", secret: "x" }) },
    });
    expect(resolveDaemonUrl()).toEqual({ url: "http://127.0.0.1:9999", secret: "x" });
  });

  it("falls back to the port file when url subcommand fails", () => {
    programSpawnSync({ url: { status: 1, stdout: "" } });
    mockExists.mockReturnValue(true);
    mockRead.mockReturnValue(JSON.stringify({ url: "http://127.0.0.1:8787" }));
    expect(resolveDaemonUrl()).toEqual({ url: "http://127.0.0.1:8787" });
  });

  it("returns null when neither url nor port file resolve", () => {
    programSpawnSync({ url: { status: 1, stdout: "" } });
    mockExists.mockReturnValue(false);
    expect(resolveDaemonUrl()).toBeNull();
  });

  it("returns null on malformed url JSON", () => {
    programSpawnSync({ url: { status: 0, stdout: "not-json" } });
    mockExists.mockReturnValue(false);
    expect(resolveDaemonUrl()).toBeNull();
  });
});

describe("ensureNotifyPanel", () => {
  it("returns the daemon URL when already installed + running", async () => {
    programSpawnSync({
      "--version": { status: 0 }, // installed
      status: { status: 0 }, // running
      url: { status: 0, stdout: JSON.stringify({ url: "http://127.0.0.1:8787" }) },
    });
    const info = await ensureNotifyPanel();
    expect(info).toEqual({ url: "http://127.0.0.1:8787" });
  });

  it("starts the daemon when installed but not running", async () => {
    programSpawnSync({
      "--version": { status: 0 },
      status: { status: 1 }, // not running
      start: { status: 0 }, // start succeeds
      url: { status: 0, stdout: JSON.stringify({ url: "http://127.0.0.1:8787" }) },
    });
    const info = await ensureNotifyPanel();
    expect(info).toEqual({ url: "http://127.0.0.1:8787" });
    expect(mockSpawnSync).toHaveBeenCalledWith(
      "notify-panel",
      ["start"],
      expect.anything(),
    );
  });

  it("returns null when start fails", async () => {
    programSpawnSync({
      "--version": { status: 0 },
      status: { status: 1 },
      start: { status: 1 }, // start fails
    });
    const info = await ensureNotifyPanel();
    expect(info).toBeNull();
  });

  it("returns null when installed but URL is undiscoverable", async () => {
    programSpawnSync({
      "--version": { status: 0 },
      status: { status: 0 },
      url: { status: 1, stdout: "" }, // discovery fails
    });
    mockExists.mockReturnValue(false); // no port file either
    const info = await ensureNotifyPanel();
    expect(info).toBeNull();
  });

  it("installs notify-panel when missing, then proceeds", async () => {
    // First isInstalled() returns false; subsequent calls (status/url) succeed.
    let versionCall = 0;
    mockSpawnSync.mockImplementation((_bin: string, args: string[]) => {
      const sub = args[0];
      if (sub === "--version") {
        versionCall++;
        return { status: versionCall === 1 ? 1 : 0, stdout: "" };
      }
      if (sub === "status") return { status: 0, stdout: "" };
      if (sub === "url") return { status: 0, stdout: JSON.stringify({ url: "http://x" }) };
      return { status: 1, stdout: "" };
    });
    // Stub the async install(): proc.spawn → a fake child that exits 0.
    proc.spawn = (() => {
      const child = new (class extends EventTarget {})() as unknown as {
        on(ev: string, cb: (a?: number) => void): void;
      };
      child.on = (ev: string, cb: (a?: number) => void) => {
        if (ev === "exit") setTimeout(() => cb(0), 0);
      };
      return () => child;
    })() as unknown as typeof proc.spawn;
    const info = await ensureNotifyPanel();
    expect(info).toEqual({ url: "http://x" });
  });

  it("returns null when install fails and prints the source-install hint", async () => {
    programSpawnSync({ "--version": { status: 1 } }); // not installed
    proc.spawn = (() => {
      const child = new (class extends EventTarget {})() as unknown as {
        on(ev: string, cb: (e: Error) => void): void;
      };
      child.on = (ev: string, cb: (e: Error) => void) => {
        if (ev === "error") setTimeout(() => cb(new Error("E404")), 0);
      };
      return () => child;
    })() as unknown as typeof proc.spawn;
    const info = await ensureNotifyPanel();
    expect(info).toBeNull();
    // The hint points to source install (notify-panel isn't on npm yet).
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining("git clone"),
    );
  });
});
