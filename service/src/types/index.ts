/**
 * ─────────────────────────────────────────────────────────
 * Core type definitions for the API Provisioning Service.
 * All interfaces are implementation-neutral contracts.
 * ─────────────────────────────────────────────────────────
 */

// ── Pipeline Stages ───────────────────────────────────────

export type PipelineStage = "validate" | "publish" | "provision" | "sync";

export interface PipelineResult {
  stage: PipelineStage;
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

// ── Provisioning ──────────────────────────────────────────

export type UpdateMode = "manual" | "auto";

export type WorkspacePolicyPreset = "standard" | "restricted" | "open-internal";

export interface ProvisionRequest {
  partner_name: string;
  partner_domains: string[];
  api_package_ids: string[];
  update_mode: UpdateMode;
  workspace_policy: WorkspacePolicyPreset;
  requested_by: string;
  /** Optional: team identifier for per-team allowlists */
  team_id?: string;
  /** Optional: additional metadata */
  metadata?: Record<string, string>;
}

export type ProvisionStatus =
  | "pending"
  | "validating"
  | "provisioning"
  | "copying_assets"
  | "setting_permissions"
  | "enrolling_updates"
  | "completed"
  | "failed"
  | "rolled_back";

export interface ProvisionResult {
  id: string;
  status: ProvisionStatus;
  workspace_id?: string;
  workspace_url?: string;
  partner_name: string;
  partner_domains: string[];
  api_package_ids: string[];
  update_mode: UpdateMode;
  policy_applied: string;
  requested_by: string;
  team_id?: string;
  created_at: string;
  updated_at: string;
  error?: string;
  steps_completed: ProvisionStep[];
}

export interface ProvisionStep {
  name: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  message?: string;
  timestamp: string;
}

// ── Policy ────────────────────────────────────────────────

export interface PolicyConfig {
  /** Globally allowed email domains */
  allowed_domains_global: string[];
  /** Per-team domain allowlists (team_id -> domains) */
  allowed_domains_by_team: Record<string, string[]>;
  /** If true, each workspace can only contain ONE partner domain */
  single_partner_domain_required: boolean;
  /** If true, partners can invite their own users (within allowed domains) */
  allow_partner_invites: boolean;
  /** Default update mode when not specified */
  default_update_mode: UpdateMode;
  /** Domains that are ALWAYS blocked (e.g., free email providers) */
  blocked_domains: string[];
  /** Maximum number of partner workspaces per team */
  max_workspaces_per_team?: number;
  /** Workspace policy presets */
  workspace_policies: Record<WorkspacePolicyPreset, WorkspacePolicyConfig>;
}

export interface WorkspacePolicyConfig {
  /** Can partner users invite others? */
  allow_member_invites: boolean;
  /** Can partner users create collections? */
  allow_collection_creation: boolean;
  /** Can partner users fork collections? */
  allow_forking: boolean;
  /** Workspace visibility */
  visibility: "personal" | "private" | "team" | "partner";
  /** Description suffix added to workspace */
  description_suffix: string;
}

export interface PolicyDecision {
  allowed: boolean;
  reasons: string[];
  warnings: string[];
  /** Which policy rules were evaluated */
  rules_evaluated: string[];
}

// ── Postman API Entities ──────────────────────────────────

export interface PostmanWorkspace {
  id: string;
  name: string;
  type: "personal" | "private" | "team" | "partner";
  description?: string;
  created_at?: string;
}

export interface PostmanCollection {
  id: string;
  uid: string;
  name: string;
  description?: string;
  version?: string;
}

export interface PostmanEnvironment {
  id: string;
  uid: string;
  name: string;
  values: PostmanEnvVariable[];
}

export interface PostmanEnvVariable {
  key: string;
  value: string;
  type: "default" | "secret";
  enabled: boolean;
}

export interface PostmanApi {
  id: string;
  name: string;
  summary?: string;
  description?: string;
  versions?: PostmanApiVersion[];
}

export interface PostmanApiVersion {
  id: string;
  name: string;
  /** Linked collection UID */
  collection_uid?: string;
  created_at?: string;
}

export interface PostmanForkResult {
  collection_id: string;
  fork_id: string;
  fork_uid: string;
  workspace_id: string;
}

// ── Compliance Guardrails (global security floor + team overrides) ──

/**
 * The "standardization curmudgeon" layer — Postman equivalents of
 * GitHub "no public repos" and Atlas "no wide-open networks."
 *
 * Two tiers:
 *  - Global guardrails: ALWAYS enforced, cannot be overridden
 *  - Team guardrails: can only be MORE restrictive than global, never less
 *
 * The key balance Andrew described: don't force forking for someone
 * just testing in their own workspace, but DO enforce it for shared
 * production-like workspaces.
 */
export interface ComplianceGuardrails {
  /** Global rules — the security floor no one can go below */
  global: ComplianceRuleSet;

