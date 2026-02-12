/**
 * MCP server for Autodesk Platform Services (APS).
 *
 * Data Management Tools:
 *   aps_get_token          – verify credentials / obtain 2‑legged token
 *   aps_dm_request         – raw Data Management API (power‑user)
 *   aps_list_hubs          – simplified hub listing
 *   aps_list_projects      – simplified project listing
 *   aps_get_top_folders    – root folders of a project
 *   aps_get_folder_contents – summarised folder contents (filters, sizes)
 *   aps_get_item_details   – single file / item metadata
 *   aps_get_folder_tree    – recursive folder tree
 *   aps_docs               – APS quick‑reference documentation
 *
 * Submittals Tools:
 *   aps_submittals_request          – raw Submittals API (power‑user)
 *   aps_list_submittal_items        – list submittal items
 *   aps_get_submittal_item          – single submittal item details
 *   aps_list_submittal_packages     – list submittal packages
 *   aps_list_submittal_specs        – list spec sections
 *   aps_get_submittal_item_attachments – attachments for a submittal item
 *   aps_submittals_docs             – Submittals quick‑reference documentation
 */

import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getApsToken, apsDmRequest, ApsApiError } from "./aps-auth.js";
import {
  summarizeHubs,
  summarizeProjects,
  summarizeTopFolders,
  summarizeFolderContents,
  summarizeItem,
  buildFolderTree,
  getErrorContext,
  validatePath,
  validateHubId,
  validateProjectId,
  validateFolderId,
  validateItemId,
  APS_DOCS,
  // ── Submittals ──
  summarizeSubmittalItems,
  summarizeSubmittalPackages,
  summarizeSubmittalSpecs,
  summarizeSubmittalAttachments,
  submittalPath,
  validateSubmittalProjectId,
  validateSubmittalItemId,
  validateSubmittalPath,
  SUBMITTALS_DOCS,
} from "./aps-helpers.js";

// ── Environment ──────────────────────────────────────────────────

const APS_CLIENT_ID = process.env.APS_CLIENT_ID ?? "";
const APS_CLIENT_SECRET = process.env.APS_CLIENT_SECRET ?? "";
const APS_SCOPE = process.env.APS_SCOPE ?? "";

function requireApsEnv(): void {
  if (!APS_CLIENT_ID || !APS_CLIENT_SECRET) {
    throw new Error(
      "APS_CLIENT_ID and APS_CLIENT_SECRET environment variables are required.",
    );
  }
}

/** Obtain a valid access token (cached automatically). */
async function token(): Promise<string> {
  requireApsEnv();
  return getApsToken(APS_CLIENT_ID, APS_CLIENT_SECRET, APS_SCOPE || undefined);
}

// ── Helpers ──────────────────────────────────────────────────────

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function fail(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const };
}

function json(obj: unknown) {
  return ok(JSON.stringify(obj, null, 2));
}

/** Format an ApsApiError with troubleshooting context. */
function richError(err: ApsApiError) {
  const ctx = getErrorContext(err.statusCode, err.method, err.path, err.responseBody);
  return fail(JSON.stringify(ctx, null, 2));
}

// ── Tool definitions ─────────────────────────────────────────────

