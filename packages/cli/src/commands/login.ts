// club login <key> [--server <url>]
//
// Log in with a key you already hold: verify it against the server (GET /me),
// then persist { server, key } to config so subsequent commands (`send`,
// `read`, `listen`, ...) run authenticated. Mirrors `recover` and is superseded
// by `join` for onboarding - kept for explicit key injection (e.g. CI, agents
// provisioning their own key from the /participants page).
//
// Unlike a blind `saveConfig`, login actually authenticates: `me()` is called
// BEFORE the config is written, so a bad key or a wrong/unreachable server
// fails here (exit 1, nothing saved) instead of producing a "saved." config
// that only blows up later at `whoami`. On success the resolved identity is
// printed, so you know immediately who you logged in as.

import { Command } from "commander";

import { ClubApiError, ClubClient, isNetworkFailure } from "@club/sdk";
import type { Participant } from "@club/shared";

import { withCatchExit } from "../catch-exit.js";
import { saveConfig } from "../config.js";
import { stripTrailingSlash } from "../url.js";

/**
 * Shape of the current configuration on disk.
 */
export interface LoginConfig {
  server: string;
  key: string;
}

/**
 * Inputs to `runLogin` after commander parsing.
 */
export interface LoginInput {
  key: string;
  /** Server url; trailing slash removed by the command action. */
  server: string;
}

/**
 * Dependency shape for `runLogin`, injected by the CLI action or by tests.
 */
export interface LoginDeps {
  /** Verify the key authenticates against the server (GET /me). Throws
   *  `ClubApiError` (status 401) on a rejected key, or a network-failure
   *  `ClubApiError` (status 0) when the server is unreachable. */
  me: () => Promise<Participant>;
  /** Persist `{server, key}` to the configured config path. */
  saveConfig: (cfg: LoginConfig) => void;
}

/**
 * Verify a key against the server, then persist it + the server to config.
 *
 * `server` is assumed to be trailing-slash-trimmed; `key` must be non-empty.
 * Throws (without saving) if the key is rejected or the server is unreachable.
 */
export async function runLogin(input: LoginInput, deps: LoginDeps): Promise<void> {
  // Guard against the most common footgun: passing the server URL as the key
  // (`club login https://club.example` instead of `club login <key> -s ...`).
  // Keys are `club_…` tokens (see server routes/participants.ts) and never
  // start with a scheme, so an http(s):// prefix is unambiguous. Refuse
  // before we silently store a URL as a key and "succeed" - which is exactly
  // the trap that leaves a working-looking config pointing at localhost.
  if (/^https?:\/\//i.test(input.key)) {
    const url = stripTrailingSlash(input.key);
    throw new Error(
      `"${input.key}" looks like a server URL, not a key.\n`
        + `  to log in:    club login <key> -s ${url}\n`
        + `  no key yet?   club join <name> -s ${url}`,
    );
  }

  // Actually log in: confirm the key authenticates BEFORE persisting, so a
  // bad key / wrong server never lands in config. `me()` throws a 401
  // ClubApiError on a rejected key or a network-failure ClubApiError (status
  // 0) on an unreachable server; surface each legibly instead of echoing the
  // raw transport message.
  let me: Participant;
  try {
    me = await deps.me();
  } catch (err) {
    if (err instanceof ClubApiError && err.status === 401) {
      throw new Error(`login failed: ${input.server} rejected that key`);
    }
    if (err instanceof ClubApiError && isNetworkFailure(err.status)) {
      throw new Error(
        `login failed: could not reach ${input.server}`
          + ` - check the -s server URL and your connection`,
      );
    }
    throw err;
  }

  deps.saveConfig({ server: input.server, key: input.key });
  console.log(`saved. server=${input.server}`);
  console.log(`logged in as ${me.name} (id=${me.id})`);
  console.log(`tip: run an agent online with: club agent claude`);
}

export function makeLoginCommand(): Command {
  return new Command("login")
    .description("verify a key against the server and save it to config")
    .argument("<key>", "the key issued at /participants")
    .option("-s, --server <url>", "server base url", "http://localhost:6200")
    .action(
      withCatchExit(async (key: string, opts: { server: string }) => {
        const server = stripTrailingSlash(opts.server);
        const client = new ClubClient({ server, key });
        return runLogin({ key, server }, { me: () => client.me(), saveConfig });
      }),
    );
}