  /**
   * Per-team overrides — can only tighten, never loosen.
   * Key: team_id (e.g., "us-hosting-services")
   * These map to Andrew's idea of the "US Hosting Services group level"
   * having stricter rules than the org default.
   */
  team_overrides: Record<string, Partial<ComplianceRuleSet>>;
}

export interface ComplianceRuleSet {
  // ── Workspace visibility (GitHub "no public repos" equivalent) ──

  /** Workspace types that are NEVER allowed to be created */
  blocked_workspace_types: Array<"personal" | "private" | "team" | "partner" | "public">;

  /** If true, "public" visibility on any Postman entity is blocked */
  block_public_sharing: boolean;

  // ── Collection / API controls ──

  /**
   * For partner/shared workspaces: require forking instead of direct edits.
   * Andrew's nuance: this should NOT apply to someone testing in their
   * own workspace — only to workspaces with shared/partner visibility.
   * The `applies_to_visibility` field controls this.
   */
  require_fork_workflow: boolean;
  /** Which workspace visibilities require fork workflow */
  fork_workflow_applies_to: Array<"partner" | "team">;

  /** Block direct collection creation in partner workspaces */
  block_direct_collection_creation_in_partner: boolean;

  // ── Environment / Secret controls ──

  /** Always strip secret-type env vars when copying to partner workspaces */
  strip_secrets_on_copy: boolean;

  /** Block export of environments containing secrets */
  block_secret_export: boolean;

  // ── API Spec controls ──

  /** Require OpenAPI/AsyncAPI specs to be valid before publishing */
  require_valid_spec: boolean;

  /** Minimum OpenAPI version allowed (e.g., "3.0" blocks Swagger 2.0) */
  min_openapi_version?: string;

  /** Require API specs to include security schemes */
  require_security_schemes_in_spec: boolean;

  // ── Network / Integration controls ──

  /** Block mock servers from being publicly accessible */
  block_public_mock_servers: boolean;

  /** Block monitors from running against non-allowed hosts */
  restrict_monitor_targets: boolean;
  /** If restrict_monitor_targets is true, only these host patterns are allowed */
  allowed_monitor_host_patterns?: string[];

  // ── Invite controls (supplements Invite Guard) ──

  /**
   * Maximum members per workspace (hard cap, overrides workspace-level setting).
   * Prevents sprawl even if a workspace manager sets their own cap higher.
   */
  max_members_per_workspace: number;

  /** Require MFA/SSO for workspace access (enforced via Postman team settings) */
  require_sso: boolean;

  // ── Audit / Governance ──

  /** All provisioning actions must have an associated ticket/reason */
  require_provision_justification: boolean;

  /** Retention period for audit logs in days */
  audit_retention_days: number;
}

export interface ComplianceCheckResult {
  compliant: boolean;
  violations: ComplianceViolation[];
  warnings: ComplianceWarning[];
  rules_checked: string[];
  /** Which tier triggered the result: global or team-specific */
  tier: "global" | "team";
}

export interface ComplianceViolation {
  rule: string;
  severity: "critical" | "high" | "medium";
  message: string;
  /** What needs to change to become compliant */
  remediation: string;
}

export interface ComplianceWarning {
  rule: string;
  message: string;
  /** Informational — not blocking */
  suggestion: string;
}

// ── Workspace Invite Policy (per-workspace domain guardrails) ──

/**
 * Stored per provisioned workspace. Defines WHO can be invited
 * and WHO can do the inviting — independently of Postman's
 * native "allow partner workspaces" toggle.
 *
 * This is the core of Andrew's #4 requirement: controlled
 * invitation-only access with domain-level guardrails so
 * non-admins can self-serve without risk.
 */
export interface WorkspaceInvitePolicy {
  /** The provisioned workspace ID in Postman */
  workspace_id: string;
  /** Human-readable workspace name */
  workspace_name: string;
  /** The provision ID that created this workspace */
  provision_id: string;
  /** Partner organization name */
  partner_name: string;

  /**
   * Domains allowed to be invited into THIS workspace.
   * Typically the partner domain(s) + relevant Deloitte domains.
   * Example: ["coca-cola.com", "deloitte.com", "deloitte.ca"]
   */
  allowed_invite_domains: string[];

  /**
   * Users who are allowed to send invites in this workspace.
   * These are Deloitte-side "workspace managers" — NOT admins.
   * They can invite anyone from allowed_invite_domains.
   * If empty, only global admins/provisioners can invite.
   */
  workspace_managers: string[];

  /**
   * If true, existing workspace members (from partner domains)
   * can also invite others — but ONLY from allowed_invite_domains.
   * Default: false (only workspace_managers and admins can invite).
   */
  allow_member_invites: boolean;

  /**
   * Maximum number of members that can be invited to this workspace.
   * Prevents runaway invite sprawl. undefined = unlimited.
   */
  max_members?: number;

  /** Current member count (tracked by the service) */
  current_member_count: number;

