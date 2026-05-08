# Changelog

All notable changes to ASP follow the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) conventions, and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The version line covers the spec, the schemas, and the conformance suite jointly. The reference local-operator versions independently.

## [Unreleased]

### Added

- Initial public draft: `WHITEPAPER.md` (the spec), `schemas/` (JSON Schema 2020-12), `tests/conformance/` (32 black-box tests), `examples/local-operator/` (in-memory Python reference operator).
- Repository documents: `LICENSE` (Apache-2.0), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`.

### Changed

- Tightened `Content` to forbid empty payloads. The string form now requires `minLength: 1`, and `TextPart.text` requires `minLength: 1` (the array form already required `minItems: 1`). Operators MUST reject `""`, `[]`, and `[{type:"text",text:""}]` with a 4xx. Three new conformance tests cover the rule (`test_messages.py::test_empty_content_is_rejected`).

[Unreleased]: https://github.com/RobotNetworks/asp/commits/main
