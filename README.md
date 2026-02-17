# Deloitte API Provisioning Platform

A governance-first platform for provisioning, managing, and securing Postman workspaces at enterprise scale. Built for Deloitte's partner ecosystem, it enforces domain guardrails, compliance rules, collection protection, and full audit trails — while letting downstream partners self-serve within safe boundaries.

---

## Demo Talking Points

These are the key narratives to walk through during a live demo. Each maps to a step in the interactive web UI.

### 1. One-Click Workspace Provisioning (Step 1)

> "We provision a partner workspace with a single API call. The platform creates the workspace, copies collections and environments from the golden source, sets permissions, applies an invite policy, and checks compliance — all in one atomic pipeline with automatic rollback on failure."

- Atomic 6-step pipeline: validate → create workspace → copy assets → set permissions → enroll updates → apply invite policy
- Automatic rollback if any step fails (no orphaned workspaces)
- Per-team workspace limits enforced (max 50 per team by default)
- Every step logged to the audit trail

### 2. Domain Guardrails (Step 2)

> "The policy engine blocks provisioning for free email domains like gmail.com, denies unknown corporate domains not in any team's allowlist, prevents cross-team domain leakage, and enforces single-partner workspaces. None of this requires human review — it's policy-as-code."

- **Blocked**: Free email providers (gmail.com, yahoo.com, hotmail.com, etc.)
- **Denied**: Domains not registered to any team's allowlist
- **Denied**: Valid domains used with the wrong team (e.g., coca-cola.com via team-automotive)
- **Denied**: Multiple partner domains in a single workspace (cross-contamination prevention)
- All Deloitte member-firm domains (deloitte.com, .ca, .co.uk, .de, etc.) are globally allowed

### 3. Invite Guard (Step 3)

> "Every provisioned workspace gets an invite policy automatically. Partners can invite their own colleagues, but the platform blocks free email addresses and competitor domains — even if the user has admin access to the workspace. The guardrails can't be bypassed."

- Invite policies are auto-created during provisioning
- Domain-scoped: only partner domains + Deloitte domains are allowed
- Dry-run endpoint for pre-validation (UI can check before sending)
- Mixed invites are partially processed (valid emails go through, invalid are rejected)

### 4. Compliance Rules (Step 4)

> "This is the security floor — the Postman equivalent of 'no public repos' in GitHub Enterprise or 'no open networks' in Atlas. Global rules can never be loosened. Teams can only make them stricter."

- **Global floor**: No public workspaces, no public mock servers, secrets always stripped on copy, valid OpenAPI specs required
- **Team overrides**: Can only tighten (e.g., US Hosting Services requires security schemes in specs, 2-year audit retention, provisioning justification)
- Workspace compliance auditing: submit any workspace config and get a violation report with remediation steps

### 5. Collection Protection & PR Workflow (Step 5)

> "This is branch protection for Postman. Protected collections can't be edited directly — you fork, make changes, and submit a PR. Self-review is blocked. You need approval before merge. Just like GitHub, but for API collections."

- Protect any collection with configurable rules (required approvals, designated reviewers/mergers)
- Fork → Edit → PR → Review → Merge workflow
- Self-review blocked (PR author cannot approve their own PR)
- Merge blocked without required approvals
- Full PR lifecycle tracking with audit trail

### 6. Audit Trail (Step 6)

> "Every action — every provision, every invite, every PR, every policy change — is logged with full context. You can query by action type, actor, provision ID, or date range. This is your compliance evidence."

- Immutable audit log for all operations
- Queryable by action, actor, provision ID, date range
- Per-provision timeline view (step-by-step what happened)
- Filter by specific events (e.g., all rejected invites)

### 7. Live Cross-Workspace Provisioning (Step 7)

> "Here's where it gets real. The platform is completely tech-agnostic. We have three source environments — AWS, Azure, and On-Prem — each with completely different auth patterns, endpoints, and infrastructure. Watch as we provision from each one into a separate partner workspace using the live Postman API. The collections and environments appear in Postman immediately."

This is the "wow" moment of the demo:

