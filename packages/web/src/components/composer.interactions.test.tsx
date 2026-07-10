import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { MessageAttachment } from "@club/shared";
import type { ClubConn } from "@club/sdk";

// Composer input-path coverage that complements composer.test.tsx: paste
// (mixed text+image, image-only), drop (image, non-image ignored), the
// MAX_IMAGES_PER_MESSAGE client-side cap, and revokeObjectURL lifecycle on send
// + remove. These exercise the onPaste/onDrop/addFiles paths the existing file
// doesn't reach (it only drives the hidden file input via fireEvent.change).

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
  return { id, url: `/files/${id}`, mime: "image/png", width: 100, height: 100, size: 100 };
}

const revokeSpy = vi.fn();
beforeEach(() => {
  uploadFileMock.mockReset();
  revokeSpy.mockReset();
  // Make createObjectURL deterministic AND spy revokeObjectURL so we can assert
  // the lifecycle (revoke on remove / send / unmount) without leaking.
  Object.defineProperty(URL, "createObjectURL", {
    value: vi.fn((f: File) => `blob:${f.name}`),
    configurable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: revokeSpy,
    configurable: true,
  });
});

// Build a synthetic paste event carrying both a text string and an image file.
function pasteEvent(text: string, files: File[]) {
  const items = [
    { kind: "string", type: "text/plain", getAsString: (cb: (s: string) => void) => cb(text) },
    ...files.map((f) => ({
      kind: "file",
      type: f.type,
      getAsFile: () => f,
    })),
  ];
  const clipboardData = {
    items,
    files: files as unknown as FileList,
    types: ["text/plain", ...files.length ? ["Files"] : []],
    getData: (t: string) => (t === "text/plain" ? text : ""),
  };
  return { clipboardData } as unknown as React.ClipboardEvent<HTMLTextAreaElement>;
}

// Build a synthetic drop event carrying the given files.
function dropEvent(files: File[]) {
  const dt = {
    files: files as unknown as FileList,
    types: files.length ? ["Files"] : [],
    items: files.map((f) => ({ kind: "file", type: f.type, getAsFile: () => f })),
  };
  return {
    dataTransfer: dt,
    preventDefault: vi.fn(),
  } as unknown as React.DragEvent<HTMLDivElement>;
}

describe("Composer — paste", () => {
  it("routes a pasted image to the preview and starts uploading it", async () => {
    uploadFileMock.mockResolvedValue(makeAttachment("p1"));
    renderWithI18n(<Composer onSend={async () => {}} conn={conn} />);
    const textarea = screen.getByTestId("composer-input");

    fireEvent.paste(textarea, pasteEvent("", [png("paste.png")]));
    await waitFor(() => expect(uploadFileMock).toHaveBeenCalledTimes(1));
    // A chip row appears (the attachment was accepted).
    expect(screen.getByTestId("composer-attachments")).toBeTruthy();
  });

  it("on paste of text+image: image becomes a draft, text is left for the textarea default", async () => {
    // The composer's onPaste only preventDefaults when an image is present; the
    // text part is NOT auto-inserted by the handler (no preventDefault on the
    // text-only branch). With an image present the whole paste is intercepted
    // (preventDefault), so the text is NOT inserted into the textarea — only
    // the image becomes a draft. This pins that contract: mixed paste yields an
    // image chip and an EMPTY textarea (the user types the text separately).
    uploadFileMock.mockResolvedValue(makeAttachment("mix1"));
    renderWithI18n(<Composer onSend={async () => {}} conn={conn} />);
    const textarea = screen.getByTestId("composer-input") as HTMLTextAreaElement;

    fireEvent.paste(textarea, pasteEvent("some text", [png("mix.png")]));
    await waitFor(() => expect(uploadFileMock).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("composer-attachments")).toBeTruthy();
    // Textarea stays empty: the paste was fully intercepted for the image.
    expect(textarea.value).toBe("");
  });

  it("does not intercept a plain-text paste (no image)", () => {
    const onSend = vi.fn();
    renderWithI18n(<Composer onSend={onSend} conn={conn} />);
    const textarea = screen.getByTestId("composer-input");
    // A text-only paste: no chip row, no upload.
    fireEvent.paste(textarea, pasteEvent("just words", []));
    expect(uploadFileMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("composer-attachments")).toBeNull();
  });
});

