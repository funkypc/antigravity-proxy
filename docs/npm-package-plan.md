# Plan: Convert Antigravity to npm Package

## Goal
Convert the Antigravity proxy into an npm package (`antigravity`) that users install globally and run via `antigravity start`. Supports Windows/macOS/Linux with full onboarding wizard, process management, and all existing features intact.

## Architecture Decision

**Use Commander.js for CLI framework.** Commander gives us help generation, typed options, subcommand routing, version display, and interactive prompts — all for ~200KB with zero transitive dependencies. This is the most battle-tested CLI framework in the npm ecosystem.

**Restructure `proxy/` as the npm package root.** The current `proxy/` directory already contains all source code, dependencies, and the proxy logic. Moving it to root eliminates the nested structure and makes the npm package self-contained.

New structure:
```
antigravity/                  (npm package root)
├── package.json              # name: "antigravity", bin: "./bin/cli.js"
├── bin/
│   └── cli.js                # CLI entry point (hashbang, Commander setup)
├── src/
│   ├── cli/
│   │   ├── commands/
│   │   │   ├── start.ts      # Start proxy + dashboard + browser
│   │   │   ├── stop.ts       # Kill running proxy by PID file
│   │   │   ├── status.ts     # Show proxy status, uptime, ports
│   │   │   ├── health.ts     # Hit /api/health endpoint
│   │   │   ├── config.ts     # Show/set config values
│   │   │   ├── logs.ts       # Tail/view logs
│   │   │   ├── certs.ts      # Generate/trust/renew certs
│   │   │   └── setup.ts      # Onboarding wizard (interactive)
│   │   └── utils/
│   │       ├── port.ts       # Find/kill processes on ports (cross-platform)
│   │       ├── cert.ts       # Cert generation + trust (cross-platform)
│   │       ├── process.ts    # PID file management, start/stop proxy
│   │       └── open.ts       # Cross-platform browser launch
│   ├── (existing proxy code: engine.ts, router.ts, adapters/, plugins/, etc.)
├── dashboard/
│   └── index.html            # Dashboard SPA
├── scripts/
│   └── gen-certs.mjs         # Cert generation (existing)
├── certs/                    # Generated at runtime (gitignored)
├── logs/                     # Runtime logs (gitignored)
├── .env.example              # Template
├── models.json               # Model alias map
├── pricing.json              # Cost data
└── tsconfig.json
```

## Tasks

### T1: Create CLI entry point (`bin/cli.js`)
- Hashbang `#!/usr/bin/env node`
- Parses process.argv for commands: `start`, `stop`, `status`, `health`, `config`, `logs`, `certs`, `setup`, `--help`, `--version`
- Delegates to command modules in `src/cli/commands/`
- Zero dependencies — uses native Node.js arg parsing
- **Verify**: `node bin/cli.js --help` prints usage

### T2: Create `src/cli/utils/port.ts` — Cross-platform port management
- `findProcessesOnPort(port)`: returns PIDs using `netstat` (Windows), `lsof` (macOS), `ss`/`lsof` (Linux)
- `killProcessOnPort(port)`: kills processes on a port gracefully, then force
- `killProcessesOnPorts(ports: number[])`: batch kill for startup cleanup
- `isPortAvailable(port)`: quick check
- **Verify**: Unit test — `isPortAvailable` returns boolean, `findProcessesOnPort` returns array

### T3: Create `src/cli/utils/cert.ts` — Cross-platform cert management
- `generateCerts()`: calls existing `scripts/gen-certs.mjs` logic (import or spawn)
- `certExists()`: checks for `certs/cert.pem` + `certs/key.pem`
- `trustCert()`: platform-specific trust (Windows: certutil/Import-Certificate, macOS: security add-trusted-cert, Linux: update-ca-certificates)
- `getCertInfo()`: returns expiry, fingerprint, days remaining
- **Verify**: `certExists()` returns true after `generateCerts()`

### T4: Create `src/cli/utils/process.ts` — Proxy process management
- `PROXY_PID_FILE`: path to `~/.antigravity/proxy.pid` (or `proxy.pid` in package dir)
- `startProxy(options)`: spawns `node dist/index.js` (or `tsx src/index.ts` in dev) as detached background process, writes PID file
- `stopProxy()`: reads PID file, sends SIGTERM (Unix) / taskkill (Windows)
- `isProxyRunning()`: checks PID file + process alive
- `getProxyPid()`: reads PID file
- Uses `child_process.spawn` with `detached: true`, `stdio: 'ignore'`, `unref()`
- **Verify**: `startProxy()` writes PID file, `stopProxy()` removes it

### T5: Create `src/cli/utils/open.ts` — Cross-platform browser launch
- `openUrl(url)`: `start` (Windows), `open` (macOS), `xdg-open`/`gnome-open` (Linux)
- **Verify**: opens browser on current platform

