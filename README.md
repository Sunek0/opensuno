# OpenSuno

> Open-source Suno AI API with Chrome Extension bridge — zero-config auth & automatic captcha bypass.
> Built with Claude Code & Paean AI.

Two modes of operation: **Bridge Mode** (Chrome Extension — recommended) and **Cookie Mode** (server-side).

## Why OpenSuno?

**Problem 1**: Suno's API relies on Clerk sessions for authentication, but Clerk frequently returns empty sessions (`sessions: []`), causing 401 Unauthorized errors.

**Problem 2**: Suno's API requires hCaptcha for music generation when an account has consumed fewer than ~200 credits. Server-side approaches fail with "Token validation failed" (422) because they can't provide a valid captcha token.

**Solution**: OpenSuno offers two approaches:
- **Bridge Mode** (Recommended) — A Chrome extension runs on suno.com, making API calls FROM the browser context. Authentication and captcha are handled natively. A local bridge server exposes REST API + MCP interfaces, forwarding requests to the extension via WebSocket.
- **Cookie Mode** — Extract JWT tokens from the browser (works but requires manual token refresh and may hit captcha blocks)

## Features

- **Chrome Extension + Bridge Server** — zero-config auth, automatic captcha bypass, no token expiry
- **MCP server** — use as a tool provider for Claude Desktop, Cursor, or any MCP-compatible AI agent
- Direct JWT Token authentication (Cookie Mode) — extract from browser Network tab
- All Suno model versions supported (V4 / V4.5+ / V4.5 Pro / V5)
- OpenAI-compatible `/v1/chat/completions` endpoint
- Web-based cookie management UI at `/cookie`
- One-click Vercel deployment (Cookie Mode)

## Bridge Mode (Recommended)

Bridge Mode uses a Chrome extension + local bridge server. The extension runs on your open suno.com tab, handling authentication and captcha natively. External clients (curl, AI agents) talk to the bridge server, which forwards requests to the extension via WebSocket.

### Architecture

```
External Clients (curl, AI agents, etc.)
         │
         ▼
┌─────────────────────────┐
│   Bridge Server (Bun)   │
│   Port 3001             │
│  ┌───────────────────┐  │
│  │ REST API endpoints │  │  ← curl / HTTP clients
│  │ /api/generate etc  │  │
│  ├───────────────────┤  │
│  │ MCP Server         │  │  ← AI agents (Claude, Cursor)
│  │ /mcp (Streamable)  │  │
│  ├───────────────────┤  │
│  │ WebSocket /ws      │──│──┐
│  └───────────────────┘  │  │
└─────────────────────────┘  │  WebSocket
                              │
┌─────────────────────────┐  │
│  Chrome Extension        │  │
│  (on suno.com tab)       │◄─┘
│  ┌───────────────────┐  │
│  │ Content Script     │  │  → Orchestrates messaging
│  ├───────────────────┤  │
│  │ Page Script        │  │  → Accesses Clerk (JWT)
│  │ (MAIN world)       │  │    + hCaptcha tokens
│  ├───────────────────┤  │
│  │ Background Worker  │  │  → Makes API calls to Suno
│  │                    │  │    (bypasses CORS)
│  ├───────────────────┤  │
│  │ Popup (status UI)  │  │
│  └───────────────────┘  │
└─────────────────────────┘
```

**How it works:**
1. The **page script** runs in suno.com's context, accessing `window.Clerk` for JWT tokens and `window.hcaptcha` for captcha tokens
2. The **content script** orchestrates between the page script, background worker, and bridge server via WebSocket
3. The **background service worker** makes actual fetch calls to `studio-api.prod.suno.com` (background scripts bypass CORS)
4. The **bridge server** receives REST/MCP requests from external clients and forwards them through the WebSocket to the extension

### Setup

#### 1. Install dependencies and build the extension

```bash
git clone https://github.com/paean-ai/opensuno.git
cd opensuno
bun install
bun run ext:build
```

