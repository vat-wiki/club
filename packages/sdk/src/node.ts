// Node-only entry for @vatwiki/sdk: everything in the browser-safe main entry,
// PLUS the Node file-upload helpers (uploadImageFile, uploadVideoFile,
// assertAttachmentCount) that read from disk + sniff via image-size / magic bytes.
// Kept behind the `@vatwiki/sdk/node` subpath so the main `@vatwiki/sdk` entry stays
// free of node:fs / image-size and the web app's browser bundle never tries to
// resolve them.
//
// Node consumers (cli, mcp) should import from "@vatwiki/sdk/node".

export * from "./file-parser.js";
export * from "./image-upload.js";
export * from "./index.js";
