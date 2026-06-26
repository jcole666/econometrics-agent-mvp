from __future__ import annotations

import argparse

import uvicorn

from sidecar.api import app


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the econometrics workbench sidecar.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8768)
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()

    target = "sidecar.api:app" if args.reload else app
    uvicorn.run(target, host=args.host, port=args.port, reload=args.reload)


if __name__ == "__main__":
    main()
