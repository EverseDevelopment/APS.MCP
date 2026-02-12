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
 * Issues Tools:
 *   aps_issues_request       – raw Issues API (power‑user)
 *   aps_issues_get_types     – issue categories & types
 *   aps_issues_list          – list / search issues (summarised)
 *   aps_issues_get           – single issue detail
 *   aps_issues_create        – create a new issue
 *   aps_issues_update        – update an existing issue
 *   aps_issues_get_comments  – list comments on an issue
 *   aps_issues_create_comment – add a comment
 *   aps_issues_docs          – Issues API quick‑reference
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
} from "./aps-dm-helpers.js";
import {
  toIssuesProjectId,
  summarizeIssuesList,
  summarizeIssueDetail,
  summarizeIssueTypes,
  summarizeComments,
  validateIssuesProjectId,
  validateIssueId,
  validateIssuesPath,
  ISSUES_DOCS,
} from "./aps-issues-helpers.js";

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
  // ACC Issues Tools
  // ═══════════════════════════════════════════════════════════════

  // 10 ── aps_issues_request (raw / power‑user)
  {
    name: "aps_issues_request",
    description:
      "Call any ACC Issues API endpoint (construction/issues/v1). " +
      "This is the raw / power‑user tool – it returns the full API response. " +
      "Prefer the simplified tools (aps_issues_list, aps_issues_get, etc.) for everyday use. " +
      "Use this when you need full control: custom filters, attribute definitions, attribute mappings, " +
      "or endpoints not covered by simplified tools.\n\n" +
      "⚠️ Project IDs for the Issues API must NOT have the 'b.' prefix. " +
      "If you have a Data Management project ID like 'b.abc123', use 'abc123'.",
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
            "API path relative to developer.api.autodesk.com " +
            "(e.g. 'construction/issues/v1/projects/{projectId}/issues'). " +
            "Must include the version prefix (construction/issues/v1).",
        },
        query: {
          type: "object",
          description:
            "Optional query parameters as key/value pairs " +
            "(e.g. { \"filter[status]\": \"open\", \"limit\": \"50\" }).",
          additionalProperties: { type: "string" },
        },
        body: {
          type: "object",
          description: "Optional JSON body for POST/PATCH requests.",
        },
        region: {
          type: "string",
          enum: ["US", "EMEA", "AUS", "CAN", "DEU", "IND", "JPN", "GBR"],
          description: "Data centre region (x-ads-region header). Defaults to US.",
        },
      },
      required: ["method", "path"],
    },
  },

  // 11 ── aps_issues_get_types
  {
    name: "aps_issues_get_types",
    description:
      "Get issue categories (types) and their types (subtypes) for a project. " +
      "Returns a compact summary: category id, title, active status, and subtypes with code. " +
      "Use the returned subtype id when creating issues (issueSubtypeId).",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: {
          type: "string",
          description:
            "Project ID – accepts with or without 'b.' prefix (e.g. 'b.abc123' or 'abc123'). " +
            "Get this from aps_list_projects.",
        },
        include_subtypes: {
          type: "boolean",
          description: "Include subtypes for each category. Defaults to true.",
        },
        region: {
          type: "string",
          enum: ["US", "EMEA", "AUS", "CAN", "DEU", "IND", "JPN", "GBR"],
          description: "Data centre region. Defaults to US.",
        },
      },
      required: ["project_id"],
    },
  },

  // 12 ── aps_issues_list
  {
    name: "aps_issues_list",
    description:
      "List and search issues in a project with optional filtering. " +
      "Returns a compact summary per issue: id, displayId, title, status, assignee, dates, comment count. " +
      "Supports filtering by status, assignee, type, date, search text, and more. " +
      "This is much smaller than the raw API response.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: {
          type: "string",
          description: "Project ID – accepts with or without 'b.' prefix.",
        },
        filter_status: {
          type: "string",
          description:
            "Filter by status. Comma‑separated. " +
            "Values: draft, open, pending, in_progress, in_review, completed, not_approved, in_dispute, closed.",
        },
        filter_assigned_to: {
          type: "string",
          description: "Filter by assignee Autodesk ID. Comma‑separated for multiple.",
        },
        filter_issue_type_id: {
          type: "string",
          description: "Filter by category (type) UUID. Comma‑separated for multiple.",
        },
        filter_issue_subtype_id: {
          type: "string",
          description: "Filter by type (subtype) UUID. Comma‑separated for multiple.",
        },
        filter_due_date: {
          type: "string",
          description: "Filter by due date (YYYY‑MM‑DD). Comma‑separated for range.",
        },
        filter_created_at: {
          type: "string",
          description: "Filter by creation date (YYYY‑MM‑DD or YYYY‑MM‑DDThh:mm:ss.sz).",
        },
        filter_search: {
          type: "string",
          description: "Search by title or display ID (e.g. '300' or 'wall crack').",
        },
        filter_root_cause_id: {
          type: "string",
          description: "Filter by root cause UUID. Comma‑separated for multiple.",
        },
        filter_location_id: {
          type: "string",
          description: "Filter by LBS location UUID. Comma‑separated for multiple.",
        },
        limit: {
          type: "number",
          description: "Max issues to return (1‑100). Default 100.",
        },
        offset: {
          type: "number",
          description: "Pagination offset. Default 0.",
        },
        sort_by: {
          type: "string",
          description:
            "Sort field(s). Comma‑separated. Prefix with '-' for descending. " +
            "Values: createdAt, updatedAt, displayId, title, status, assignedTo, dueDate, startDate, closedAt.",
        },
        region: {
          type: "string",
          enum: ["US", "EMEA", "AUS", "CAN", "DEU", "IND", "JPN", "GBR"],
          description: "Data centre region. Defaults to US.",
        },
      },
      required: ["project_id"],
    },
  },

  // 13 ── aps_issues_get
  {
    name: "aps_issues_get",
    description:
      "Get detailed information about a single issue. " +
      "Returns a compact summary with: id, title, description, status, assignee, dates, location, " +
      "custom attributes, linked document count, permitted statuses, and more.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: {
          type: "string",
          description: "Project ID – accepts with or without 'b.' prefix.",
        },
        issue_id: {
          type: "string",
          description: "Issue UUID. Get this from aps_issues_list.",
        },
        region: {
          type: "string",
          enum: ["US", "EMEA", "AUS", "CAN", "DEU", "IND", "JPN", "GBR"],
          description: "Data centre region. Defaults to US.",
        },
      },
      required: ["project_id", "issue_id"],
    },
  },

  // 14 ── aps_issues_create
  {
    name: "aps_issues_create",
    description:
      "Create a new issue in a project. " +
      "Requires: title, issueSubtypeId (get from aps_issues_get_types), and status. " +
      "Optional: description, assignee, dates, location, root cause, custom attributes, watchers. " +
      "⚠️ Requires 'data:write' in APS_SCOPE.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: {
          type: "string",
          description: "Project ID – accepts with or without 'b.' prefix.",
        },
        title: {
          type: "string",
          description: "Issue title (max 10,000 chars).",
        },
        issue_subtype_id: {
          type: "string",
          description: "Type (subtype) UUID – get from aps_issues_get_types.",
        },
        status: {
          type: "string",
          enum: ["draft", "open", "pending", "in_progress", "in_review", "completed", "not_approved", "in_dispute", "closed"],
          description: "Initial status (e.g. 'open').",
        },
        description: {
          type: "string",
          description: "Issue description (max 10,000 chars). Optional.",
        },
        assigned_to: {
          type: "string",
          description: "Autodesk ID of assignee (user, company, or role). Optional.",
        },
        assigned_to_type: {
          type: "string",
          enum: ["user", "company", "role"],
          description: "Type of assignee. Required if assigned_to is set.",
        },
        due_date: {
          type: "string",
          description: "Due date in ISO8601 format (e.g. '2025‑12‑31'). Optional.",
        },
        start_date: {
          type: "string",
          description: "Start date in ISO8601 format. Optional.",
        },
        location_id: {
          type: "string",
          description: "LBS (Location Breakdown Structure) UUID. Optional.",
        },
        location_details: {
          type: "string",
          description: "Location as plain text (max 8,300 chars). Optional.",
        },
        root_cause_id: {
          type: "string",
          description: "Root cause UUID. Optional.",
        },
        published: {
          type: "boolean",
          description: "Whether the issue is published. Default false.",
        },
        watchers: {
          type: "array",
          items: { type: "string" },
          description: "Array of Autodesk IDs to add as watchers. Optional.",
        },
        custom_attributes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              attributeDefinitionId: { type: "string" },
              value: {},
            },
            required: ["attributeDefinitionId", "value"],
          },
          description: "Custom attribute values. Optional.",
        },
        region: {
          type: "string",
          enum: ["US", "EMEA", "AUS", "CAN", "DEU", "IND", "JPN", "GBR"],
          description: "Data centre region. Defaults to US.",
        },
      },
      required: ["project_id", "title", "issue_subtype_id", "status"],
    },
  },

  // 15 ── aps_issues_update
  {
    name: "aps_issues_update",
    description:
      "Update an existing issue. Only include the fields you want to change. " +
      "⚠️ Requires 'data:write' in APS_SCOPE. " +
      "To see which fields the current user can update, check permittedAttributes in the issue detail.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: {
          type: "string",
          description: "Project ID – accepts with or without 'b.' prefix.",
        },
        issue_id: {
          type: "string",
          description: "Issue UUID to update.",
        },
        title: { type: "string", description: "New title. Optional." },
        description: { type: "string", description: "New description. Optional." },
        status: {
          type: "string",
          enum: ["draft", "open", "pending", "in_progress", "in_review", "completed", "not_approved", "in_dispute", "closed"],
          description: "New status. Optional.",
        },
        assigned_to: { type: "string", description: "New assignee Autodesk ID. Optional." },
        assigned_to_type: {
          type: "string",
          enum: ["user", "company", "role"],
          description: "Assignee type. Required if assigned_to is set.",
        },
        due_date: { type: "string", description: "New due date (ISO8601). Optional." },
        start_date: { type: "string", description: "New start date (ISO8601). Optional." },
        location_id: { type: "string", description: "New LBS location UUID. Optional." },
        location_details: { type: "string", description: "New location text. Optional." },
        root_cause_id: { type: "string", description: "New root cause UUID. Optional." },
        published: { type: "boolean", description: "Set published state. Optional." },
        watchers: {
          type: "array",
          items: { type: "string" },
          description: "New watcher list. Optional.",
        },
        custom_attributes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              attributeDefinitionId: { type: "string" },
              value: {},
            },
            required: ["attributeDefinitionId", "value"],
          },
          description: "Custom attribute values to update. Optional.",
        },
        region: {
          type: "string",
          enum: ["US", "EMEA", "AUS", "CAN", "DEU", "IND", "JPN", "GBR"],
          description: "Data centre region. Defaults to US.",
        },
      },
      required: ["project_id", "issue_id"],
    },
  },

  // 16 ── aps_issues_get_comments
  {
    name: "aps_issues_get_comments",
    description:
      "Get all comments for a specific issue. " +
      "Returns a compact list: comment id, body, author, date.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: {
          type: "string",
          description: "Project ID – accepts with or without 'b.' prefix.",
        },
        issue_id: {
          type: "string",
          description: "Issue UUID.",
        },
        limit: {
          type: "number",
          description: "Max comments to return. Optional.",
        },
        offset: {
          type: "number",
          description: "Pagination offset. Optional.",
        },
        sort_by: {
          type: "string",
          description: "Sort field (e.g. 'createdAt' or '-createdAt'). Optional.",
        },
        region: {
          type: "string",
          enum: ["US", "EMEA", "AUS", "CAN", "DEU", "IND", "JPN", "GBR"],
          description: "Data centre region. Defaults to US.",
        },
      },
      required: ["project_id", "issue_id"],
    },
  },

  // 17 ── aps_issues_create_comment
  {
    name: "aps_issues_create_comment",
    description:
      "Add a comment to an issue. " +
      "⚠️ Requires 'data:write' in APS_SCOPE.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: {
          type: "string",
          description: "Project ID – accepts with or without 'b.' prefix.",
        },
        issue_id: {
          type: "string",
          description: "Issue UUID.",
        },
        body: {
          type: "string",
          description: "Comment text (max 10,000 chars). Use \\n for newlines.",
        },
        region: {
          type: "string",
          enum: ["US", "EMEA", "AUS", "CAN", "DEU", "IND", "JPN", "GBR"],
          description: "Data centre region. Defaults to US.",
        },
      },
      required: ["project_id", "issue_id", "body"],
    },
  },

  // 18 ── aps_issues_docs
  {
    name: "aps_issues_docs",
    description:
      "Return ACC Issues API quick‑reference documentation: " +
      "project ID format, statuses, typical workflow, raw API paths, " +
      "common filters, sort options, and error troubleshooting. " +
      "Call this before your first Issues interaction.",
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
  // ACC Issues Tool Handlers
  // ═══════════════════════════════════════════════════════════════

  /** Build optional headers for Issues API calls. */
  function issuesHeaders(region?: string): Record<string, string> {
    const h: Record<string, string> = {};
    if (region) h["x-ads-region"] = region;
    return h;
  }

  /** Build headers for Issues API write operations (POST/PATCH). */
  function issuesWriteHeaders(region?: string): Record<string, string> {
    return { "Content-Type": "application/json", ...issuesHeaders(region) };
  }

  // ── aps_issues_request ──────────────────────────────────────
  if (name === "aps_issues_request") {
    const method = (args.method as string) ?? "GET";
    const path = args.path as string;
    const pathErr = validateIssuesPath(path);
    if (pathErr) return fail(pathErr);

    const query = args.query as Record<string, string> | undefined;
    const body = args.body as Record<string, unknown> | undefined;
    const region = args.region as string | undefined;
    const t = await token();

    const headers: Record<string, string> = {
      ...issuesHeaders(region),
    };
    if ((method === "POST" || method === "PATCH") && body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const data = await apsDmRequest(
      method as "GET" | "POST" | "PATCH" | "DELETE",
      path,
      t,
      { query, body, headers },
    );
    return json(data);
  }

  // ── aps_issues_get_types ────────────────────────────────────
  if (name === "aps_issues_get_types") {
    const projectId = args.project_id as string;
    const err = validateIssuesProjectId(projectId);
    if (err) return fail(err);

    const pid = toIssuesProjectId(projectId);
    const includeSubtypes = (args.include_subtypes as boolean) !== false;
    const region = args.region as string | undefined;
    const t = await token();

    const query: Record<string, string> = {};
    if (includeSubtypes) query.include = "subtypes";

    const raw = await apsDmRequest(
      "GET",
      `construction/issues/v1/projects/${pid}/issue-types`,
      t,
      { query, headers: issuesHeaders(region) },
    );
    return json(summarizeIssueTypes(raw));
  }

  // ── aps_issues_list ─────────────────────────────────────────
  if (name === "aps_issues_list") {
    const projectId = args.project_id as string;
    const err = validateIssuesProjectId(projectId);
    if (err) return fail(err);

    const pid = toIssuesProjectId(projectId);
    const region = args.region as string | undefined;
    const t = await token();

    const query: Record<string, string> = {};
    if (args.filter_status) query["filter[status]"] = args.filter_status as string;
    if (args.filter_assigned_to) query["filter[assignedTo]"] = args.filter_assigned_to as string;
    if (args.filter_issue_type_id) query["filter[issueTypeId]"] = args.filter_issue_type_id as string;
    if (args.filter_issue_subtype_id) query["filter[issueSubtypeId]"] = args.filter_issue_subtype_id as string;
    if (args.filter_due_date) query["filter[dueDate]"] = args.filter_due_date as string;
    if (args.filter_created_at) query["filter[createdAt]"] = args.filter_created_at as string;
    if (args.filter_search) query["filter[search]"] = args.filter_search as string;
    if (args.filter_root_cause_id) query["filter[rootCauseId]"] = args.filter_root_cause_id as string;
    if (args.filter_location_id) query["filter[locationId]"] = args.filter_location_id as string;
    if (args.limit != null) query.limit = String(Math.min(Math.max(Number(args.limit) || 100, 1), 100));
    if (args.offset != null) query.offset = String(Number(args.offset) || 0);
    if (args.sort_by) query.sortBy = args.sort_by as string;

    const raw = await apsDmRequest(
      "GET",
      `construction/issues/v1/projects/${pid}/issues`,
      t,
      { query, headers: issuesHeaders(region) },
    );
    return json(summarizeIssuesList(raw));
  }

  // ── aps_issues_get ──────────────────────────────────────────
  if (name === "aps_issues_get") {
    const projectId = args.project_id as string;
    const issueId = args.issue_id as string;
    const e1 = validateIssuesProjectId(projectId);
    if (e1) return fail(e1);
    const e2 = validateIssueId(issueId);
    if (e2) return fail(e2);

    const pid = toIssuesProjectId(projectId);
    const region = args.region as string | undefined;
    const t = await token();

    const raw = await apsDmRequest(
      "GET",
      `construction/issues/v1/projects/${pid}/issues/${issueId}`,
      t,
      { headers: issuesHeaders(region) },
    );
    return json(summarizeIssueDetail(raw));
  }

  // ── aps_issues_create ───────────────────────────────────────
  if (name === "aps_issues_create") {
    const projectId = args.project_id as string;
    const err = validateIssuesProjectId(projectId);
    if (err) return fail(err);

    const title = args.title as string;
    if (!title) return fail("title is required.");
    const issueSubtypeId = args.issue_subtype_id as string;
    if (!issueSubtypeId) return fail("issue_subtype_id is required.");
    const status = args.status as string;
    if (!status) return fail("status is required.");

    const pid = toIssuesProjectId(projectId);
    const region = args.region as string | undefined;
    const t = await token();

    const body: Record<string, unknown> = {
      title,
      issueSubtypeId,
      status,
    };
    if (args.description != null) body.description = args.description;
    if (args.assigned_to != null) body.assignedTo = args.assigned_to;
    if (args.assigned_to_type != null) body.assignedToType = args.assigned_to_type;
    if (args.due_date != null) body.dueDate = args.due_date;
    if (args.start_date != null) body.startDate = args.start_date;
    if (args.location_id != null) body.locationId = args.location_id;
    if (args.location_details != null) body.locationDetails = args.location_details;
    if (args.root_cause_id != null) body.rootCauseId = args.root_cause_id;
    if (args.published != null) body.published = args.published;
    if (args.watchers != null) body.watchers = args.watchers;
    if (args.custom_attributes != null) body.customAttributes = args.custom_attributes;

    const raw = await apsDmRequest(
      "POST",
      `construction/issues/v1/projects/${pid}/issues`,
      t,
      { body, headers: issuesWriteHeaders(region) },
    );
    return json(summarizeIssueDetail(raw));
  }

  // ── aps_issues_update ───────────────────────────────────────
  if (name === "aps_issues_update") {
    const projectId = args.project_id as string;
    const issueId = args.issue_id as string;
    const e1 = validateIssuesProjectId(projectId);
    if (e1) return fail(e1);
    const e2 = validateIssueId(issueId);
    if (e2) return fail(e2);

    const pid = toIssuesProjectId(projectId);
    const region = args.region as string | undefined;
    const t = await token();

    const body: Record<string, unknown> = {};
    if (args.title != null) body.title = args.title;
    if (args.description != null) body.description = args.description;
    if (args.status != null) body.status = args.status;
    if (args.assigned_to != null) body.assignedTo = args.assigned_to;
    if (args.assigned_to_type != null) body.assignedToType = args.assigned_to_type;
    if (args.due_date != null) body.dueDate = args.due_date;
    if (args.start_date != null) body.startDate = args.start_date;
    if (args.location_id != null) body.locationId = args.location_id;
    if (args.location_details != null) body.locationDetails = args.location_details;
    if (args.root_cause_id != null) body.rootCauseId = args.root_cause_id;
    if (args.published != null) body.published = args.published;
    if (args.watchers != null) body.watchers = args.watchers;
    if (args.custom_attributes != null) body.customAttributes = args.custom_attributes;

    if (Object.keys(body).length === 0) {
      return fail("No fields to update. Provide at least one field to change.");
    }

    const raw = await apsDmRequest(
      "PATCH",
      `construction/issues/v1/projects/${pid}/issues/${issueId}`,
      t,
      { body, headers: issuesWriteHeaders(region) },
    );
    return json(summarizeIssueDetail(raw));
  }

  // ── aps_issues_get_comments ─────────────────────────────────
  if (name === "aps_issues_get_comments") {
    const projectId = args.project_id as string;
    const issueId = args.issue_id as string;
    const e1 = validateIssuesProjectId(projectId);
    if (e1) return fail(e1);
    const e2 = validateIssueId(issueId);
    if (e2) return fail(e2);

    const pid = toIssuesProjectId(projectId);
    const region = args.region as string | undefined;
    const t = await token();

    const query: Record<string, string> = {};
    if (args.limit != null) query.limit = String(args.limit);
    if (args.offset != null) query.offset = String(args.offset);
    if (args.sort_by) query.sortBy = args.sort_by as string;

    const raw = await apsDmRequest(
      "GET",
      `construction/issues/v1/projects/${pid}/issues/${issueId}/comments`,
      t,
      { query, headers: issuesHeaders(region) },
    );
    return json(summarizeComments(raw));
  }

  // ── aps_issues_create_comment ───────────────────────────────
  if (name === "aps_issues_create_comment") {
    const projectId = args.project_id as string;
    const issueId = args.issue_id as string;
    const e1 = validateIssuesProjectId(projectId);
    if (e1) return fail(e1);
    const e2 = validateIssueId(issueId);
    if (e2) return fail(e2);

    const body = args.body as string;
    if (!body) return fail("body is required.");

    const pid = toIssuesProjectId(projectId);
    const region = args.region as string | undefined;
    const t = await token();

    const raw = await apsDmRequest(
      "POST",
      `construction/issues/v1/projects/${pid}/issues/${issueId}/comments`,
      t,
      { body: { body }, headers: issuesWriteHeaders(region) },
    );
    return json(raw);
  }

  // ── aps_issues_docs ─────────────────────────────────────────
  if (name === "aps_issues_docs") {
    return ok(ISSUES_DOCS);
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
