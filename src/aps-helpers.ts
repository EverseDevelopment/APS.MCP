/**
 * APS Data Management helpers: response summarisers, folder‑tree builder,
 * error‑context enrichment, parameter validation, and quick‑reference docs.
 */

import { apsDmRequest } from "./aps-auth.js";

// ── Shared tiny types ────────────────────────────────────────────

export interface HubSummary {
  name: string;
  id: string;
  type: string;
  region: string;
}

export interface ProjectSummary {
  name: string;
  id: string;
  type: string;
  platform: string;
  status?: string;
  last_modified?: string;
}

export interface FolderEntry {
  name: string;
  id: string;
  last_modified: string;
  object_count?: number;
  hidden: boolean;
}

export interface FileEntry {
  name: string;
  item_id: string;
  version_id?: string;
  type: string;
  size_bytes?: number;
  size_mb?: string;
  version_number?: number;
  last_modified: string;
  created: string;
  hidden: boolean;
}

export interface FolderContentsSummary {
  folder: { name?: string; id: string };
  summary: {
    total_items: number;
    folder_count: number;
    file_count: number;
    file_types: Record<string, number>;
    total_size_mb?: string;
  };
  folders: FolderEntry[];
  files: FileEntry[];
}

export interface FolderTreeNode {
  name: string;
  id: string;
  type: "folder";
  children?: FolderTreeNode[];
  file_count?: number;
}

// ── Response summarisers ─────────────────────────────────────────

export function summarizeHubs(raw: unknown): { hubs: HubSummary[] } {
  const r = raw as Record<string, unknown> | undefined;
  const data = Array.isArray(r?.data) ? (r!.data as Record<string, unknown>[]) : [];
  const hubs: HubSummary[] = data.map((h) => {
    const attrs = h.attributes as Record<string, unknown> | undefined;
    const ext = attrs?.extension as Record<string, unknown> | undefined;
    return {
      name: (attrs?.name as string) ?? "(unknown)",
      id: h.id as string,
      type: (ext?.type as string) ?? (h.type as string) ?? "",
      region: (attrs?.region as string) ?? "US",
    };
  });
  return { hubs };
}

export function summarizeProjects(raw: unknown): { projects: ProjectSummary[] } {
  const r = raw as Record<string, unknown> | undefined;
  const data = Array.isArray(r?.data) ? (r!.data as Record<string, unknown>[]) : [];
  const projects: ProjectSummary[] = data.map((p) => {
    const attrs = p.attributes as Record<string, unknown> | undefined;
    const ext = attrs?.extension as Record<string, unknown> | undefined;
    const extType = (ext?.type as string) ?? "";
    let platform = "Unknown";
    if (extType.includes("bim360")) platform = "BIM 360";
    else if (extType.includes("accproject")) platform = "ACC";
    else if (extType.includes("a360")) platform = "A360";
    return {
      name: (attrs?.name as string) ?? "(unknown)",
      id: p.id as string,
      type: extType,
      platform,
      status: ((ext?.data as Record<string, unknown>)?.projectType as string) ?? undefined,
      last_modified: (attrs?.lastModifiedTime as string) ?? undefined,
    };
  });
  return { projects };
}

/** Summarise the JSON:API response from a top‑folders endpoint. */
export function summarizeTopFolders(
  raw: unknown,
  hubName?: string,
  projectName?: string,
): { context: { hub?: string; project?: string }; folders: FolderEntry[] } {
  const r = raw as Record<string, unknown> | undefined;
  const data = Array.isArray(r?.data) ? (r!.data as Record<string, unknown>[]) : [];
  const folders: FolderEntry[] = data.map((f) => {
    const attrs = f.attributes as Record<string, unknown> | undefined;
    return {
      name: (attrs?.displayName as string) ?? (attrs?.name as string) ?? "(unknown)",
      id: f.id as string,
      last_modified: (attrs?.lastModifiedTime as string) ?? "",
      object_count: (attrs?.objectCount as number) ?? undefined,
      hidden: (attrs?.hidden as boolean) === true,
    };
  });
  return {
    context: { hub: hubName, project: projectName },
    folders,
  };
}

/**
 * Summarise a folder‑contents JSON:API response.
 * Matches items → tip versions from the `included` array to get file sizes.
 */
