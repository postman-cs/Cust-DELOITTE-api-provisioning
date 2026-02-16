/**
 * ─────────────────────────────────────────────────────────
 * Invite Guard Service
 *
 * Addresses Deloitte requirement #4 — "Invitation-Only Access"
 * with domain-level guardrails.
 *
 * PROBLEM (Andrew's concern):
 *   When "Allow Partner Workspaces" is enabled in Postman,
 *   any team member can invite anyone. At 100k+ users this
 *   is a security and compliance risk.
 *
 * SOLUTION:
 *   This service sits between users and Postman's invite API.
 *   Each provisioned workspace gets an InvitePolicy that defines:
 *     - Which email domains are allowed (e.g., deloitte.ca, partner.com)
 *     - Who can send invites (workspace managers — NOT full admins)
 *     - Whether existing members can invite their colleagues
 *     - Member caps to prevent sprawl
 *
 *   Non-admins can self-serve invites within policy bounds.
 *   Admins can update policies without code changes.
 *   Every invite attempt is audited.
 *
 * ─────────────────────────────────────────────────────────
 */

import { v4 as uuid } from "uuid";
import {
  WorkspaceInvitePolicy,
  InviteRequest,
  InviteResult,
  InvitePolicyDecision,
  InviteRole,
  UserContext,
  PolicyConfig,
} from "../types";
import { IPostmanClient } from "../adapters/postman-client.interface";
import { IAuditLogger, createInviteAuditEntry } from "../audit/audit-logger";
import { createLogger } from "../middleware/logger";

const logger = createLogger("invite-guard");

// ── Public interface ──────────────────────────────────────

export interface IInviteGuard {
  /** Create a new workspace invite policy (called during provisioning) */
  createPolicy(params: CreatePolicyParams): WorkspaceInvitePolicy;

  /** Get the invite policy for a workspace */
  getPolicy(workspaceId: string): WorkspaceInvitePolicy | undefined;

  /** Update the invite policy (admin or workspace manager) */
  updatePolicy(
    workspaceId: string,
    updates: UpdatePolicyParams,
    user: UserContext
  ): WorkspaceInvitePolicy;

  /** Evaluate whether an invite request is allowed (does NOT send invites) */
  evaluateInvite(
    request: InviteRequest,
    user: UserContext
  ): InvitePolicyDecision;

  /** Process an invite: evaluate policy, send via Postman API, audit */
  processInvite(
    request: InviteRequest,
    user: UserContext
  ): Promise<InviteResult>;

  /** List all workspace policies */
  listPolicies(): WorkspaceInvitePolicy[];

  /** Delete a workspace policy (e.g., when workspace is deprovisioned) */
  deletePolicy(workspaceId: string): boolean;
}

export interface CreatePolicyParams {
  workspace_id: string;
  workspace_name: string;
  provision_id: string;
  partner_name: string;
  allowed_invite_domains: string[];
  workspace_managers?: string[];
  allow_member_invites?: boolean;
  max_members?: number;
}

export interface UpdatePolicyParams {
  /** Add domains to the allowlist */
  add_domains?: string[];
  /** Remove domains from the allowlist */
  remove_domains?: string[];
  /** Add workspace managers */
  add_managers?: string[];
  /** Remove workspace managers */
  remove_managers?: string[];
  /** Toggle member invites */
  allow_member_invites?: boolean;
  /** Update member cap */
  max_members?: number;
}

// ── Implementation ─────────────────────────────────────────

export class InviteGuard implements IInviteGuard {
  /**
   * In-memory policy store.
   * Key: workspace_id → WorkspaceInvitePolicy
   */
  private policies: Map<string, WorkspaceInvitePolicy> = new Map();

  constructor(
    private readonly postmanClient: IPostmanClient,
    private readonly auditLogger: IAuditLogger,
    private readonly globalPolicy: PolicyConfig
  ) {}

  // ── Policy CRUD ────────────────────────────────────────

