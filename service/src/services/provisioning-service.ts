/**
 * ─────────────────────────────────────────────────────────
 * Provisioning Service
 *
 * Orchestrates the full partner workspace provisioning flow:
 *  1. Validate request via Policy Engine
 *  2. Create partner workspace in Postman
 *  3. Copy selected collections & environments from Golden
 *  4. Set workspace permissions
 *  5. Optionally enroll in auto-updates
 *  6. Record audit trail at each step
 *
 * Each step is idempotent-friendly and logged.
 * ─────────────────────────────────────────────────────────
 */

import { v4 as uuid } from "uuid";
import {
  ProvisionRequest,
  ProvisionResult,
  ProvisionStep,
  UserContext,
  PolicyDecision,
  WorkspacePolicyConfig,
} from "../types";
import { IPostmanClient } from "../adapters/postman-client.interface";
import { IPolicyEngine } from "../policy/policy-engine";
import { IAuditLogger, createProvisionAuditEntry } from "../audit/audit-logger";
import { IInviteGuard } from "./invite-guard";
import { IComplianceGuardrails } from "./compliance-guardrails";
import { AppConfig } from "../config";
import { createLogger } from "../middleware/logger";

const logger = createLogger("provisioning");

export class ProvisioningService {
  /** In-memory store of provision results (swap for database in prod) */
  private results: Map<string, ProvisionResult> = new Map();

  /** Optional Invite Guard — when present, auto-creates invite policies */
  private inviteGuard?: IInviteGuard;

  /** Optional Compliance Guardrails — when present, checks security floor */
  private complianceGuardrails?: IComplianceGuardrails;

  constructor(
    private readonly postmanClient: IPostmanClient,
    private readonly policyEngine: IPolicyEngine,
    private readonly auditLogger: IAuditLogger,
    private readonly config: AppConfig
  ) {}

  /**
   * Attach the Invite Guard so provisioning auto-creates invite policies.
   * Called during service wiring in index.ts.
   */
  setInviteGuard(guard: IInviteGuard): void {
    this.inviteGuard = guard;
  }

  /**
   * Attach the Compliance Guardrails so provisioning checks the security floor.
   * Called during service wiring in index.ts.
   */
  setComplianceGuardrails(guardrails: IComplianceGuardrails): void {
    this.complianceGuardrails = guardrails;
  }

