// club completion [shell] [--install]
//
// Print or install a shell completion script for `club` (bash / zsh / fish).
// The generated script delegates candidate computation to the hidden
// `club __complete` dispatcher, which introspects the live commander tree, so
// it never goes stale when subcommands or options change.
//
//   club completion bash            # print bash script (pipe to ~/.bashrc, or eval)
//   completion zsh --install        # write script + wire into ~/.zshrc
//   club completion                 # detect shell from $SHELL

import { Command } from "commander";

import { withCatchExit } from "../catch-exit.js";
import {
  detectShell,
  getScript,
  installCompletion,
  type Shell,
  SHELLS,
} from "../completion/script.js";

/** Resolve the shell: explicit arg, else detect from $SHELL. Throws if unknown. */
export function resolveShell(arg: string | undefined): Shell {
  if (arg) {
    if (!SHELLS.includes(arg as Shell)) {
      throw new Error(`unsupported shell "${arg}". choose one of: ${SHELLS.join(", ")}`);
    }
    return arg as Shell;
  }
  const detected = detectShell();
  if (!detected) {
    throw new Error(
      `could not detect your shell from $SHELL. specify one explicitly: club completion <${SHELLS.join("|")}>`,
    );
  }
  return detected;
}

/**
 * Build the `club completion` commander sub-command.
 *
 * With no `--install`, prints the script for `shell` (detected from `$SHELL`
 * when omitted) to stdout, so it can be `eval`'d or redirected. With
 * `--install`, writes the script under `~/.club/` and wires it into the shell's
 * rc file (or fish's completions dir) idempotently.
 *
 * @returns A configured `Command` instance to register with the CLI program.
 */
export function makeCompletionCommand(): Command {
  return new Command("completion")
    .description(
      "print or install shell completion (bash/zsh/fish); delegates to `club __complete`",
    )
    .argument("[shell]", "bash | zsh | fish (default: detected from $SHELL)")
    .option("--install", "write the script and wire it into your shell rc file")
    .action(
      withCatchExit((shellArg: string | undefined, opts: { install?: boolean }) => {
        const shell = resolveShell(shellArg);

        if (opts.install) {
          const res = installCompletion(shell);
          if (shell === "fish") {
            process.stderr.write(
              res.installed
                ? `installed club fish completion -> ${res.scriptPath}\n(restart fish, or it auto-loads on next session)\n`
                : `club fish completion already installed at ${res.scriptPath} (refreshed)\n`,
            );
            return;
          }
          process.stderr.write(
            res.installed
              ? `installed club ${shell} completion -> ${res.scriptPath}\nadded source line to ${res.rcPath}\n(restart your shell, or run: source "${res.rcPath}")\n`
              : `club ${shell} completion already installed (refreshed ${res.scriptPath})\n`,
          );
          return;
        }

        // Print the script to stdout. `eval "$(club completion bash)"` works,
        // as does redirecting to a file you source from your rc.
        process.stdout.write(getScript(shell));
      }),
    );
}
