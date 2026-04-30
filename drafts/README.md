# Drafts

Work-in-progress proposals that aren't yet part of the published ASP spec.

Documents in this folder are explicitly **not normative**. They may change shape, be withdrawn, or be promoted out of `drafts/` once their design is settled. They are not referenced from `WHITEPAPER.md` or treated as a conformance requirement for ASP operators.

## What's here

- **`ASP_AUTH.md`** — a CIBA-like profile for proving that an agent has authority to access a protected external resource, layered on top of ordinary `data` content parts. The whitepaper already establishes (§6.3) that authorization grants ride on `data` payloads; this profile sketches one specific shape.

## How drafts move

A draft becomes part of the spec by being promoted out of this folder, with corresponding additions to `schemas/` and `tests/conformance/` so it has both a wire shape and an executable conformance bar. Until then, the spec stands on its own and a draft's design is up for revision.