  createPolicy(params: CreatePolicyParams): WorkspaceInvitePolicy {
    const now = new Date().toISOString();

    const policy: WorkspaceInvitePolicy = {
      workspace_id: params.workspace_id,
      workspace_name: params.workspace_name,
      provision_id: params.provision_id,
      partner_name: params.partner_name,
      allowed_invite_domains: this.normalizeDomains(params.allowed_invite_domains),
      workspace_managers: params.workspace_managers ?? [],
      allow_member_invites: params.allow_member_invites ?? false,
      max_members: params.max_members,
      current_member_count: 0,
      created_at: now,
      updated_at: now,
    };

    this.policies.set(params.workspace_id, policy);
    logger.info("Invite policy created", {
      workspace_id: params.workspace_id,
      partner: params.partner_name,
      domains: policy.allowed_invite_domains,
      managers: policy.workspace_managers.length,
    });

    return policy;
  }

  getPolicy(workspaceId: string): WorkspaceInvitePolicy | undefined {
    return this.policies.get(workspaceId);
  }

  updatePolicy(
    workspaceId: string,
    updates: UpdatePolicyParams,
    user: UserContext
  ): WorkspaceInvitePolicy {
    const policy = this.policies.get(workspaceId);
    if (!policy) {
      throw new Error(`No invite policy found for workspace ${workspaceId}`);
    }

    // Only admins or workspace managers can update policy
    if (!this.canManagePolicy(user, policy)) {
      throw new Error(
        `User ${user.email} is not authorized to update invite policy for workspace ${workspaceId}. ` +
        `Requires admin role or workspace manager designation.`
      );
    }

    // Apply domain changes
    if (updates.add_domains) {
      const newDomains = this.normalizeDomains(updates.add_domains);
      // Validate against global blocked domains
      const blocked = this.findBlockedDomains(newDomains);
      if (blocked.length > 0) {
        throw new Error(
          `Cannot add blocked domains: [${blocked.join(", ")}]. ` +
          `Free email providers are never allowed.`
        );
      }
      policy.allowed_invite_domains = [
        ...new Set([...policy.allowed_invite_domains, ...newDomains]),
      ];
    }
    if (updates.remove_domains) {
      const removeLower = updates.remove_domains.map((d) => d.toLowerCase());
      policy.allowed_invite_domains = policy.allowed_invite_domains.filter(
        (d) => !removeLower.includes(d.toLowerCase())
      );
    }

    // Apply manager changes
    if (updates.add_managers) {
      policy.workspace_managers = [
        ...new Set([...policy.workspace_managers, ...updates.add_managers.map((e) => e.toLowerCase())]),
      ];
    }
    if (updates.remove_managers) {
      const removeLower = updates.remove_managers.map((e) => e.toLowerCase());
      policy.workspace_managers = policy.workspace_managers.filter(
        (m) => !removeLower.includes(m.toLowerCase())
      );
    }

    // Apply toggles
    if (updates.allow_member_invites !== undefined) {
      policy.allow_member_invites = updates.allow_member_invites;
    }
    if (updates.max_members !== undefined) {
      policy.max_members = updates.max_members;
    }

    policy.updated_at = new Date().toISOString();
    this.policies.set(workspaceId, policy);

    // Audit the policy change
    this.auditLogger.log(
      createInviteAuditEntry("invite.policy_updated", user.email, {
        workspace_id: workspaceId,
        partner_name: policy.partner_name,
        updates,
      })
    );

    logger.info("Invite policy updated", {
      workspace_id: workspaceId,
      updated_by: user.email,
      domains: policy.allowed_invite_domains,
    });

    return policy;
  }

  listPolicies(): WorkspaceInvitePolicy[] {
    return Array.from(this.policies.values());
  }

  deletePolicy(workspaceId: string): boolean {
    return this.policies.delete(workspaceId);
  }

  // ── Invite evaluation (pure logic, no side effects) ────