describe("Composer — drop", () => {
  it("accepts a dropped image file and uploads it", async () => {
    uploadFileMock.mockResolvedValue(makeAttachment("d1"));
    const { container } = renderWithI18n(<Composer onSend={async () => {}} conn={conn} />);
    // The drop target is the flex row container.
    const dropZone = container.querySelector(
      '[class*="focus-within:border-agent"]',
    ) as HTMLElement;

    fireEvent.drop(dropZone, dropEvent([png("drop.png")]));
    await waitFor(() => expect(uploadFileMock).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("composer-attachments")).toBeTruthy();
  });

  it("ignores a dropped non-image file (no chip, no upload)", () => {
    const { container } = renderWithI18n(<Composer onSend={async () => {}} conn={conn} />);
    const dropZone = container.querySelector(
      '[class*="focus-within:border-agent"]',
    ) as HTMLElement;
    const txt = new File([new Uint8Array(4)], "notes.txt", { type: "text/plain" });

    fireEvent.drop(dropZone, dropEvent([txt]));
    expect(uploadFileMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("composer-attachments")).toBeNull();
  });

  it("ignores a drop event with no files (e.g. text/HTML drag)", () => {
    const { container } = renderWithI18n(<Composer onSend={async () => {}} conn={conn} />);
    const dropZone = container.querySelector(
      '[class*="focus-within:border-agent"]',
    ) as HTMLElement;
    // Empty file list — early return, no preventDefault call on the event.
    const evt = dropEvent([]);
    fireEvent.drop(dropZone, evt);
    expect(uploadFileMock).not.toHaveBeenCalled();
  });
});

describe("Composer — client-side image count cap (MAX_IMAGES_PER_MESSAGE = 8)", () => {
  it("caps accepted drafts at 8 and announces the cap when more are added", async () => {
    uploadFileMock.mockResolvedValue(makeAttachment("id"));
    const { container } = renderWithI18n(<Composer onSend={async () => {}} conn={conn} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;

    // Pick 8 images first — all accepted.
    fireEvent.change(input, { target: { files: Array.from({ length: 8 }, (_, i) => png(`a${i}.png`)) } });
    await waitFor(() => expect(uploadFileMock).toHaveBeenCalledTimes(8));
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);

    // A 9th pick is rejected with the localized "too many" message; no 9th upload.
    uploadFileMock.mockClear();
    fireEvent.change(input, { target: { files: [png("ninth.png")] } });
    await waitFor(() => {
      expect(screen.getByText(/最多 8 个附件/)).toBeTruthy();
    });
    expect(uploadFileMock).not.toHaveBeenCalled();
  });
});

describe("Composer — revokeObjectURL lifecycle", () => {
  it("revokes the blob URL when a draft is removed", async () => {
    uploadFileMock.mockResolvedValue(makeAttachment("r1"));
    const { container } = renderWithI18n(<Composer onSend={async () => {}} conn={conn} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [png("rm.png")] } });
    await waitFor(() => expect(uploadFileMock).toHaveBeenCalledTimes(1));

    // Click the chip's remove button (localized aria-label).
    const removeBtn = await screen.findByLabelText("移除图片 1");
    fireEvent.click(removeBtn);

    expect(revokeSpy).toHaveBeenCalledWith("blob:rm.png");
    expect(screen.queryByTestId("composer-attachments")).toBeNull();
  });

  it("revokes blob URLs after a successful send", async () => {
    uploadFileMock.mockResolvedValue(makeAttachment("s1"));
    const onSend = vi.fn().mockResolvedValue(undefined);
    const { container } = renderWithI18n(<Composer onSend={onSend} conn={conn} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [png("send.png")] } });
    await waitFor(() => expect(uploadFileMock).toHaveBeenCalledTimes(1));

    // Pure-image send (no text): the done attachment makes send enabled.
    fireEvent.click(screen.getByTestId("composer-send-button"));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("", ["s1"]));

    // The blob URL created for the chip must be revoked on success.
    expect(revokeSpy).toHaveBeenCalledWith("blob:send.png");
    expect(screen.queryByTestId("composer-attachments")).toBeNull();
  });

  it("revokes remaining blob URLs on unmount (mid-upload teardown)", async () => {
    // Never-resolving upload keeps the draft in "uploading"; unmounting mid-
    // flight must still revoke the objectUrl to avoid a leak.
    uploadFileMock.mockReturnValue(new Promise(() => {}));
    const { container, unmount } = renderWithI18n(
      <Composer onSend={async () => {}} conn={conn} />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [png("leak.png")] } });
    await waitFor(() => expect(uploadFileMock).toHaveBeenCalledTimes(1));

    unmount();
    expect(revokeSpy).toHaveBeenCalledWith("blob:leak.png");
  });
});
