/**
 * ─────────────────────────────────────────────────────────
 * Configuration loader.
 * Merges environment variables with typed defaults.
 * ─────────────────────────────────────────────────────────
 */

import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { PolicyConfig, ComplianceGuardrails } from "../types";

// Load .env — search in multiple locations for plug-and-play flexibility.
// Priority: cwd → service/ → repo root (parent of service/)
const envCandidates = [
  path.resolve(process.cwd(), ".env"),                    // Current working directory
  path.resolve(__dirname, "..", "..", ".env"),             // service/.env (relative to compiled output)
  path.resolve(__dirname, "..", "..", "..", ".env"),       // repo-root/.env (one level above service/)
];
const envFile = envCandidates.find((p) => fs.existsSync(p));
if (envFile) {
  dotenv.config({ path: envFile });
} else {
  // No .env found — rely on process.env and defaults (fine for Docker/CI)
  dotenv.config();
}

export interface TargetWorkspace {
  id: string;
  name: string;
}

export interface DemoBranding {
  adminOrgName: string;
  adminOrgDomain: string;
  partnerName: string;
  partnerDomain: string;
  competitorDomain: string;
}

export interface AppConfig {
  port: number;
  nodeEnv: string;
  logLevel: string;

  // Postman
  postmanApiKey: string;
  postmanApiBaseUrl: string;
  postmanGoldenWorkspaceId: string;
  postmanGoldenWorkspaceName: string;
  useMockPostmanClient: boolean;

  // Target workspaces (one per source environment)
  targetWorkspaces: {
    AWS: TargetWorkspace;
    Azure: TargetWorkspace;
    "On-Prem": TargetWorkspace;
  };

  // Demo branding
  branding: DemoBranding;

  // Auth
  authEnabled: boolean;
  authIssuer: string;
  authAudience: string;
  authJwksUri: string;

  // Database
  databaseUrl: string;

  // Policy
  policy: PolicyConfig;

  // Compliance Guardrails
  compliance: ComplianceGuardrails;
}

/**
 * Default policy configuration.
 * Override by setting POLICY_CONFIG_PATH env var or editing this directly.
 */
export const DEFAULT_POLICY: PolicyConfig = {
  allowed_domains_global: [
    "deloitte.com",
    "deloitte.ca",
    "deloitte.co.uk",
    "deloitte.de",
    "deloitte.fr",
    "deloitte.nl",
    "deloitte.com.au",
    "deloitte.co.jp",
    "deloitte.co.za",
    "deloitte.ch",
  ],

  allowed_domains_by_team: {
    "team-cpg": ["coca-cola.com", "ko.com"],
    "team-automotive": ["ford.com", "gm.com"],
  },

  single_partner_domain_required: true,

  allow_partner_invites: false,

  default_update_mode: "manual",

  blocked_domains: [
    "gmail.com",
    "yahoo.com",
    "hotmail.com",
    "outlook.com",
    "aol.com",
    "icloud.com",
    "mail.com",
    "protonmail.com",
    "zoho.com",
    "yandex.com",
    "163.com",
    "qq.com",
  ],

  max_workspaces_per_team: 50,

  workspace_policies: {
    standard: {
      allow_member_invites: false,
      allow_collection_creation: false,
      allow_forking: true,
      visibility: "partner",
      description_suffix: " | Managed by Deloitte API Platform",
    },
    restricted: {
      allow_member_invites: false,
      allow_collection_creation: false,
      allow_forking: false,
      visibility: "private",
      description_suffix: " | RESTRICTED - Deloitte Managed",
    },
    "open-internal": {
      allow_member_invites: true,
      allow_collection_creation: true,
      allow_forking: true,
      visibility: "team",
      description_suffix: " | Internal Deloitte Workspace",
    },
  },
};

/**
 * Default compliance guardrails — the "bare minimum" security floor.
 *
 * These are the Postman equivalents of:
 *  - GitHub Enterprise: "no public repos" → block_public_sharing
 *  - Atlas: "no open networks" → block_public_mock_servers
 *  - AWS SCPs: prevent egregious violations
 *
 * Team overrides (e.g., US Hosting Services) can only tighten these.
 */
