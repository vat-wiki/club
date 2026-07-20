// Read a message body from stdin. Extracted from commands/send.ts so the edge
// cases — an interactive terminal with no piped input, and stream read errors —
// are unit-testable with a fake stream instead of the real process.stdin.

// A minimal slice of a Node readable stream — broad enough that process.stdin
// satisfies it, narrow enough to fake in a test.
export interface ReadableLike {
  /** True when stdin is an interactive terminal (i.e. nothing is piped in). */
  isTTY?: boolean;
  setEncoding(encoding: BufferEncoding | undefined): void;
  on(event: "data", listener: (chunk: Buffer) => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  on(event: "end", listener: () => void): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
}

/**
 * Read a stream to a string. Rejects (rather than hanging forever) when:
 *  - the stream is a TTY (`--stdin` was passed but nothing is piped in), or
 *  - the stream emits an 'error'.
 * Resolves with the concatenated chunks on 'end'.
 */
export function readStream(stream: ReadableLike): Promise<string> {
  return new Promise((resolve, reject) => {
    if (stream.isTTY) {
      reject(
        new Error(
          "--stdin requires piped input (e.g. `echo hi | club send --stdin`); stdin is an interactive terminal",
        ),
      );
      return;
    }
    let data = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      data += String(chunk);
    });
    stream.on("end", () => resolve(data));
    stream.on("error", (err) => reject(err));
  });
}
