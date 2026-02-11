/**
 * MCP service for Autodesk Platform Services (APS).
 * Exposes tools for authentication and Data Management (e.g. list hubs).
 */

import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getApsToken, apsProjectGet } from "./aps-auth.js";

const APS_CLIENT_ID = process.env.APS_CLIENT_ID ?? "";
const APS_CLIENT_SECRET = process.env.APS_CLIENT_SECRET ?? "";
const APS_SCOPE = process.env.APS_SCOPE ?? "";

function requireApsEnv(): void {
  if (!APS_CLIENT_ID || !APS_CLIENT_SECRET) {
    throw new Error(
      "APS_CLIENT_ID and APS_CLIENT_SECRET environment variables are required."
    );
  }
}

async function main() {

  const server = new Server(
    {
      name: "acc-mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "aps_get_token",
        description:
          "Get a 2-legged access token for Autodesk Platform Services. Use this to verify credentials or before calling other APS APIs.",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
      {
        name: "aps_list_hubs",
        description:
          "List hubs (top-level containers) in APS Data Management. Requires APS_CLIENT_ID and APS_CLIENT_SECRET to be set.",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const safeArgs = (args as Record<string, unknown>) ?? {};

    try {
      if (name === "aps_get_token") {
        requireApsEnv();
        const token = await getApsToken(
          APS_CLIENT_ID,
          APS_CLIENT_SECRET,
          APS_SCOPE || undefined
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `2-legged token obtained successfully (length: ${token.length}). Use it in Authorization: Bearer <token> for APS APIs.`,
            },
          ],
        };
      }

      if (name === "aps_list_hubs") {
        requireApsEnv();
        const token = await getApsToken(
          APS_CLIENT_ID,
          APS_CLIENT_SECRET,
          APS_SCOPE || undefined
        );
        const data = await apsProjectGet("/hubs", token);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Unknown tool: ${name}`,
          },
        ],
        isError: true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
