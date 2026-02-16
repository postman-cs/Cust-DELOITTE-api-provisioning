/**
 * ─────────────────────────────────────────────────────────
 * Compliance Guardrails Service
 *
 * The "standardization curmudgeon" layer — enforces the
 * security floor for ALL Postman workspaces at Deloitte.
 *
 * Think of this as the Postman equivalents of:
 *  - GitHub Enterprise: "no public repos"
 *  - MongoDB Atlas: "no wide-open networks"
 *  - AWS SCPs: "no public S3 buckets"
 *
 * TWO-TIER DESIGN:
 *
 *  Tier 1 — Global guardrails (security floor):
 *    Always enforced. Nobody can go below these.
 *    Examples: no public workspaces, strip secrets on copy,
 *    block public mock servers.
 *
 *  Tier 2 — Team overrides (can only tighten, never loosen):
 *    The "US Hosting Services group level" Andrew described.
 *    Example: team-hosting requires fork workflow for all
 *    shared workspaces, but team-sandbox does not.
 *
 * THE BALANCE:
 *  Andrew's key point: don't force forking for someone just
 *  playing around in their own workspace. The fork_workflow
 *  rule only applies to specific workspace visibility types
 *  (partner, team) — not personal workspaces.
 *
 * ─────────────────────────────────────────────────────────
 */

import {
  ComplianceGuardrails,
  ComplianceRuleSet,
  ComplianceCheckResult,
  ComplianceViolation,
  ComplianceWarning,
  ProvisionRequest,
  WorkspacePolicyConfig,
  WorkspacePolicyPreset,
} from "../types";
import { createLogger } from "../middleware/logger";

const logger = createLogger("compliance");

// ── Public interface ──────────────────────────────────────

export interface IComplianceGuardrails {
  /**
   * Check a provisioning request against all compliance rules.
   * Called during provisioning BEFORE workspace creation.
   */
  evaluateProvisionRequest(
    request: ProvisionRequest,
    policyConfig: WorkspacePolicyConfig,
    teamId?: string
  ): ComplianceCheckResult;

  /**
   * Check a workspace configuration against compliance rules.
   * Called on-demand to audit existing workspaces.
   */
  evaluateWorkspaceConfig(
    config: WorkspaceComplianceInput,
    teamId?: string
  ): ComplianceCheckResult;

  /**
   * Get the effective ruleset for a team (global + team overrides merged).
   */
  getEffectiveRules(teamId?: string): ComplianceRuleSet;

  /**
   * List all compliance rules with their current values.
   * Useful for a governance dashboard.
   */
  listRules(teamId?: string): ComplianceRuleSummary[];
}

/** Input for checking an existing workspace's compliance */
export interface WorkspaceComplianceInput {
  workspace_id: string;
  workspace_type: "personal" | "private" | "team" | "partner";
  has_public_collections: boolean;
  has_public_mock_servers: boolean;
  has_unstripped_secrets: boolean;
  member_count: number;
  has_fork_workflow: boolean;
  has_direct_collection_creation: boolean;
  has_valid_spec: boolean;
  spec_version?: string;
  has_security_schemes: boolean;
  has_sso_enabled: boolean;
}

export interface ComplianceRuleSummary {
  rule: string;
  description: string;
  severity: "critical" | "high" | "medium";
  value: unknown;
  source: "global" | "team_override";
}

// ── Implementation ─────────────────────────────────────────

export class ComplianceGuardrailsService implements IComplianceGuardrails {
  constructor(private readonly guardrails: ComplianceGuardrails) {}

  // ── Evaluate a provisioning request ────────────────────

