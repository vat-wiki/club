// Node-only entry for @club/sdk: everything in the browser-safe main entry,
// PLUS the Node file-upload helpers (uploadImageFile, uploadVideoFile,
// assertImageCount) that read from disk + sniff via image-size / magic bytes.
// Kept behind the `@club/sdk/node` subpath so the main `@club/sdk` entry stays
// free of node:fs / image-size and the web app's browser bundle never tries to
// resolve them.
//
// Node consumers (cli, mcp) should import from "@club/sdk/node".

export * from "./index.js";
export * from "./image-upload.js";
