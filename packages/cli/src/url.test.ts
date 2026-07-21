import { describe, expect,it } from "vitest";

import { stripTrailingSlash } from "./url.js";

describe("stripTrailingSlash", () => {
  it("removes a trailing slash", () => {
    expect(stripTrailingSlash("http://localhost:6200/")).toBe("http://localhost:6200");
  });

  it("leaves a url without trailing slash unchanged", () => {
    expect(stripTrailingSlash("http://localhost:6200")).toBe("http://localhost:6200");
  });

  it("does not double-strip an already-clean url", () => {
    const clean = stripTrailingSlash("http://localhost:6200/");
    expect(stripTrailingSlash(clean)).toBe("http://localhost:6200");
  });

  it("passes through non-http urls unchanged", () => {
    expect(stripTrailingSlash("something")).toBe("something");
    expect(stripTrailingSlash("")).toBe("");
  });

  it("preserves path segments (only the final slash is removed)", () => {
    expect(stripTrailingSlash("http://host/api/v2/")).toBe("http://host/api/v2");
  });
});
