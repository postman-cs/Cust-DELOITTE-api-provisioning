# Architecture: API Publishing + Partner Workspace Provisioning

## Reference Architecture (Implementation-Neutral)

This document defines the architecture by **contracts**, not by specific technology.
The included reference implementation uses Node.js + TypeScript + Express, but every
component is swappable.

---

## System Overview

```
┌──────────────┐     ┌──────────────────────┐     ┌───────────────────┐
│  Developer    │────▶│  CI/CD Pipeline       │────▶│  Postman Golden   │
│  (Git Push)   │     │  (validate→publish)   │     │  Workspace        │
└──────────────┘     └──────────────────────┘     └───────┬───────────┘
                                                          │
                     ┌──────────────────────┐             │ copy/fork
┌──────────────┐     │  Provisioning Service │◀────────────┘
│  Nexus Portal│────▶│  + Policy Engine      │
│  (or CLI)    │     │  + Audit Logger       │────────────┐
└──────────────┘     └──────────────────────┘             │
                                                          ▼
                                                  ┌───────────────────┐
                                                  │  Partner Workspace │
                                                  │  (isolated copy)   │
                                                  └───────────────────┘
```

---

## Pipeline Stages

### Stage 1: Validate
- **Input**: OpenAPI spec (`api/openapi.yaml`), governance rules (`api/governance-rules.yaml`)
- **Processing**: Spectral lint, schema validation, security scanning, metadata checks
- **Output**: Pass/fail with detailed errors
- **Trigger**: On PR creation/update

### Stage 2: Publish
- **Input**: Validated spec + Postman collection templates
- **Processing**: Import spec to Golden workspace, update API definition, tag version
- **Output**: Updated Golden workspace with versioned artifacts
- **Trigger**: On merge to `main`

### Stage 3: Provision
- **Input**: `ProvisionRequest` (partner name, domains, API packages, policy)
- **Processing**: Policy check → create workspace → copy assets → set permissions → enroll updates
- **Output**: `ProvisionResult` with workspace details and audit trail
- **Trigger**: API call from portal or CI/CD workflow dispatch

### Stage 4: Sync
- **Input**: Sync registration (workspace mapping, update mode)
- **Processing**: Compare Golden → partner, copy updated collections
- **Output**: Synced partner workspace
- **Trigger**: Scheduled (auto mode) or manual pull

---

## Component Contracts

### 1. Postman API Adapter

Interface: `IPostmanClient`

| Method | Input | Output | Purpose |
|--------|-------|--------|---------|
| `createWorkspace` | name, type, description | Workspace | Create partner workspace |
| `getWorkspace` | workspaceId | Workspace | Fetch workspace details |
| `listCollections` | workspaceId | Collection[] | List workspace collections |
| `copyCollection` | collectionUid, targetWsId | Collection | Copy to target workspace |
| `forkCollection` | collectionUid, targetWsId, label | ForkResult | Fork with label |
| `copyEnvironment` | envUid, targetWsId, stripSecrets | Environment | Copy env (strip secrets) |
| `setWorkspacePermissions` | wsId, members[] | void | Set member access |
| `importOpenApiSpec` | wsId, specContent | Api | Import OAS into workspace |

**Implementations provided:**
- `MockPostmanClient` — in-memory for testing
- `LivePostmanClient` — real Postman REST API via axios

### 2. Policy Engine

Interface: `IPolicyEngine`

| Method | Input | Output |
|--------|-------|--------|
| `evaluate` | ProvisionRequest, UserContext, existingCount? | PolicyDecision |

**PolicyDecision**:
```typescript
{
  allowed: boolean;
  reasons: string[];       // Why denied (empty if allowed)
  warnings: string[];      // Non-blocking concerns
  rules_evaluated: string[]; // Which rules ran
}
```

**Rules evaluated (in order):**
1. `rbac_check` — user must have admin or provisioner role
2. `blocked_domains` — reject gmail, yahoo, etc.
3. `global_domain_allowlist` — domain must be in global list or team list
4. `per_team_domain_allowlist` — team-specific domain restrictions
5. `single_partner_domain` — only one external domain per workspace
6. `workspace_limit` — max workspaces per team
7. `workspace_policy_validation` — policy preset must exist
8. `partner_domains_required` — at least one domain
9. `api_packages_required` — at least one package

### 3. Audit Logger

Interface: `IAuditLogger`

| Method | Input | Output |
|--------|-------|--------|
| `log` | AuditEntry (minus id/timestamp) | AuditEntry |
| `query` | AuditQuery (filters) | AuditEntry[] |
| `getById` | id | AuditEntry? |
| `getByProvisionId` | provisionId | AuditEntry[] |

---

## Security Model

### Domain Guardrails
- **Blocked domains**: gmail.com, yahoo.com, hotmail.com, etc. (configurable)
- **Global allowlist**: All Deloitte member firm domains
- **Per-team allowlist**: Team-specific partner domains (e.g., team-cpg → coca-cola.com)
- **Single-partner constraint**: Each workspace serves ONE external domain (configurable)

### RBAC
- **admin**: Full access, can override policies
- **provisioner**: Can create workspaces within policy
- **viewer**: Read-only access to status and audit

### Workspace Isolation
- Partner workspaces are isolated copies, not shared access to Golden
- Secrets are stripped from environment copies
- Partners cannot invite others unless explicitly allowed
- Golden workspace is read-only for consumers

---

## Data Flow: Provision Request

```
Client → POST /provision/workspace
  │
  ├─ Validate input (Zod schema)
  │
  ├─ Policy Engine: evaluate(request, user)
  │    ├─ Check RBAC
  │    ├─ Check blocked domains
  │    ├─ Check allowlists
  │    ├─ Check single-partner rule
  │    └─ Return PolicyDecision
  │
  ├─ [If denied] → Return 422 + audit log
  │
  ├─ [If allowed] →
  │    ├─ Create workspace (Postman API)
  │    ├─ Copy/fork collections from Golden
  │    ├─ Copy environments (strip secrets)
  │    ├─ Set permissions
  │    ├─ [If auto] Enroll in sync
  │    └─ Return 201 + ProvisionResult
  │
  └─ Audit: log every step
```

---

## Configuration

All policy is driven by `PolicyConfig` (see `service/src/config/`):

```json
{
  "allowed_domains_global": ["deloitte.com", "deloitte.ca", ...],
  "allowed_domains_by_team": { "team-cpg": ["coca-cola.com"] },
  "single_partner_domain_required": true,
  "allow_partner_invites": false,
  "default_update_mode": "manual",
  "blocked_domains": ["gmail.com", "yahoo.com", ...],
  "max_workspaces_per_team": 50,
  "workspace_policies": { ... }
}
```

---

## Egress Constraints Guidance

If APIs are behind a firewall or VPC:

1. **Desktop Agent**: Use Postman Desktop Agent for local testing behind VPN
2. **Postman Tunneling**: Use `postman-tunnel` for CI/CD pipeline access
3. **Proxy Configuration**: Configure proxy in Postman environments
4. **IP Allowlisting**: Allowlist Postman's IP ranges for API access
5. **API Gateway**: Expose only the partner-facing API through a gateway

Document network requirements in the workspace description and partner onboarding docs.
