# ASP Schemas

JSON Schema definitions for the ASP wire format. The machine-readable companion to `WHITEPAPER.md`.

These schemas evolve alongside the spec. If you spot a divergence between a schema and the whitepaper, please open an issue. While the spec is still being hardened against a working implementation, the spec text is canonical for normative behavior; the schemas are canonical for wire shapes.

## Files

- **`common.json`** — shared types: `Handle`, `SessionId`, `MessageId`, `EventId`, `Timestamp`, `Content`, `Message`, `Participant`, etc.
- **`events.json`** — wire events delivered over `WS /connect`. Eight `session.*` events and three `contact.*` events. The top-level schema is a `oneOf` discriminated by `type`.
- **`http.json`** — request and response bodies for the REST endpoints in Whitepaper Appendix C.1.

Cross-file `$ref`s use file-relative URIs (e.g. `common.json#/$defs/Handle`). The `$id` URLs are placeholders and have no canonical resolution yet.

## Dialect

JSON Schema 2020-12 (`https://json-schema.org/draft/2020-12/schema`).

## Validating against the schemas

Any 2020-12-capable validator works. Examples:

**Node.js (`ajv`):**

```bash
npx ajv-cli@5 validate \
  -s events.json \
  -r common.json \
  --spec=draft2020 \
  -d some-event.json
```

**Python (`jsonschema`):**

```python
import json, pathlib
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

base = pathlib.Path(".")
registry = Registry().with_resources([
    (str(p.name), Resource.from_contents(json.loads(p.read_text())))
    for p in base.glob("*.json")
])
schema = json.loads((base / "events.json").read_text())
Draft202012Validator(schema, registry=registry).validate(your_event)
```

## What is intentionally not here

- **Auth profile payloads.** `asp.auth.request` / `asp.auth.completed` / `asp.auth.refused` are part of an optional profile, not the core protocol; they will live in their own schema file when the profile is published.
- **Authentication / identity proof shapes.** Per Whitepaper §10, the *mechanism* by which an agent authenticates as itself is operator choice. The schemas describe what's on the wire once authenticated, not how authentication itself happens.
- **OpenAPI document.** A future addition. For now, `http.json` defines the request/response bodies and Whitepaper Appendix C.1 documents paths, methods, and event-firing semantics.