  /**
   * Execute a full provisioning workflow.
   */
  async provision(
    request: ProvisionRequest,
    user: UserContext
  ): Promise<ProvisionResult> {
    const provisionId = uuid();
    const now = new Date().toISOString();

    // Initialize result
    const result: ProvisionResult = {
      id: provisionId,
      status: "pending",
      partner_name: request.partner_name,
      partner_domains: request.partner_domains,
      api_package_ids: request.api_package_ids,
      update_mode: request.update_mode ?? this.config.policy.default_update_mode,
      policy_applied: request.workspace_policy,
      requested_by: user.email,
      team_id: request.team_id,
      created_at: now,
      updated_at: now,
      steps_completed: [],
    };

    this.results.set(provisionId, result);

    // Audit: request received
    this.auditLogger.log(
      createProvisionAuditEntry(
        "provision.requested",
        user.email,
        provisionId,
        request.partner_name,
        request.partner_domains,
        request.api_package_ids
      )
    );

    // Declared outside try so rollback in catch can access it
    let workspaceId: string | undefined;

    try {
      // ── Step 1: Policy validation ───────────────────
      await this.executeStep(result, "Policy Validation", async () => {
        result.status = "validating";

        // Count existing workspaces for workspace-limit enforcement
        const existingWorkspaces = this.countWorkspacesByTeam(request.team_id);

        const decision = this.policyEngine.evaluate(request, user, existingWorkspaces);

        this.auditLogger.log(
          createProvisionAuditEntry(
            "provision.policy_check",
            user.email,
            provisionId,
            request.partner_name,
            request.partner_domains,
            request.api_package_ids,
            decision
          )
        );

        if (!decision.allowed) {
          throw new PolicyDeniedError(decision);
        }

        logger.info("Policy check passed", {
          provisionId,
          warnings: decision.warnings,
        });
      });

      // ── Step 1b: Compliance guardrails check ─────────
      const policyConfig = this.config.policy.workspace_policies[request.workspace_policy];

      if (!policyConfig) {
        throw new Error(`Workspace policy "${request.workspace_policy}" not found in config`);
      }

      if (this.complianceGuardrails) {
        await this.executeStep(result, "Compliance Check", async () => {
          const complianceResult = this.complianceGuardrails!.evaluateProvisionRequest(
            request,
            policyConfig,
            request.team_id
          );

          if (!complianceResult.compliant) {
            const violationMessages = complianceResult.violations
              .map((v) => `[${v.severity.toUpperCase()}] ${v.rule}: ${v.message}`)
              .join("; ");
            throw new Error(
              `Compliance check failed with ${complianceResult.violations.length} violation(s): ${violationMessages}`
            );
          }

          if (complianceResult.warnings.length > 0) {
            logger.info("Compliance warnings", {
              provisionId,
              warnings: complianceResult.warnings.map((w) => w.message),
            });
          }
        });
      }

      // ── Step 2: Create workspace ────────────────────

      await this.executeStep(result, "Create Workspace", async () => {
        result.status = "provisioning";

        const workspaceName = this.generateWorkspaceName(request);
        const description = this.generateWorkspaceDescription(request, policyConfig);

        const workspace = await this.postmanClient.createWorkspace({
          name: workspaceName,
          type: policyConfig.visibility as "personal" | "private" | "team" | "partner",
          description,
        });

        workspaceId = workspace.id;
        result.workspace_id = workspace.id;
        result.workspace_url = `https://www.postman.com/workspace/${workspace.id}`;

        this.auditLogger.log(
          createProvisionAuditEntry(
            "provision.workspace_created",
            user.email,
            provisionId,
            request.partner_name,
            request.partner_domains,
            undefined,
            undefined,
            { workspace_id: workspace.id, workspace_name: workspaceName }
          )
        );
      });

      // ── Step 3: Copy collections & environments ─────
      await this.executeStep(result, "Copy Assets", async () => {
        result.status = "copying_assets";

        if (!workspaceId) throw new Error("Workspace ID not available");

        // Get all collections from Golden workspace
        const goldenCollections = await this.postmanClient.listCollections(
          this.config.postmanGoldenWorkspaceId
        );

        // Filter to requested API packages — STRICT: no fallback to all
        const selectedCollections = goldenCollections.filter((c) =>
          request.api_package_ids.includes(c.uid) ||
          request.api_package_ids.includes(c.id)
        );

        if (selectedCollections.length === 0) {
          logger.warn("No matching collections found for requested API packages", {
            provisionId,
            requested: request.api_package_ids,
            available: goldenCollections.map((c) => ({ id: c.id, uid: c.uid, name: c.name })),
          });
          throw new Error(
            `No collections found matching API package IDs: [${request.api_package_ids.join(", ")}]. ` +
            `Available: [${goldenCollections.map((c) => c.uid).join(", ")}]`
          );
        }

        // Copy each collection
        for (const col of selectedCollections) {
          if (policyConfig.allow_forking) {
            await this.postmanClient.forkCollection({
              collection_uid: col.uid,
              target_workspace_id: workspaceId,
              label: `${request.partner_name} - ${new Date().toISOString().slice(0, 10)}`,
            });
          } else {
            await this.postmanClient.copyCollection({
              collection_uid: col.uid,
              target_workspace_id: workspaceId,
              new_name: col.name,
            });
          }
        }

        // Copy environments (strip secrets for partner workspaces)
        const goldenEnvironments = await this.postmanClient.listEnvironments(
          this.config.postmanGoldenWorkspaceId
        );

        for (const env of goldenEnvironments) {
          await this.postmanClient.copyEnvironment({
            environment_uid: env.uid,
            target_workspace_id: workspaceId,
            strip_secrets: true,
          });
        }

        this.auditLogger.log(
          createProvisionAuditEntry(
            "provision.assets_copied",
            user.email,
            provisionId,
            request.partner_name,
            undefined,
            request.api_package_ids,
            undefined,
            {
              collections_copied: selectedCollections.length,
              environments_copied: goldenEnvironments.length,
              workspace_id: workspaceId,
            }
          )
        );
      });

      // ── Step 4: Set permissions ─────────────────────
      await this.executeStep(result, "Set Permissions", async () => {
        result.status = "setting_permissions";

        if (!workspaceId) throw new Error("Workspace ID not available");

        // Add the authenticated user as an editor
        const members: Array<{ email: string; role: "viewer" | "editor" }> = [
          { email: user.email, role: "editor" },
        ];

        // If requested_by differs from user, validate domain before granting access
        if (request.requested_by !== user.email) {
          const requestedByDomain = request.requested_by.split("@")[1]?.toLowerCase();
          const allowedDomains = [
            ...this.config.policy.allowed_domains_global,
            ...request.partner_domains.map((d) => d.toLowerCase()),
          ];
          if (requestedByDomain && allowedDomains.some((d) => d.toLowerCase() === requestedByDomain)) {
            members.push({ email: request.requested_by, role: "editor" });
          } else {
            logger.warn("requested_by domain not in allowlist, skipping permission grant", {
              provisionId,
              requested_by: request.requested_by,
              domain: requestedByDomain,
            });
          }
        }

        await this.postmanClient.setWorkspacePermissions({
          workspace_id: workspaceId,
          members,
        });

        this.auditLogger.log(
          createProvisionAuditEntry(
            "provision.permissions_set",
            user.email,
            provisionId,
            request.partner_name,
            request.partner_domains,
            undefined,
            undefined,
            {
              workspace_id: workspaceId,
              members_added: members.length,
              allow_partner_invites: policyConfig.allow_member_invites,
            }
          )
        );
      });

      // ── Step 5: Create invite policy (if Invite Guard attached) ──
      if (this.inviteGuard && workspaceId) {
        await this.executeStep(result, "Create Invite Policy", async () => {
          const invitePolicy = this.inviteGuard!.createPolicy({
            workspace_id: workspaceId!,
            workspace_name: result.workspace_url
              ? `Partner: ${request.partner_name}`
              : request.partner_name,
            provision_id: provisionId,
            partner_name: request.partner_name,
            allowed_invite_domains: [
              // Include Deloitte's own domain(s) + the partner domains
              ...this.config.policy.allowed_domains_global.filter((d) =>
                d.toLowerCase().startsWith("deloitte")
              ),
              ...request.partner_domains,
            ],
            workspace_managers: [user.email],
            allow_member_invites: policyConfig.allow_member_invites,
            max_members: this.config.policy.max_workspaces_per_team
              ? undefined // no per-workspace cap by default
              : undefined,
          });

          logger.info("Invite policy created for workspace", {
            provisionId,
            workspaceId,
            allowed_domains: invitePolicy.allowed_invite_domains,
            managers: invitePolicy.workspace_managers,
          });
        });
      }

      // ── Step 6: Enroll in updates (if auto) ─────────
      if (result.update_mode === "auto") {
        await this.executeStep(result, "Enroll Auto-Updates", async () => {
          result.status = "enrolling_updates";

          this.auditLogger.log(
            createProvisionAuditEntry(
              "provision.updates_enrolled",
              user.email,
              provisionId,
              request.partner_name,
              undefined,
              undefined,
              undefined,
              {
                update_mode: "auto",
                workspace_id: workspaceId,
              }
            )
          );

          logger.info("Auto-update enrollment recorded", {
            provisionId,
            workspaceId,
          });
        });
      }

      // ── Complete ────────────────────────────────────
      result.status = "completed";
      result.updated_at = new Date().toISOString();
      this.results.set(provisionId, result);

      this.auditLogger.log(
        createProvisionAuditEntry(
          "provision.completed",
          user.email,
          provisionId,
          request.partner_name,
          request.partner_domains,
          request.api_package_ids,
          undefined,
          {
            workspace_id: workspaceId,
            workspace_url: result.workspace_url,
            total_steps: result.steps_completed.length,
          }
        )
      );

      logger.info("Provisioning completed successfully", {
        provisionId,
        workspaceId,
        partner: request.partner_name,
      });

      return result;
    } catch (err) {
      result.status = "failed";
      result.error =
        err instanceof Error ? err.message : "Unknown error";
      result.updated_at = new Date().toISOString();
      this.results.set(provisionId, result);

      // ── Rollback: clean up orphaned workspace if one was created ──
      if (workspaceId) {
        try {
          logger.info("Rolling back: deleting orphaned workspace", { provisionId, workspaceId });
          await this.postmanClient.deleteWorkspace(workspaceId);

          // Also clean up invite policy if one was created
          if (this.inviteGuard) {
            this.inviteGuard.deletePolicy(workspaceId);
          }

          result.status = "rolled_back";

          this.auditLogger.log(
            createProvisionAuditEntry(
              "provision.failed",
              user.email,
              provisionId,
              request.partner_name,
              request.partner_domains,
              undefined,
              undefined,
              { rollback: "workspace_deleted", workspace_id: workspaceId }
            )
          );
        } catch (rollbackErr) {
          logger.error("Rollback failed: could not delete workspace", {
            provisionId,
            workspaceId,
            error: rollbackErr instanceof Error ? rollbackErr.message : "Unknown",
          });
          result.error += ` (Rollback also failed: workspace ${workspaceId} may be orphaned)`;
        }
      }

      this.auditLogger.log(
        createProvisionAuditEntry(
          "provision.failed",
          user.email,
          provisionId,
          request.partner_name,
          request.partner_domains,
          undefined,
          err instanceof PolicyDeniedError ? err.decision : undefined,
          { error: result.error }
        )
      );

      logger.error("Provisioning failed", {
        provisionId,
        error: result.error,
      });

      return result;
    }
  }