  evaluateProvisionRequest(
    request: ProvisionRequest,
    policyConfig: WorkspacePolicyConfig,
    teamId?: string
  ): ComplianceCheckResult {
    const rules = this.getEffectiveRules(teamId);
    const violations: ComplianceViolation[] = [];
    const warnings: ComplianceWarning[] = [];
    const rulesChecked: string[] = [];
    const tier = teamId && this.guardrails.team_overrides[teamId] ? "team" : "global";

    // ── Rule: blocked workspace types ────────────────
    rulesChecked.push("blocked_workspace_types");
    if (rules.blocked_workspace_types.includes(policyConfig.visibility as any)) {
      violations.push({
        rule: "blocked_workspace_types",
        severity: "critical",
        message:
          `Workspace visibility "${policyConfig.visibility}" is blocked by compliance policy. ` +
          `Blocked types: [${rules.blocked_workspace_types.join(", ")}].`,
        remediation:
          `Use a different workspace policy preset. Allowed visibility types: ` +
          `${["personal", "private", "team", "partner"].filter((t) => !rules.blocked_workspace_types.includes(t as any)).join(", ")}.`,
      });
    }

    // ── Rule: block public sharing ───────────────────
    rulesChecked.push("block_public_sharing");
    if (rules.block_public_sharing && policyConfig.visibility === ("public" as any)) {
      violations.push({
        rule: "block_public_sharing",
        severity: "critical",
        message: "Public sharing is blocked. No Postman entity may be publicly accessible.",
        remediation: "Use 'partner' or 'private' visibility instead.",
      });
    }

    // ── Rule: fork workflow for shared workspaces ─────
    rulesChecked.push("require_fork_workflow");
    if (
      rules.require_fork_workflow &&
      rules.fork_workflow_applies_to.includes(policyConfig.visibility as any) &&
      !policyConfig.allow_forking
    ) {
      violations.push({
        rule: "require_fork_workflow",
        severity: "high",
        message:
          `Fork workflow is required for "${policyConfig.visibility}" workspaces, ` +
          `but the selected policy preset has allow_forking=false.`,
        remediation:
          "Use a workspace policy preset that enables forking, or switch to a " +
          "visibility type that doesn't require fork workflow.",
      });
    }

    // ── Rule: block direct collection creation ───────
    rulesChecked.push("block_direct_collection_creation_in_partner");
    if (
      rules.block_direct_collection_creation_in_partner &&
      policyConfig.visibility === "partner" &&
      policyConfig.allow_collection_creation
    ) {
      violations.push({
        rule: "block_direct_collection_creation_in_partner",
        severity: "high",
        message:
          "Direct collection creation is blocked in partner workspaces. " +
          "Partners should only receive forked/copied collections from the golden workspace.",
        remediation:
          "Use a workspace policy preset with allow_collection_creation=false for partner workspaces.",
      });
    }

    // ── Rule: strip secrets on copy ──────────────────
    rulesChecked.push("strip_secrets_on_copy");
    if (rules.strip_secrets_on_copy && policyConfig.visibility === "partner") {
      // This is informational — we always strip. Just confirm it's happening.
      warnings.push({
        rule: "strip_secrets_on_copy",
        message: "Secret-type environment variables will be stripped when copying to this partner workspace.",
        suggestion: "Ensure partner-facing environments use non-secret variables or document required values.",
      });
    }

    // ── Rule: require valid spec ─────────────────────
    rulesChecked.push("require_valid_spec");
    if (rules.require_valid_spec) {
      warnings.push({
        rule: "require_valid_spec",
        message: "API specs must be valid OpenAPI/AsyncAPI before publishing.",
        suggestion: "Run spec validation in the publish pipeline.",
      });
    }

    // ── Rule: require security schemes ───────────────
    rulesChecked.push("require_security_schemes_in_spec");
    if (rules.require_security_schemes_in_spec) {
      warnings.push({
        rule: "require_security_schemes_in_spec",
        message: "API specs should include security scheme definitions.",
        suggestion: "Add securitySchemes to your OpenAPI spec's components section.",
      });
    }

    // ── Rule: block public mock servers ──────────────
    rulesChecked.push("block_public_mock_servers");
    if (rules.block_public_mock_servers) {
      warnings.push({
        rule: "block_public_mock_servers",
        message: "Public mock servers are blocked. Any mock servers created will be private.",
        suggestion: "Share mock server URLs only with authorized users.",
      });
    }

    // ── Rule: member cap ─────────────────────────────
    rulesChecked.push("max_members_per_workspace");
    // Checked at invite time, not provisioning — but log the cap
    if (rules.max_members_per_workspace) {
      warnings.push({
        rule: "max_members_per_workspace",
        message: `Workspace member cap: ${rules.max_members_per_workspace}. Enforced at invite time.`,
        suggestion: "Ensure invite policies respect this global cap.",
      });
    }

    // ── Rule: require SSO ────────────────────────────
    rulesChecked.push("require_sso");
    if (rules.require_sso) {
      warnings.push({
        rule: "require_sso",
        message: "SSO is required for workspace access. Ensure Postman team SSO is configured.",
        suggestion: "Verify SSO enforcement in Postman team settings.",
      });
    }

    // ── Rule: require justification ──────────────────
    rulesChecked.push("require_provision_justification");
    if (rules.require_provision_justification) {
      if (!request.metadata?.justification && !request.metadata?.ticket_id) {
        violations.push({
          rule: "require_provision_justification",
          severity: "medium",
          message:
            "A justification or ticket ID is required for provisioning. " +
            "Include metadata.justification or metadata.ticket_id in the request.",
          remediation:
            'Add { "metadata": { "justification": "reason" } } or ' +
            '{ "metadata": { "ticket_id": "JIRA-123" } } to the provisioning request.',
        });
      }
    }

    const compliant = violations.length === 0;

    if (!compliant) {
      logger.warn("Compliance violations detected", {
        partner: request.partner_name,
        team: teamId,
        violation_count: violations.length,
        rules: violations.map((v) => v.rule),
      });
    }

    return {
      compliant,
      violations,
      warnings,
      rules_checked: rulesChecked,
      tier,
    };
  }

