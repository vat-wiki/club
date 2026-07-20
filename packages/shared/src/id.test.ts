import { describe, expect,it } from "vitest";

import { ID_REGEX,isValidId } from "./id.js";

describe("ID_REGEX shape", () => {
  it("matches a valid ULID", () => {
    expect(ID_REGEX.test("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(true);
  });

  it("matches a base64url slug", () => {
    expect(ID_REGEX.test("aB3_-xYz123456789")).toBe(true);
  });
});

describe("isValidId", () => {
  it("accepts ULID-style uppercase base32", () => {
    expect(isValidId("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(true);
  });

  it("accepts lowercase alphanumeric", () => {
    expect(isValidId("abcdef1234567890")).toBe(true);
  });

  it("accepts hyphen and underscore separators", () => {
    expect(isValidId("abc-def_ghi-123")).toBe(true);
  });

  it("rejects empty strings", () => {
    expect(isValidId("")).toBe(false);
  });

  it("rejects path separators (path traversal defense)", () => {
    expect(isValidId("../etc/passwd")).toBe(false);
    expect(isValidId("foo/bar")).toBe(false);
    expect(isValidId("foo\\bar")).toBe(false);
  });

  it("rejects whitespace", () => {
    expect(isValidId(" abc")).toBe(false);
    expect(isValidId("abc ")).toBe(false);
    expect(isValidId("a b")).toBe(false);
  });

  it("rejects dots and query string characters", () => {
    expect(isValidId("abc.def")).toBe(false);
    expect(isValidId("abc?foo=bar")).toBe(false);
  });
});