This builds the extension to `extension/dist/`.

#### 2. Load the Chrome extension

1. Open `chrome://extensions/` in Chrome
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `extension/dist/` directory

#### 3. Open suno.com

Open https://suno.com/create in a tab and make sure you're logged in. The extension icon should show a badge.

#### 4. Start the bridge server

```bash
bun run bridge
```

The bridge server starts at `http://localhost:3001`. The extension popup should show **Connected**.

#### 5. Test it

```bash
# Check connection status
curl http://localhost:3001/api/status

# Check credits
curl http://localhost:3001/api/get_limit

# Generate music (captcha handled automatically)
curl -X POST http://localhost:3001/api/custom_generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "sunshine and rainbows",
    "tags": "pop, upbeat",
    "title": "Happy Day"
  }'
```

### Bridge MCP Server

The bridge server includes a built-in MCP endpoint at `/mcp` (Streamable HTTP transport). Configure your AI client:

**Claude Code** — edit `~/.claude/claude_code_config.json`:

```json
{
  "mcpServers": {
    "suno": {
      "type": "url",
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

**Claude Desktop** — edit your config to add the remote MCP URL, or use the stdio mode (see below).

### Bridge Scripts

```bash
bun run bridge          # Start bridge server (port 3001)
bun run bridge:dev      # Start with --watch (auto-restart on changes)
bun run ext:build       # Build extension to extension/dist/
bun run ext:watch       # Build extension with file watching
```

> **Note**: After rebuilding the extension, click the refresh button on `chrome://extensions/` and then **refresh the suno.com tab** to load the updated scripts.

---

## Cookie Mode (Alternative)

### 1. Install dependencies

```bash
git clone https://github.com/paean-ai/opensuno.git
cd opensuno
bun install
```

### 2. Get your JWT Token

**Option A: Web UI (Recommended)**

Start the server first with `bun dev`, then visit `http://localhost:3000/cookie` for a guided setup with step-by-step instructions.

**Option B: Interactive CLI**

1. Open https://suno.com/create in your browser and log in
2. Press `F12` to open Developer Tools
3. Switch to the **Network** tab
4. Click the input box on the page (to trigger an API request)
5. Find any `studio-api.prod.suno.com` request in the Network list
6. Click the request → **Headers** → **Request Headers**
7. Copy two values:
   - `authorization: Bearer xxx` → copy the part after `Bearer`
   - `cookie: xxx` → copy the entire cookie string
8. Run the setup script:

```bash
node setup-cookie.js
```

Paste the JWT token and cookies when prompted.

**Option C: Manual configuration**

Create a `.env` file:

```bash
SUNO_COOKIE=__session=<YOUR_JWT_TOKEN>; __client=xxx; ajs_anonymous_id=xxx; ...
```

**Important**: Make sure the value after `__session=` is the JWT token extracted from the Authorization header.

### 3. Start the server

```bash
bun dev
```

The server starts at http://localhost:3000.

### 4. Test the API

```bash
# Check account credits
curl http://localhost:3000/api/get_limit

# Generate lyrics
curl -X POST http://localhost:3000/api/generate_lyrics \
  -H "Content-Type: application/json" \
  -d '{"prompt": "a happy song about sunshine"}'

# Generate music
curl -X POST http://localhost:3000/api/custom_generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "sunshine and rainbows",
    "tags": "pop, upbeat",
    "title": "Happy Day"
  }'
```

## Supported Models

| Version  | Model ID        | Constant                  | Note              |
|----------|-----------------|---------------------------|-------------------|
| V3.5     | `chirp-v3-5`    | `SUNO_MODELS.V3_5`        | Legacy            |
| V4       | `chirp-v4`      | `SUNO_MODELS.V4`          | —                 |
| V4.5+    | `chirp-bluejay` | `SUNO_MODELS.V4_5_PLUS`   | Bluejay           |
| V4.5 Pro | `chirp-auk`     | `SUNO_MODELS.V4_5_PRO`    | Auk               |
| **V5**   | `chirp-crow`    | `SUNO_MODELS.V5`          | Crow **(default)**|

