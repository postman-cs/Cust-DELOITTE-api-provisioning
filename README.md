# API Provisioning Platform

A governance-first platform for provisioning, managing, and securing Postman workspaces at enterprise scale. Enforces domain guardrails, compliance rules, collection protection, and full audit trails — while letting downstream partners self-serve within safe boundaries.

> *"Governance should feel like autocomplete, not a speed bump. The developers who comply should barely notice it exists, and the ones who bump into it should immediately understand why and what to do instead."*

---

## Plug & Play Setup

### Prerequisites

- **Node.js** >= 20 (`node --version`)
- **npm** >= 9
- A **Postman API key** (get one at [go.postman.co/settings/me/api-keys](https://go.postman.co/settings/me/api-keys))

### 1. Clone

```bash
git clone <your-repo-url>
cd Delloite
```

### 2. Configure (one file)

```bash
cp .env.example service/.env
```

Open `service/.env` and fill in **your** values. Here's what matters:

| Variable | What to put | Where to find it |
|----------|-------------|------------------|
| `POSTMAN_API_KEY` | Your Postman API key | [API Keys page](https://go.postman.co/settings/me/api-keys) |
| `POSTMAN_GOLDEN_WORKSPACE_ID` | ID of your source workspace | URL bar when you open it in Postman |
| `POSTMAN_GOLDEN_WORKSPACE_NAME` | Display name for the golden workspace | Whatever you named it |
| `TARGET_WS_AWS_ID` | Target workspace for AWS assets | Create a workspace in Postman, copy ID |
| `TARGET_WS_AWS_NAME` | Display name for the AWS target | e.g. "Partner-AWS" |
| `TARGET_WS_AZURE_ID` | Target workspace for Azure assets | Create a workspace in Postman, copy ID |
| `TARGET_WS_AZURE_NAME` | Display name for the Azure target | e.g. "Partner-Azure" |
| `TARGET_WS_ONPREM_ID` | Target workspace for On-Prem assets | Create a workspace in Postman, copy ID |
| `TARGET_WS_ONPREM_NAME` | Display name for the On-Prem target | e.g. "Partner-OnPrem" |
| `PARTNER_NAME` | Your demo partner name | e.g. "Coca-Cola UK" |
| `PARTNER_DOMAIN` | Partner's email domain | e.g. "coca-cola.com" |
| `COMPETITOR_DOMAIN` | A competitor domain to block | e.g. "pepsi.com" |
| `ADMIN_ORG_NAME` | Your org name | e.g. "Deloitte" |
| `ADMIN_ORG_DOMAIN` | Your org email domain | e.g. "deloitte.com" |

**Optional (advanced):**

| Variable | What to put | Default |
|----------|-------------|---------|
| `CORS_ALLOWED_ORIGINS` | Comma-separated allowed origins (production only) | All origins allowed in dev |
| `USE_MOCK_POSTMAN_CLIENT` | `true` for in-memory mock, `false` for real API | `true` |
| `AUTH_ENABLED` | `true` to require JWT auth | `false` |

> **That's it.** The demo UI reads all its configuration from the backend's `/config` endpoint. No workspace IDs, partner names, or domains are hardcoded in the HTML — everything flows from `service/.env`.

### 3. Run

```bash
# Install dependencies + start the service
make setup
make dev
```

In a second terminal:

```bash
# Start the demo UI
make demo-ui
```

Open **http://localhost:5173** in your browser. Everything is wired up.

### Or start both at once:

```bash
make demo-all
```

### Zero-config mode (no Postman API key)

If you don't have a Postman API key yet, the service starts in **mock mode** by default. Steps 1–6 and 8–12 all work with the in-memory mock. Only Step 7 (Live Cross-Workspace Provisioning) requires a real API key.

---

## What the Demo Shows

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
- **Denied**: Valid domains used with the wrong team
- **Denied**: Multiple partner domains in a single workspace (cross-contamination prevention)

### 3. Invite Guard (Step 3)

> "Every provisioned workspace gets an invite policy automatically. Partners can invite their own colleagues, but the platform blocks free email addresses and competitor domains — even if the user has admin access to the workspace."

### 4. Compliance Rules (Step 4)

> "This is the security floor — the Postman equivalent of 'no public repos' in GitHub Enterprise. Global rules can never be loosened. Teams can only make them stricter."

- **Global floor**: No public workspaces, no public mock servers, secrets always stripped on copy
- **Team overrides**: Can only tighten (never loosen)

### 5. Collection Protection & PR Workflow (Step 5)

> "Branch protection for Postman. Protected collections can't be edited directly — you fork, make changes, and submit a PR. Self-review is blocked."

### 6. Audit Trail (Step 6)

> "Every action — every provision, every invite, every PR, every policy change — is logged with full context."

### 7. Live Cross-Workspace Provisioning (Step 7)

> "The platform is completely tech-agnostic. We have three source environments — AWS, Azure, and On-Prem — each with completely different infrastructure. Watch as we provision each one into its own dedicated partner workspace using the live Postman API."

This is the "wow" moment:

- **AWS Cloud Services** → **Target Workspace 1**: API Gateway + Lambda + DynamoDB
- **Azure Enterprise** → **Target Workspace 2**: Azure APIM + App Service + Cosmos DB
- **On-Prem Legacy** → **Target Workspace 3**: Traditional data center deployment

Each source environment routes to a completely separate target workspace. The provisioning pipeline copies **three asset types** per environment:

1. **Collections** — full Postman request suites with auth, tests, and examples
2. **Environments** — variable sets (secrets stripped automatically)
3. **API Specs → Spec Hub** — OpenAPI definitions published to each target's Spec Hub, linked to collections

The UI shows the full routing diagram — one golden source fans out into three isolated partner workspaces. Everything is live.

### 8–11. Partner / Sub-Org Experience (Steps 8–11)

> "Switch personas. You're no longer the admin — you're a downstream partner. This is what your team sees."

- **Step 8 — My Workspace**: View provisioned workspace, invite rules, compliance rules
- **Step 9 — Invite My Team**: Invite colleagues (allowed), personal gmail (blocked), competitors (blocked)
- **Step 10 — Fork & PR Workflow**: Submit PRs against protected collections
- **Step 11 — Guardrails in Action**: Self-review blocked, merge without approval blocked, public workspace blocked

### 12. Developer Experience — The Proof Point (Step 12)

> "Governance should feel like autocomplete, not a speed bump."

A simulated developer completes 5 normal tasks — all succeed smoothly. Then we reveal what governance did behind the scenes:

- **17+ policy checks** fired silently
- **5 audit entries** created automatically
- **0 friction points** — the developer never saw a modal or a denial

**No revolt. No wild west.**

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Demo UI (port 5173)                     │
│               Vanilla HTML + Tailwind CSS + JS              │
│               Reads all config from GET /config             │
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
│  │ AWS → WS1 │ Azure → WS2 │ On-Prem → WS3               │ │
│  │ Collections + Environments + Spec Hub (OpenAPI 3.1)     │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### Configuration Flow

```
service/.env  (you edit this)
      │
      ▼
  loadConfig()  →  AppConfig object
      │
      ├──→  GET /config  →  Demo UI (all workspace IDs, names, branding)
      ├──→  Policy Engine (domain allowlists)
      ├──→  Live Provisioning (API key, workspace IDs)
      └──→  Auth Middleware (OIDC settings)
```

**No hardcoded values in the frontend.** The demo UI fetches `GET /config` on startup and populates all workspace IDs, partner names, and domains dynamically from your `.env`.

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
| API Spec | OpenAPI 3.1 |
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
│   ├── seed-workspace.sh       # Seed a Postman workspace from OpenAPI spec
│   └── demo.sh                 # CLI demo script
├── .env.example                # ← START HERE: copy to service/.env
├── Makefile                    # One-command operations
└── README.md
```

---

## Customizing

### Domain Allowlists

Edit `service/src/config/index.ts` → `DEFAULT_POLICY`:

```typescript
allowed_domains_global: [
  "yourcompany.com",
  "yourcompany.co.uk",
],
allowed_domains_by_team: {
  "team-cpg": ["partner.com", "partner-subsidiary.com"],
  "team-automotive": ["oem.com", "supplier.com"],
},
```

Or provide a JSON override file:

```bash
# In service/.env
POLICY_CONFIG_PATH=./config/policy.json
```

### Compliance Rules

The compliance engine has a global security floor and per-team overrides. Teams can only tighten rules, never loosen. See `DEFAULT_COMPLIANCE` in `service/src/config/index.ts`.

### Auth (production)

Set these in `service/.env`:

```bash
AUTH_ENABLED=true
AUTH_ISSUER=https://login.microsoftonline.com/{your-tenant}/v2.0
AUTH_AUDIENCE=api://your-app-registration
AUTH_JWKS_URI=https://login.microsoftonline.com/{your-tenant}/discovery/v2.0/keys
```

---

## API Reference

### Config

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/config` | UI configuration (no secrets) |

### Provisioning

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/provision/workspace` | Provision a partner workspace |
| `GET` | `/provision/status/:id` | Check provisioning status |
| `GET` | `/provision/list` | List all provisions (admin) |

### Live Provisioning (real Postman API)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/provision/live/environments` | List source environments (AWS, Azure, On-Prem) |
| `POST` | `/provision/live` | Provision collections, environments, and specs to target workspace |
| `POST` | `/provision/live/cleanup` | Reset a target workspace (collections, environments, and Spec Hub APIs) |

### Invite Guard

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/invite/workspace/:id` | Send invites (policy-gated) |
| `POST` | `/invite/workspace/:id/check` | Dry-run invite check |
| `GET` | `/invite/workspace/:id/policy` | View invite policy |
| `PUT` | `/invite/workspace/:id/policy` | Update invite policy |

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
| `POST` | `/collections/pr` | Create pull request |
| `POST` | `/collections/pr/:id/review` | Approve/reject PR |
| `POST` | `/collections/pr/:id/merge` | Merge approved PR |

### Audit

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/audit/logs` | Query audit logs |
| `GET` | `/audit/provision/:id` | Full provision audit trail |

---

## Makefile Commands

| Command | Description |
|---------|-------------|
| `make setup` | First-time setup: install deps, create .env |
| `make dev` | Start the service in dev mode |
| `make demo-ui` | Start the web demo UI (port 5173) |
| `make demo-all` | Start service + demo UI together |
| `make test` | Run all tests with coverage |
| `make seed` | Seed the golden workspace from OpenAPI spec |
| `make clean` | Remove build artifacts |

---

## Seeding Your Postman Workspace

To populate your golden workspace with multi-environment collections:

```bash
make seed
```

This creates a collection and environments from the OpenAPI spec and registers the API in Postman's Spec Hub (API Builder). For the multi-environment demo (AWS, Azure, On-Prem), you'll need to create tagged collections in your golden workspace with the `[Tag] Name` format:

- `[AWS] Cloud Platform API`
- `[Azure] Enterprise Services API`
- `[On-Prem] Legacy Platform API`

The platform parses these tags to route assets to the correct target workspace.

### Spec Hub

During live provisioning (Step 7), the platform also publishes the OpenAPI spec from `api/openapi.yaml` into each target workspace's Spec Hub. This creates a full API definition (with schema) and links it to the copied collection. The cleanup route removes these entries as well.

If you have APIs already registered in your golden workspace, the source inventory will display them grouped by environment tag. Otherwise, the local `api/openapi.yaml` is used as the spec source.

---

## Security

The codebase has been hardened for demo and production readiness:

| Area | What's in place |
|------|-----------------|
| **XSS prevention** | All API-sourced data rendered via `innerHTML` is passed through `esc()` (HTML entity encoding) before injection |
| **CORS** | Restricted to explicit origins in production (`CORS_ALLOWED_ORIGINS` env var); permissive only in development |
| **Input validation** | Zod schemas on all POST routes; domain-format regex on partner domains; email validation on `requested_by` |
| **Secrets** | `service/.env` is gitignored; the `/config` endpoint never exposes the API key (only a boolean `liveProvisioningEnabled`) |
| **Error handling** | Global Express error handler; `unhandledRejection` and `uncaughtException` process handlers; graceful network-error messages in the UI |
| **Null safety** | All DOM element lookups guarded; config-load failure shows a visible banner instead of crashing |
| **Spec Hub auth** | Uses the Postman API v10 `Accept: application/vnd.api.v10+json` header for all API/schema operations |

> **Before pushing to a remote**: rotate your `POSTMAN_API_KEY` if it was ever pasted into `service/.env` during local development. The `.gitignore` prevents committing it, but check `git status` to be sure.

---

## RBAC Roles

| Role | Permissions |
|------|-------------|
| `admin` | Full access |
| `provisioner` | Provision workspaces, send invites, create PRs |
| `viewer` | Read-only |

In dev mode (`AUTH_ENABLED=false`), all requests use a default admin user.

---

## Demo Talking Points

Key messages to land during the walkthrough:

1. **Single pane of glass** — One platform governs every API workspace, regardless of source technology (AWS, Azure, on-prem).
2. **Policy-as-code** — Domain guardrails, invite rules, and compliance floors are all defined in config, not manual review queues.
3. **Atomic provisioning** — Workspaces are created through a multi-step pipeline with automatic rollback on failure. No orphaned resources.
4. **Spec Hub integration** — OpenAPI specs are published to each partner workspace's Spec Hub automatically during provisioning, keeping API contracts front-and-center.
5. **Security floor, not ceiling** — Global compliance rules can never be loosened. Teams can only tighten them. This is the Postman equivalent of "no public repos" in GitHub Enterprise.
6. **Branch protection for APIs** — Protected collections require fork → PR → review → merge. Self-review is blocked. This is familiar to any developer who's used GitHub.
7. **Tech-agnostic** — The platform doesn't care if the API runs on Lambda, App Service, or a rack in a basement. It governs and provisions them identically.
8. **Zero-friction governance** — Step 12 is the proof point. A developer does 5 normal tasks, everything works smoothly, and then you reveal 17+ policy checks fired invisibly. No revolt, no wild west.
9. **Plug and play** — Clone the repo, edit one `.env` file, run `make dev`. Everything else auto-configures.

---

## License

UNLICENSED — Proprietary.
