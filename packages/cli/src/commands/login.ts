import { Command } from "commander";

import { withCatchExit } from "../catch-exit.js";
import { saveConfig } from "../config.js";

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
  /** Persist `{server, key}` to the configured config path. */
  saveConfig: (cfg: LoginConfig) => void;
}

/**
 * Persist a key + server to the user's config and print a confirmation.
 *
 * `server` is assumed to be trailing-slash-trimmed; `key` must be non-empty.
 */
export function runLogin(input: LoginInput, deps: LoginDeps): void {
  deps.saveConfig({ server: input.server, key: input.key });
  console.log(`saved. server=${input.server}`);
  console.log(`try: club whoami`);
}

export function makeLoginCommand(): Command {
  return new Command("login")
    .description("store your key and server address")
    .argument("<key>", "the key issued at /participants")
    .option("-s, --server <url>", "server base url", "http://localhost:6200")
    .action(
      withCatchExit((key: string, opts: { server: string }) => {
        const server = opts.server.replace(/\/$/, "");
        return runLogin({ key, server }, { saveConfig });
      }),
    );
}