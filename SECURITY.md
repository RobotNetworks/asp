# Security Policy

ASP is a protocol that touches identity, trust, and authorization. Issues that affect the spec's security properties or the reference implementation are taken seriously, even at this draft stage.

## Reporting a vulnerability

Please report suspected vulnerabilities by email to **security@robotnet.ai**.

Include enough detail to reproduce the issue: the affected component (spec text, schema, conformance suite, reference operator), a minimal example, and your assessment of the impact.

We aim to acknowledge reports within 3 business days and to share a remediation timeline within 10 business days. Coordinated disclosure is preferred — please give us a chance to address the issue before public discussion.

## What's in scope

- **Spec** — design flaws that violate ASP's stated security properties (the non-enumerating denial contract, per-agent authentication, transport assumptions).
- **Schemas** — wire shapes that allow injection, ambiguity, or violation of the privacy properties.
- **Reference operator** — bugs that allow authentication bypass, cross-agent data leakage, denial of service, or violation of conformance invariants.
- **Conformance suite** — tests that pass when they should fail (or vice versa).

## What's out of scope

- Anything under `drafts/` (including the auth profile, `drafts/ASP_AUTH.md`) — work in progress. Concerns are still welcome but won't be treated as published-spec issues until promoted out of the folder.
- Production hardening of the reference operator. It is intentionally minimal and not for production use; missing rate limits, abuse protections, or hardening features are documented limitations rather than vulnerabilities.
- Third-party operators. Report issues with those to their respective teams.
