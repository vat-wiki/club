import { Command } from "commander";
import { sendMessage } from "../client.js";
import { requireConfig } from "../config.js";

export function makeSendCommand(): Command {
  return new Command("send")
    .description('send a message — `club send "hi"` or `echo hi | club send --stdin`')
    .argument("[text...]", "message text (omit if piping via --stdin)")
    .option("--stdin", "read message body from stdin")
    .action(async (text: string[], opts: { stdin?: boolean }) => {
      let content: string;
      if (opts.stdin) {
        content = await readStdin();
      } else {
        if (text.length === 0) {
          console.error("no message. pass text or use --stdin");
          process.exit(1);
        }
        content = text.join(" ");
      }
      content = content.trim();
      if (!content) {
        console.error("empty message");
        process.exit(1);
      }
      const cfg = requireConfig();
      try {
        await sendMessage(cfg, content);
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
    });
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}