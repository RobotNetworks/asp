import { open } from "node:fs/promises";

const READ_CHUNK_BYTES = 8192;

/**
 * Read the last `n` lines of a UTF-8 text file by walking backwards from
 * the end in 8 KiB chunks. Avoids loading large logs entirely into memory
 * and is fast for the common case where the tail of interest is small.
 *
 * Returns the empty string for an empty file. Trailing newlines are
 * preserved verbatim — callers should write the result as-is.
 */
export async function readLastLines(path: string, n: number): Promise<string> {
  if (n <= 0) return "";
  const handle = await open(path, "r");
  try {
    const stat = await handle.stat();
    if (stat.size === 0) return "";

    let pos = stat.size;
    let buffer = "";
    // Stop when we have n+1 newlines (so n+1 segments) or we've read the
    // whole file. The +1 is because the file may not end in a newline.
    let newlineCount = 0;
    while (pos > 0 && newlineCount <= n) {
      const readSize = Math.min(READ_CHUNK_BYTES, pos);
      pos -= readSize;
      const chunk = Buffer.alloc(readSize);
      const { bytesRead } = await handle.read(chunk, 0, readSize, pos);
      buffer = chunk.subarray(0, bytesRead).toString("utf8") + buffer;
      newlineCount = countNewlines(buffer);
    }

    return takeLastLines(buffer, n);
  } finally {
    await handle.close();
  }
}

function countNewlines(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 0x0a) n++;
  }
  return n;
}

/**
 * Take the trailing `n` lines from `buffer`, where a "line" is a string
 * terminated (or, for the very last one, possibly not terminated) by '\n'.
 * Preserves trailing newlines.
 */
export function takeLastLines(buffer: string, n: number): string {
  if (n <= 0 || buffer.length === 0) return "";
  // Indexes of newlines in the buffer.
  const ends: number[] = [];
  for (let i = 0; i < buffer.length; i++) {
    if (buffer.charCodeAt(i) === 0x0a) ends.push(i);
  }
  if (ends.length === 0) return buffer;

  // Count of logical lines: every '\n' terminates one, plus a final
  // unterminated tail if the buffer doesn't end with '\n'.
  const totalSegments = ends.length + (buffer.endsWith("\n") ? 0 : 1);
  if (totalSegments <= n) return buffer;

  // To keep the last n lines we slice from one past the
  // (totalSegments - n - 1)th newline.
  const startNewlineIndex = ends[totalSegments - n - 1];
  if (startNewlineIndex === undefined) return buffer;
  return buffer.slice(startNewlineIndex + 1);
}
