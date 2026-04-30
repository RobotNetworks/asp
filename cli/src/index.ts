/**
 * Programmatic entry point for `@robotnetworks/asp`.
 *
 * The package's primary use is the `asp` CLI (see `bin/asp.js`). This module
 * re-exports a small surface for tests and embedders that need to drive the
 * CLI or, in later phases, start an in-process ASP server without spawning.
 */
export { buildProgram, run } from "./cli.js";
export { PACKAGE_VERSION } from "./version.js";