To specify a model, add `"model": "chirp-bluejay"` (or any model ID) to your request body.

## API Reference

These endpoints are available in both Bridge Mode (port 3001) and Cookie Mode (port 3000):

| Method | Endpoint                  | Description                                      |
|--------|---------------------------|--------------------------------------------------|
| GET    | `/api/get_limit`          | Get account credits remaining                    |
| POST   | `/api/generate`           | Generate music (simple mode)                     |
| POST   | `/api/custom_generate`    | Generate music (custom mode with lyrics/tags)     |
| POST   | `/api/generate_lyrics`    | Generate lyrics from a prompt                    |
| GET    | `/api/get?ids=xxx`        | Get music details by ID(s)                       |
| POST   | `/api/extend_audio`       | Extend an audio clip                             |
| POST   | `/api/generate_stems`     | Separate into stem tracks                        |
| POST   | `/api/concat`             | Concatenate extensions into a full song           |

Bridge Mode only:

| Method | Endpoint                  | Description                                      |
|--------|---------------------------|--------------------------------------------------|
| GET    | `/api/status`             | Bridge connection status & extension info         |
| GET    | `/api/captcha_check`      | Check if captcha is currently required            |
| POST   | `/mcp`                    | MCP Streamable HTTP endpoint for AI agents        |

Cookie Mode only:

| Method | Endpoint                  | Description                                      |
|--------|---------------------------|--------------------------------------------------|
| GET    | `/api/get_aligned_lyrics` | Get word-level lyric timestamps                  |
| POST   | `/v1/chat/completions`    | OpenAI-compatible music generation               |
| GET    | `/api/cookie`             | Check current cookie status                      |
| POST   | `/api/cookie`             | Save cookie to .env (for local deployments)       |

Full interactive docs available at `/docs` after starting the server.

## Configuration

### Environment Variables

**Bridge Mode:**
```bash
# Optional — override bridge server port (default: 3001)
BRIDGE_PORT=3001
```

Bridge Mode requires no other configuration — auth and captcha are handled by the extension.

**Cookie Mode:**
```bash
# Required
SUNO_COOKIE=__session=<JWT_TOKEN>; __client=xxx; ...

# Optional (CAPTCHA solving)
TWOCAPTCHA_KEY=your_2captcha_key

# Optional (browser config for CAPTCHA)
BROWSER=chromium                    # chromium | firefox
BROWSER_HEADLESS=true               # true | false
BROWSER_LOCALE=en                   # browser locale
BROWSER_GHOST_CURSOR=false          # use ghost cursor (more natural mouse movement)
BROWSER_DISABLE_GPU=false           # set to true for Docker environments
```

### JWT Token Expiry

JWT Tokens typically last for a few hours. When expired, the API returns 401 errors. To fix:

1. Visit https://suno.com/create again
2. Extract a new JWT token from Network requests
3. Update via the `/cookie` web UI or edit `.env` directly

If you provide the `__client` cookie, the system will attempt to auto-refresh tokens via Clerk.

## MCP Server (Model Context Protocol)

This project includes MCP servers for both Bridge Mode and Cookie Mode, allowing AI agents (Claude Desktop, Cursor, Claude Code, etc.) to use Suno as a tool provider.

### Bridge Mode MCP (Recommended)

