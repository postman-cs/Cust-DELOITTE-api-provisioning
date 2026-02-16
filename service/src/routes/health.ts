/**
 * ─────────────────────────────────────────────────────────
 * Health Check Route
 * ─────────────────────────────────────────────────────────
 */

import { Router, Request, Response } from "express";
import * as path from "path";
import * as fs from "fs";
import { getConfig } from "../config";

/** Read version from package.json at startup (not on every request) */
let serviceVersion = "unknown";
try {
  const pkgPath = path.resolve(__dirname, "../../package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  serviceVersion = pkg.version || "unknown";
} catch {
  // If package.json can't be read, keep "unknown"
}

export function createHealthRoutes(): Router {
  const router = Router();

  /**
   * GET /health
   * Basic health check — returns service status and config summary.
   */
  router.get("/", (_req: Request, res: Response) => {
    const config = getConfig();

    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      service: "@deloitte/api-provisioning-service",
      version: serviceVersion,
      environment: config.nodeEnv,
      config: {
        auth_enabled: config.authEnabled,
        mock_postman_client: config.useMockPostmanClient,
        golden_workspace_configured: !!config.postmanGoldenWorkspaceId,
        policy: {
          allowed_domains_global_count: config.policy.allowed_domains_global.length,
          blocked_domains_count: config.policy.blocked_domains.length,
          teams_configured: Object.keys(config.policy.allowed_domains_by_team).length,
          single_partner_domain_required: config.policy.single_partner_domain_required,
        },
      },
    });
  });

  /**
   * GET /health/ready
   * Readiness check — verifies critical dependencies are available.
   */
  router.get("/ready", async (_req: Request, res: Response) => {
    const config = getConfig();

    const checks: Record<string, boolean> = {
      config_loaded: true,
      postman_configured: config.useMockPostmanClient || !!config.postmanApiKey,
      golden_workspace_set: !!config.postmanGoldenWorkspaceId,
    };

    const allHealthy = Object.values(checks).every((v) => v);

    res.status(allHealthy ? 200 : 503).json({
      ready: allHealthy,
      checks,
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