- **AWS Cloud Services**: API Gateway + Lambda + DynamoDB (us-east-1) — Cognito auth, DynamoDB table names, Lambda qualifiers
- **Azure Enterprise**: Azure API Management + App Service + Cosmos DB (West Europe) — Azure AD/OIDC auth, APIM subscription keys, Cosmos endpoints
- **On-Prem Legacy**: Traditional data center deployment (US-DC-01) — the original platform API

Each environment has its own collection (with real request structures, auth headers, and variable references) and Dev + Production environments with infrastructure-specific variables. The platform provisions them all the same way — it doesn't care where your APIs live.

- Per-environment or all-at-once provisioning
- Secrets are stripped during copy (credentials never leak to partner workspaces)
- Additive provisioning: provision AWS first, add Azure later
- Reset button to clean and re-run the demo
- Direct links to verify in Postman

### 8–11. Partner / Sub-Org Experience (Steps 8–11)

> "Now let's switch personas. You're no longer the Deloitte admin — you're Coca-Cola UK, a downstream partner. This is what your team sees: your workspace, your invite rules, your compliance obligations, and your guardrails in action."

- **Step 8 — My Workspace**: View provisioned workspace, invite rules, compliance rules, and protected collections
- **Step 9 — Invite My Team**: Invite colleagues from coca-cola.com (allowed), Deloitte consultants (allowed), personal gmail (blocked), competitors (blocked)
- **Step 10 — Fork & PR Workflow**: Submit a PR against a protected collection, check status, list all PRs
- **Step 11 — Guardrails in Action**: Try to self-review (blocked), merge without approval (blocked), create a public workspace (compliance violation)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Demo UI (port 5173)                     │
│               Vanilla HTML + Tailwind CSS + JS              │
└─────────────────────┬───────────────────────────────────────┘
                      │ HTTP
┌─────────────────────▼───────────────────────────────────────┐
│                  Express API (port 3000)                     │
│                                                              │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐ │
│  │ Policy Engine │ │ Invite Guard │ │ Collection Protection │ │
│  └──────┬───────┘ └──────┬───────┘ └──────────┬───────────┘ │
│         │                │                     │              │
│  ┌──────▼────────────────▼─────────────────────▼───────────┐ │
│  │            Provisioning Service (pipeline)               │ │
│  │    validate → create → copy → permissions → enroll       │ │
│  └──────────────────────┬──────────────────────────────────┘ │
│                         │                                    │
│  ┌──────────────────────▼──────────────────────────────────┐ │
│  │  Postman Client (IPostmanClient)                         │ │
│  │  ├── MockPostmanClient (in-memory, zero-config)          │ │
│  │  └── LivePostmanClient (real Postman API)                │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌──────────────────┐  ┌─────────────────────────────────┐  │
│  │ Compliance Engine │  │ Audit Logger (in-memory / DB)    │  │
│  └──────────────────┘  └─────────────────────────────────┘  │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Live Provisioning (real Postman API, multi-environment)  │ │
│  │ AWS Cloud │ Azure Enterprise │ On-Prem Legacy            │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (strict mode) |
| Runtime | Node.js >= 20 |
| Framework | Express.js |
| Validation | Zod schemas |
| Auth | JWT (Entra ID / OIDC) — stubbed in dev mode |
| Logging | Winston (structured JSON) |
| Testing | Jest with coverage |
| API Spec | OpenAPI 3.0 |
| API Linting | Spectral |
| Build | `tsc` (TypeScript compiler) |

### Project Structure

