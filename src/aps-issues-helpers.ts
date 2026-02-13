/**
 * APS Construction Issues helpers: response summarisers, validators,
 * project‑ID conversion, and quick‑reference docs.
 *
 * Follows the same patterns as aps‑helpers.ts (Data Management).
 */

// ── Shared tiny types ────────────────────────────────────────────

export interface IssueSummary {
  id: string;
  displayId: number;
  title: string;
  status: string;
  assignedTo?: string;
  assignedToType?: string;
  dueDate?: string;
  startDate?: string;
  locationDetails?: string;
  rootCauseId?: string;
  published: boolean;
  commentCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  closedBy?: string;
  closedAt?: string;
}

export interface IssueDetailSummary extends IssueSummary {
  description?: string;
  issueTypeId?: string;
  issueSubtypeId?: string;
  locationId?: string;
  customAttributes?: { id: string; value: unknown; type?: string; title?: string }[];
  linkedDocumentCount: number;
  watchers?: string[];
  permittedStatuses?: string[];
}

export interface IssueTypeSummary {
  id: string;
  title: string;
  isActive: boolean;
  subtypes?: { id: string; title: string; code?: string; isActive: boolean }[];
}

export interface IssueCommentSummary {
  id: string;
  body: string;
  createdBy: string;
  createdAt: string;
}

export interface RootCauseCategorySummary {
  id: string;
  title: string;
  isActive: boolean;
  rootCauses?: { id: string; title: string; isActive: boolean }[];
}

// ── Project ID helper ────────────────────────────────────────────

/**
 * Strip the 'b.' prefix from a project ID for the ACC Issues API.
 * The Issues API uses raw project GUIDs, while the Data Management
 * API uses 'b.'‑prefixed IDs. Accepts either format.
 */
export function toIssuesProjectId(projectId: string): string {
  return projectId.replace(/^b\./, "");
}

// ── Response summarisers ─────────────────────────────────────────

/** Extract pagination from raw response. */
function extractPagination(r: Record<string, unknown> | undefined): { limit: number; offset: number; totalResults: number } {
  const p = r?.pagination as Record<string, unknown> | undefined;
  return {
    limit: (p?.limit as number) ?? 0,
    offset: (p?.offset as number) ?? 0,
    totalResults: (p?.totalResults as number) ?? 0,
  };
}

/** Summarise a paginated issues list – drops permittedActions/Attributes, linkedDocuments, etc. */
export function summarizeIssuesList(raw: unknown): {
  pagination: { limit: number; offset: number; totalResults: number };
  issues: IssueSummary[];
} {
  const r = raw as Record<string, unknown> | undefined;
  const pagination = extractPagination(r);
  const results = Array.isArray(r?.results)
    ? (r!.results as Record<string, unknown>[])
    : [];

  const issues: IssueSummary[] = results.map((issue) => ({
    id: issue.id as string,
    displayId: (issue.displayId as number) ?? 0,
    title: (issue.title as string) ?? "",
    status: (issue.status as string) ?? "",
    assignedTo: (issue.assignedTo as string) ?? undefined,
    assignedToType: (issue.assignedToType as string) ?? undefined,
    dueDate: (issue.dueDate as string) ?? undefined,
    startDate: (issue.startDate as string) ?? undefined,
    locationDetails: (issue.locationDetails as string) ?? undefined,
    rootCauseId: (issue.rootCauseId as string) ?? undefined,
    published: (issue.published as boolean) ?? false,
    commentCount: (issue.commentCount as number) ?? 0,
    createdBy: (issue.createdBy as string) ?? "",
    createdAt: (issue.createdAt as string) ?? "",
    updatedAt: (issue.updatedAt as string) ?? "",
    closedBy: (issue.closedBy as string) ?? undefined,
    closedAt: (issue.closedAt as string) ?? undefined,
  }));

  return { pagination, issues };
}

