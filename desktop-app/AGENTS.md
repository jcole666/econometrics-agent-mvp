# Local Instructions

- Do not bulk delete files or directories.
- Do not use `del /s`, `rd /s`, `rmdir /s`, `Remove-Item -Recurse`, or `rm -rf`.
- If a file must be deleted, delete one explicit file path at a time.
- Keep API keys in `.env`, environment variables, or a local `config.toml`.
- Do not copy credentials from source documents into code, tests, docs, or examples.
- Keep generated artifacts out of git: `.venv`, `node_modules`, `dist`, `dist-electron`, caches, and local logs.