```
Delloite/
├── service/                    # Backend API service
│   ├── src/
│   │   ├── index.ts            # Entry point — wires everything together
│   │   ├── config/             # Configuration loader (.env + defaults)
│   │   ├── adapters/           # Postman API clients (mock + live)
│   │   ├── services/           # Core business logic
│   │   │   ├── provisioning-service.ts   # Workspace provisioning pipeline
│   │   │   ├── invite-guard.ts           # Domain-scoped invite control
│   │   │   ├── compliance-guardrails.ts  # Security floor enforcement
│   │   │   └── collection-protection.ts  # Branch protection + PR workflow
│   │   ├── policy/             # Policy engine (domain guardrails)
│   │   ├── routes/             # Express route handlers
│   │   ├── middleware/         # Auth, error handling, logging
│   │   ├── audit/              # Audit logger
│   │   └── types/              # TypeScript interfaces
│   ├── tests/                  # Jest test suite
│   ├── package.json
│   └── tsconfig.json
├── demo-ui/                    # Interactive web demo
│   ├── index.html              # Single-page app (Tailwind CSS)
│   └── package.json
├── scripts/
│   ├── demo.sh                 # CLI demo script
│   ├── provision.sh            # CLI provisioning helper
│   ├── publish.sh              # CLI publish helper
│   ├── validate.sh             # CLI validation helper
│   └── seed-workspace.sh       # Seed a Postman workspace from OpenAPI spec
├── postman/                    # Postman assets
│   └── environments/           # Environment JSON files
├── openapi.yaml                # OpenAPI 3.0 specification
├── .spectral.yaml              # API linting rules
├── .env.example                # Environment template
├── Makefile                    # One-command operations
└── README.md                   # You are here
```

---

## Quick Start

### Prerequisites

- **Node.js** >= 20 (`node --version`)
- **npm** >= 9

### Setup (2 commands)

```bash
# 1. Clone and set up
git clone https://github.com/danielshively-source/Deloitte.git
cd Deloitte
make setup

# 2. Start the service
make dev
```

The service starts on `http://localhost:3000` in mock mode — no Postman API key needed, no auth required. Everything works out of the box.

### Run the Web Demo

In a second terminal:

```bash
make demo-ui
```

Open `http://localhost:5173` in your browser. Click through Steps 1–11 or hit "Run Full Demo" to automate everything.

### Or start both at once:

```bash
make demo-all
```

---

## Configuration

Copy `.env.example` to `service/.env` and edit as needed. The defaults work for local development in mock mode.

### Key Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `USE_MOCK_POSTMAN_CLIENT` | `true` | Use in-memory mock (no API key needed) |
| `POSTMAN_API_KEY` | — | Your Postman API key (for live mode) |
| `POSTMAN_GOLDEN_WORKSPACE_ID` | auto | Source workspace for provisioning |
| `PORT` | `3000` | Service port |
| `AUTH_ENABLED` | `false` | Enable JWT auth (Entra ID / OIDC) |
| `LOG_LEVEL` | `debug` | Winston log level |

### Mock Mode vs. Live Mode

| Feature | Mock Mode | Live Mode |
|---------|-----------|-----------|
| Postman API calls | In-memory simulation | Real Postman API |
| API key required | No | Yes |
| Assets visible in Postman | No | Yes |
| Cross-workspace provisioning | Simulated | Real (Step 7) |
| Suitable for | Development, demo, testing | Production, live demo |

> **Note**: Even in mock mode, Step 7 (Live Cross-Workspace Provisioning) uses the real Postman API if `POSTMAN_API_KEY` and `POSTMAN_GOLDEN_WORKSPACE_ID` are set. This lets you run Steps 1–6 with the fast mock client while still having a real "wow" moment in Step 7.

---

## API Reference

### Provisioning

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/provision/workspace` | Provision a partner workspace |
| `GET` | `/provision/status/:id` | Check provisioning status |
| `GET` | `/provision/list` | List all provisions (admin) |

### Live Provisioning (real Postman API)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/provision/live/environments` | List available source environments (AWS, Azure, On-Prem) |
| `POST` | `/provision/live` | Provision from source to target workspace |
| `POST` | `/provision/live/cleanup` | Reset a target workspace |

### Invite Guard

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/invite/workspace/:id` | Send invites (policy-gated) |
| `POST` | `/invite/workspace/:id/check` | Dry-run invite check |
| `GET` | `/invite/workspace/:id/policy` | View invite policy |
| `PUT` | `/invite/workspace/:id/policy` | Update invite policy |
| `GET` | `/invite/policies` | List all policies (admin) |

### Compliance

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/compliance/rules` | Global compliance rules |
| `GET` | `/compliance/rules/:teamId` | Effective rules for a team |
| `POST` | `/compliance/check/workspace` | Audit a workspace config |

