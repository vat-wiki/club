// Shared URL normalization for CLI commands.
//
// Several commands (`login`, `join`, `recover`) accept a `--server` URL from
// the user. A trailing slash on the base URL would otherwise break request
// path resolution (e.g. `http://x//participants`), so each command historically
// inlined `.replace(/\/$/, "")`. This module provides a single source of
// truth so every command gets the same behaviour and new commands don't repeat
// the pattern.

/**
 * Strip a single trailing slash from a URL base string, if present.
 *
 * The URL must start with `http://` or `https://`; otherwise it is returned
 * unchanged (the validation responsibility of the caller).
 *
 * @param url - A base URL, possibly ending in `/`.
 * @returns The same URL with the trailing slash removed.
 *
 * @example
 *   stripTrailingSlash("http://localhost:6200/") // => "http://localhost:6200"
 */
export function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
