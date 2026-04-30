#!/usr/bin/env node
import("../dist/cli.js").then(({ run }) => run(process.argv)).catch((err) => {
  // Last-resort handler: anything reaching here is a bug in cli.ts's own error
  // handling. Print a short message and a non-zero exit so CI catches it.
  process.stderr.write(`asp: fatal: ${err?.message ?? err}\n`);
  process.exit(1);
});