  /**
   * Get the status/result of a provisioning request.
   */
  getStatus(provisionId: string): ProvisionResult | undefined {
    return this.results.get(provisionId);
  }

  /**
   * List all provision results (for admin/portal).
   */
  listAll(): ProvisionResult[] {
    return Array.from(this.results.values()).sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  // ── Private helpers ─────────────────────────────────

  /**
   * Count existing provisioned workspaces for a team.
   * Used for workspace-limit enforcement.
   */
  private countWorkspacesByTeam(teamId?: string): number {
    if (!teamId) return 0;
    // In production, query the database. For now, count in-memory results.
    let count = 0;
    for (const r of this.results.values()) {
      if (r.status === "completed" && r.team_id === teamId) count++;
    }
    return count;
  }

  private async executeStep(
    result: ProvisionResult,
    stepName: string,
    fn: () => Promise<void>
  ): Promise<void> {
    const step: ProvisionStep = {
      name: stepName,
      status: "in_progress",
      timestamp: new Date().toISOString(),
    };
    result.steps_completed.push(step);

    try {
      await fn();
      step.status = "completed";
      step.message = "Success";
    } catch (err) {
      step.status = "failed";
      step.message = err instanceof Error ? err.message : "Unknown error";
      throw err;
    }
  }

  private generateWorkspaceName(request: ProvisionRequest): string {
    const sanitized = request.partner_name
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .trim();
    return `Partner: ${sanitized}`;
  }

  private generateWorkspaceDescription(
    request: ProvisionRequest,
    policyConfig: WorkspacePolicyConfig
  ): string {
    return (
      `Partner workspace for ${request.partner_name}. ` +
      `Domains: ${request.partner_domains.join(", ")}. ` +
      `Update mode: ${request.update_mode}.` +
      policyConfig.description_suffix
    );
  }
}

/**
 * Custom error for policy-denied requests.
 */
export class PolicyDeniedError extends Error {
  constructor(public readonly decision: PolicyDecision) {
    super(
      `Provisioning denied by policy: ${decision.reasons.join("; ")}`
    );
    this.name = "PolicyDeniedError";
  }
}