  // ── Evaluate an existing workspace ─────────────────────

  evaluateWorkspaceConfig(
    config: WorkspaceComplianceInput,
    teamId?: string
  ): ComplianceCheckResult {
    const rules = this.getEffectiveRules(teamId);
    const violations: ComplianceViolation[] = [];
    const warnings: ComplianceWarning[] = [];
    const rulesChecked: string[] = [];
    const tier = teamId && this.guardrails.team_overrides[teamId] ? "team" : "global";

    // ── Blocked workspace type ───────────────────────
    rulesChecked.push("blocked_workspace_types");
    if (rules.blocked_workspace_types.includes(config.workspace_type as any)) {
      violations.push({
        rule: "blocked_workspace_types",
        severity: "critical",
        message: `Workspace type "${config.workspace_type}" is not compliant.`,
        remediation: "Change workspace visibility or migrate to a compliant type.",
      });
    }

    // ── Public sharing ───────────────────────────────
    rulesChecked.push("block_public_sharing");
    if (rules.block_public_sharing && config.has_public_collections) {
      violations.push({
        rule: "block_public_sharing",
        severity: "critical",
        message: "Workspace contains publicly shared collections.",
        remediation: "Set all collections to private/team visibility.",
      });
    }

    // ── Public mock servers ──────────────────────────
    rulesChecked.push("block_public_mock_servers");
    if (rules.block_public_mock_servers && config.has_public_mock_servers) {
      violations.push({
        rule: "block_public_mock_servers",
        severity: "high",
        message: "Workspace contains publicly accessible mock servers.",
        remediation: "Set mock servers to private access.",
      });
    }

    // ── Unstripped secrets ───────────────────────────
    rulesChecked.push("strip_secrets_on_copy");
    if (
      rules.strip_secrets_on_copy &&
      config.workspace_type === "partner" &&
      config.has_unstripped_secrets
    ) {
      violations.push({
        rule: "strip_secrets_on_copy",
        severity: "critical",
        message: "Partner workspace contains environment variables with secret values.",
        remediation: "Remove or mask secret-type variables in partner workspace environments.",
      });
    }

    // ── Fork workflow ────────────────────────────────
    rulesChecked.push("require_fork_workflow");
    if (
      rules.require_fork_workflow &&
      rules.fork_workflow_applies_to.includes(config.workspace_type as any) &&
      !config.has_fork_workflow
    ) {
      violations.push({
        rule: "require_fork_workflow",
        severity: "high",
        message: `Fork workflow is required for "${config.workspace_type}" workspaces.`,
        remediation: "Enable forking and use fork-based collaboration in this workspace.",
      });
    }

    // ── Direct collection creation in partner ────────
    rulesChecked.push("block_direct_collection_creation_in_partner");
    if (
      rules.block_direct_collection_creation_in_partner &&
      config.workspace_type === "partner" &&
      config.has_direct_collection_creation
    ) {
      violations.push({
        rule: "block_direct_collection_creation_in_partner",
        severity: "high",
        message: "Partner workspace allows direct collection creation.",
        remediation: "Disable collection creation for partner users.",
      });
    }

    // ── Member cap ───────────────────────────────────
    rulesChecked.push("max_members_per_workspace");
    if (config.member_count > rules.max_members_per_workspace) {
      violations.push({
        rule: "max_members_per_workspace",
        severity: "medium",
        message:
          `Workspace has ${config.member_count} members, exceeding the cap of ${rules.max_members_per_workspace}.`,
        remediation: "Remove excess members or request a cap increase.",
      });
    }

    // ── SSO ──────────────────────────────────────────
    rulesChecked.push("require_sso");
    if (rules.require_sso && !config.has_sso_enabled) {
      violations.push({
        rule: "require_sso",
        severity: "high",
        message: "SSO is required but not enabled for this workspace.",
        remediation: "Enable SSO in Postman team settings.",
      });
    }

    // ── API spec validation ──────────────────────────
    rulesChecked.push("require_valid_spec");
    if (rules.require_valid_spec && !config.has_valid_spec) {
      violations.push({
        rule: "require_valid_spec",
        severity: "medium",
        message: "Workspace contains invalid API specs.",
        remediation: "Fix spec validation errors before publishing.",
      });
    }

    rulesChecked.push("require_security_schemes_in_spec");
    if (rules.require_security_schemes_in_spec && !config.has_security_schemes) {
      warnings.push({
        rule: "require_security_schemes_in_spec",
        message: "API specs are missing security scheme definitions.",
        suggestion: "Add securitySchemes to your OpenAPI spec.",
      });
    }

    return {
      compliant: violations.length === 0,
      violations,
      warnings,
      rules_checked: rulesChecked,
      tier,
    };
  }

