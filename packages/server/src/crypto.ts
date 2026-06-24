import { createHash } from "node:crypto";

export function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}