### Collection Protection & PR Workflow

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/collections/protect` | Protect a collection |
| `GET` | `/collections/:uid/protection` | View protection rule |
| `PUT` | `/collections/:uid/protection` | Update protection rule |
| `DELETE` | `/collections/:uid/protection` | Remove protection |
| `GET` | `/collections/workspace/:id/rules` | List workspace rules |
| `POST` | `/collections/pr` | Create pull request |
| `GET` | `/collections/pr/:id` | Get PR details |
| `POST` | `/collections/pr/:id/review` | Approve/reject PR |
| `POST` | `/collections/pr/:id/merge` | Merge approved PR |
| `GET` | `/collections/workspace/:id/prs` | List workspace PRs |

### Audit

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/audit/logs` | Query audit logs (supports `?action=`, `?actor=`, `?limit=`) |
| `GET` | `/audit/logs/:id` | Get a specific audit entry |
| `GET` | `/audit/provision/:id` | Full provision audit trail |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Service health check |
| `GET` | `/health/ready` | Readiness probe |

---

## Makefile Commands

Run `make help` to see all available commands:

| Command | Description |
|---------|-------------|
| `make setup` | First-time setup: install deps, create .env, run tests |
| `make dev` | Start the service in dev mode (mock Postman, no auth) |
| `make test` | Run all tests with coverage |
| `make lint` | Typecheck the codebase |
| `make check` | Run all checks: lint + typecheck + tests |
| `make build` | Build for production |
| `make demo` | Run the interactive CLI demo |
| `make demo-ui` | Start the web demo UI (port 5173) |
| `make demo-all` | Start service + demo UI together |
| `make seed` | Seed the golden Postman workspace from OpenAPI spec |
| `make provision` | Provision a partner workspace (CLI example) |
| `make clean` | Remove build artifacts and coverage |

---

## Seeding a Postman Workspace

To populate a real Postman workspace with the OpenAPI spec, collection, and environments:

```bash
# Set your credentials
export POSTMAN_API_KEY=PMAK-your-key-here
export POSTMAN_GOLDEN_WORKSPACE_ID=your-workspace-id

# Seed from local spec
make seed

# Or seed by pulling the spec from GitHub
make seed-github
```

This creates:
- A Postman collection from the OpenAPI spec
- Production and Staging environments
- An API definition in Postman's Spec Hub with the linked schema

---

## Testing

```bash
# Run tests with coverage
make test

# Watch mode
make test-watch

# Typecheck only
make lint
```

---

## RBAC Roles

| Role | Permissions |
|------|-------------|
| `admin` | Full access: provision, invite, protect, audit, compliance |
| `provisioner` | Provision workspaces, send invites, create PRs |
| `viewer` | Read-only access to status, policies, and audit logs |

In dev mode (`AUTH_ENABLED=false`), all requests run as a default user with `admin` + `provisioner` roles.

---

## Policy Configuration

Domain policies and compliance rules are configured in `service/src/config/index.ts` with sensible defaults. Override with JSON files:

```bash
# Custom policy
POLICY_CONFIG_PATH=./config/policy.json

# Custom compliance rules
COMPLIANCE_CONFIG_PATH=./config/compliance.json
```

### Default Domain Allowlists

| Team | Allowed Partner Domains |
|------|------------------------|
| `team-cpg` | coca-cola.com, ko.com |
| `team-automotive` | ford.com, gm.com |
| (global) | All deloitte.* member-firm domains |

### Blocked Domains (always)

gmail.com, yahoo.com, hotmail.com, outlook.com, aol.com, icloud.com, mail.com, protonmail.com, zoho.com, yandex.com, 163.com, qq.com

---

## Deployment

### Production Checklist

- [ ] Set `USE_MOCK_POSTMAN_CLIENT=false`
- [ ] Set `POSTMAN_API_KEY` to a valid Postman API key
- [ ] Set `POSTMAN_GOLDEN_WORKSPACE_ID` to your golden workspace
- [ ] Set `AUTH_ENABLED=true` and configure Entra ID / OIDC
- [ ] Set `NODE_ENV=production`
- [ ] Set `LOG_LEVEL=info`
- [ ] Configure a persistent database for audit logs (`DATABASE_URL`)
- [ ] Run `make build` and deploy `service/dist/`

### Health Checks

- **Liveness**: `GET /health`
- **Readiness**: `GET /health/ready`

---

## License

UNLICENSED — Proprietary. Deloitte internal use only.