  // ── Get effective rules (global + team merge) ──────────

  getEffectiveRules(teamId?: string): ComplianceRuleSet {
    const base = { ...this.guardrails.global };

    if (!teamId) return base;

    const teamOverrides = this.guardrails.team_overrides[teamId];
    if (!teamOverrides) return base;

    // Merge: team overrides can only TIGHTEN, never loosen
    return this.mergeRules(base, teamOverrides);
  }

  // ── List rules for dashboard ───────────────────────────

  listRules(teamId?: string): ComplianceRuleSummary[] {
    const effective = this.getEffectiveRules(teamId);
    const teamOverrides = teamId ? this.guardrails.team_overrides[teamId] : undefined;

    const rules: ComplianceRuleSummary[] = [
      {
        rule: "blocked_workspace_types",
        description: "Workspace types that cannot be created",
        severity: "critical",
        value: effective.blocked_workspace_types,
        source: teamOverrides?.blocked_workspace_types ? "team_override" : "global",
      },
      {
        rule: "block_public_sharing",
        description: "Block all public sharing of Postman entities",
        severity: "critical",
        value: effective.block_public_sharing,
        source: teamOverrides?.block_public_sharing !== undefined ? "team_override" : "global",
      },
      {
        rule: "require_fork_workflow",
        description: "Require fork-based workflow for shared workspaces",
        severity: "high",
        value: effective.require_fork_workflow,
        source: teamOverrides?.require_fork_workflow !== undefined ? "team_override" : "global",
      },
      {
        rule: "fork_workflow_applies_to",
        description: "Which workspace types require fork workflow",
        severity: "high",
        value: effective.fork_workflow_applies_to,
        source: teamOverrides?.fork_workflow_applies_to ? "team_override" : "global",
      },
      {
        rule: "block_direct_collection_creation_in_partner",
        description: "Block partners from creating collections directly",
        severity: "high",
        value: effective.block_direct_collection_creation_in_partner,
        source: teamOverrides?.block_direct_collection_creation_in_partner !== undefined ? "team_override" : "global",
      },
      {
        rule: "strip_secrets_on_copy",
        description: "Strip secret env vars when copying to partner workspaces",
        severity: "critical",
        value: effective.strip_secrets_on_copy,
        source: "global", // never overridden
      },
      {
        rule: "block_secret_export",
        description: "Block export of environments containing secrets",
        severity: "critical",
        value: effective.block_secret_export,
        source: "global",
      },
      {
        rule: "require_valid_spec",
        description: "Require valid OpenAPI/AsyncAPI specs before publishing",
        severity: "medium",
        value: effective.require_valid_spec,
        source: teamOverrides?.require_valid_spec !== undefined ? "team_override" : "global",
      },
      {
        rule: "require_security_schemes_in_spec",
        description: "Require security schemes in API specs",
        severity: "medium",
        value: effective.require_security_schemes_in_spec,
        source: teamOverrides?.require_security_schemes_in_spec !== undefined ? "team_override" : "global",
      },
      {
        rule: "block_public_mock_servers",
        description: "Block publicly accessible mock servers",
        severity: "high",
        value: effective.block_public_mock_servers,
        source: "global",
      },
      {
        rule: "max_members_per_workspace",
        description: "Maximum members per workspace (hard cap)",
        severity: "medium",
        value: effective.max_members_per_workspace,
        source: teamOverrides?.max_members_per_workspace !== undefined ? "team_override" : "global",
      },
      {
        rule: "require_sso",
        description: "Require SSO for workspace access",
        severity: "high",
        value: effective.require_sso,
        source: "global",
      },
      {
        rule: "require_provision_justification",
        description: "Require justification/ticket for provisioning",
        severity: "medium",
        value: effective.require_provision_justification,
        source: teamOverrides?.require_provision_justification !== undefined ? "team_override" : "global",
      },
    ];

    return rules;
  }