When running the bridge server (`bun run bridge`), the MCP endpoint is available at `http://localhost:3001/mcp` using Streamable HTTP transport. See [Bridge MCP Server](#bridge-mcp-server) above for configuration.

### Cookie Mode MCP

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `get_credits` | Check remaining credits and usage limits |
| `generate` | Generate music from a text prompt |
| `custom_generate` | Generate music with lyrics, style tags, and title |
| `generate_lyrics` | Generate lyrics from a topic/theme |
| `get_audio` | Get audio clip status and details |
| `extend_audio` | Extend an existing clip from a timestamp |
| `generate_stems` | Separate a clip into stem tracks |
| `concat` | Combine extended clips into a full song |

#### Local mode (stdio) — for Claude Desktop / Cursor / Claude Code

This is the standard way to use MCP locally. The AI client launches the server as a child process and communicates over stdin/stdout.

**Claude Desktop** — edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "suno": {
      "command": "bun",
      "args": ["run", "src/mcp/stdio.ts"],
      "cwd": "/path/to/opensuno",
      "env": {
        "SUNO_COOKIE": "__session=xxx; __client=xxx; ..."
      }
    }
  }
}
```

**Cursor** — go to Settings → Features → MCP → Add Server:
- Name: `suno`
- Type: `stdio`
- Command: `bun run src/mcp/stdio.ts`
- Working directory: `/path/to/opensuno`

**Claude Code** — edit `~/.claude/claude_code_config.json`:

```json
{
  "mcpServers": {
    "suno": {
      "command": "bun",
      "args": ["run", "src/mcp/stdio.ts"],
      "cwd": "/path/to/opensuno",
      "env": {
        "SUNO_COOKIE": "__session=xxx; __client=xxx; ..."
      }
    }
  }
}
```

If you have a `.env` file configured in the project directory, you can omit the `env` block — the server reads `.env` automatically.

#### Cloud mode (Streamable HTTP) — for remote agents

For cloud deployment or sharing the MCP server over the network:

```bash
# Start the MCP HTTP server (default port 3001)
bun run mcp:http

# Or with a custom port
MCP_PORT=8080 bun run mcp:http
```

The server listens at `http://localhost:3001/mcp` and supports the MCP Streamable HTTP transport (session-based, supports SSE streaming).

Remote MCP clients can connect using:
- Endpoint: `http://your-server:3001/mcp`
- Transport: Streamable HTTP

#### Running both Next.js API and MCP server

The Next.js API server (port 3000) and the MCP HTTP server (port 3001) are independent — you can run both simultaneously:

```bash
# Terminal 1: Next.js API server
bun dev

# Terminal 2: MCP HTTP server
bun run mcp:http
```

## Docker

```bash
# Build
docker build -t opensuno .

# Run
docker run -d -p 3000:3000 \
  -e SUNO_COOKIE="__session=xxx; __client=xxx; ..." \
  opensuno
```

## FAQ

**Q: Which mode should I use?**
Use **Bridge Mode** if you're running locally. It handles authentication and captcha automatically — no token management needed. Use **Cookie Mode** for server/cloud deployments where you can't run a browser extension.

**Q: The extension shows "Disconnected"?**
Make sure the bridge server is running (`bun run bridge`). Check that the bridge URL in the extension popup matches (default: `ws://localhost:3001/ws`).

**Q: API calls fail after reloading the extension?**
After reloading the extension in `chrome://extensions/`, you must also **refresh the suno.com tab** to inject the updated scripts.

**Q: Why am I getting 401 Unauthorized? (Cookie Mode)**
The JWT Token has expired or is malformed. Check that `SUNO_COOKIE` starts with `__session=` followed by the token from the Authorization header. Re-extract from the browser if needed.

**Q: Where do I find the JWT Token?**
In the browser Developer Tools → Network tab, find any `studio-api.prod.suno.com` request, look at Request Headers, and copy the value after `authorization: Bearer `.

**Q: Cookie too long, getting 431 error?**
The cookie contains extraneous entries (Google, Facebook, etc.). Use the `/cookie` web UI or `setup-cookie.js` which automatically filters to only Suno-relevant cookies.

## License

LGPL-3.0-or-later — see [LICENSE](LICENSE).

## Acknowledgments

- Built with [Claude Code](https://claude.ai/claude-code) & [Paean AI](https://github.com/paean-ai/)
- [Suno AI](https://suno.ai) — the music generation service

## Disclaimer

This project is for learning and research purposes only. Please comply with Suno.ai's terms of service.