  evaluateInvite(
    request: InviteRequest,
    user: UserContext
  ): InvitePolicyDecision {
    const reasons: string[] = [];
    const warnings: string[] = [];
    let allowed = true;

    const policy = this.policies.get(request.workspace_id);
    if (!policy) {
      return {
        allowed: false,
        invitee_decisions: request.invitees.map((inv) => ({
          email: inv.email,
          allowed: false,
          reason: "No invite policy found for this workspace.",
        })),
        reasons: ["No invite policy found for this workspace. Was it provisioned through this service?"],
        warnings: [],
      };
    }

    // ── Check: can this USER send invites? ──────────────
    if (!this.canSendInvites(user, policy)) {
      return {
        allowed: false,
        invitee_decisions: request.invitees.map((inv) => ({
          email: inv.email,
          allowed: false,
          reason: "Requester not authorized to send invites for this workspace.",
        })),
        reasons: [
          `User ${user.email} is not authorized to invite to workspace ${request.workspace_id}. ` +
          `Must be: admin, provisioner, workspace manager, or member (if member invites are enabled).`,
        ],
        warnings: [],
      };
    }

    // ── Check: member cap ───────────────────────────────
    if (
      policy.max_members !== undefined &&
      policy.current_member_count + request.invitees.length > policy.max_members
    ) {
      const remaining = Math.max(0, policy.max_members - policy.current_member_count);
      allowed = false;
      reasons.push(
        `Workspace member cap reached. Max: ${policy.max_members}, ` +
        `Current: ${policy.current_member_count}, Requested: ${request.invitees.length}, ` +
        `Remaining capacity: ${remaining}.`
      );
    }

    // ── Check each invitee's domain ─────────────────────
    const inviteeDecisions = request.invitees.map((inv) => {
      const domain = this.extractDomain(inv.email);
      if (!domain) {
        return {
          email: inv.email,
          allowed: false,
          reason: `Invalid email address: ${inv.email}`,
        };
      }

      // Check against globally blocked domains
      if (this.isDomainBlocked(domain)) {
        return {
          email: inv.email,
          allowed: false,
          reason: `Domain "${domain}" is globally blocked (free email provider).`,
        };
      }

      // Check against workspace-specific allowed domains
      if (!this.isDomainAllowed(domain, policy)) {
        return {
          email: inv.email,
          allowed: false,
          reason:
            `Domain "${domain}" is not in this workspace's allowed invite domains: ` +
            `[${policy.allowed_invite_domains.join(", ")}]. ` +
            `Ask a workspace manager or admin to add this domain to the policy.`,
        };
      }

      return {
        email: inv.email,
        allowed: true,
      };
    });

    // If any invitee was rejected, the overall decision depends on whether ALL were rejected
    const anyRejected = inviteeDecisions.some((d) => !d.allowed);
    const allRejected = inviteeDecisions.every((d) => !d.allowed);

    if (allRejected) {
      allowed = false;
      reasons.push("All invitees were rejected by the invite policy.");
    } else if (anyRejected) {
      warnings.push(
        "Some invitees were rejected. Only approved invitees will be processed."
      );
    }

    return {
      allowed,
      invitee_decisions: inviteeDecisions,
      reasons,
      warnings,
    };
  }

  // ── Process invite (full flow: evaluate → send → audit) ──

