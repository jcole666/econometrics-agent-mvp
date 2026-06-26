# Econometrics Agent Workbench

Desktop-style workbench for the econometrics agent. The project mirrors the `checker` shape with a React/Electron `app/` and a Python FastAPI `sidecar/`.

## Run

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r sidecar\requirements.txt

cd app
npm install
npm run dev
```

In another terminal, start the sidecar when running the web renderer directly:

```powershell
cd desktop-workbench
.\.venv\Scripts\python.exe -m sidecar.serve --port 8768
```

Then open `http://127.0.0.1:5173`.

Electron development:

```powershell
cd desktop-workbench\app
npm run dev
# in another terminal after Vite is running:
npm run dev:electron
```

Build the sidecar executable:

```powershell
cd desktop-workbench
.\scripts\build-sidecar.ps1
```

The build writes the executable to:

```text
sidecar-dist\econometrics-sidecar\econometrics-sidecar.exe
```

## Scope

The first slice supports:

- data profiling for CSV and Excel files
- variable inference from a research question
- model recommendation for OLS, Logit, Panel FE, DID, RDD, and IV-2SLS
- real OLS and Logit execution through statsmodels
- safe business messages for complex models that are not executable yet
- chat fallback and Markdown report generation

`/run-model` does not execute generated code, user scripts, `eval`, or uploaded programs.

## Sensitive Data

Do not store API keys in source files or docs. Use `.env`, environment variables, or an untracked `config.toml`.

Supported environment variables:

```powershell
MAAS_ENABLED=auto
MAAS_BASE_URL=https://api.modelarts-maas.com/openai/v1
MAAS_MODEL=deepseek-v4-pro-IckBJP
MAAS_API_KEY=...
```

## Verification

```powershell
.\.venv\Scripts\python.exe -m compileall sidecar
.\.venv\Scripts\python.exe -m pytest sidecar\tests
cd app
npm run typecheck
```