export function summarizeFolderContents(
  raw: unknown,
  options?: {
    filterExtensions?: string[];
    excludeHidden?: boolean;
  },
): FolderContentsSummary {
  const r = raw as Record<string, unknown> | undefined;
  const data = Array.isArray(r?.data) ? (r!.data as Record<string, unknown>[]) : [];
  const included = Array.isArray(r?.included)
    ? (r!.included as Record<string, unknown>[])
    : [];

  // Build version lookup: version_id → attributes
  const versionMap = new Map<string, Record<string, unknown>>();
  for (const inc of included) {
    if (inc.type === "versions") {
      versionMap.set(inc.id as string, (inc.attributes as Record<string, unknown>) ?? {});
    }
  }

  const folders: FolderEntry[] = [];
  const files: FileEntry[] = [];

  for (const item of data) {
    const attrs = item.attributes as Record<string, unknown> | undefined;
    const hidden = (attrs?.hidden as boolean) === true;

    if (item.type === "folders") {
      if (options?.excludeHidden && hidden) continue;
      folders.push({
        name: (attrs?.displayName as string) ?? "(unknown)",
        id: item.id as string,
        last_modified: (attrs?.lastModifiedTime as string) ?? "",
        object_count: (attrs?.objectCount as number) ?? undefined,
        hidden,
      });
    } else if (item.type === "items") {
      if (options?.excludeHidden && hidden) continue;
      const name: string = (attrs?.displayName as string) ?? "(unknown)";
      const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "unknown";

      if (
        options?.filterExtensions?.length &&
        !options.filterExtensions.some((fe) => fe.replace(/^\./, "").toLowerCase() === ext)
      ) {
        continue;
      }

      const rels = item.relationships as Record<string, unknown> | undefined;
      const tip = rels?.tip as Record<string, unknown> | undefined;
      const tipData = tip?.data as Record<string, unknown> | undefined;
      const tipVersionId = tipData?.id as string | undefined;
      const vAttrs = tipVersionId ? versionMap.get(tipVersionId) : undefined;
      const sizeBytes = vAttrs?.storageSize as number | undefined;

      files.push({
        name,
        item_id: item.id as string,
        version_id: tipVersionId,
        type: ext,
        size_bytes: sizeBytes,
        size_mb: sizeBytes != null ? (sizeBytes / (1024 * 1024)).toFixed(1) : undefined,
        version_number: (vAttrs?.versionNumber as number) ?? undefined,
        last_modified: (attrs?.lastModifiedTime as string) ?? "",
        created: (attrs?.createTime as string) ?? "",
        hidden,
      });
    }
  }

  // Aggregate
  const fileTypes: Record<string, number> = {};
  let totalBytes = 0;
  let hasSizes = false;
  for (const f of files) {
    const key = `.${f.type}`;
    fileTypes[key] = (fileTypes[key] || 0) + 1;
    if (f.size_bytes != null) {
      totalBytes += f.size_bytes;
      hasSizes = true;
    }
  }

  return {
    folder: { id: "" }, // caller should set
    summary: {
      total_items: folders.length + files.length,
      folder_count: folders.length,
      file_count: files.length,
      file_types: fileTypes,
      total_size_mb: hasSizes ? (totalBytes / (1024 * 1024)).toFixed(1) : undefined,
    },
    folders,
    files,
  };
}

