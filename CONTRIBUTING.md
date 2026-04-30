# Contributing to ASP

ASP is an open protocol. Contributions are welcome — small fixes, clarifications, schema corrections, conformance tests, and reference-implementation improvements all move the project forward.

This file describes how to propose changes, what bar new changes have to clear, and how the spec is versioned.

## How to propose a change

- **Typos, clarifications, conformance test gaps, reference-impl bugs:** open a pull request directly. Brief description in the PR body.
- **Anything that changes the wire format or normative behavior:** open an issue first to discuss the design before writing code or spec edits. Wire-level decisions are sticky and worth aligning on before drafts get written.
- **Drafts (`drafts/`):** work-in-progress proposals, including the auth profile (`drafts/ASP_AUTH.md`). Substantive changes should still open an issue first; drafts get promoted out of the folder when their design is settled.

## What new changes need

Any change that touches `WHITEPAPER.md`, `schemas/`, or the operator's wire behavior should be accompanied by:

1. **A spec edit** — the textual change in the whitepaper, with section references intact.
2. **A schema update** — `schemas/*.json` updated to match the new wire shape, with `oneOf`/`$defs` entries added or amended.
3. **A conformance test** — a black-box test in `tests/conformance/` that exercises the new behavior. The test runs against any conforming operator, not just the reference impl.
4. **A reference-impl update** — the local operator (`examples/local-operator/`) updated so the conformance suite passes against it.

PRs that update the spec without schemas or tests will be asked to add them. Changes that pass the test suite against the reference impl are not automatically conformant — the suite is the floor, not the ceiling.

## Versioning

ASP versions follow `MAJOR.MINOR.PATCH`.

- **Major** — wire-incompatible change. Existing conforming clients break. New required fields, removed fields, semantic redefinitions. Reserved for changes that cannot be expressed any other way.
- **Minor** — backward-compatible addition. New optional fields old clients can ignore, new event types old clients can route, new endpoints. Conforming clients written against an earlier minor version continue to work.
- **Patch** — clarifications and fixes to spec text that do not change wire behavior. Schema typos, doc improvements, examples added.

The spec, the schemas, and the conformance suite version together. The reference local-operator versions independently — its job is to satisfy whatever the current spec requires.

## Breaking-vs-additive

When in doubt, ask "would a v0.1 client receiving this from a v0.2 operator misbehave?" — if yes, it's breaking. New optional fields are additive; new required fields are breaking; renaming or restructuring existing fields is breaking; tightening the allowed values for an existing field is breaking.

The schema's `additionalProperties` posture matters here. Keep most objects strict (`additionalProperties: false`) so additive changes are explicit at the spec layer rather than slipping in via lax validation.

## Code style

Python: type-annotated, async where I/O is involved. Keep functions short. Comment the *why*, not the *what*. Service logic in `service.py`; storage shape in `store.py`; transport / fan-out in `transport.py`. The reference impl is also pedagogy — it should read cleanly.

TypeScript (`cli/`): TypeScript strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. ESM only. Same layering discipline as the Python reference — routes thin, business rules in services, persistence behind a repository. Comment the *why*, not the *what*.

Schemas: JSON Schema 2020-12. Keep `$defs` flat and named. Prefer `allOf` envelope + `oneOf` discriminator over deeply nested unions.

Conformance tests: each test should narrate exactly what spec invariant it asserts. Cite the section. Failure messages should help the implementer diagnose; "expected 404, got 200" is fine, "the privacy property in §6.2 was violated" is better.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/). Each subject starts with a type, an optional scope, and an imperative summary:

```
feat(cli): add asp start lifecycle management
fix(operator): respect grace window on reconnect
docs(spec): clarify session reopen semantics
```

**Types:** `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`, `ci`, `build`.

**Scopes** name the area of the repo: `cli` (TypeScript reference at `cli/`), `operator` (Python reference at `examples/local-operator/`), `spec` (whitepaper), `schemas`, `conformance`, `drafts`, or omit the scope for repo-wide changes.

A breaking spec or wire change adds a `!` after the type/scope (e.g. `feat(spec)!: ...`) and a `BREAKING CHANGE:` footer with migration notes.

## Reviews

For now, one maintainer (see `README.md`). Substantive design proposals get held open for at least a few days so other implementers can weigh in.
