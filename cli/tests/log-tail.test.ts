import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { readLastLines, takeLastLines } from "../src/log-tail.js";

describe("log-tail/takeLastLines", () => {
  it("returns empty for n<=0 or empty input", () => {
    assert.equal(takeLastLines("", 5), "");
    assert.equal(takeLastLines("a\nb\n", 0), "");
    assert.equal(takeLastLines("a\nb\n", -1), "");
  });

  it("returns the whole buffer if it has fewer than n lines", () => {
    assert.equal(takeLastLines("one\ntwo\n", 5), "one\ntwo\n");
    assert.equal(takeLastLines("one", 5), "one");
  });

  it("returns exactly the last n lines preserving trailing newline", () => {
    assert.equal(takeLastLines("a\nb\nc\nd\n", 2), "c\nd\n");
  });

  it("returns the last n lines for a buffer without a trailing newline", () => {
    assert.equal(takeLastLines("a\nb\nc", 2), "b\nc");
  });
});

describe("log-tail/readLastLines", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "asp-tail-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns empty string for an empty file", async () => {
    const p = join(dir, "log");
    await writeFile(p, "", "utf8");
    assert.equal(await readLastLines(p, 10), "");
  });

  it("returns the whole content if the file has fewer than n lines", async () => {
    const p = join(dir, "log");
    await writeFile(p, "one\ntwo\n", "utf8");
    assert.equal(await readLastLines(p, 10), "one\ntwo\n");
  });

  it("reads exactly the last n lines from a small file", async () => {
    const p = join(dir, "log");
    await writeFile(p, "a\nb\nc\nd\ne\n", "utf8");
    assert.equal(await readLastLines(p, 2), "d\ne\n");
  });

  it("handles files larger than the read chunk size", async () => {
    const p = join(dir, "log");
    // Generate ~200 KiB of content so the backwards reader makes multiple passes.
    const lines: string[] = [];
    for (let i = 0; i < 20_000; i++) lines.push(`line-${i}`);
    await writeFile(p, `${lines.join("\n")}\n`, "utf8");

    const tail = await readLastLines(p, 3);
    assert.equal(tail, "line-19997\nline-19998\nline-19999\n");
  });

  it("returns empty for n<=0 even on a populated file", async () => {
    const p = join(dir, "log");
    await writeFile(p, "a\nb\n", "utf8");
    assert.equal(await readLastLines(p, 0), "");
  });
});
