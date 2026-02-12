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
  viewer_url?: string;
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

// ── Viewer URL builder ───────────────────────────────────────────

/**
 * Build an ACC viewer URL for a file.
 * Format: https://acc.autodesk.com/build/files/projects/{id}?folderUrn=…&entityId=…&viewModel=detail&moduleId=folders
 * @param projectId – project ID with 'b.' prefix (will be stripped)
 * @param folderId  – folder URN
 * @param itemId    – item (lineage) URN
 */
export function buildViewerUrl(projectId: string, folderId: string, itemId: string): string {
  const projectGuid = projectId.replace(/^b\./, "");
  const folderUrn = encodeURIComponent(folderId);
  const entityId = encodeURIComponent(itemId);
  return (
    `https://acc.autodesk.com/build/files/projects/${projectGuid}` +
    `?folderUrn=${folderUrn}&entityId=${entityId}&viewModel=detail&moduleId=folders`
  );
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
    projectId?: string;
    folderId?: string;
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

      const fileItemId = item.id as string;
      files.push({
        name,
        item_id: fileItemId,
        version_id: tipVersionId,
        type: ext,
        size_bytes: sizeBytes,
        size_mb: sizeBytes != null ? (sizeBytes / (1024 * 1024)).toFixed(1) : undefined,
        version_number: (vAttrs?.versionNumber as number) ?? undefined,
        last_modified: (attrs?.lastModifiedTime as string) ?? "",
        created: (attrs?.createTime as string) ?? "",
        hidden,
        viewer_url:
          options?.projectId && options?.folderId
            ? buildViewerUrl(options.projectId, options.folderId, fileItemId)
            : undefined,
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
export function summarizeItem(
  raw: unknown,
  options?: { projectId?: string },
): Record<string, unknown> {
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

  // Extract parent folder URN from relationships for viewer URL
  const parentData = (rels?.parent as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
  const parentFolderId = parentData?.id as string | undefined;

  const name = (attrs?.displayName as string) ?? "(unknown)";
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const sizeBytes = vAttrs.storageSize as number | undefined;
  const itemId = item.id as string;

  return {
    name,
    item_id: itemId,
    type: ext || "unknown",
    viewer_url:
      options?.projectId && parentFolderId
        ? buildViewerUrl(options.projectId, parentFolderId, itemId)
        : undefined,
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

// ══════════════════════════════════════════════════════════════════
// ── ACC Submittals helpers ────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

// ── Submittal types ──────────────────────────────────────────────

export interface SubmittalItemSummary {
  id: string;
  title: string;
  number?: string;
  spec_identifier?: string;
  subsection?: string;
  type?: string;
  status?: string;
  priority?: string;
  revision?: number;
  description?: string;
  manager?: string;
  subcontractor?: string;
  due_date?: string;
  required_on_job_date?: string;
  response?: string;
  response_comment?: string;
  created_at?: string;
  updated_at?: string;
  package_title?: string;
  package_id?: string;
}

export interface SubmittalPackageSummary {
  id: string;
  title: string;
  identifier?: number;
  spec_identifier?: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SubmittalSpecSummary {
  id: string;
  identifier: string;
  title: string;
  created_at?: string;
  updated_at?: string;
}

export interface SubmittalAttachmentSummary {
  id: string;
  name: string;
  urn?: string;
  upload_urn?: string;
  revision?: number;
  category?: string;
  created_at?: string;
  created_by?: string;
}

// ── ACC project‑ID helper ────────────────────────────────────────

/**
 * Convert a project ID from DM format ('b.uuid') to ACC format ('uuid').
 * If the ID already lacks the 'b.' prefix, it is returned as‑is.
 */
export function toAccProjectId(projectId: string): string {
  return projectId.replace(/^b\./, "");
}

// ── Submittal base path builder ──────────────────────────────────

const SUBMITTALS_BASE = "construction/submittals/v2";

/** Build the Submittals API path for a given project. */
export function submittalPath(projectId: string, subPath: string): string {
  const pid = toAccProjectId(projectId);
  const sub = subPath.replace(/^\//, "");
  return `${SUBMITTALS_BASE}/projects/${pid}/${sub}`;
}

// ── Submittal response summarisers ───────────────────────────────

/**
 * Summarise the paginated response from GET /items.
 * ACC Submittals API returns `{ pagination, results }` with camelCase fields.
 */
export function summarizeSubmittalItems(raw: unknown): {
  pagination: { total: number; limit: number; offset: number };
  items: SubmittalItemSummary[];
} {
  const r = raw as Record<string, unknown> | undefined;
  const pagination = r?.pagination as Record<string, unknown> | undefined;
  const results = Array.isArray(r?.results)
    ? (r!.results as Record<string, unknown>[])
    : [];

  const items: SubmittalItemSummary[] = results.map((item) => ({
    id: item.id as string,
    title: (item.title as string) ?? "(untitled)",
    number:
      (item.customIdentifierHumanReadable as string) ??
      (item.customIdentifier as string) ??
      undefined,
    spec_identifier: (item.specIdentifier as string) ?? undefined,
    subsection: (item.subsection as string) ?? undefined,
    type: (item.typeValue as string) ?? (item.type as string) ?? undefined,
    status: (item.statusValue as string) ?? (item.status as string) ?? undefined,
    priority: (item.priorityValue as string) ?? (item.priority as string) ?? undefined,
    revision: (item.revision as number) ?? undefined,
    description: (item.description as string) ?? undefined,
    manager: (item.manager as string) ?? undefined,
    subcontractor: (item.subcontractor as string) ?? undefined,
    due_date: (item.dueDate as string) ?? undefined,
    required_on_job_date: (item.requiredOnJobDate as string) ?? undefined,
    response: (item.responseValue as string) ?? undefined,
    response_comment: (item.responseComment as string) ?? undefined,
    created_at: (item.createdAt as string) ?? undefined,
    updated_at: (item.updatedAt as string) ?? undefined,
    package_title: (item.packageTitle as string) ?? undefined,
    package_id: (item.package as string) ?? undefined,
  }));

  return {
    pagination: {
      total: (pagination?.totalResults as number) ?? items.length,
      limit: (pagination?.limit as number) ?? 0,
      offset: (pagination?.offset as number) ?? 0,
    },
    items,
  };
}

/** Summarise the paginated response from GET /packages. */
export function summarizeSubmittalPackages(raw: unknown): {
  pagination: { total: number; limit: number; offset: number };
  packages: SubmittalPackageSummary[];
} {
  const r = raw as Record<string, unknown> | undefined;
  const pagination = r?.pagination as Record<string, unknown> | undefined;
  const results = Array.isArray(r?.results)
    ? (r!.results as Record<string, unknown>[])
    : [];

  const packages: SubmittalPackageSummary[] = results.map((pkg) => ({
    id: pkg.id as string,
    title: (pkg.title as string) ?? "(untitled)",
    identifier: (pkg.identifier as number) ?? undefined,
    spec_identifier: (pkg.specIdentifier as string) ?? undefined,
    description: (pkg.description as string) ?? undefined,
    created_at: (pkg.createdAt as string) ?? undefined,
    updated_at: (pkg.updatedAt as string) ?? undefined,
  }));

  return {
    pagination: {
      total: (pagination?.totalResults as number) ?? packages.length,
      limit: (pagination?.limit as number) ?? 0,
      offset: (pagination?.offset as number) ?? 0,
    },
    packages,
  };
}

/** Summarise the paginated response from GET /specs. */
export function summarizeSubmittalSpecs(raw: unknown): {
  pagination: { total: number; limit: number; offset: number };
  specs: SubmittalSpecSummary[];
} {
  const r = raw as Record<string, unknown> | undefined;
  const pagination = r?.pagination as Record<string, unknown> | undefined;
  const results = Array.isArray(r?.results)
    ? (r!.results as Record<string, unknown>[])
    : [];

  const specs: SubmittalSpecSummary[] = results.map((spec) => ({
    id: spec.id as string,
    identifier: (spec.identifier as string) ?? "",
    title: (spec.title as string) ?? "(untitled)",
    created_at: (spec.createdAt as string) ?? undefined,
    updated_at: (spec.updatedAt as string) ?? undefined,
  }));

  return {
    pagination: {
      total: (pagination?.totalResults as number) ?? specs.length,
      limit: (pagination?.limit as number) ?? 0,
      offset: (pagination?.offset as number) ?? 0,
    },
    specs,
  };
}

/** Summarise the response from GET /items/:itemId/attachments. */
export function summarizeSubmittalAttachments(raw: unknown): {
  attachments: SubmittalAttachmentSummary[];
} {
  // The response may be { results: [...] } or just an array
  const r = raw as Record<string, unknown> | undefined;
  const results = Array.isArray(r?.results)
    ? (r!.results as Record<string, unknown>[])
    : Array.isArray(raw)
      ? (raw as Record<string, unknown>[])
      : [];

  const attachments: SubmittalAttachmentSummary[] = results.map((att) => ({
    id: att.id as string,
    name: (att.name as string) ?? "(unknown)",
    urn: (att.urn as string) ?? undefined,
    upload_urn: (att.uploadUrn as string) ?? undefined,
    revision: (att.revision as number) ?? undefined,
    category: (att.categoryValue as string) ?? (att.category as string) ?? undefined,
    created_at: (att.createdAt as string) ?? undefined,
    created_by: (att.createdBy as string) ?? undefined,
  }));

  return { attachments };
}

// ── Submittal‑specific validation ────────────────────────────────

export function validateSubmittalProjectId(id: string): string | null {
  if (!id) return "project_id is required.";
  // Accept both 'b.uuid' (DM format) and plain UUID (ACC format)
  return null;
}

export function validateSubmittalItemId(id: string): string | null {
  if (!id) return "item_id is required.";
  return null;
}

export function validateSubmittalPath(path: string): string | null {
  if (!path || typeof path !== "string") return "path is required and must be a non‑empty string.";
  if (path.includes("..")) return "path must not contain '..'.";
  return null;
}

// ── Quick‑reference documentation ────────────────────────────────

export const SUBMITTALS_DOCS = `# ACC Submittals API – Quick Reference

## Overview
The ACC Submittals API lets you read and create submittal items, packages, spec sections,
attachments, and responses for Autodesk Construction Cloud (ACC Build) projects.

## Project ID Format
- The Submittals API uses **UUID** project IDs (e.g. \`abc12345-6789-…\`).
- If you have a Data Management project ID with \`b.\` prefix, the prefix is stripped automatically.
- Account ID is also a UUID (hub ID without \`b.\` prefix).

## Authentication
- **2‑legged OAuth** with scopes: \`data:read\` (read), \`data:write\` (create/update).
- Uses the same token as the Data Management tools.

## API Base Path
\`https://developer.api.autodesk.com/construction/submittals/v2/projects/{projectId}/…\`

## Available Endpoints

### Read Endpoints
| Action | Method | Path |
|--------|--------|------|
| List submittal items | GET | items |
| Get submittal item | GET | items/{itemId} |
| List packages | GET | packages |
| Get package | GET | packages/{packageId} |
| List spec sections | GET | specs |
| Get item type | GET | item-types/{id} |
| List item types | GET | item-types |
| List responses | GET | responses |
| Get response | GET | responses/{id} |
| Item attachments | GET | items/{itemId}/attachments |
| Project metadata | GET | metadata |
| Manager settings | GET | settings/mappings |
| Current user perms | GET | users/me |
| Next custom number | GET | items:next-custom-identifier |

### Write Endpoints
| Action | Method | Path |
|--------|--------|------|
| Create submittal item | POST | items |
| Create spec section | POST | specs |
| Validate custom number | POST | items:validate-custom-identifier |

## Common Query Parameters (GET items)
- \`limit\` – items per page (default 20, max 200)
- \`offset\` – pagination offset
- \`filter[statusId]\` – filter by status: 1=Required, 2=Open, 3=Closed, 4=Void, 5=Empty, 6=Draft
- \`filter[packageId]\` – filter by package ID
- \`filter[reviewResponseId]\` – filter by review response ID
- \`filter[specId]\` – filter by spec section ID
- \`sort\` – sort by field (e.g. \`title\`, \`createdAt\`)

## Submittal Item Statuses
| ID | Status |
|----|--------|
| 1 | Required |
| 2 | Open |
| 3 | Closed |
| 4 | Void |
| 5 | Empty |
| 6 | Draft |

## Submittal Item Priorities
| ID | Priority |
|----|----------|
| 1 | Low |
| 2 | Normal |
| 3 | High |

## Custom Numbering
- **Global format**: items get a global sequential number.
- **Spec section format**: items numbered as \`<specId>-<sequence>\` (e.g. \`033100-01\`).
- \`customIdentifier\` – the sequential number portion.
- \`customIdentifierHumanReadable\` – the full display number.

## Typical Workflow
\`\`\`
1. aps_list_hubs / aps_list_projects          → get project ID
2. aps_list_submittal_specs   project_id       → see spec sections
3. aps_list_submittal_packages project_id      → see packages
4. aps_list_submittal_items   project_id       → browse items (with filters)
5. aps_get_submittal_item     project_id + id  → item details
6. aps_get_submittal_item_attachments          → view attachments
\`\`\`

## Key Concepts
- **Submittal Item**: A document (shop drawing, product data, sample, etc.) that requires review.
- **Package**: Groups related submittal items for batch submission.
- **Spec Section**: A specification division (e.g. "033100 – Structural Concrete").
- **Response**: The review outcome (e.g. Approved, Revise and Resubmit).
- **Review Step / Task**: Multi‑step review workflow with assigned reviewers.

## Full Documentation
- Field Guide: https://aps.autodesk.com/en/docs/acc/v1/overview/field-guide/submittals/
- API Reference: https://aps.autodesk.com/en/docs/acc/v1/reference/http/submittals-items-GET/
- Create Item Tutorial: https://aps.autodesk.com/en/docs/acc/v1/tutorials/submittals/create-submittal-item/
- Data Schema: https://developer.api.autodesk.com/data-connector/v1/doc/schema?name=submittalsacc&format=html
`;

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
