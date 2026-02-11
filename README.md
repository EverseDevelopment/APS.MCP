# ACC.MCP – MCP service for Autodesk Platform Services

MCP (Model Context Protocol) server that exposes **Autodesk Platform Services (APS)** as tools for AI assistants (e.g. Cursor).

## Requirements

- Node.js 18+
- [APS application](https://aps.autodesk.com/) with **Client ID** and **Client Secret** (2-legged OAuth)

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure credentials**

   Copy `.env.example` to `.env` and set your APS app credentials:

   ```bash
   cp .env.example .env
   # Edit .env: set APS_CLIENT_ID and APS_CLIENT_SECRET
   ```

3. **Build**

   ```bash
   npm run build
   ```

4. **Pack (optional)**
If you want to use it on Claude Desktop, you can pack the MCP to a .mcpb 
   ```bash
   npm run pack
   ```

## Running the MCP service

The server uses **stdio** transport: a client (e.g. Cursor) spawns this process and talks to it via stdin/stdout.

- **Run directly:** `npm start` or `node dist/index.js`
- **With env file:** use `dotenv` or your shell to load `.env` before starting

## Cursor configuration

Add this MCP server in Cursor (e.g. **Settings → MCP** or `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "acc-mcp": {
      "command": "node",
      "args": ["c:/repositories/00-Research/ACC.MCP/dist/index.js"],
      "env": {
        "APS_CLIENT_ID": "your_client_id",
        "APS_CLIENT_SECRET": "your_client_secret",
        "APS_SCOPE": "data:read"
      }
    }
  }
}
```

Use the path to `dist/index.js` that matches your machine. You can also run via `npx` or a wrapper script that loads `.env` and then runs `node dist/index.js`.

## Tools

| Tool | Description |
|------|-------------|
| `aps_get_token` | Get a 2-legged APS access token (verifies credentials). |
| `aps_list_hubs` | List hubs from APS Data Management API. |

More tools (e.g. projects, folders, items, model derivative) can be added in `src/index.ts` and `src/aps-auth.ts`.

## MCP Bundle (.mcpb)

This project can be packed as an [MCP Bundle](https://github.com/modelcontextprotocol/mcpb) for one-click install in [Claude Desktop](https://claude.ai/download) and other MCPB-compatible apps.

1. **Create the bundle**

   ```bash
   npm run pack
   ```

   This builds the server, prepares a bundle directory (manifest + server + production dependencies), zips it to `acc-mcp.mcpb`, then removes the temp directory. On Windows the script uses PowerShell `Compress-Archive`; on macOS/Linux it uses `zip -r`.

2. **Install the bundle**

   Open `acc-mcp.mcpb` in Claude for macOS or Windows (or any app that supports MCPB). You’ll be prompted for **APS Client ID** and **APS Client Secret**; the app will pass them to the server as environment variables.

The `manifest.json` at the repo root follows the [MCPB manifest spec](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md) (manifest_version 0.3, Node server, `user_config` for credentials).

## License

MIT