/** Summarise a single item (file) response, merging tip‑version metadata. */
export function summarizeItem(raw: unknown): Record<string, unknown> {
  const r = raw as Record<string, unknown> | undefined;
  const item = r?.data as Record<string, unknown> | undefined;
  if (!item) return { error: "No item data found in response" };

  const included = Array.isArray(r?.included) ? (r!.included as Record<string, unknown>[]) : [];
  const attrs = item.attributes as Record<string, unknown> | undefined;
  const rels = item.relationships as Record<string, unknown> | undefined;
  const tipData = (rels?.tip as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
  const tipVersionId = tipData?.id as string | undefined;
  const tipVersion = included.find(
    (i) => i.type === "versions" && i.id === tipVersionId,
  );
  const vAttrs = (tipVersion?.attributes as Record<string, unknown>) ?? {};

  const name = (attrs?.displayName as string) ?? "(unknown)";
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const sizeBytes = vAttrs.storageSize as number | undefined;

  return {
    name,
    item_id: item.id,
    type: ext || "unknown",
    version: {
      id: tipVersionId,
      number: vAttrs.versionNumber,
      size_bytes: sizeBytes,
      size_mb: sizeBytes != null ? (sizeBytes / (1024 * 1024)).toFixed(1) : undefined,
      file_type: vAttrs.fileType,
      last_modified: vAttrs.lastModifiedTime,
      created: vAttrs.createTime,
    },
    created: attrs?.createTime,
    last_modified: attrs?.lastModifiedTime,
    hidden: (attrs?.hidden as boolean) === true,
  };
}

// ── Folder tree builder ──────────────────────────────────────────

export async function buildFolderTree(
  projectId: string,
  folderId: string,
  token: string,
  maxDepth: number = 3,
  _currentDepth: number = 0,
): Promise<FolderTreeNode> {
  const path = `data/v1/projects/${projectId}/folders/${encodeURIComponent(folderId)}/contents`;
  const raw = (await apsDmRequest("GET", path, token, {
    query: { "page[limit]": "200" },
  })) as Record<string, unknown>;
  const data = Array.isArray(raw.data) ? (raw.data as Record<string, unknown>[]) : [];

  const childFolders: FolderTreeNode[] = [];
  let fileCount = 0;

  for (const item of data) {
    const attrs = item.attributes as Record<string, unknown> | undefined;
    if (item.type === "folders") {
      if (_currentDepth < maxDepth - 1) {
        const child = await buildFolderTree(
          projectId,
          item.id as string,
          token,
          maxDepth,
          _currentDepth + 1,
        );
        child.name = (attrs?.displayName as string) ?? "(unknown)";
        childFolders.push(child);
      } else {
        childFolders.push({
          name: (attrs?.displayName as string) ?? "(unknown)",
          id: item.id as string,
          type: "folder",
          // max depth reached – children not fetched
        });
      }
    } else {
      fileCount++;
    }
  }

  // Resolve folder name at the root level of the call
  let folderName = folderId;
  if (_currentDepth === 0) {
    try {
      const folderRaw = (await apsDmRequest(
        "GET",
        `data/v1/projects/${projectId}/folders/${encodeURIComponent(folderId)}`,
        token,
      )) as Record<string, unknown>;
      const fAttrs = (folderRaw.data as Record<string, unknown>)?.attributes as
        | Record<string, unknown>
        | undefined;
      folderName = (fAttrs?.displayName as string) ?? folderId;
    } catch {
      // keep folderId as name
    }
  }

  return {
    name: folderName,
    id: folderId,
    type: "folder",
    children: childFolders.length > 0 ? childFolders : undefined,
    file_count: fileCount,
  };
}

// ── Error context ────────────────────────────────────────────────

const ERROR_HINTS: Record<number, { likely_cause: string; fix: string }> = {
  400: {
    likely_cause: "Malformed request – invalid JSON body, bad query parameters, or wrong Content‑Type",
    fix: "Check the request body matches the JSON:API spec. Ensure query keys like page[number] are formatted correctly.",
  },
  401: {
    likely_cause: "Token expired or invalid credentials",
    fix: "Verify APS_CLIENT_ID and APS_CLIENT_SECRET are correct. Tokens expire after 1 hour and are auto‑refreshed.",
  },
  403: {
    likely_cause: "App not provisioned to this BIM 360/ACC account, or insufficient OAuth scopes",
    fix: "Account admin must add your app in Account Settings → Custom Integrations. Also ensure APS_SCOPE includes the required scopes (e.g. 'data:read data:write').",
  },
  404: {
    likely_cause: "Resource not found – wrong ID, deleted item, or incorrect path",
    fix: "Verify: hub/project IDs start with 'b.', folder/item IDs are URNs starting with 'urn:', and the resource exists in ACC/BIM 360.",
  },
  409: {
    likely_cause: "Conflict – resource already exists or concurrent modification",
    fix: "Check if a folder/item with the same name already exists. Retry after a brief wait if caused by concurrency.",
  },
  429: {
    likely_cause: "Rate limit exceeded",
    fix: "Wait 60 seconds before retrying. APS rate limits vary by endpoint (typically 100‑300 req/min).",
  },
  500: {
    likely_cause: "APS internal server error",
    fix: "Retry after 30 seconds. If persistent, check https://health.autodesk.com for service status.",
  },
  503: {
    likely_cause: "APS service temporarily unavailable",
    fix: "Retry after 60 seconds. Check https://health.autodesk.com for service status.",
  },
};

function statusText(code: number): string {
  const m: Record<number, string> = {
    400: "Bad Request", 401: "Unauthorized", 403: "Forbidden",
    404: "Not Found", 409: "Conflict", 429: "Too Many Requests",
    500: "Internal Server Error", 503: "Service Unavailable",
  };
  return m[code] ?? "Error";
}

export function getErrorContext(
  statusCode: number,
  method: string,
  path: string,
  responseBody?: string,
): Record<string, unknown> {
  const hint = ERROR_HINTS[statusCode];
  const result: Record<string, unknown> = {
    error: `${statusCode} ${statusText(statusCode)}`,
    method,
    path,
  };
  if (hint) {
    result.likely_cause = hint.likely_cause;
    result.fix = hint.fix;
  }
  if (responseBody) {
    try {
      result.api_error = JSON.parse(responseBody);
    } catch {
      result.api_error = responseBody.substring(0, 500);
    }
  }
  return result;
}

// ── Parameter validation ─────────────────────────────────────────

export function validatePath(path: string): string | null {
  if (!path || typeof path !== "string") return "path is required and must be a non‑empty string.";
  if (path.includes("..")) return "path must not contain '..'.";
  if (/^(hubs|projects|folders|items|versions)\b/.test(path)) {
    return `path looks like it's missing the version prefix. Did you mean 'project/v1/${path}' or 'data/v1/${path}'?`;
  }
  return null; // valid
}

export function validateHubId(id: string): string | null {
  if (!id) return "hub_id is required.";
  if (!id.startsWith("b.")) return `hub_id should start with 'b.' (e.g. 'b.abc123…'). Got: '${id}'.`;
  return null;
}

export function validateProjectId(id: string): string | null {
  if (!id) return "project_id is required.";
  if (!id.startsWith("b.")) return `project_id should start with 'b.' (e.g. 'b.abc123…'). Got: '${id}'.`;
  return null;
}

export function validateFolderId(id: string): string | null {
  if (!id) return "folder_id is required.";
  if (!id.startsWith("urn:")) return `folder_id should be a URN starting with 'urn:'. Got: '${id.substring(0, 40)}…'.`;
  return null;
}

export function validateItemId(id: string): string | null {
  if (!id) return "item_id is required.";
  if (!id.startsWith("urn:")) return `item_id should be a URN starting with 'urn:'. Got: '${id.substring(0, 40)}…'.`;
  return null;
}

// ── Quick‑reference documentation ────────────────────────────────

export const APS_DOCS = `# APS Data Management – Quick Reference

## Common ID Formats
- **Hub ID**: \`b.<account_id>\` (e.g. \`b.abc12345-6789-…\`)
- **Project ID**: \`b.<project_id>\` (same format as hub)
- **Folder URN**: \`urn:adsk.wipprod:fs.folder:co.<id>\`
- **Item URN (lineage)**: \`urn:adsk.wipprod:dm.lineage:<id>\`
- **Version URN**: \`urn:adsk.wipprod:fs.file:vf.<id>?version=<n>\`

## Typical Browsing Workflow
\`\`\`
1. aps_list_hubs                                      → pick a hub
2. aps_list_projects        hub_id                    → pick a project
3. aps_get_top_folders      hub_id + project_id       → see root folders
4. aps_get_folder_contents  project_id + folder_id    → browse files
5. aps_get_item_details     project_id + item_id      → file metadata
\`\`\`

## Raw API Paths (for aps_dm_request)
| Action | Method | Path |
|--------|--------|------|
| List hubs | GET | project/v1/hubs |
| List projects | GET | project/v1/hubs/{hub_id}/projects |
| Top folders | GET | project/v1/hubs/{hub_id}/projects/{project_id}/topFolders |
| Folder contents | GET | data/v1/projects/{project_id}/folders/{folder_id}/contents |
| Item details | GET | data/v1/projects/{project_id}/items/{item_id} |
| Item tip version | GET | data/v1/projects/{project_id}/items/{item_id}/tip |
| All versions | GET | data/v1/projects/{project_id}/items/{item_id}/versions |
| Search folder | GET | data/v1/projects/{project_id}/folders/{folder_id}/search |
| Create folder | POST | data/v1/projects/{project_id}/folders |
| Download | GET | (use storage URL from version relationships.storage.meta.link.href) |

## Query Parameters
- \`page[number]\` – page index (0‑based)
- \`page[limit]\` – items per page (default 25, max 200)
- \`filter[type]\` – filter by resource type
- \`filter[extension.type]\` – filter by extension type
- \`includeHidden\` – include hidden items (default false)

## Common BIM File Extensions
| Extension | Description |
|-----------|-------------|
| .rvt | Revit Model |
| .rfa | Revit Family |
| .nwd | Navisworks (full) |
| .nwc | Navisworks Cache |
| .ifc | Industry Foundation Classes |
| .dwg | AutoCAD Drawing |
| .dwfx | Design Web Format |
| .pdf | PDF Document |

## Error Troubleshooting
| Code | Common Cause | Fix |
|------|-------------|-----|
| 401 | Expired / invalid token | Check credentials; token auto‑refreshes |
| 403 | App not provisioned | Admin → Account Settings → Custom Integrations |
| 404 | Wrong ID format | Hub/project use 'b.' prefix; folders/items use 'urn:' |
| 429 | Rate limited | Wait 60 s, reduce request frequency |

## Full Specification
- Docs: https://aps.autodesk.com/en/docs/data/v2/reference/http/
- OpenAPI: https://github.com/autodesk-platform-services/aps-sdk-openapi/blob/main/datamanagement/datamanagement.yaml
`;
