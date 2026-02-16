/**
 * ─────────────────────────────────────────────────────────
 * Policy Engine
 *
 * Evaluates provisioning requests against configurable rules.
 * Returns allow/deny decisions with reasons and warnings.
 *
 * Rules enforced (in order):
 *  1. Required fields (domains, packages)
 *  2. RBAC role check
 *  3. Blocked domain check (gmail, yahoo, etc.)
 *  4. Global domain allowlist
 *  5. Per-team domain allowlist
 *  6. Single-partner-domain constraint
 *  7. Workspace limit per team
 *  8. Workspace policy validation
 * ─────────────────────────────────────────────────────────
 */

import {
  PolicyConfig,
  PolicyDecision,
  ProvisionRequest,
  UserContext,
} from "../types";

export interface IPolicyEngine {
  evaluate(
    request: ProvisionRequest,
    user: UserContext,
    existingWorkspaceCount?: number
  ): PolicyDecision;
}

export class PolicyEngine implements IPolicyEngine {
  constructor(private readonly config: PolicyConfig) {}

  evaluate(
    request: ProvisionRequest,
    user: UserContext,
    existingWorkspaceCount: number = 0
  ): PolicyDecision {
    const reasons: string[] = [];
    const warnings: string[] = [];
    const rulesEvaluated: string[] = [];
    let allowed = true;

    // ── Rule 1: Required fields (checked FIRST to prevent null crashes) ──
    rulesEvaluated.push("partner_domains_required");
    const hasDomains = Array.isArray(request.partner_domains) && request.partner_domains.length > 0;
    if (!hasDomains) {
      allowed = false;
      reasons.push("At least one partner domain is required.");
    }

    rulesEvaluated.push("api_packages_required");
    if (!Array.isArray(request.api_package_ids) || request.api_package_ids.length === 0) {
      allowed = false;
      reasons.push("At least one API package ID is required.");
    }

    // ── Rule 2: RBAC check ────────────────────────────
    rulesEvaluated.push("rbac_check");
    if (!this.hasProvisionPermission(user)) {
      allowed = false;
      reasons.push(
        `User ${user.email} does not have provisioner or admin role. ` +
        `Current roles: [${user.roles.join(", ")}]`
      );
    }

    // Skip domain-related rules if no domains provided (already denied above)
    if (hasDomains) {
      // ── Rule 3: Blocked domains ───────────────────────
      rulesEvaluated.push("blocked_domains");
      const blockedDomains = this.findBlockedDomains(request.partner_domains);
      if (blockedDomains.length > 0) {
        allowed = false;
        reasons.push(
          `Blocked domains detected: [${blockedDomains.join(", ")}]. ` +
          `Free email providers and public domains are not allowed.`
        );
      }

      // ── Rule 4: Global domain allowlist ───────────────
      rulesEvaluated.push("global_domain_allowlist");
      const nonAllowedDomains = this.findNonAllowedDomains(
        request.partner_domains,
        request.team_id
      );
      if (nonAllowedDomains.length > 0) {
        const strictlyDisallowed = nonAllowedDomains.filter(
          (d) => !this.isDomainAllowedByTeam(d, request.team_id)
        );
        if (strictlyDisallowed.length > 0) {
          allowed = false;
          reasons.push(
            `Domains not in any allowlist: [${strictlyDisallowed.join(", ")}]. ` +
            `Add to global or team-specific allowlist to permit.`
          );
        }
      }

      // ── Rule 5: Per-team domain allowlist ─────────────
      rulesEvaluated.push("per_team_domain_allowlist");
      if (request.team_id) {
        const teamDomains = this.config.allowed_domains_by_team[request.team_id];
        if (teamDomains) {
          const outsideTeamScope = request.partner_domains.filter(
            (d) =>
              !this.normalizedIncludes(teamDomains, d) &&
              !this.normalizedIncludes(this.config.allowed_domains_global, d)
          );
          if (outsideTeamScope.length > 0) {
            warnings.push(
              `Domains [${outsideTeamScope.join(", ")}] are not in team ` +
              `"${request.team_id}" allowlist. They may require additional approval.`
            );
          }
        }
      }

      // ── Rule 6: Single-partner-domain constraint ──────
      rulesEvaluated.push("single_partner_domain");
      if (this.config.single_partner_domain_required) {
        const externalDomains = request.partner_domains.filter(
          (d) => !this.isDeloitteDomain(d)
        );
        if (externalDomains.length > 1) {
          allowed = false;
          reasons.push(
            `Single-partner-domain policy is active. Found ${externalDomains.length} ` +
            `external domains: [${externalDomains.join(", ")}]. ` +
            `Each partner workspace must serve exactly one external partner domain.`
          );
        }
      }
    }

    // ── Rule 7: Workspace limit per team ──────────────
    rulesEvaluated.push("workspace_limit");
    if (
      this.config.max_workspaces_per_team !== undefined &&
      this.config.max_workspaces_per_team !== null &&
      this.config.max_workspaces_per_team >= 0 &&
      existingWorkspaceCount >= this.config.max_workspaces_per_team
    ) {
      allowed = false;
      reasons.push(
        `Team has reached the maximum workspace limit of ` +
        `${this.config.max_workspaces_per_team}. Current count: ${existingWorkspaceCount}.`
      );
    }

    // ── Rule 8: Workspace policy validation ───────────
    rulesEvaluated.push("workspace_policy_validation");
    if (!this.config.workspace_policies[request.workspace_policy]) {
      allowed = false;
      reasons.push(
        `Unknown workspace policy preset: "${request.workspace_policy}". ` +
        `Valid presets: [${Object.keys(this.config.workspace_policies).join(", ")}]`
      );
    }

    // ── Informational warnings ────────────────────────
    if (!this.config.allow_partner_invites) {
      warnings.push(
        "Partner invite policy is disabled. Only Deloitte provisioners " +
        "can add members to this workspace."
      );
    }

    return {
      allowed,
      reasons,
      warnings,
      rules_evaluated: rulesEvaluated,
    };
  }

