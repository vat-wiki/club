import { Command } from "commander";

import { withCatchExit } from "../catch-exit.js";
import {
  CURRENT_VERSION,
  fetchLatestVersion,
  isNewer,
  runSelfUpdate,
} from "../update.js";

/** Inputs for `runUpdate`. */
export interface UpdateInput {
  currentVersion: string;
}

/** Dependency shape for `runUpdate`, injected by the CLI action or by tests. */
export interface UpdateDeps {
  /** Fetch the latest published version from npm. Null on any failure. */
  fetchLatestVersion: () => Promise<string | null>;
  /** Compare versions; true when latest > current. */
  isNewer: (latest: string, current: string) => boolean;
  /** Perform the in-place npm global install. */
  runSelfUpdate: () => Promise<void>;
}

/**
 * Execute the `club update` flow without tying it to the commander action or
 * the real network / filesystem. Throws when the registry is unreachable or the
 * install fails, so the caller can surface the message to the user.
 */
export async function runUpdate(
  input: UpdateInput,
  deps: UpdateDeps,
): Promise<void> {
  const latest = await deps.fetchLatestVersion();
  if (!latest) {
    throw new Error("could not reach the npm registry");
  }
  if (!deps.isNewer(latest, input.currentVersion)) {
    console.log(`already up to date (${input.currentVersion})`);
    return;
  }
  console.error(`updating club-cli ${input.currentVersion} → ${latest}`);
  await deps.runSelfUpdate();
  console.log(`updated to ${latest}`);
}

/**
 * `club update` — manually pull the latest published club-cli from npm.
 * Forces a registry fetch (ignores the TTL cache) and reports the outcome.
 * Does not self-relaunch: the next `club` invocation runs the new version.
 */
export function makeUpdateCommand(): Command {
  return new Command("update")
    .description("update club-cli to the latest version on npm")
    .action(
      withCatchExit(async () => {
        return runUpdate(
          { currentVersion: CURRENT_VERSION },
          {
            fetchLatestVersion,
            isNewer,
            runSelfUpdate,
          },
        );
      }),
    );
}
