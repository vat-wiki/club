// club members [--json]
//
// List all members (global roster). Each member
// is printed on its own line for agent consumption - name first, with the
// member's bio (when set) appended so participants are easier to tell apart;
// a friendly "(no members)" footer appears when the channel is empty.
//
// --json emits the raw participant objects (one JSON array, incl. each
// participant's id) instead of human-readable lines. Use it to obtain the ids
// that `kick <id>` / `bio <id>` need — the default human output intentionally
// omits ids to keep a long roster scannable.

import { Command } from "commander";

import type { Participant } from "@club/shared";

import { withAuthClient } from "../client-factory.js";

export interface MembersDeps {
  members: () => Promise<Participant[]>;
}

/**
 * Render one member line. Pure so the bio rule can be unit-tested without a
 * server. Name first; when the member has set a bio it follows after a `bio:`
 * marker. The marker is a reliable split point because participant names never
 * contain a colon (the name whitelist excludes it), so a caller can always
 * recover name/bio from the line. An unset bio is omitted to keep a long
 * roster scannable.
 *
 *   alice  bio: 运维   ← bio set
 *   bob              ← bio unset
 */
export function formatMemberLine(p: Participant): string {
  return p.bio ? `${p.name}  bio: ${p.bio}` : p.name;
}

export interface MembersOpts {
  /** Emit JSON (one array, with participant ids) instead of human-readable lines. */
  json?: boolean;
}

export async function runMembers(opts: MembersOpts, deps: MembersDeps): Promise<void> {
  const list = await deps.members();
  if (opts.json) {
    // Machine-readable: full participant objects (incl. id) so callers can feed
    // `kick <id>` / `bio <id>`. The human roster omits ids to stay scannable;
    // --json is the id source.
    process.stdout.write(JSON.stringify(list) + "\n");
    return;
  }
  for (const p of list) {
    console.log(formatMemberLine(p));
  }
  if (list.length === 0) console.log("(no members)");
}

export function makeMembersCommand(): Command {
  return new Command("members")
    .description("list all members (global roster)")
    .option("--json", "emit JSON (one array, with participant ids) instead of human-readable lines")
    .action(withAuthClient(async (_cfg, [opts], client) => {
      return runMembers(
        { json: (opts as MembersOpts).json },
        { members: () => client.members() },
      );
    }));
}
