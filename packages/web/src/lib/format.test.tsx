import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { fmtTime, fmtDay, renderContent } from "./format";

describe("fmtDay", () => {
  it("labels today as 'today'", () => {
    expect(fmtDay(Date.now())).toBe("today");
  });

  it("labels an older date with something other than 'today'", () => {
    const d = new Date();
    d.setDate(d.getDate() - 5);
    const label = fmtDay(d.getTime());
    expect(label).not.toBe("today");
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
});