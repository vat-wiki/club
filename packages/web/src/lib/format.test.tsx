import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { fmtTime, fmtDay, renderContent, mentionsSelf } from "./format";

describe("fmtDay", () => {
  it("labels today as '今天'", () => {
    expect(fmtDay(Date.now())).toBe("今天");
  });

  it("labels an older date with something other than '今天'", () => {
    const d = new Date();
    d.setDate(d.getDate() - 5);
    const label = fmtDay(d.getTime());
    expect(label).not.toBe("今天");
    expect(label).toMatch(/\d/); // locale-independent: a day number is present
  });
});

describe("fmtTime", () => {
  it("formats as HH:MM", () => {
    expect(fmtTime(new Date(2024, 0, 1, 9, 5).getTime())).toMatch(/^\d{1,2}:\d{2}/);
  });
});

describe("renderContent", () => {
  it("wraps known @handles in a highlighted mark", () => {
    const { container } = render(<>{renderContent("hi @alice and @bob", ["alice"])}</>);
    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("@alice");
  });

  it("leaves unknown @handles as plain text", () => {
    const { container } = render(<>{renderContent("ping @nobody", [])}</>);
    expect(container.querySelectorAll("mark")).toHaveLength(0);
    expect(container.textContent).toContain("@nobody");
  });

  it("highlights CJK @handles when they are known (regex widened beyond ASCII)", () => {
    const { container } = render(<>{renderContent("hi @王前端!", ["王前端"])}</>);
    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("@王前端");
  });

  it("renders a self-mention with the primary (brand) palette, not amber", () => {
    const { container } = render(<>{renderContent("hi @alice", ["alice"], "alice")}</>);
    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("@alice");
    // self-mention mark gets the primary tint + left accent border
    expect(marks[0].className).toContain("bg-primary/25");
    expect(marks[0].className).toContain("text-primary");
    expect(marks[0].className).toContain("border-l-2");
    expect(marks[0].className).toContain("border-primary");
    // and must NOT carry the amber other-mention classes
    expect(marks[0].className).not.toContain("bg-human-soft");
    expect(marks[0].className).not.toContain("text-human");
  });

  it("renders a known mention of someone else with the amber palette, even when selfName is set", () => {
    const { container } = render(<>{renderContent("hi @bob", ["bob"], "alice")}</>);
    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0].className).toContain("bg-human-soft");
    expect(marks[0].className).toContain("text-human");
    expect(marks[0].className).not.toContain("bg-primary");
  });

  it("matches self-mention case-insensitively", () => {
    const { container } = render(<>{renderContent("HI @ALICE!", ["alice"], "Alice")}</>);
    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0].className).toContain("bg-primary/25");
  });

  it("treats a self-mention of an unknown handle as plain text (no highlight)", () => {
    // selfName set, but the handle isn't in `known` — no mark at all.
    const { container } = render(<>{renderContent("hi @alice", [], "alice")}</>);
    expect(container.querySelectorAll("mark")).toHaveLength(0);
  });
});

describe("mentionsSelf", () => {
  it("returns true when content contains @selfName (case-insensitive)", () => {
    expect(mentionsSelf("hey @Alice please", "alice")).toBe(true);
    expect(mentionsSelf("HEY @ALICE!", "alice")).toBe(true);
  });

  it("returns false when selfName is undefined", () => {
    expect(mentionsSelf("hi @alice", undefined)).toBe(false);
  });

  it("returns false when selfName is not @-mentioned", () => {
    expect(mentionsSelf("hi @bob", "alice")).toBe(false);
    expect(mentionsSelf("plain text", "alice")).toBe(false);
  });

  it("does not false-positive on substring without @", () => {
    // "alice" alone, no `@`, is not a mention
    expect(mentionsSelf("talking about alice here", "alice")).toBe(false);
  });

  it("does not match @alexandra when selfName is alice", () => {
    expect(mentionsSelf("ping @alexandra", "alice")).toBe(false);
  });
});