import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { loadConfig } from "./config.js";
import { makeLoginCommand } from "./commands/login.js";
import { makeJoinCommand } from "./commands/join.js";
import { makeWhoamiCommand } from "./commands/whoami.js";
import { makeSendCommand } from "./commands/send.js";
import { makeReadCommand } from "./commands/read.js";
import { makeMembersCommand } from "./commands/members.js";
import { makeListenCommand } from "./commands/listen.js";
import { makeMentionsCommand } from "./commands/mentions.js";
import { makeRecoverCommand } from "./commands/recover.js";
import { makeRoomsCommand } from "./commands/rooms.js";
import { makeEnterCommand } from "./commands/enter.js";
import { makeInfoCommand } from "./commands/info.js";
import { makeDeleteCommand } from "./commands/delete.js";
import { makeReactCommand } from "./commands/react.js";
import { makeSearchCommand } from "./commands/search.js";
import { makeCatCommand } from "./commands/cat.js";
import { makeUpdateCommand } from "./commands/update.js";
import { runTui } from "./tui.js";
import { autoUpdateAndRelaunch, checkForUpdate, isDevRun } from "./update.js";

// Top-level error handler — uniform "error: <msg>" output for all commands.
// Each command's action throws; this wrapper catches and formats consistently.
function die(msg: string | Error): never {
  console.error(typeof msg === "string" ? `error: ${msg}` : `error: ${msg.message}`);
  process.exit(1);
}

const program = new Command();

program
  .name("club")
  .description("chat room where humans and agents are equal citizens")
  .version(pkg.version);

// Register all subcommands
const cmds = [
  makeLoginCommand(),
  makeJoinCommand(),
  makeWhoamiCommand(),
  makeInfoCommand(),
  makeRoomsCommand(),
  makeEnterCommand(),
  makeSendCommand(),
  makeReadCommand(),
  makeMembersCommand(),
  makeListenCommand(),
  makeMentionsCommand(),
  makeRecoverCommand(),
  makeSearchCommand(),
  makeDeleteCommand(),
  makeReactCommand(),
  makeCatCommand(),
  makeUpdateCommand(),
];
cmds.forEach((c) => program.addCommand(c));

// Before any command runs: opportunistically self-update club-cli.
// A 24h TTL cache keeps this off the hot path; on a hit we reinstall globally and
// relaunch, so the user's original command continues on the new version. Anything that
// can go wrong (offline, no write permission, dev run, the update command itself,
// a relaunched child) bails out and the original command runs unchanged.
program.hook("preAction", async (_thisCmd, actionCmd) => {
  try {
    if (process.env.CLUB_NO_UPDATE_CHECK === "1") return; // relaunched child / user opt-out
    if (actionCmd.name() === "update") return; // `club update` manages itself
    if (isDevRun()) return; // running from source via tsx
    // (note: --version/--help short-circuit before the action and never reach this hook)

    const { update, latest } = await checkForUpdate();
    if (!update || !latest) return;
    await autoUpdateAndRelaunch(latest); // success → exits running the new version
  } catch {
    // Last-resort safety net: never block the user's command.
  }
});

// No subcommand -> interactive TUI for a human.
program.action(() => {
  const cfg = loadConfig();
  if (!cfg) die("not logged in. run: club login <key>");
  runTui(cfg);
});

program.parseAsync(process.argv).catch((err) => die(err as Error));
