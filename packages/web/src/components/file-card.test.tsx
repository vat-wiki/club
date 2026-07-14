import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { MessageAttachment } from "@club/shared";
import { renderWithI18n } from "@/test/i18n-wrap";
import { FileCard } from "./file-card";

// Markdown attachment preview coverage: the preview affordance appears for a
// markdown attachment, opening it fetches + renders the parsed markdown, and —
// critically, since attachment content is untrusted — the rendered HTML is
// sanitized (no <script>, no javascript: URLs).

function mdAtt(): MessageAttachment {
  return {
    id: "md1",
    url: "/files/md1",
    mime: "text/markdown",
    filename: "readme.md",
    size: 100,
  };
}

describe("FileCard — markdown preview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a preview button for a markdown attachment", () => {
    renderWithI18n(<FileCard attachment={mdAtt()} />);
    expect(screen.getByTestId("file-preview-btn")).toBeTruthy();
  });

  it("renders parsed markdown and strips dangerous markup", async () => {
    // marked passes raw HTML through, so DOMPurify is the only thing standing
    // between this string and the DOM. Assert both render (h1/strong) and
    // sanitize (no <script>, no javascript: href).
    const dirty =
      "# Title\n\nhello **world**\n\n<script>alert(1)</script>\n\n[a](javascript:alert(1))";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(dirty),
      }),
    );

    renderWithI18n(<FileCard attachment={mdAtt()} />);
    fireEvent.click(screen.getByTestId("file-preview-btn"));

    const body = await screen.findByTestId("markdown-body");
    await waitFor(() => {
      expect(body.innerHTML).toContain("<h1>");
      expect(body.innerHTML).toContain("<strong>world</strong>");
      expect(body.innerHTML).not.toContain("<script>");
      expect(body.innerHTML).not.toContain("javascript:alert");
    });
  });

  it("shows the failed state when the fetch is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, text: () => Promise.resolve("") }),
    );
    renderWithI18n(<FileCard attachment={mdAtt()} />);
    fireEvent.click(screen.getByTestId("file-preview-btn"));
    await waitFor(() => {
      expect(screen.getByText("预览失败——请尝试下载后打开")).toBeTruthy();
    });
  });
});
