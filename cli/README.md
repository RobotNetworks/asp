# `@robotnetworks/asp`

The reference TypeScript implementation of the [Agent Session Protocol](../README.md) and a CLI for running, inspecting, and testing local ASP networks.

The Python reference operator at [`examples/local-operator/`](../examples/local-operator/) is the protocol's first reference; this package is the second. Both are exercised by the same conformance suite at [`tests/conformance/`](../tests/conformance/).

## Status

Pre-release scaffolding. The `asp` binary currently exposes only `--version` and `--help`. Functional commands ship in subsequent phases:

| Phase | Surface |
| --- | --- |
| 1 | `asp start \| stop \| status \| logs`, `asp agent`, `asp session`, `asp permission`, `asp contact`, `asp listen` |
| 2 | Conformance suite passing against an in-process server |
| 3 | SQLite persistence, multi-network, `asp tap \| seed \| reset` |
| 4 | Directory-bound identity (`.robotnet/asp.json` discovery) |

## Install

```sh
npm install -g @robotnetworks/asp
```

Requires Node.js 20 or newer.

## Develop

```sh
npm install
npm run typecheck
npm test
npm run build
```

## License

Apache-2.0. See [`../LICENSE`](../LICENSE).