const TOOLS = [
  // 1 ── aps_get_token
  {
    name: "aps_get_token",
    description:
      "Get a 2‑legged access token for Autodesk Platform Services (APS). " +
      "Use this to verify that credentials are configured correctly. " +
      "The token is cached and auto‑refreshed by all other tools, so you rarely need to call this explicitly.",
    inputSchema: { type: "object" as const, properties: {} },
  },

  // 2 ── aps_dm_request (raw / power‑user)
  {
    name: "aps_dm_request",
    description:
      "Call any APS Data Management API endpoint (project/v1, data/v1). " +
      "This is the raw / power‑user tool – it returns the full JSON:API response which can be very large (100 K+ tokens for folder listings). " +
      "Prefer the simplified tools (aps_list_hubs, aps_list_projects, aps_get_folder_contents, etc.) for everyday browsing. " +
      "Use this tool when you need full control: pagination, POST/PATCH/DELETE, or endpoints not covered by simplified tools.\n\n" +
      "Response guidance – when summarising large responses focus on:\n" +
      "• Folders: name, id, item count\n" +
      "• Files: name, type/extension, size, last modified, version info\n" +
      "• Ignore: relationship links, JSON:API meta, and extended attributes unless specifically needed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        method: {
          type: "string",
          enum: ["GET", "POST", "PATCH", "DELETE"],
          description: "HTTP method.",
        },
        path: {
          type: "string",
          description:
            "API path relative to developer.api.autodesk.com (e.g. 'project/v1/hubs' or " +
            "'data/v1/projects/b.xxx/folders/urn:adsk.wipprod:fs.folder:co.xxx/contents'). " +
            "Must include the version prefix (project/v1 or data/v1).",
        },
        query: {
          type: "object",
          description:
            "Optional query parameters as key/value pairs (e.g. { \"page[limit]\": \"200\", \"includeHidden\": \"true\" }).",
          additionalProperties: { type: "string" },
        },
        body: {
          type: "object",
          description: "Optional JSON body for POST/PATCH requests.",
        },
      },
      required: ["method", "path"],
    },
  },

  // 3 ── aps_list_hubs
  {
    name: "aps_list_hubs",
    description:
      "List all ACC / BIM 360 hubs (accounts) accessible to this app. " +
      "Returns a compact summary: hub name, id, type, and region. " +
      "Use the returned hub id (e.g. 'b.abc123…') in subsequent calls to aps_list_projects.",
    inputSchema: { type: "object" as const, properties: {} },
  },

  // 4 ── aps_list_projects
  {
    name: "aps_list_projects",
    description:
      "List projects in an ACC / BIM 360 hub. " +
      "Returns a compact summary: project name, id, platform (ACC / BIM 360), and last modified date. " +
      "Use the returned project id with aps_get_top_folders or aps_get_folder_contents.",
    inputSchema: {
      type: "object" as const,
      properties: {
        hub_id: {
          type: "string",
          description: "Hub (account) ID – starts with 'b.' (e.g. 'b.abc12345-6789-…'). Get this from aps_list_hubs.",
        },
      },
      required: ["hub_id"],
    },
  },

  // 5 ── aps_get_top_folders
  {
    name: "aps_get_top_folders",
    description:
      "Get the root / top‑level folders for an ACC / BIM 360 project. " +
      "Common root folders: 'Project Files', 'Plans', 'Shared', 'Recycle Bin'. " +
      "Returns folder name, id, and item count. Use the folder id with aps_get_folder_contents.",
    inputSchema: {
      type: "object" as const,
      properties: {
        hub_id: {
          type: "string",
          description: "Hub (account) ID – starts with 'b.'.",
        },
        project_id: {
          type: "string",
          description: "Project ID – starts with 'b.'.",
        },
      },
      required: ["hub_id", "project_id"],
    },
  },

  // 6 ── aps_get_folder_contents
  {
    name: "aps_get_folder_contents",
    description:
      "Get a summarised listing of a folder's contents. " +
      "Returns a compact JSON with: summary (item counts, file type breakdown, total size), " +
      "folders (name, id, item count), and files (name, id, type, size, version, dates). " +
      "This is ~95 % smaller than the raw API response.\n\n" +
      "Supports optional filtering by file extension and hiding hidden items. " +
      "For the full raw response, use aps_dm_request instead.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: {
          type: "string",
          description: "Project ID – starts with 'b.'.",
        },
        folder_id: {
          type: "string",
          description: "Folder URN – starts with 'urn:'.",
        },
        filter_extensions: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional list of file extensions to include (e.g. [\".rvt\", \".nwd\", \".ifc\"]). " +
            "Omit to return all file types.",
        },
        exclude_hidden: {
          type: "boolean",
          description: "When true, exclude hidden items. Defaults to false.",
        },
        page_limit: {
          type: "number",
          description: "Max items per page (1‑200). Defaults to 200.",
        },
      },
      required: ["project_id", "folder_id"],
    },
  },

  // 7 ── aps_get_item_details
  {
    name: "aps_get_item_details",
    description:
      "Get summarised metadata for a single file / item: name, type, size, version number, dates. " +
      "Much smaller than the raw JSON:API response. " +
      "Use for quick file lookups when you already have the item_id from a folder listing.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: {
          type: "string",
          description: "Project ID – starts with 'b.'.",
        },
        item_id: {
          type: "string",
          description: "Item (lineage) URN – starts with 'urn:'.",
        },
      },
      required: ["project_id", "item_id"],
    },
  },

  // 8 ── aps_get_folder_tree
  {
    name: "aps_get_folder_tree",
    description:
      "Build a recursive folder‑tree structure showing subfolder hierarchy and file counts per folder. " +
      "Useful for understanding a project's organisation at a glance. " +
      "⚠️ Each level makes an API call, so keep max_depth low (default 3) to avoid rate limits.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: {
          type: "string",
          description: "Project ID – starts with 'b.'.",
        },
        folder_id: {
          type: "string",
          description: "Root folder URN – starts with 'urn:'.",
        },
        max_depth: {
          type: "number",
          description: "Maximum recursion depth (1‑5). Default 3.",
        },
      },
      required: ["project_id", "folder_id"],
    },
  },

  // 9 ── aps_docs
  {
    name: "aps_docs",
    description:
      "Return APS Data Management quick‑reference documentation: " +
      "common ID formats, typical browsing workflow, raw API paths, query parameters, " +
      "BIM file extensions, and error troubleshooting. " +
      "Call this before your first APS interaction or when unsure about ID formats or API paths.",
    inputSchema: { type: "object" as const, properties: {} },
  },

  // ═══════════════════════════════════════════════════════════════
  // ── ACC Submittals tools ───────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════

  // 10 ── aps_submittals_request (raw / power‑user)
  {
    name: "aps_submittals_request",
    description:
      "Call any ACC Submittals API endpoint. " +
      "This is the raw / power‑user tool – it returns the full JSON response. " +
      "Prefer the simplified tools (aps_list_submittal_items, aps_list_submittal_packages, etc.) for everyday use. " +
      "Use this tool when you need full control: pagination, POST/PATCH, or endpoints not covered by simplified tools " +
      "(e.g. metadata, settings/mappings, users/me, item-types, responses).\n\n" +
      "The base path is: construction/submittals/v2/projects/{projectId}/\n" +
      "You only need to provide the sub‑path after 'projects/{projectId}/' (e.g. 'items', 'packages', 'specs').",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: {
          type: "string",
          description:
            "Project ID – UUID format (e.g. 'abc12345-6789-…'). " +
            "If you have a DM project ID with 'b.' prefix, it will be stripped automatically.",
        },
        method: {
          type: "string",
          enum: ["GET", "POST"],
          description: "HTTP method. Default: GET.",
        },
        path: {
          type: "string",
          description:
            "Sub‑path relative to 'projects/{projectId}/' " +
            "(e.g. 'items', 'packages', 'specs', 'items/{itemId}', 'metadata', 'responses', 'item-types').",
        },
        query: {
          type: "object",
          description:
            "Optional query parameters as key/value pairs (e.g. { \"limit\": \"50\", \"offset\": \"0\", \"filter[statusId]\": \"2\" }).",
          additionalProperties: { type: "string" },
        },
        body: {
          type: "object",
          description: "Optional JSON body for POST requests.",
        },
      },
      required: ["project_id", "path"],
    },
  },

  // 11 ── aps_list_submittal_items
  {
    name: "aps_list_submittal_items",
    description:
      "List submittal items in an ACC project. " +
      "Returns a compact summary: title, number, spec section, type, status, priority, revision, dates. " +
      "Supports filtering by status, package, spec section, and review response.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: {
          type: "string",
          description: "Project ID (UUID or 'b.' prefixed – auto‑converted).",
        },
        filter_status: {
          type: "string",
          description:
            "Filter by status ID: 1=Required, 2=Open, 3=Closed, 4=Void, 5=Empty, 6=Draft. " +
            "Omit to return all statuses.",
        },
        filter_package_id: {
          type: "string",
          description: "Filter by package UUID. Omit to return items from all packages.",
        },
        filter_spec_id: {
          type: "string",
          description: "Filter by spec section UUID. Omit to return all spec sections.",
        },
        limit: {
          type: "number",
          description: "Max items per page (1–200). Default 20.",
        },
        offset: {
          type: "number",
          description: "Pagination offset. Default 0.",
        },
      },
      required: ["project_id"],
    },
  },

  // 12 ── aps_get_submittal_item
  {
    name: "aps_get_submittal_item",
    description:
      "Get full details for a single submittal item by ID. " +
      "Returns the complete item object from the API.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: {
          type: "string",
          description: "Project ID (UUID or 'b.' prefixed – auto‑converted).",
        },
        item_id: {
          type: "string",
          description: "Submittal item UUID.",
        },
      },
      required: ["project_id", "item_id"],
    },
  },

  // 13 ── aps_list_submittal_packages
  {
    name: "aps_list_submittal_packages",
    description:
      "List submittal packages in an ACC project. " +
      "Returns a compact summary: title, identifier, spec section, description, dates.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: {
          type: "string",
          description: "Project ID (UUID or 'b.' prefixed – auto‑converted).",
        },
        limit: {
          type: "number",
          description: "Max items per page (1–200). Default 20.",
        },
        offset: {
          type: "number",
          description: "Pagination offset. Default 0.",
        },
      },
      required: ["project_id"],
    },
  },

  // 14 ── aps_list_submittal_specs
  {
    name: "aps_list_submittal_specs",
    description:
      "List spec sections for submittals in an ACC project. " +
      "Returns a compact summary: identifier (e.g. '033100'), title, dates. " +
      "Spec sections are the specification divisions that submittal items are organised under.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: {
          type: "string",
          description: "Project ID (UUID or 'b.' prefixed – auto‑converted).",
        },
        limit: {
          type: "number",
          description: "Max items per page (1–200). Default 20.",
        },
        offset: {
          type: "number",
          description: "Pagination offset. Default 0.",
        },
      },
      required: ["project_id"],
    },
  },

  // 15 ── aps_get_submittal_item_attachments
  {
    name: "aps_get_submittal_item_attachments",
    description:
      "Get attachments for a specific submittal item. " +
      "Returns file names, URNs, revision numbers, and categories. " +
      "Use the URN to download the attachment via the Data Management API.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: {
          type: "string",
          description: "Project ID (UUID or 'b.' prefixed – auto‑converted).",
        },
        item_id: {
          type: "string",
          description: "Submittal item UUID.",
        },
      },
      required: ["project_id", "item_id"],
    },
  },

  // 16 ── aps_submittals_docs
  {
    name: "aps_submittals_docs",
    description:
      "Return ACC Submittals API quick‑reference documentation: " +
      "endpoints, query parameters, statuses, custom numbering, typical workflow, and key concepts. " +
      "Call this before your first Submittals interaction or when unsure about Submittals API usage.",
    inputSchema: { type: "object" as const, properties: {} },
  },
];

