import { describe, it, expect } from "vitest";
import { parseBearer } from "./http.js";

describe("parseBearer", () => {
  it("extracts a clean Bearer token", () => {
    expect(parseBearer("Bearer abc123")).toBe("abc123");
  });

  it("is case-insensitive to the Bearer scheme", () => {
    expect(parseBearer("bearer abc123")).toBe("abc123");
    expect(parseBearer("BEARER abc123")).toBe("abc123");
    expect(parseBearer("BeArEr abc123")).toBe("abc123");
  });

  it("trims the extracted token of surrounding spaces", () => {
    expect(parseBearer("Bearer   token  ")).toBe("token");
  });

  it("tolerates multiple spaces between scheme and token", () => {
    expect(parseBearer("Bearer    token")).toBe("token");
  });

  it("returns undefined for a missing header", () => {
    expect(parseBearer(undefined)).toBeUndefined();
    expect(parseBearer("")).toBeUndefined();
  });

  it("returns undefined for a Bearer scheme with no token", () => {
    expect(parseBearer("Bearer")).toBeUndefined();
    expect(parseBearer("Bearer ")).toBeUndefined();
  });

  it("rejects a Basic auth scheme", () => {
    expect(parseBearer("Basic abc123")).toBeUndefined();
  });

  it("rejects a scheme that is not Bearer", () => {
    expect(parseBearer("Token xyz")).toBeUndefined();
  });

  it("handles a token containing spaces (trims trailing)", () => {
    expect(parseBearer("Bearer my token")).toBe("my token");
  });

  it("preserves non-space characters in the token", () => {
    expect(parseBearer("Bearer sk-123/abc.def")).toBe("sk-123/abc.def");
  });
});
