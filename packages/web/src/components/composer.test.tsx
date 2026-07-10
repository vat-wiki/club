import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { MessageAttachment } from "@club/shared";
import type { ClubConn } from "@club/sdk";

// The composer drives uploads through @/lib/api.uploadFile. We mock that module
// so tests don't hit XHR/fetch, and we can resolve/reject uploads at will.
const uploadFileMock = vi.fn();
vi.mock("@/lib/api", () => ({
  api: { uploadFile: (...args: unknown[]) => uploadFileMock(...args), thinking: vi.fn().mockResolvedValue(undefined), idle: vi.fn().mockResolvedValue(undefined) },
}));

import { Composer } from "./composer";
import { renderWithI18n } from "@/test/i18n-wrap";

const conn: ClubConn = { server: "http://x", key: "club_human_test" };

function png(name = "img.png", size = 100): File {
  return new File([new Uint8Array(size)], name, { type: "image/png" });
}

function makeAttachment(id: string): MessageAttachment {
  return {
    id,
    url: `/files/${id}`,
    mime: "image/png",
    width: 100,
    height: 100,
    size: 100,
  };
}

// The composer resolves a File into an objectUrl via URL.createObjectURL; jsdom
// returns a stable-ish "blob:" string. We don't assert on it, just ensure it
// doesn't throw.
beforeEach(() => {
  uploadFileMock.mockReset();
  if (!("createObjectURL" in URL)) {
    Object.defineProperty(URL, "createObjectURL", { value: () => "blob:mock", configurable: true });
  }
  if (!("revokeObjectURL" in URL)) {
    Object.defineProperty(URL, "revokeObjectURL", { value: () => {}, configurable: true });
  }
});

describe("Composer — image input", () => {
  it("renders the attach button with an accessible name", () => {
    renderWithI18n(<Composer onSend={async () => {}} conn={conn} />);
    const attach = screen.getByLabelText("添加图片或视频");
    expect(attach).toBeTruthy();
    expect(attach.tagName).toBe("BUTTON");
  });

  it("renders a hidden file input with the image+video accept whitelist + multiple + capture", () => {
    const { container } = renderWithI18n(<Composer onSend={async () => {}} conn={conn} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).toBeTruthy();
    expect(input?.hidden).toBe(true);
    expect(input?.multiple).toBe(true);
    expect(input?.accept).toBe(
      "image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm",
    );
    expect(input?.hasAttribute("capture")).toBe(true);
  });

  it("uploads a picked image and sends its id alongside the text", async () => {
    uploadFileMock.mockResolvedValue(makeAttachment("abc"));
    const onSend = vi.fn().mockResolvedValue(undefined);
    const { container } = renderWithI18n(<Composer onSend={onSend} conn={conn} />);

    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [png()] } });

    // upload kicks off immediately
    await waitFor(() => expect(uploadFileMock).toHaveBeenCalledTimes(1));

    // type some text and send
    const textarea = container.querySelector<HTMLTextAreaElement>("#composer-input")!;
    fireEvent.change(textarea, { target: { value: "look" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith("look", ["abc"]),
    );
  });

  it("allows sending an image with NO text (text-optional, plan §1)", async () => {
    uploadFileMock.mockResolvedValue(makeAttachment("img1"));
    const onSend = vi.fn().mockResolvedValue(undefined);
    const { container } = renderWithI18n(<Composer onSend={onSend} conn={conn} />);

    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [png()] } });
    await waitFor(() => expect(uploadFileMock).toHaveBeenCalledTimes(1));

    // The send button is NOT disabled even though the textarea is empty.
    const send = screen.getByRole("button", { name: "发送" });
    expect(send).not.toBeDisabled();
    fireEvent.click(send);

    await waitFor(() => expect(onSend).toHaveBeenCalledWith("", ["img1"]));
  });

  it("disables Send while an image is still uploading", () => {
    // Never-resolving upload keeps status === "uploading".
    uploadFileMock.mockReturnValue(new Promise(() => {}));
    const onSend = vi.fn().mockResolvedValue(undefined);
    const { container } = renderWithI18n(<Composer onSend={onSend} conn={conn} />);

    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [png()] } });

    const send = screen.getByRole("button", { name: "发送" });
    expect(send).toBeDisabled();
    // And the hint explains why (uploading status, live region).
    expect(screen.getByText("附件上传中…")).toBeTruthy();
  });

  it("rejects an over-size file with a message naming the limit and the actual size", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const { container } = renderWithI18n(<Composer onSend={onSend} conn={conn} />);

    // 24MB file — over the 10MB cap. validateImageFile rejects before upload.
    const big = new File([new Uint8Array(0)], "big.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: 24 * 1024 * 1024 });

    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [big] } });

    // The localized rejection message must carry BOTH numbers (zh dict).
    await waitFor(() => {
      expect(screen.getByText(/图片不能超过 10MB（这张 24MB）/)).toBeTruthy();
    });
    expect(uploadFileMock).not.toHaveBeenCalled();
  });

  it("rejects a wrong-type file (svg) without uploading", async () => {
    const { container } = renderWithI18n(<Composer onSend={async () => {}} conn={conn} />);
    const svg = new File([new Uint8Array(0)], "a.svg", { type: "image/svg+xml" });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [svg] } });

    await waitFor(() => {
      expect(screen.getByText(/只支持 PNG/)).toBeTruthy();
    });
    expect(uploadFileMock).not.toHaveBeenCalled();
  });

  it("marks a failed upload and lets the user retry", async () => {
    uploadFileMock.mockRejectedValueOnce(new Error("boom"));
    const { container } = renderWithI18n(<Composer onSend={async () => {}} conn={conn} />);

    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [png()] } });
    await waitFor(() => expect(uploadFileMock).toHaveBeenCalledTimes(1));

    // chip now shows error state with a retry button (aria-label localized)
    const retry = await screen.findByLabelText("重新上传图片 1");
    expect(retry).toBeTruthy();

    // retry succeeds
    uploadFileMock.mockResolvedValueOnce(makeAttachment("ok"));
    fireEvent.click(retry);
    await waitFor(() => expect(uploadFileMock).toHaveBeenCalledTimes(2));
  });

  it("does not upload when there is no connection (defensive)", () => {
    const { container } = renderWithI18n(<Composer onSend={async () => {}} conn={null} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [png()] } });
    expect(uploadFileMock).not.toHaveBeenCalled();
  });
});
