# Contract: Policy Engine

The policy engine evaluates every provisioning request against configurable rules
and returns an allow/deny decision with reasons.

---

## Interface: IPolicyEngine

```typescript
interface IPolicyEngine {
  evaluate(
    request: ProvisionRequest,
    user: UserContext,
    existingWorkspaceCount?: number
  ): PolicyDecision;
}
```

---

## PolicyDecision

```typescript
interface PolicyDecision {
  allowed: boolean;
  reasons: string[];       // Why denied (empty array if allowed)
  warnings: string[];      // Non-blocking advisories
  rules_evaluated: string[]; // Which rules were checked
}
```

---

## Rules (evaluated in order)

### 1. rbac_check
- User must have `admin` or `provisioner` role
- Viewers cannot provision

### 2. blocked_domains
- Partner domains are checked against `blocked_domains` list
- Free email providers (gmail, yahoo, hotmail, etc.) are always blocked
- Hard deny — no override

### 3. global_domain_allowlist
- Domains must appear in `allowed_domains_global` OR in the team's allowlist
- Deloitte member firm domains are always in the global list

### 4. per_team_domain_allowlist
- If `team_id` is provided, checks `allowed_domains_by_team[team_id]`
- Generates warnings for domains outside team scope (even if globally allowed)

### 5. single_partner_domain
- When `single_partner_domain_required` is true:
  - Only ONE non-Deloitte domain is allowed per workspace
  - Multiple Deloitte domains are fine (internal sharing)
  - Prevents mixing partners (e.g., coca-cola + pepsi in one workspace)

### 6. workspace_limit
- If `max_workspaces_per_team` is set, checks against `existingWorkspaceCount`
- Prevents runaway workspace creation

### 7. workspace_policy_validation
- The requested `workspace_policy` preset must exist in config
- Unknown presets are denied

### 8. partner_domains_required
- At least one partner domain must be provided

### 9. api_packages_required
- At least one API package ID must be provided

---

## Configuration

```json
{
  "allowed_domains_global": ["deloitte.com", "deloitte.ca", ...],
  "allowed_domains_by_team": {
    "team-cpg": ["coca-cola.com", "ko.com"],
    "team-automotive": ["ford.com", "gm.com"]
  },
  "single_partner_domain_required": true,
  "allow_partner_invites": false,
  "default_update_mode": "manual",
  "blocked_domains": ["gmail.com", "yahoo.com", ...],
  "max_workspaces_per_team": 50,
  "workspace_policies": {
    "standard": { ... },
    "restricted": { ... },
    "open-internal": { ... }
  }
}
```

---

## Extending

To add a new policy rule:

1. Add the rule name to the `rulesEvaluated` array in `evaluate()`
2. Add the evaluation logic
3. Push deny reasons or warnings as appropriate
4. Add test cases in `tests/policy-engine.test.ts`
