"""Run the operator: `python -m operator`."""

from __future__ import annotations

import json
import os
import pathlib

import uvicorn

from .app import create_app


def main() -> None:
    seed_path = pathlib.Path(
        os.environ.get("ASP_SEED", pathlib.Path(__file__).resolve().parents[1] / "seed.json")
    )
    if not seed_path.exists():
        raise SystemExit(f"seed file not found: {seed_path}")
    seed = json.loads(seed_path.read_text())

    host = os.environ.get("ASP_HOST", "127.0.0.1")
    port = int(os.environ.get("ASP_PORT", "8080"))
    app = create_app(seed=seed)
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
