/**
 * APS ACC Submittals helpers: response summarisers, path builders,
 * parameter validation, and quick‑reference docs.
 */

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
