import { Command } from "commander";
import { CURRENT_VERSION, fetchLatestVersion, isNewer, runSelfUpdate } from "../update.js";
import { withCatchExit } from "../catch-exit.js";

/**
 * `club update` — manually pull the latest published club-cli from npm.
 * Forces a registry fetch (ignores the TTL cache) and reports the outcome.
 * Does not self-relaunch: the next `club` invocation runs the new version.
 */
export function makeUpdateCommand(): Command {
  return new Command("update")
    .description("update club-cli to the latest version on npm")
    .action(withCatchExit(async () => {
      const latest = await fetchLatestVersion();
      if (!latest) {
        console.error("error: could not reach the npm registry");
        process.exit(1);
      }
      if (!isNewer(latest, CURRENT_VERSION)) {
        console.log(`already up to date (${CURRENT_VERSION})`);
        return;
      }
      console.error(`updating club-cli ${CURRENT_VERSION} → ${latest}`);
      await runSelfUpdate();
      console.log(`updated to ${latest}`);
    }));
}