export const DEFAULT_COMPLIANCE: ComplianceGuardrails = {
  global: {
    // No public workspaces — ever (like GitHub "no public repos")
    blocked_workspace_types: ["public"],
    block_public_sharing: true,

    // Fork workflow for shared workspaces (partner + team),
    // but NOT for personal workspaces (Andrew's balance point)
    require_fork_workflow: true,
    fork_workflow_applies_to: ["partner"],

    // Partners can't create their own collections
    block_direct_collection_creation_in_partner: true,

    // Always strip secrets when copying to partner workspaces
    strip_secrets_on_copy: true,
    block_secret_export: true,

    // API specs must be valid
    require_valid_spec: true,
    min_openapi_version: "3.0",
    require_security_schemes_in_spec: false, // warning only at global level

    // No public mock servers (like no public endpoints in Atlas)
    block_public_mock_servers: true,

    // Monitor restrictions
    restrict_monitor_targets: false,
    allowed_monitor_host_patterns: [],

    // Member cap
    max_members_per_workspace: 100,

    // SSO required
    require_sso: true,

    // Provisioning justification — not required at global level
    require_provision_justification: false,

    // Audit
    audit_retention_days: 365,
  },

  team_overrides: {
    // Example: US Hosting Services — stricter rules
    "team-hosting": {
      // Also require fork workflow for team workspaces (not just partner)
      fork_workflow_applies_to: ["partner", "team"],
      // Require a ticket for every provisioning request
      require_provision_justification: true,
      // Lower member cap
      max_members_per_workspace: 50,
      // Require security schemes in specs
      require_security_schemes_in_spec: true,
      // Longer audit retention
      audit_retention_days: 730, // 2 years
    },

    // Example: Sandbox team — uses global defaults (no tightening)
    // "team-sandbox": {} — intentionally absent, gets global defaults
  },
};

/**
 * Deep merge two objects. Arrays are replaced, not concatenated.
 * Only merges plain objects (not arrays, dates, etc.).
 */
function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    const baseVal = base[key];
    const overrideVal = override[key];
    if (
      overrideVal !== undefined &&
      typeof baseVal === "object" &&
      baseVal !== null &&
      !Array.isArray(baseVal) &&
      typeof overrideVal === "object" &&
      overrideVal !== null &&
      !Array.isArray(overrideVal)
    ) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overrideVal as Record<string, unknown>
      );
    } else if (overrideVal !== undefined) {
      result[key] = overrideVal;
    }
  }
  return result;
}

/**
 * Load policy from a JSON file (safe — no code execution).
 * Falls back to DEFAULT_POLICY on any error.
 */
function loadPolicy(): PolicyConfig {
  const policyPath = process.env.POLICY_CONFIG_PATH;
  if (policyPath) {
    try {
      const resolved = path.resolve(policyPath);
      // Security: only allow .json files (no arbitrary code execution)
      if (!resolved.endsWith(".json")) {
        console.warn(`[config] Policy file must be .json, got: ${resolved}. Using defaults.`);
        return DEFAULT_POLICY;
      }
      const raw = fs.readFileSync(resolved, "utf-8");
      const custom = JSON.parse(raw) as Record<string, unknown>;
      return deepMerge(DEFAULT_POLICY as unknown as Record<string, unknown>, custom) as unknown as PolicyConfig;
    } catch (err) {
      console.warn(`[config] Failed to load policy from ${policyPath}, using defaults:`, err);
    }
  }
  return DEFAULT_POLICY;
}

/**
 * Load compliance guardrails from a JSON file.
 * Falls back to DEFAULT_COMPLIANCE on any error.
 */
function loadCompliance(): ComplianceGuardrails {
  const compliancePath = process.env.COMPLIANCE_CONFIG_PATH;
  if (compliancePath) {
    try {
      const resolved = path.resolve(compliancePath);
      if (!resolved.endsWith(".json")) {
        console.warn(`[config] Compliance file must be .json, got: ${resolved}. Using defaults.`);
        return DEFAULT_COMPLIANCE;
      }
      const raw = fs.readFileSync(resolved, "utf-8");
      const custom = JSON.parse(raw) as Record<string, unknown>;
      return deepMerge(DEFAULT_COMPLIANCE as unknown as Record<string, unknown>, custom) as unknown as ComplianceGuardrails;
    } catch (err) {
      console.warn(`[config] Failed to load compliance from ${compliancePath}, using defaults:`, err);
    }
  }
  return DEFAULT_COMPLIANCE;
}

