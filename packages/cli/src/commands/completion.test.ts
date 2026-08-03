import { afterEach, describe, expect, it } from "vitest";

import { resolveShell } from "./completion.js";

describe("resolveShell", () => {
  const origShell = process.env.SHELL;
  afterEach(() => {
    process.env.SHELL = origShell;
  });

  it("accepts each supported shell explicitly", () => {
    expect(resolveShell("bash")).toBe("bash");
    expect(resolveShell("zsh")).toBe("zsh");
    expect(resolveShell("fish")).toBe("fish");
  });

  it("throws on an unsupported shell", () => {
    expect(() => resolveShell("powershell")).toThrow(/unsupported shell/);
  });

  it("detects from $SHELL when no arg given", () => {
    process.env.SHELL = "/bin/zsh";
    expect(resolveShell(undefined)).toBe("zsh");
  });

  it("throws when it cannot detect and no arg given", () => {
    delete process.env.SHELL;
    expect(() => resolveShell(undefined)).toThrow(/could not detect/);
  });

  it("explicit arg takes precedence over $SHELL", () => {
    process.env.SHELL = "/bin/zsh";
    expect(resolveShell("bash")).toBe("bash");
  });
});
