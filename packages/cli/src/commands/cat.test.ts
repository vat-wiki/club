import { afterEach,describe, expect, it, vi } from "vitest";

import { type CatDeps,runCat } from "./cat.js";

const SERVER = "https://club.example.com";
const ID = "file_abc123";
const URL = `${SERVER}/files/${ID}`;

function freshDeps(): CatDeps {
  return {
    server: SERVER,
    readFileContent: vi.fn(),
    getFile: vi.fn(),
  };
}

describe("runCat default (URL) output", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints the download URL when no flag is set", async () => {
    const deps = freshDeps();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runCat(ID, { content: false, raw: false, meta: false }, deps);
    expect(log).toHaveBeenCalledWith(URL);
    expect(deps.readFileContent).not.toHaveBeenCalled();
    expect(deps.getFile).not.toHaveBeenCalled();
  });

  it("trims whitespace from the file id before constructing the URL", async () => {
    const deps = freshDeps();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runCat("  " + ID + "  ", { content: false, raw: false, meta: false }, deps);
    expect(log).toHaveBeenCalledWith(URL);
  });

  it("rejects an empty id after trimming", async () => {
    const deps = freshDeps();
    await expect(runCat("   ", { content: false, raw: false, meta: false }, deps))
      .rejects.toThrow("file id required");
  });
});

describe("runCat --meta", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits JSON with mime, format, filename, textLength, metadata", async () => {
    const deps = freshDeps();
    const parsed = {
      text: "hello world",
      format: "txt",
      mime: "text/plain",
      filename: "notes.txt",
      metadata: { title: "Notes" },
    };
    deps.readFileContent.mockResolvedValue(parsed);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCat(ID, { content: false, raw: false, meta: true }, deps);

    const emitted = JSON.parse(log.mock.calls[0][0]);
    expect(emitted.id).toBe(ID);
    expect(emitted.url).toBe(URL);
    expect(emitted.mime).toBe("text/plain");
    expect(emitted.filename).toBe("notes.txt");
    expect(emitted.format).toBe("txt");
    expect(emitted.textLength).toBe(11);
    expect(emitted.metadata).toEqual({ title: "Notes" });
    expect(deps.getFile).not.toHaveBeenCalled();
  });

  it("omits metadata key when readFileContent returns no metadata", async () => {
    const deps = freshDeps();
    deps.readFileContent.mockResolvedValue({
      text: "a",
      format: "bin",
      mime: "application/octet-stream",
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runCat(ID, { content: false, raw: false, meta: true }, deps);
    const emitted = JSON.parse(log.mock.calls[0][0]);
    expect(emitted.metadata).toBeUndefined();
  });
});

describe("runCat --content", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("streams parsed text to stdout without trailing newline", async () => {
    const deps = freshDeps();
    const parsed = {
      text: "doc line one\ndoc line two",
      format: "md",
      mime: "text/markdown",
    };
    deps.readFileContent.mockResolvedValue(parsed);
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCat(ID, { content: true, raw: false, meta: false }, deps);

    expect(write).toHaveBeenCalledWith("doc line one\ndoc line two");
    expect(deps.getFile).not.toHaveBeenCalled();
  });
});

describe("runCat --raw", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("streams base64 of the binary buffer to stdout", async () => {
    const deps = freshDeps();
    const buffer = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
    deps.getFile.mockResolvedValue({ buffer });
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCat(ID, { content: false, raw: true, meta: false }, deps);

    // PNG magic bytes 0x89 0x50 0x4E 0x47 → "iVBORw=="
    expect(write).toHaveBeenCalledWith("iVBORw==");
    expect(deps.readFileContent).not.toHaveBeenCalled();
  });
});

describe("runCat error propagation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards readFileContent errors to the caller", async () => {
    const deps = freshDeps();
    deps.readFileContent.mockRejectedValue(new Error("404 not found"));
    await expect(
      runCat(ID, { content: true, raw: false, meta: false }, deps),
    ).rejects.toThrow("404 not found");
  });

  it("forwards getFile errors to the caller", async () => {
    const deps = freshDeps();
    deps.getFile.mockRejectedValue(new Error("network unreachable"));
    await expect(
      runCat(ID, { content: false, raw: true, meta: false }, deps),
    ).rejects.toThrow("network unreachable");
  });
});