// ── Tool handlers ────────────────────────────────────────────────

async function handleTool(
  name: string,
  args: Record<string, unknown>,
) {
  // ── aps_get_token ────────────────────────────────────────────
  if (name === "aps_get_token") {
    const t = await token();
    return ok(
      `2‑legged token obtained (length ${t.length}). ` +
      "All other tools use this token automatically – you don't need to pass it.",
    );
  }

  // ── aps_dm_request ───────────────────────────────────────────
  if (name === "aps_dm_request") {
    const method = (args.method as string) ?? "GET";
    const path = args.path as string;
    const pathErr = validatePath(path);
    if (pathErr) return fail(pathErr);

    const query = args.query as Record<string, string> | undefined;
    const body = args.body as Record<string, unknown> | undefined;
    const t = await token();
    const data = await apsDmRequest(method as "GET" | "POST" | "PATCH" | "DELETE", path, t, {
      query,
      body,
    });
    return json(data);
  }

  // ── aps_list_hubs ────────────────────────────────────────────
  if (name === "aps_list_hubs") {
    const t = await token();
    const raw = await apsDmRequest("GET", "project/v1/hubs", t);
    return json(summarizeHubs(raw));
  }

  // ── aps_list_projects ────────────────────────────────────────
  if (name === "aps_list_projects") {
    const hubId = args.hub_id as string;
    const err = validateHubId(hubId);
    if (err) return fail(err);

    const t = await token();
    const raw = await apsDmRequest("GET", `project/v1/hubs/${hubId}/projects`, t, {
      query: { "page[limit]": "100" },
    });
    return json(summarizeProjects(raw));
  }

  // ── aps_get_top_folders ──────────────────────────────────────
  if (name === "aps_get_top_folders") {
    const hubId = args.hub_id as string;
    const projectId = args.project_id as string;
    const e1 = validateHubId(hubId);
    if (e1) return fail(e1);
    const e2 = validateProjectId(projectId);
    if (e2) return fail(e2);

    const t = await token();
    const raw = await apsDmRequest(
      "GET",
      `project/v1/hubs/${hubId}/projects/${projectId}/topFolders`,
      t,
    );
    return json(summarizeTopFolders(raw));
  }

  // ── aps_get_folder_contents ──────────────────────────────────
  if (name === "aps_get_folder_contents") {
    const projectId = args.project_id as string;
    const folderId = args.folder_id as string;
    const e1 = validateProjectId(projectId);
    if (e1) return fail(e1);
    const e2 = validateFolderId(folderId);
    if (e2) return fail(e2);

    const filterExts = args.filter_extensions as string[] | undefined;
    const excludeHidden = (args.exclude_hidden as boolean) ?? false;
    const pageLimit = Math.min(Math.max(Number(args.page_limit) || 200, 1), 200);

    const t = await token();
    const raw = await apsDmRequest(
      "GET",
      `data/v1/projects/${projectId}/folders/${encodeURIComponent(folderId)}/contents`,
      t,
      { query: { "page[limit]": String(pageLimit) } },
    );

    const result = summarizeFolderContents(raw, {
      filterExtensions: filterExts,
      excludeHidden,
      projectId,
      folderId,
    });
    // Populate folder id
    result.folder.id = folderId;

    // Best‑effort: resolve folder name
    try {
      const folderRaw = (await apsDmRequest(
        "GET",
        `data/v1/projects/${projectId}/folders/${encodeURIComponent(folderId)}`,
        t,
      )) as Record<string, unknown>;
      const fAttrs = (folderRaw.data as Record<string, unknown>)?.attributes as
        | Record<string, unknown>
        | undefined;
      result.folder.name = (fAttrs?.displayName as string) ?? undefined;
    } catch {
      // non‑critical – leave name undefined
    }

    return json(result);
  }

  // ── aps_get_item_details ─────────────────────────────────────
  if (name === "aps_get_item_details") {
    const projectId = args.project_id as string;
    const itemId = args.item_id as string;
    const e1 = validateProjectId(projectId);
    if (e1) return fail(e1);
    const e2 = validateItemId(itemId);
    if (e2) return fail(e2);

    const t = await token();
    const raw = await apsDmRequest(
      "GET",
      `data/v1/projects/${projectId}/items/${encodeURIComponent(itemId)}`,
      t,
    );
    return json(summarizeItem(raw, { projectId }));
  }

  // ── aps_get_folder_tree ──────────────────────────────────────
  if (name === "aps_get_folder_tree") {
    const projectId = args.project_id as string;
    const folderId = args.folder_id as string;
    const e1 = validateProjectId(projectId);
    if (e1) return fail(e1);
    const e2 = validateFolderId(folderId);
    if (e2) return fail(e2);

    const maxDepth = Math.min(Math.max(Number(args.max_depth) || 3, 1), 5);
    const t = await token();
    const tree = await buildFolderTree(projectId, folderId, t, maxDepth);
    return json(tree);
  }

  // ── aps_docs ─────────────────────────────────────────────────
  if (name === "aps_docs") {
    return ok(APS_DOCS);
  }

  // ═══════════════════════════════════════════════════════════════
  // ── ACC Submittals handlers ────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════

  // ── aps_submittals_request ──────────────────────────────────
  if (name === "aps_submittals_request") {
    const projectId = args.project_id as string;
    const e1 = validateSubmittalProjectId(projectId);
    if (e1) return fail(e1);
    const subPath = args.path as string;
    const pathErr = validateSubmittalPath(subPath);
    if (pathErr) return fail(pathErr);

    const method = (args.method as string) ?? "GET";
    const query = args.query as Record<string, string> | undefined;
    const body = args.body as Record<string, unknown> | undefined;
    const t = await token();
    const fullPath = submittalPath(projectId, subPath);
    const data = await apsDmRequest(
      method as "GET" | "POST" | "PATCH" | "DELETE",
      fullPath,
      t,
      { query, body, headers: { "Content-Type": "application/json" } },
    );
    return json(data);
  }

  // ── aps_list_submittal_items ────────────────────────────────
  if (name === "aps_list_submittal_items") {
    const projectId = args.project_id as string;
    const e1 = validateSubmittalProjectId(projectId);
    if (e1) return fail(e1);

    const query: Record<string, string> = {};
    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 200);
    query.limit = String(limit);
    if (args.offset != null) query.offset = String(args.offset);
    if (args.filter_status) query["filter[statusId]"] = args.filter_status as string;
    if (args.filter_package_id) query["filter[packageId]"] = args.filter_package_id as string;
    if (args.filter_spec_id) query["filter[specId]"] = args.filter_spec_id as string;

    const t = await token();
    const raw = await apsDmRequest("GET", submittalPath(projectId, "items"), t, {
      query,
      headers: { "Content-Type": "application/json" },
    });
    return json(summarizeSubmittalItems(raw));
  }

  // ── aps_get_submittal_item ──────────────────────────────────
  if (name === "aps_get_submittal_item") {
    const projectId = args.project_id as string;
    const itemId = args.item_id as string;
    const e1 = validateSubmittalProjectId(projectId);
    if (e1) return fail(e1);
    const e2 = validateSubmittalItemId(itemId);
    if (e2) return fail(e2);

    const t = await token();
    const raw = await apsDmRequest("GET", submittalPath(projectId, `items/${itemId}`), t, {
      headers: { "Content-Type": "application/json" },
    });
    return json(raw);
  }

  // ── aps_list_submittal_packages ─────────────────────────────
  if (name === "aps_list_submittal_packages") {
    const projectId = args.project_id as string;
    const e1 = validateSubmittalProjectId(projectId);
    if (e1) return fail(e1);

    const query: Record<string, string> = {};
    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 200);
    query.limit = String(limit);
    if (args.offset != null) query.offset = String(args.offset);

    const t = await token();
    const raw = await apsDmRequest("GET", submittalPath(projectId, "packages"), t, {
      query,
      headers: { "Content-Type": "application/json" },
    });
    return json(summarizeSubmittalPackages(raw));
  }

  // ── aps_list_submittal_specs ────────────────────────────────
  if (name === "aps_list_submittal_specs") {
    const projectId = args.project_id as string;
    const e1 = validateSubmittalProjectId(projectId);
    if (e1) return fail(e1);

    const query: Record<string, string> = {};
    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 200);
    query.limit = String(limit);
    if (args.offset != null) query.offset = String(args.offset);

    const t = await token();
    const raw = await apsDmRequest("GET", submittalPath(projectId, "specs"), t, {
      query,
      headers: { "Content-Type": "application/json" },
    });
    return json(summarizeSubmittalSpecs(raw));
  }

  // ── aps_get_submittal_item_attachments ──────────────────────
  if (name === "aps_get_submittal_item_attachments") {
    const projectId = args.project_id as string;
    const itemId = args.item_id as string;
    const e1 = validateSubmittalProjectId(projectId);
    if (e1) return fail(e1);
    const e2 = validateSubmittalItemId(itemId);
    if (e2) return fail(e2);

    const t = await token();
    const raw = await apsDmRequest(
      "GET",
      submittalPath(projectId, `items/${itemId}/attachments`),
      t,
      { headers: { "Content-Type": "application/json" } },
    );
    return json(summarizeSubmittalAttachments(raw));
  }

  // ── aps_submittals_docs ─────────────────────────────────────
  if (name === "aps_submittals_docs") {
    return ok(SUBMITTALS_DOCS);
  }

  return fail(`Unknown tool: ${name}`);
}

// ── Server bootstrap ─────────────────────────────────────────────

async function main() {
  const server = new Server(
    { name: "acc-mcp", version: "0.3.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const safeArgs = (args as Record<string, unknown>) ?? {};
    try {
      return await handleTool(name, safeArgs);
    } catch (err) {
      if (err instanceof ApsApiError) return richError(err);
      const message = err instanceof Error ? err.message : String(err);
      return fail(`Error: ${message}`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
