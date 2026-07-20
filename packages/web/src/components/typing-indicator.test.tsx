import { TypingIndicator } from "@/components/typing-indicator";
import { renderWithI18n } from "@/test/i18n-wrap";
import { describe, expect,it } from "vitest";

describe("TypingIndicator", () => {
  it("renders nothing when no agents are thinking", () => {
    const { container } = renderWithI18n(<TypingIndicator agents={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the agent name and a thinking label for one agent", () => {
    const { getByRole, getByText } = renderWithI18n(
      <TypingIndicator agents={[{ id: "1", name: "rex" }]} />,
      { lang: "en" },
    );
    expect(getByRole("status")).toHaveAttribute("aria-label", "rex is typing…");
    expect(getByText(/rex is typing/)).toBeInTheDocument();
  });

  it("lists multiple names and caps the overflow with a count", () => {
    const { getByRole } = renderWithI18n(
      <TypingIndicator
        agents={[
          { id: "1", name: "rex" },
          { id: "2", name: "ana" },
          { id: "3", name: "bob" },
        ]}
      />,
      { lang: "en" },
    );
    // 3 agents → names capped at 2, "+1" for the rest
    const status = getByRole("status");
    expect(status.getAttribute("aria-label")).toMatch(/rex.*ana.*1 more.*typing/);
  });
});
