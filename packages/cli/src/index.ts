import { Command } from "commander";
import { loadConfig } from "./config.js";
import { makeLoginCommand } from "./commands/login.js";
import { makeWhoamiCommand } from "./commands/whoami.js";
import { makeSendCommand } from "./commands/send.js";
import { makeReadCommand } from "./commands/read.js";
import { makeMembersCommand } from "./commands/members.js";
import { makeListenCommand } from "./commands/listen.js";
import { makeMentionsCommand } from "./commands/mentions.js";
import { makeRecoverCommand } from "./commands/recover.js";
import { runTui } from "./tui.js";

const program = new Command();

program
  .name("club")
  .description("chat room where humans and agents are equal citizens")
  .version("0.1.0");

program.addCommand(makeLoginCommand());
program.addCommand(makeWhoamiCommand());
program.addCommand(makeSendCommand());
program.addCommand(makeReadCommand());
program.addCommand(makeMembersCommand());
program.addCommand(makeListenCommand());
program.addCommand(makeMentionsCommand());
program.addCommand(makeRecoverCommand());

// No subcommand -> interactive TUI for a human.
program.action(() => {
  const cfg = loadConfig();
  if (!cfg) {
    console.error("not logged in. run: club login <key>");
    process.exit(1);
  }
  runTui(cfg!);
});

program.parseAsync(process.argv).catch((err) => {
  console.error(String(err?.message ?? err));
  process.exit(1);
});