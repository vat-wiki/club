import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  runUpdate,
  type UpdateDeps,
  type UpdateInput,
} from "./update.js";

const CURRENT = "1.0.0";

function makeDeps(over: Partial<UpdateDeps> = {}): UpdateDeps {
  return {
    fetchLatestVersion: vi.fn().mockResolvedValue("1.1.0"),
    isNewer: vi.fn().mockImplementation((latest, current) => latest > current),
    runSelfUpdate: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

const input: UpdateInput = { currentVersion: CURRENT };

describe("runUpdate", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when the registry is unreachable (fetchLatestVersion returns null)", async () => {
    const deps = makeDeps({
      fetchLatestVersion: vi.fn().mockResolvedValue(null),
    });
    await expect(runUpdate(input, deps)).rejects.toThrow(
      "could not reach the npm registry",
    );
    expect(deps.runSelfUpdate).not.toHaveBeenCalled();
  });

  it("logs 'already up to date' and does not install when latest is not newer", async () => {
    const deps = makeDeps({
      fetchLatestVersion: vi.fn().mockResolvedValue("1.0.0"),
      isNewer: vi.fn().mockReturnValue(false),
    });
    await runUpdate(input, deps);
    expect(deps.isNewer).toHaveBeenCalledWith("1.0.0", CURRENT);
    expect(console.log).toHaveBeenCalledWith(`already up to date (${CURRENT})`);
    expect(deps.runSelfUpdate).not.toHaveBeenCalled();
  });

  it("installs when latest is newer", async () => {
    const deps = makeDeps();
    await runUpdate(input, deps);
    expect(deps.isNewer).toHaveBeenCalledWith("1.1.0", CURRENT);
    expect(console.error).toHaveBeenCalledWith(
      `updating club-cli ${CURRENT} → 1.1.0`,
    );
    expect(deps.runSelfUpdate).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith("updated to 1.1.0");
  });

  it("does not log 'updated to' when runSelfUpdate throws", async () => {
    const deps = makeDeps({
      runSelfUpdate: vi.fn().mockRejectedValue(new Error("install failed")),
    });
    await expect(runUpdate(input, deps)).rejects.toThrow("install failed");
    const logCalls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
    const updatedCalls = logCalls.filter(
      (c: unknown[]) => c[0]?.startsWith("updated to"),
    );
    expect(updatedCalls).toHaveLength(0);
  });

  it("surfaces fetchLatestVersion rejection as a registry error", async () => {
    const deps = makeDeps({
      fetchLatestVersion: vi.fn().mockRejectedValue(new Error("net down")),
    });
    await expect(runUpdate(input, deps)).rejects.toThrow("net down");
    expect(deps.runSelfUpdate).not.toHaveBeenCalled();
  });
});