  // ── Merge helpers ──────────────────────────────────────

  /**
   * Merge team overrides into base rules.
   * CRITICAL: team overrides can only TIGHTEN rules, never loosen.
   *
   * For booleans: if global says true (enforced), team can't say false.
   * For numbers: team can lower caps but not raise them.
   * For arrays: team can add to blocked lists but not remove.
   */
  private mergeRules(base: ComplianceRuleSet, overrides: Partial<ComplianceRuleSet>): ComplianceRuleSet {
    const merged = { ...base };

    // Boolean tightening: true stays true (can't loosen)
    if (overrides.block_public_sharing !== undefined) {
      merged.block_public_sharing = base.block_public_sharing || overrides.block_public_sharing;
    }
    if (overrides.require_fork_workflow !== undefined) {
      merged.require_fork_workflow = base.require_fork_workflow || overrides.require_fork_workflow;
    }
    if (overrides.block_direct_collection_creation_in_partner !== undefined) {
      merged.block_direct_collection_creation_in_partner =
        base.block_direct_collection_creation_in_partner ||
        overrides.block_direct_collection_creation_in_partner;
    }
    if (overrides.strip_secrets_on_copy !== undefined) {
      merged.strip_secrets_on_copy = base.strip_secrets_on_copy || overrides.strip_secrets_on_copy;
    }
    if (overrides.block_secret_export !== undefined) {
      merged.block_secret_export = base.block_secret_export || overrides.block_secret_export;
    }
    if (overrides.require_valid_spec !== undefined) {
      merged.require_valid_spec = base.require_valid_spec || overrides.require_valid_spec;
    }
    if (overrides.require_security_schemes_in_spec !== undefined) {
      merged.require_security_schemes_in_spec =
        base.require_security_schemes_in_spec || overrides.require_security_schemes_in_spec;
    }
    if (overrides.block_public_mock_servers !== undefined) {
      merged.block_public_mock_servers = base.block_public_mock_servers || overrides.block_public_mock_servers;
    }
    if (overrides.require_sso !== undefined) {
      merged.require_sso = base.require_sso || overrides.require_sso;
    }
    if (overrides.require_provision_justification !== undefined) {
      merged.require_provision_justification =
        base.require_provision_justification || overrides.require_provision_justification;
    }
    if (overrides.restrict_monitor_targets !== undefined) {
      merged.restrict_monitor_targets = base.restrict_monitor_targets || overrides.restrict_monitor_targets;
    }

    // Number tightening: team can only LOWER caps
    if (overrides.max_members_per_workspace !== undefined) {
      merged.max_members_per_workspace = Math.min(
        base.max_members_per_workspace,
        overrides.max_members_per_workspace
      );
    }
    if (overrides.audit_retention_days !== undefined) {
      // Retention: team can only INCREASE (keep logs longer)
      merged.audit_retention_days = Math.max(
        base.audit_retention_days,
        overrides.audit_retention_days
      );
    }

    // Array tightening: team can ADD to blocked lists
    if (overrides.blocked_workspace_types) {
      merged.blocked_workspace_types = [
        ...new Set([...base.blocked_workspace_types, ...overrides.blocked_workspace_types]),
      ];
    }
    if (overrides.fork_workflow_applies_to) {
      merged.fork_workflow_applies_to = [
        ...new Set([...base.fork_workflow_applies_to, ...overrides.fork_workflow_applies_to]),
      ];
    }

    return merged;
  }
}
