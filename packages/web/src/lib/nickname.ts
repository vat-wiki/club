// Nickname validation for club/web.
//
// The server (packages/shared CreateParticipantRequest) accepts any
// 1–40 char string with no charset restriction, and the mention system is a
// case-insensitive substring match that already supports CJK names like "王前端".
// So we do NOT hard-restrict to ASCII — that would break CJK agent identities.
//
// What we DO guard against, client-side as advisory feedback:
//  - whitespace inside the name genuinely breaks @-mention tokenization (a
//    space ends the handle token), so "Bad Nick!!" can't be reliably @-pinged.
//    We hard-block whitespace (it's a real functional bug, not just style).
//  - names shorter than 3 or longer than 20 chars get a soft hint (the common
//    chat-app convention), but aren't blocked — the server allows up to 40 and
//    some legitimate handles may be 2 chars.
//
// CJK, letters, digits, underscore, hyphen, and dots are all fine. The
// validation returns a structured result so callers can decide whether to block
// (whitespace) or just hint (length).

export type NicknameIssue =
  | { kind: "empty" }
  | { kind: "whitespace" }
  | { kind: "tooShort"; min: number }
  | { kind: "tooLong"; max: number };

export interface NicknameRule {
  min: number;
  max: number;
}

// The advisory length window. Server max is 40; we hint at 20+ but the field's
// maxLength still allows the server's 40. min 3 is the chat-app convention.
export const NICKNAME_RULE: NicknameRule = { min: 3, max: 20 };

export const NICKNAME_PATTERN = /^[A-Za-z0-9_\-一-鿿㐀-䶿.]+$/;

/**
 * Validate a candidate nickname. Returns the first issue found, or null when the
 * name passes all checks. Pure so it can be unit-tested directly.
 *
 * Order matters: empty → whitespace → length. Whitespace is the only "blocking"
 * issue (it breaks mentions); length issues are advisory (caller may still
 * submit if the server allows it).
 */
export function validateNickname(name: string, rule: NicknameRule = NICKNAME_RULE): NicknameIssue | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return { kind: "empty" };
  if (/\s/.test(trimmed)) return { kind: "whitespace" };
  if (trimmed.length < rule.min) return { kind: "tooShort", min: rule.min };
  if (trimmed.length > rule.max) return { kind: "tooLong", max: rule.max };
  return null;
}

/** True when the issue is severe enough to block submission (whitespace). */
export function isBlockingIssue(issue: NicknameIssue | null): boolean {
  return issue?.kind === "whitespace";
}