  async processInvite(
    request: InviteRequest,
    user: UserContext
  ): Promise<InviteResult> {
    // 1. Audit the request
    this.auditLogger.log(
      createInviteAuditEntry("invite.requested", user.email, {
        workspace_id: request.workspace_id,
        invitees: request.invitees.map((i) => i.email),
      })
    );

    // 2. Evaluate the invite
    const decision = this.evaluateInvite(request, user);

    // 3. Audit the policy check
    this.auditLogger.log(
      createInviteAuditEntry("invite.policy_check", user.email, {
        workspace_id: request.workspace_id,
        decision,
      })
    );

    if (!decision.allowed && decision.invitee_decisions.every((d) => !d.allowed)) {
      // All rejected — nothing to send
      this.auditLogger.log(
        createInviteAuditEntry("invite.rejected", user.email, {
          workspace_id: request.workspace_id,
          reasons: decision.reasons,
          invitee_details: decision.invitee_decisions,
        })
      );

      return {
        workspace_id: request.workspace_id,
        invited: decision.invitee_decisions.map((d) => ({
          email: d.email,
          role: request.invitees.find((i) => i.email === d.email)?.role ?? "viewer",
          status: "rejected" as const,
          reason: d.reason,
        })),
        policy_applied: `workspace:${request.workspace_id}`,
        invited_by: user.email,
        timestamp: new Date().toISOString(),
      };
    }

    // 4. Send approved invites via Postman API
    const approved = decision.invitee_decisions.filter((d) => d.allowed);
    const rejected = decision.invitee_decisions.filter((d) => !d.allowed);

    try {
      if (approved.length > 0) {
        await this.postmanClient.setWorkspacePermissions({
          workspace_id: request.workspace_id,
          members: approved.map((a) => ({
            email: a.email,
            role: request.invitees.find((i) => i.email === a.email)?.role ?? "viewer",
          })),
        });
      }

      // 5. Update member count
      const policy = this.policies.get(request.workspace_id);
      if (policy) {
        policy.current_member_count += approved.length;
        policy.updated_at = new Date().toISOString();
        this.policies.set(request.workspace_id, policy);
      }

      // 6. Audit success
      this.auditLogger.log(
        createInviteAuditEntry("invite.sent", user.email, {
          workspace_id: request.workspace_id,
          invited_count: approved.length,
          rejected_count: rejected.length,
          invited_emails: approved.map((a) => a.email),
        })
      );

      logger.info("Invites processed", {
        workspace_id: request.workspace_id,
        invited: approved.length,
        rejected: rejected.length,
        by: user.email,
      });

      return {
        workspace_id: request.workspace_id,
        invited: [
          ...approved.map((a) => ({
            email: a.email,
            role: (request.invitees.find((i) => i.email === a.email)?.role ?? "viewer") as InviteRole,
            status: "sent" as const,
          })),
          ...rejected.map((r) => ({
            email: r.email,
            role: (request.invitees.find((i) => i.email === r.email)?.role ?? "viewer") as InviteRole,
            status: "rejected" as const,
            reason: r.reason,
          })),
        ],
        policy_applied: `workspace:${request.workspace_id}`,
        invited_by: user.email,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      logger.error("Failed to send invites via Postman API", {
        workspace_id: request.workspace_id,
        error: err,
      });
      throw err;
    }
  }

  // ── Authorization helpers ──────────────────────────────

  /**
   * Can this user send invites for a given workspace?
   *
   * Allowed if ANY of:
   *  - User has admin or provisioner role
   *  - User is a designated workspace manager
   *  - allow_member_invites is true AND user's domain is in allowed list
   */
  private canSendInvites(user: UserContext, policy: WorkspaceInvitePolicy): boolean {
    // Global admins/provisioners can always invite
    if (user.roles.includes("admin") || user.roles.includes("provisioner")) {
      return true;
    }

    // Workspace managers
    if (policy.workspace_managers.some((m) => m.toLowerCase() === user.email.toLowerCase())) {
      return true;
    }

    // Member self-serve (if enabled)
    if (policy.allow_member_invites) {
      const userDomain = this.extractDomain(user.email);
      if (userDomain && this.isDomainAllowed(userDomain, policy)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Can this user manage (update) the invite policy?
   * More restrictive than sending invites — only admins + managers.
   */
  private canManagePolicy(user: UserContext, policy: WorkspaceInvitePolicy): boolean {
    if (user.roles.includes("admin")) return true;
    return policy.workspace_managers.some(
      (m) => m.toLowerCase() === user.email.toLowerCase()
    );
  }

  // ── Domain helpers ─────────────────────────────────────

  private normalizeDomains(domains: string[]): string[] {
    return [...new Set(domains.map((d) => d.toLowerCase().trim()))];
  }

  private extractDomain(email: string): string | null {
    const parts = email.split("@");
    if (parts.length !== 2) return null;
    return parts[1].toLowerCase().trim();
  }

  private isDomainBlocked(domain: string): boolean {
    return this.globalPolicy.blocked_domains.some(
      (b) => b.toLowerCase() === domain.toLowerCase()
    );
  }

  private isDomainAllowed(domain: string, policy: WorkspaceInvitePolicy): boolean {
    return policy.allowed_invite_domains.some(
      (d) => d.toLowerCase() === domain.toLowerCase()
    );
  }

  private findBlockedDomains(domains: string[]): string[] {
    return domains.filter((d) => this.isDomainBlocked(d));
  }
}
