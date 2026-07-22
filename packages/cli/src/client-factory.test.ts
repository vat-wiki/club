/**
 * Tests for `client-factory.ts` (`withAuthClient`).
 *
 * The factory wires `requireConfig() + new ClubClient(cfg)` behind a
 * `withCatchExit` guard. Verifying it here means:
 *   1. when config is valid, the wrapped handler receives (cfg, args, client)
 *      and `ClubClient` is constructed with the parsed config;
 *   2. when config is missing, `ConfigError` is surfaced through
 *      `formatError` rather than a raw stack trace;
 *   3. the returned Commander action forwards `this` (the `Command` instance)
 *      to `withCatchExit` so downstream `this.name` / `this.opts()` still work;
 *   4. positional / option args arrive at the handler verbatim;
 *   5. async handler rejections (including SDK `ClubApiError`-like objects)
 *      are caught identically to the `withCatchExit` contract.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ClubConfig } from "./config.js";
import { ConfigError } from "./config.js";

// --- Mocks (hoisted by Vitest) -------------------------------------------

const mockClubClientInstance = { _cfg: null as ClubConfig | null };

// ClubClient must be a class (constructor) because client-factory does `new ClubClient(cfg)`.
const ClubClient = vi.fn().mockImplementation(function (this: any, cfg: ClubConfig) {
  mockClubClientInstance._cfg = cfg;
  return mockClubClientInstance;
}) as unknown as typeof import("@club/sdk").ClubClient;

vi.mock("@club/sdk", () => ({
  get ClubClient() { return ClubClient; },
  formatError: vi.fn((err) => {
    if (err instanceof Error) return err.message;
    return String(err);
  }),
}));

// Wrap `requireConfig` so each test can control whether the user is "logged in".
vi.mock("./config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config.js")>();
  return {
    ...actual,
    requireConfig: vi.fn(),
  };
});

const { requireConfig } = await import("./config.js");
const { withAuthClient } = await import("./client-factory.js");

// --- Helpers -------------------------------------------------------------

/** Build a fake Commander `Command` — the only thing `withAuthClient` needs
 *  from Commander is the `this` binding. */
function makeCommand(name: string = "test"): any {
  return { name: () => name, parent: null, opts: () => ({}) };
}

/** Run a wrapped handler, collecting what it receives. */
async function run(fn: any, cmd: any, ...args: unknown[]) {
  const captured: Array<[ClubConfig, readonly unknown[], any]> = [];
  const wrapped = withAuthClient(function (cfg, receivedArgs, client) {
    captured.push([cfg, receivedArgs, client]);
  });
  await wrapped.apply(cmd, args);
  return captured[0];
}

describe("withAuthClient", () => {
  beforeEach(() => {
    // Reset call history but preserve the mocked implementation set by
    // vi.mock (which is hoisted above this block).
    vi.clearAllMocks();
    const valid: ClubConfig = { server: "http://localhost:6200", key: "club_human_abc" };
    vi.mocked(requireConfig).mockReturnValue(valid);
    mockClubClientInstance._cfg = null;
  });

  it("calls requireConfig exactly once per invocation", async () => {
    await run(() => {}, makeCommand());
    expect(requireConfig).toHaveBeenCalledTimes(1);
  });

  it("constructs ClubClient with the parsed config", async () => {
    vi.mocked(requireConfig).mockReturnValue({ server: "http://srv", key: "k" });
    await run(() => {}, makeCommand());
    expect(ClubClient).toHaveBeenCalledTimes(1);
    expect(ClubClient).toHaveBeenLastCalledWith({ server: "http://srv", key: "k" });
    expect(mockClubClientInstance._cfg).toEqual({ server: "http://srv", key: "k" });
  });

  it("surfaces ConfigError as a formatted message when not logged in", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(requireConfig).mockImplementation(() => {
      throw new ConfigError("not logged in. run: club login <key>");
    });
    const wrapped = withAuthClient(() => {});
    await wrapped.apply(makeCommand());
    expect(errorSpy).toHaveBeenCalledWith("error: not logged in. run: club login <key>");
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("passes position arguments through to the handler verbatim", async () => {
    const [cfg, receivedArgs] = await run(() => {}, makeCommand(), "arg1", "arg2", "arg3");
    expect(receivedArgs).toEqual(["arg1", "arg2", "arg3"]);
    expect(requireConfig).toHaveReturnedWith(cfg);
  });

  it("passes the constructed ClubClient to the handler", async () => {
    const capturedClient: any[] = [];
    const wrapped = withAuthClient(function (_cfg, _args, client) {
      capturedClient.push(client);
    });
    await wrapped.apply(makeCommand());
    expect(capturedClient).toHaveLength(1);
    expect(mockClubClientInstance._cfg).toEqual({
      server: "http://localhost:6200",
      key: "club_human_abc",
    });
  });

  it("awaits an async handler and propagates its result", async () => {
    let resolved = false;
    const wrapped = withAuthClient(async () => { resolved = true; });
    await wrapped.apply(makeCommand());
    expect(resolved).toBe(true);
  });

  it("lets withCatchExit catch handler rejections (plain Error)", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapped = withAuthClient(() => { throw new Error("boom"); });
    await wrapped.apply(makeCommand());
    expect(errorSpy).toHaveBeenCalledWith("error: boom");
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("lets withCatchExit catch handler rejections (string-like object)", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapped = withAuthClient(() => {
      throw Object.assign(new Error("api err"), { status: 401, reason: "unauthorized" });
    });
    await wrapped.apply(makeCommand());
    expect(errorSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("accepts both sync and async wrapped handlers without lint-unsafe require-await", async () => {
    // The factory's job is to let commands write sync handlers and still get
    // async error semantics. Both shapes should work.
    await run(() => {}, makeCommand());             // sync
    await run(async () => {}, makeCommand());       // async
  });
});
