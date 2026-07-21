import { describe, expect,it } from "vitest";

import { parseFileContent } from "./file-parser.js";

const encoder = new TextEncoder();
function buf(text: string) {
  return encoder.encode(text).buffer;
}

describe("parseFileContent — text MIME path", () => {
  it("decodes plain text verbatim", async () => {
    const r = await parseFileContent(buf("hello world"), "text/plain");
    expect(r).toEqual({ text: "hello world", format: "text/plain" });
  });

  it("decodes markdown as-is", async () => {
    const markdown = "# Heading\n\n- item";
    const r = await parseFileContent(buf(markdown), "text/markdown");
    expect(r).toEqual({ text: markdown, format: "text/markdown" });
  });

  it("decodes HTML as-is", async () => {
    const html = "<div>hi</div>";
    const r = await parseFileContent(buf(html), "text/html");
    expect(r).toEqual({ text: html, format: "text/html" });
  });

  it("decodes CSV as-is", async () => {
    const csv = "a,b,c\n1,2,3";
    const r = await parseFileContent(buf(csv), "text/csv");
    expect(r).toEqual({ text: csv, format: "text/csv" });
  });

  it("decodes XML as-is", async () => {
    const xml = "<root><x/></root>";
    const r = await parseFileContent(buf(xml), "text/xml");
    expect(r).toEqual({ text: xml, format: "text/xml" });
  });

  it("pretty-prints valid JSON", async () => {
    const raw = JSON.stringify({ a: 1, b: [2, 3] });
    const r = await parseFileContent(buf(raw), "application/json");
    expect(r).toEqual({
      text: JSON.stringify({ a: 1, b: [2, 3] }, null, 2),
      format: "json",
    });
  });

  it("passes invalid JSON through as plain text but keeps json tag", async () => {
    const bad = "{ not json";
    const r = await parseFileContent(buf(bad), "application/json");
    expect(r).toEqual({ text: bad, format: "json" });
  });

  it("preserves BOM and non-ASCII UTF-8 bytes (native TextDecoder strips BOM as per Unicode standard)", async () => {
    const text = "\uFEFFcafé — über";
    const r = await parseFileContent(buf(text), "text/plain");
    // TextDecoder strips the BOM per spec; verify the non-ASCII bytes survive intact.
    expect(r.text).toBe("café — über");
    expect(r.format).toBe("text/plain");
  });

  it("handles an empty buffer as empty string", async () => {
    const r = await parseFileContent(new ArrayBuffer(0), "text/plain");
    expect(r).toEqual({ text: "", format: "text/plain" });
  });

  it("ignores the optional filename argument (no-op)", async () => {
    const r = await parseFileContent(buf("hi"), "text/plain", "notes.txt");
    expect(r).toEqual({ text: "hi", format: "text/plain" });
    expect(r.metadata).toBeUndefined();
  });

  it("preserves internal whitespace in text files", async () => {
    const text = "line one\n   indented\nline three";
    const r = await parseFileContent(buf(text), "text/plain");
    expect(r.text).toBe(text);
  });
});

describe("parseFileContent — binary fallback", () => {
  it("returns a descriptive placeholder for an unrecognised MIME", async () => {
    const r = await parseFileContent(
      new Uint8Array([0x00, 0x01, 0x02]).buffer,
      "image/png",
    );
    expect(r).toEqual({
      text: "[Binary file: image/png, size: 3 bytes]",
      format: "image/png",
    });
  });

  it("surfaces actual ArrayBuffer size in the fallback message", async () => {
    const r = await parseFileContent(
      new Uint8Array(1024).fill(0xff).buffer,
      "application/octet-stream",
    );
    expect(r.text).toBe("[Binary file: application/octet-stream, size: 1024 bytes]");
  });
});

describe("parseFileContent — format tag for text sub-types", () => {
  it.each(["text/plain", "text/html", "text/css", "text/csv", "text/xml", "text/markdown"] as const)(
    "uses `%s` as the format tag for text files",
    async (mime) => {
      const r = await parseFileContent(buf("x"), mime);
      expect(r.format).toBe(mime);
    },
  );
});