function env(key: string, fallback: string = ""): string {
  return process.env[key] ?? fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined) return fallback;
  return v === "true" || v === "1";
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined) return fallback;
  const parsed = parseInt(v, 10);
  return isNaN(parsed) ? fallback : parsed;
}

export function loadConfig(): AppConfig {
  const useMock = envBool("USE_MOCK_POSTMAN_CLIENT", true);
  const authEnabled = envBool("AUTH_ENABLED", false);
  const postmanApiKey = env("POSTMAN_API_KEY");
  // Default to the mock's seeded workspace ID so zero-config dev works out of the box
  const goldenWorkspaceId = env("POSTMAN_GOLDEN_WORKSPACE_ID", useMock ? "golden-workspace-001" : "");

  // Startup validation: warn loudly if critical config is missing
  if (!useMock && !postmanApiKey) {
    console.error(
      "[config] CRITICAL: POSTMAN_API_KEY is not set and USE_MOCK_POSTMAN_CLIENT is false. " +
      "The service will fail on Postman API calls."
    );
  }
  if (!useMock && !goldenWorkspaceId) {
    console.error(
      "[config] CRITICAL: POSTMAN_GOLDEN_WORKSPACE_ID is not set. " +
      "Publish and provision operations will fail."
    );
  }
  if (authEnabled) {
    const issuer = env("AUTH_ISSUER");
    const jwksUri = env("AUTH_JWKS_URI");
    if (!issuer || !jwksUri) {
      console.error(
        "[config] CRITICAL: AUTH_ENABLED=true but AUTH_ISSUER or AUTH_JWKS_URI is not set. " +
        "JWT validation will not work correctly."
      );
    }
  }

  return {
    port: envInt("PORT", 3000),
    nodeEnv: env("NODE_ENV", "development"),
    logLevel: env("LOG_LEVEL", "debug"),

    postmanApiKey,
    postmanApiBaseUrl: env("POSTMAN_API_BASE_URL", "https://api.getpostman.com"),
    postmanGoldenWorkspaceId: goldenWorkspaceId,
    postmanGoldenWorkspaceName: env("POSTMAN_GOLDEN_WORKSPACE_NAME", "Golden Workspace"),
    useMockPostmanClient: useMock,

    targetWorkspaces: {
      AWS: {
        id: env("TARGET_WS_AWS_ID"),
        name: env("TARGET_WS_AWS_NAME", "Target-AWS"),
      },
      Azure: {
        id: env("TARGET_WS_AZURE_ID"),
        name: env("TARGET_WS_AZURE_NAME", "Target-Azure"),
      },
      "On-Prem": {
        id: env("TARGET_WS_ONPREM_ID"),
        name: env("TARGET_WS_ONPREM_NAME", "Target-OnPrem"),
      },
    },

    branding: {
      adminOrgName: env("ADMIN_ORG_NAME", "Acme Corp"),
      adminOrgDomain: env("ADMIN_ORG_DOMAIN", "acme.com"),
      partnerName: env("PARTNER_NAME", "Partner Inc"),
      partnerDomain: env("PARTNER_DOMAIN", "partner.com"),
      competitorDomain: env("COMPETITOR_DOMAIN", "competitor.com"),
    },

    authEnabled,
    authIssuer: env("AUTH_ISSUER"),
    authAudience: env("AUTH_AUDIENCE"),
    authJwksUri: env("AUTH_JWKS_URI"),

    databaseUrl: env("DATABASE_URL", "sqlite://./data/audit.db"),

    policy: loadPolicy(),
    compliance: loadCompliance(),
  };
}

/** Singleton config instance */
let _config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

/** Reset config (for testing) */
export function resetConfig(): void {
  _config = null;
}