  /** When the policy was created */
  created_at: string;
  /** When the policy was last modified */
  updated_at: string;
}

export type InviteRole = "viewer" | "editor";

export interface InviteRequest {
  /** Workspace to invite into */
  workspace_id: string;
  /** Email addresses to invite */
  invitees: Array<{
    email: string;
    role: InviteRole;
  }>;
}

export interface InviteResult {
  workspace_id: string;
  invited: Array<{
    email: string;
    role: InviteRole;
    status: "sent" | "already_member" | "rejected";
    reason?: string;
  }>;
  policy_applied: string;
  invited_by: string;
  timestamp: string;
}

export interface InvitePolicyDecision {
  allowed: boolean;
  /** Per-invitee results */
  invitee_decisions: Array<{
    email: string;
    allowed: boolean;
    reason?: string;
  }>;
  reasons: string[];
  warnings: string[];
}

// ── Pull Request & Collection Protection ──────────────────

/**
 * Postman supports a fork → pull request → merge workflow
 * on collections, analogous to Git's branch protection.
 *
 * This is Andrew's "branch protection" — ensuring people
 * fork the collection, make changes, and PR back instead of
 * editing the source collection directly.
 */

export type PullRequestStatus = "open" | "approved" | "rejected" | "merged";

export interface PostmanPullRequest {
  id: string;
  /** The forked collection that contains the changes */
  source_collection_uid: string;
  /** The original (protected) collection to merge into */
  target_collection_uid: string;
  /** Workspace where the PR was created */
  workspace_id: string;
  title: string;
  description?: string;
  status: PullRequestStatus;
  /** Who created the PR */
  created_by: string;
  /** Who reviewed/approved the PR */
  reviewed_by?: string;
  review_comment?: string;
  created_at: string;
  updated_at: string;
  merged_at?: string;
}

/**
 * Collection Protection Rule — the Postman equivalent of
 * GitHub's "branch protection rules."
 *
 * Applied per-collection in a workspace. When a collection
 * is "protected," direct edits are blocked and changes must
 * go through the fork → PR → review → merge workflow.
 */
export interface CollectionProtectionRule {
  /** The collection UID being protected */
  collection_uid: string;
  /** The workspace containing this collection */
  workspace_id: string;
  /** Human-readable collection name */
  collection_name: string;

  /** Is protection active? */
  enabled: boolean;

  /** Require at least N approvals before merge */
  required_approvals: number;

  /**
   * Who can approve PRs against this collection.
   * Empty = any workspace manager or admin can approve.
   */
  designated_reviewers: string[];

  /**
   * Who can merge PRs (after approval).
   * Empty = any workspace manager or admin can merge.
   */
  designated_mergers: string[];

  /** Block direct edits to this collection (force fork workflow) */
  block_direct_edits: boolean;

  /** Require PR description */
  require_description: boolean;

  /** Auto-delete source fork after successful merge */
  auto_delete_fork_on_merge: boolean;

  created_at: string;
  updated_at: string;
}

export interface CreatePullRequestParams {
  source_collection_uid: string;
  target_collection_uid: string;
  workspace_id: string;
  title: string;
  description?: string;
  created_by: string;
}

export interface ReviewPullRequestParams {
  pr_id: string;
  action: "approve" | "reject";
  reviewer: string;
  comment?: string;
}

export interface MergePullRequestParams {
  pr_id: string;
  merged_by: string;
  /** Strategy for merge */
  strategy: "merge" | "replace";
}

// ── Audit ─────────────────────────────────────────────────

export type AuditAction =
  | "provision.requested"
  | "provision.policy_check"
  | "provision.workspace_created"
  | "provision.assets_copied"
  | "provision.permissions_set"
  | "provision.updates_enrolled"
  | "provision.completed"
  | "provision.failed"
  | "provision.rolled_back"
  | "sync.started"
  | "sync.completed"
  | "sync.failed"
  | "publish.started"
  | "publish.completed"
  | "publish.failed"
  | "invite.requested"
  | "invite.policy_check"
  | "invite.sent"
  | "invite.rejected"
  | "invite.policy_updated"
  | "pr.created"
  | "pr.approved"
  | "pr.rejected"
  | "pr.merged"
  | "collection.protected"
  | "collection.protection_updated";

export interface AuditEntry {
  id: string;
  timestamp: string;
  action: AuditAction;
  actor: string;
  provision_id?: string;
  partner_name?: string;
  partner_domains?: string[];
  api_package_ids?: string[];
  policy_decision?: PolicyDecision;
  details?: Record<string, unknown>;
  ip_address?: string;
}

export interface AuditQuery {
  action?: AuditAction;
  actor?: string;
  provision_id?: string;
  partner_name?: string;
  from_date?: string;
  to_date?: string;
  limit?: number;
  offset?: number;
}

// ── RBAC ──────────────────────────────────────────────────

export type Role = "admin" | "provisioner" | "viewer";

export interface UserContext {
  user_id: string;
  email: string;
  roles: Role[];
  team_ids: string[];
  display_name?: string;
}

// ── API Response wrappers ─────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    request_id: string;
    timestamp: string;
  };
}
