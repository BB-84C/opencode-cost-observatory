# OpenCode Cost Observatory

Cost Observatory gives OpenCode users a local analytics view of token spend, model mix, and pricing coverage.
It keeps data on your machine while helping you understand where AI coding costs come from.

## Status and scope

- This repository is a source-only GitHub release.
- Current support target is Windows + PowerShell 7+.
- The tool reads a local OpenCode database and builds a local analytics database for dashboard use.
- Launcher integration with `opencode --usage` is optional and user-managed.

## Prerequisites

- Node 22+
- npm
- PowerShell 7+
- A local OpenCode installation with a readable OpenCode SQLite database

## Install dependencies

```powershell
npm ci
```

## Configuration

Create runtime config with either of these files:

- copy `.env.example` to `.env`
- or copy `dashboard.config.example.json` to `dashboard.config.json`

After copying, edit the file so `OPENCODE_DB_PATH` / `opencodeDbPath` point at your local OpenCode SQLite database.

Config precedence is:

1. process environment variables
2. `.env`
3. `dashboard.config.json`

For localhost auth, provide either:

- `DASHBOARD_TOKEN`
- or `DASHBOARD_TOKEN_FILE`

## Run the backend

```powershell
pwsh -File .\bootstrap.ps1 start
```

## Check backend status

```powershell
pwsh -File .\bootstrap.ps1 status
```

## Stop backend

```powershell
pwsh -File .\bootstrap.ps1 stop
```

## Run the frontend

```powershell
npm run dev
```

The default frontend URL is `http://127.0.0.1:41778`.

The browser UI is served separately from the backend during development.

## Build

```powershell
npm run build
```

Note: the current build only emits the client bundle.

## Typecheck

```powershell
npm run check
```

## Optional `opencode --usage` integration

This repository does **not** install or manage your personal `opencode` launcher.

If you want `opencode --usage` to start the observatory, create and maintain your own launcher file at a path appropriate for your local OpenCode installation, for example:

`C:\Users\<your-user>\.config\opencode\bin\opencode.cmd`

Minimal example:

```cmd
@echo off
if /I "%~1"=="--usage" (
  pwsh -NoProfile -NoLogo -File "<path-to-this-repo>\scripts\opencode-usage.ps1"
  exit /b %ERRORLEVEL%
)
call "<path-to-real-opencode.cmd>" %*
exit /b %ERRORLEVEL%
```

That launcher is outside the managed surface of this repo.

## Privacy and local data

- `.run/` contains local runtime state, logs, auth tokens, and analytics data.
- Do not commit `.run/`, local databases, or local tokens.
- Browser auth is localhost-only and token-based.