### T6: Create `src/cli/commands/start.ts` — Main start command
Orchestrates the full startup sequence:
1. Check Node.js version (>=20)
2. Check/install dependencies (if `node_modules` missing, run `npm install --production`)
3. Generate TLS certs if missing (`cert.ts`)
4. Optionally trust certs (`cert.ts`)
5. Kill old processes on ports 443/8443/4000 (`port.ts`)
6. Create `.env` from `.env.example` if missing
7. Create `logs/` directory
8. Build TypeScript if `dist/` missing (`tsc`)
9. Start proxy as background process (`process.ts`)
10. Wait for health endpoint (`/api/health` returns 200)
11. Open dashboard in browser (`open.ts`)
12. Print summary (dashboard URL, proxy URL, log file, PID)
- Options: `--port <port>`, `--no-browser`, `--foreground`, `--trust-cert`
- **Verify**: `antigravity start` launches proxy, opens dashboard, prints URLs

### T7: Create `src/cli/commands/stop.ts`
- Read PID file, kill process, remove PID file
- Also kill by port as fallback
- **Verify**: `antigravity stop` stops proxy, port freed

### T8: Create `src/cli/commands/status.ts`
- Check if proxy running (PID file + process alive)
- Hit `/api/health` for uptime/status
- Show ports, provider config, dashboard URL
- **Verify**: `antigravity status` prints running/stopped + config

### T9: Create `src/cli/commands/health.ts`
- Hit `http://localhost:4000/api/health`
- Print response JSON (status, uptime, timestamp)
- **Verify**: `antigravity health` returns health data

### T10: Create `src/cli/commands/config.ts`
- `antigravity config` — show current config
- `antigravity config set <key> <value>` — update .env
- `antigravity config get <key>` — show specific value
- **Verify**: config commands read/write .env correctly

### T11: Create `src/cli/commands/logs.ts`
- `antigravity logs` — tail latest log file
- `antigravity logs list` — list all log files
- `antigravity logs show <file>` — show specific log
- **Verify**: logs command outputs log content

### T12: Create `src/cli/commands/certs.ts`
- `antigravity certs` — show cert info (expiry, fingerprint)
- `antigravity certs generate` — regenerate certs
- `antigravity certs trust` — install cert to OS trust store
- **Verify**: certs commands work on current platform

### T13: Create `src/cli/commands/setup.ts` — Onboarding wizard
Interactive readline-based wizard:
1. Welcome message + what Antigravity does
2. Select primary provider (OpenRouter, NVIDIA, OpenAI, Anthropic, Groq, Google, Ollama)
3. Prompt for API key (masked input, validated with API call if possible)
4. Select proxy port (443 default, suggest 8443 if not admin)
5. Toggle features: dashboard auth, rate limiting, context strip mode, auto-trust certs
6. Write `.env` with all selections
7. Offer to start proxy immediately
- **Verify**: `antigravity setup` creates valid .env with user selections

### T14: Create `bin/cli.js` dispatcher
- Wire all commands together
- Handle `--version` from package.json
- Handle unknown commands with helpful error
- **Verify**: All subcommands accessible via `antigravity <cmd>`

### T15: Update `package.json` for npm distribution
- `name`: `"antigravity"`
- `version`: `"1.0.0"`
- `bin`: `{ "antigravity": "./bin/cli.js" }`
- `files`: `["bin/", "src/", "dashboard/", "scripts/", "models.json", "pricing.json", ".env.example", "tsconfig.json"]`
- `scripts.build`: `"tsc"`
- `scripts.prepublishOnly`: `"npm run build"`
- `main`: `"src/index.ts"` (or `"dist/index.js"` after build)
- Add `shebang` in bin/cli.js
- Handle `better-sqlite3` as optional/prebuilt dependency
- **Verify**: `npm pack` produces correct tarball, `npm install -g .` works

### T16: Update tsconfig.json
- Ensure output to `dist/` with correct module settings
- Include `src/cli/` in compilation
- **Verify**: `npm run build` compiles everything including CLI

### T17: Preserve backward compatibility
- Keep `start.sh` and `start.ps1` at root (updated to point to new structure)
- Keep existing proxy features untouched (engine, router, adapters, plugins, dashboard)
- All existing `.env` variables continue to work
- **Verify**: existing `npm run dev` still works for development

### T18: Update .gitignore for npm package
- Ignore `dist/`, `node_modules/`, `certs/`, `logs/`, `.env`, `*.tgz`
- **Verify**: `npm pack --dry-run` shows correct file list

### T19: Validate — typecheck + test
- Run `npm run typecheck` — all files compile
- Run `npm test` — all 126 existing tests pass
- Run `npm run build` — dist/ produced
- **Verify**: Clean build, no type errors, tests pass

## Done When
- `npm install -g .` installs the package globally
- `antigravity --help` shows all commands
- `antigravity setup` runs onboarding wizard, creates .env
- `antigravity start` launches proxy + dashboard (all features work)
- `antigravity stop` stops proxy cleanly
- `antigravity status` shows running state
- `antigravity health` returns health check
- `antigravity config` shows/edits config
- `antigravity logs` tails logs
- `antigravity certs` manages certificates
- All 126 existing tests still pass
- Works on Windows, macOS, Linux

## Notes
- The existing `proxy/` directory becomes the npm package root — no code duplication
- `better-sqlite3` is a native dependency; npm handles prebuilt binaries for all platforms
- The CLI runs the proxy as a background detached process (same as current start scripts)
- The onboarding wizard uses Node.js readline (no extra dependencies)
- No new runtime dependencies added — all CLI logic uses Node.js built-ins