/** Summarise a single issue response – keeps more detail than the list summary. */
export function summarizeIssueDetail(raw: unknown): IssueDetailSummary {
  const issue = raw as Record<string, unknown>;

  const customAttrs = Array.isArray(issue.customAttributes)
    ? (issue.customAttributes as Record<string, unknown>[]).map((ca) => ({
        id: (ca.attributeDefinitionId as string) ?? "",
        value: ca.value,
        type: (ca.type as string) ?? undefined,
        title: (ca.title as string) ?? undefined,
      }))
    : undefined;

  const linkedDocs = Array.isArray(issue.linkedDocuments)
    ? issue.linkedDocuments.length
    : 0;

  return {
    id: issue.id as string,
    displayId: (issue.displayId as number) ?? 0,
    title: (issue.title as string) ?? "",
    description: (issue.description as string) ?? undefined,
    status: (issue.status as string) ?? "",
    issueTypeId: (issue.issueTypeId as string) ?? undefined,
    issueSubtypeId: (issue.issueSubtypeId as string) ?? undefined,
    assignedTo: (issue.assignedTo as string) ?? undefined,
    assignedToType: (issue.assignedToType as string) ?? undefined,
    dueDate: (issue.dueDate as string) ?? undefined,
    startDate: (issue.startDate as string) ?? undefined,
    locationId: (issue.locationId as string) ?? undefined,
    locationDetails: (issue.locationDetails as string) ?? undefined,
    rootCauseId: (issue.rootCauseId as string) ?? undefined,
    published: (issue.published as boolean) ?? false,
    commentCount: (issue.commentCount as number) ?? 0,
    createdBy: (issue.createdBy as string) ?? "",
    createdAt: (issue.createdAt as string) ?? "",
    updatedAt: (issue.updatedAt as string) ?? "",
    closedBy: (issue.closedBy as string) ?? undefined,
    closedAt: (issue.closedAt as string) ?? undefined,
    customAttributes: customAttrs,
    linkedDocumentCount: linkedDocs,
    watchers: Array.isArray(issue.watchers)
      ? (issue.watchers as string[])
      : undefined,
    permittedStatuses: Array.isArray(issue.permittedStatuses)
      ? (issue.permittedStatuses as string[])
      : undefined,
  };
}

/** Summarise issue types/categories response. */
export function summarizeIssueTypes(raw: unknown): {
  pagination: { limit: number; offset: number; totalResults: number };
  types: IssueTypeSummary[];
} {
  const r = raw as Record<string, unknown> | undefined;
  const pagination = extractPagination(r);
  const results = Array.isArray(r?.results)
    ? (r!.results as Record<string, unknown>[])
    : [];

  const types: IssueTypeSummary[] = results.map((t) => {
    const subtypes = Array.isArray(t.subtypes)
      ? (t.subtypes as Record<string, unknown>[]).map((st) => ({
          id: st.id as string,
          title: (st.title as string) ?? "",
          code: (st.code as string) ?? undefined,
          isActive: (st.isActive as boolean) ?? false,
        }))
      : undefined;

    return {
      id: t.id as string,
      title: (t.title as string) ?? "",
      isActive: (t.isActive as boolean) ?? false,
      subtypes,
    };
  });

  return { pagination, types };
}

/** Summarise issue comments response. */
export function summarizeComments(raw: unknown): {
  pagination: { limit: number; offset: number; totalResults: number };
  comments: IssueCommentSummary[];
} {
  const r = raw as Record<string, unknown> | undefined;
  const pagination = extractPagination(r);
  const results = Array.isArray(r?.results)
    ? (r!.results as Record<string, unknown>[])
    : [];

  const comments: IssueCommentSummary[] = results.map((c) => ({
    id: c.id as string,
    body: (c.body as string) ?? "",
    createdBy: (c.createdBy as string) ?? "",
    createdAt: (c.createdAt as string) ?? "",
  }));

  return { pagination, comments };
}

/** Summarise root cause categories response. */
export function summarizeRootCauseCategories(raw: unknown): {
  pagination: { limit: number; offset: number; totalResults: number };
  categories: RootCauseCategorySummary[];
} {
  const r = raw as Record<string, unknown> | undefined;
  const pagination = extractPagination(r);
  const results = Array.isArray(r?.results)
    ? (r!.results as Record<string, unknown>[])
    : [];

  const categories: RootCauseCategorySummary[] = results.map((cat) => {
    const rootCauses = Array.isArray(cat.rootCauses)
      ? (cat.rootCauses as Record<string, unknown>[]).map((rc) => ({
          id: rc.id as string,
          title: (rc.title as string) ?? "",
          isActive: (rc.isActive as boolean) ?? false,
        }))
      : undefined;

    return {
      id: cat.id as string,
      title: (cat.title as string) ?? "",
      isActive: (cat.isActive as boolean) ?? false,
      rootCauses,
    };
  });

  return { pagination, categories };
}

// ── Parameter validation ─────────────────────────────────────────

export function validateIssuesProjectId(id: string): string | null {
  if (!id) return "project_id is required.";
  return null;
}

export function validateIssueId(id: string): string | null {
  if (!id) return "issue_id is required.";
  return null;
}