  // ── Helper methods ──────────────────────────────────

  private hasProvisionPermission(user: UserContext): boolean {
    return user.roles.includes("admin") || user.roles.includes("provisioner");
  }

  /** Case-insensitive check whether a value exists in a list */
  private normalizedIncludes(list: string[], value: string): boolean {
    const lower = value.toLowerCase();
    return list.some((item) => item.toLowerCase() === lower);
  }

  private findBlockedDomains(domains: string[]): string[] {
    return domains.filter((d) =>
      this.normalizedIncludes(this.config.blocked_domains, d)
    );
  }

  private findNonAllowedDomains(
    domains: string[],
    teamId?: string
  ): string[] {
    return domains.filter((d) => {
      const lower = d.toLowerCase();
      // Check global allowlist (case-insensitive)
      if (this.config.allowed_domains_global.some((g) => g.toLowerCase() === lower)) return false;
      // Check team-specific allowlist
      if (teamId && this.isDomainAllowedByTeam(lower, teamId)) return false;
      return true;
    });
  }

  private isDomainAllowedByTeam(
    domain: string,
    teamId?: string
  ): boolean {
    if (!teamId) return false;
    const teamDomains = this.config.allowed_domains_by_team[teamId];
    if (!teamDomains) return false;
    return this.normalizedIncludes(teamDomains, domain);
  }

  /**
   * Determine if a domain belongs to Deloitte.
   * Checks: exact "deloitte.com", subdomains of deloitte.com,
   * and any domain matching the "deloitte.<tld>" pattern in the
   * global allowlist (covers country-specific member firms).
   */
  private isDeloitteDomain(domain: string): boolean {
    const lower = domain.toLowerCase();
    // Exact match or subdomain of deloitte.com
    if (lower === "deloitte.com" || lower.endsWith(".deloitte.com")) {
      return true;
    }
    // Check all global allowlist entries that start with "deloitte."
    // This covers deloitte.ca, deloitte.co.uk, etc.
    return this.config.allowed_domains_global.some(
      (d) => d.toLowerCase().startsWith("deloitte.") && d.toLowerCase() === lower
    );
  }
}
