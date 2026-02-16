# Contract: Pipeline Stages

Each stage is defined by its inputs, outputs, and behavior — independent of CI/CD platform.

---

## Stage: Validate

**Purpose**: Ensure API spec meets governance requirements before merge.

**Inputs**:
- `api/openapi.yaml` — OpenAPI 3.x specification
- `api/governance-rules.yaml` — Spectral ruleset with Deloitte-specific rules

**Processing**:
1. Structural validation (valid OpenAPI schema)
2. Governance lint (Spectral with custom rules)
3. Security scan (no hardcoded secrets, no unprotected endpoints)
4. Metadata checks (x-deloitte-metadata, contact, data-classification)

**Outputs**:
- Pass: PR is allowed to merge
- Fail: PR is blocked with detailed error messages

**Platform mapping**:
| Platform | Implementation |
|----------|---------------|
| GitHub Actions | `pr-validate.yml` workflow |
| GitLab CI | `validate` stage in `.gitlab-ci.yml` |
| Jenkins | `validate` stage in Jenkinsfile |
| Azure DevOps | `Validate` stage in `azure-pipelines.yml` |

---

## Stage: Publish

**Purpose**: Push approved artifacts to Golden Source-of-Truth workspace.

**Inputs**:
- Validated API spec
- Postman collection/environment templates (optional)
- `POSTMAN_API_KEY` secret
- `POSTMAN_GOLDEN_WORKSPACE_ID` secret

**Processing**:
1. Re-validate spec (defense in depth)
2. Import/update OpenAPI spec in Golden workspace
3. Sync collection and environment templates
4. Tag with commit SHA and semantic version

**Outputs**:
- Updated Golden workspace
- Publish confirmation in CI logs

**Trigger**: Merge to `main` branch

---

## Stage: Provision

**Purpose**: Create isolated partner workspace with selected API packages.

**Inputs**:
```typescript
interface ProvisionRequest {
  partner_name: string;
  partner_domains: string[];
  api_package_ids: string[];
  update_mode: "manual" | "auto";
  workspace_policy: "standard" | "restricted" | "open-internal";
  requested_by: string;
  team_id?: string;
}
```

**Processing**:
1. Input validation (Zod schema)
2. Policy evaluation (domain allowlists, RBAC, single-partner rule)
3. Workspace creation (Postman API)
4. Asset copying (collections, environments, with secret stripping)
5. Permission setting
6. Optional update enrollment

**Outputs**:
```typescript
interface ProvisionResult {
  id: string;
  status: "completed" | "failed";
  workspace_id?: string;
  workspace_url?: string;
  steps_completed: ProvisionStep[];
  error?: string;
}
```

**Trigger**: API call from portal, CLI, or workflow dispatch

---

## Stage: Sync

**Purpose**: Keep partner workspaces in sync with Golden.

**Inputs**:
- Sync registration (workspace mapping, update mode)
- Golden workspace state

**Processing**:
- **Manual mode**: Partner or admin triggers sync via API
- **Auto mode**: Scheduled job compares and updates

**Outputs**:
- Updated partner workspace collections
- Sync audit entry

**Trigger**: Manual API call or scheduled job