export function validateIssuesPath(path: string): string | null {
  if (!path || typeof path !== "string")
    return "path is required and must be a non‑empty string.";
  if (path.includes("..")) return "path must not contain '..'.";
  return null;
}

// ── Quick‑reference documentation ────────────────────────────────

export const ISSUES_DOCS = `# ACC Issues API – Quick Reference

## Important: Project ID Format
The Issues API uses project IDs **without** the 'b.' prefix.
- Data Management ID: \`b.a4be0c34a-4ab7\`
- Issues API ID:      \`a4be0c34a-4ab7\`

The simplified tools handle this conversion automatically – you can pass either format.

## Statuses
\`draft\` → \`open\` → \`pending\` / \`in_progress\` / \`in_review\` / \`completed\` / \`not_approved\` / \`in_dispute\` → \`closed\`

## Typical Workflow
\`\`\`
1. aps_issues_get_types     project_id                     → get issue categories & types
2. aps_issues_list          project_id + filters           → browse issues
3. aps_issues_get           project_id + issue_id          → single issue details
4. aps_issues_create        project_id + title + subtype   → create new issue
5. aps_issues_update        project_id + issue_id + fields → update issue
6. aps_issues_get_comments  project_id + issue_id          → read comments
7. aps_issues_create_comment project_id + issue_id + body  → add comment
\`\`\`

## Raw API Paths (for aps_issues_request)
| Action | Method | Path |
|--------|--------|------|
| User profile | GET | construction/issues/v1/projects/{projectId}/users/me |
| Issue types | GET | construction/issues/v1/projects/{projectId}/issue-types?include=subtypes |
| Attribute definitions | GET | construction/issues/v1/projects/{projectId}/issue-attribute-definitions |
| Attribute mappings | GET | construction/issues/v1/projects/{projectId}/issue-attribute-mappings |
| Root cause categories | GET | construction/issues/v1/projects/{projectId}/issue-root-cause-categories?include=rootcauses |
| List issues | GET | construction/issues/v1/projects/{projectId}/issues |
| Create issue | POST | construction/issues/v1/projects/{projectId}/issues |
| Get issue | GET | construction/issues/v1/projects/{projectId}/issues/{issueId} |
| Update issue | PATCH | construction/issues/v1/projects/{projectId}/issues/{issueId} |
| List comments | GET | construction/issues/v1/projects/{projectId}/issues/{issueId}/comments |
| Create comment | POST | construction/issues/v1/projects/{projectId}/issues/{issueId}/comments |

## Common Filters (for aps_issues_list)
- \`filter[status]\` – open, closed, pending, in_progress, etc.
- \`filter[assignedTo]\` – Autodesk user/company/role ID
- \`filter[issueTypeId]\` – category UUID
- \`filter[issueSubtypeId]\` – type UUID
- \`filter[dueDate]\` – YYYY-MM-DD
- \`filter[createdAt]\` – YYYY-MM-DDThh:mm:ss.sz
- \`filter[search]\` – search by title or display ID
- \`filter[locationId]\` – LBS location UUID
- \`filter[rootCauseId]\` – root cause UUID
- \`filter[displayId]\` – chronological issue number

## Sort Options
\`createdAt\`, \`updatedAt\`, \`displayId\`, \`title\`, \`status\`, \`assignedTo\`, \`dueDate\`, \`startDate\`, \`closedAt\`
Prefix with \`-\` for descending (e.g. \`-createdAt\`).

## Region Header (x-ads-region)
Possible values: \`US\` (default), \`EMEA\`, \`AUS\`, \`CAN\`, \`DEU\`, \`IND\`, \`JPN\`, \`GBR\`.
Pass as the \`region\` parameter on any Issues tool.

## Creating an Issue (required fields)
- \`title\` – the issue title (max 10,000 chars)
- \`issueSubtypeId\` – the type UUID (get from aps_issues_get_types)
- \`status\` – initial status (e.g. 'open')

## Error Troubleshooting
| Code | Common Cause | Fix |
|------|-------------|-----|
| 401 | Expired / invalid token | Check credentials; token auto‑refreshes |
| 403 | App not provisioned or insufficient scopes | Admin → Account Settings → Custom Integrations. Ensure scope includes 'data:read data:write' for write operations |
| 404 | Wrong project ID or issue not found | Ensure project ID has no 'b.' prefix for raw API calls |
| 409 | Conflict (e.g. duplicate) | Check for existing resource |
| 422 | Attachment limit reached (100/issue) | Remove old attachments first |

## Full Specification
- OpenAPI: https://github.com/autodesk-platform-services/aps-sdk-openapi/blob/main/construction/issues/Issues.yaml
`;
