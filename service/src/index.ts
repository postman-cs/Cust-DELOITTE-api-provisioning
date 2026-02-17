/**
 * ─────────────────────────────────────────────────────────
 * API Provisioning Service - Entry Point
 *
 * Wires together all components:
 *  - Config
 *  - Postman client (mock or live)
 *  - Policy engine
 *  - Audit logger
 *  - Provisioning + Sync services
 *  - Express routes + middleware
 * ─────────────────────────────────────────────────────────
 */

import express, { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import helmet from "helmet";
import cors from "cors";

import { loadConfig } from "./config";
import { PolicyEngine } from "./policy/policy-engine";
import { MockPostmanClient } from "./adapters/postman-client.mock";
import { LivePostmanClient } from "./adapters/postman-client.live";
import { IPostmanClient } from "./adapters/postman-client.interface";
import { InMemoryAuditLogger } from "./audit/audit-logger";
import { ProvisioningService } from "./services/provisioning-service";
import { authMiddleware } from "./middleware/auth";
import { errorHandler } from "./middleware/error-handler";
import { InviteGuard } from "./services/invite-guard";
import { ComplianceGuardrailsService } from "./services/compliance-guardrails";
import { CollectionProtectionService } from "./services/collection-protection";
import { createProvisionRoutes } from "./routes/provision";
import { createInviteRoutes } from "./routes/invite";
import { createComplianceRoutes } from "./routes/compliance";
import { createCollectionProtectionRoutes } from "./routes/collection-protection";
import { createAuditRoutes } from "./routes/audit";
import { createHealthRoutes } from "./routes/health";
import { createLiveProvisionRoutes } from "./routes/provision-live";
import { createLogger } from "./middleware/logger";

const logger = createLogger("app");

async function main(): Promise<void> {
  // ── Load configuration ──────────────────────────────
  const config = loadConfig();
  logger.info("Configuration loaded", {
    env: config.nodeEnv,
    port: config.port,
    mockClient: config.useMockPostmanClient,
    authEnabled: config.authEnabled,
  });

  // ── Initialize components ───────────────────────────
  const postmanClient: IPostmanClient = config.useMockPostmanClient
    ? new MockPostmanClient()
    : new LivePostmanClient(config.postmanApiKey, config.postmanApiBaseUrl);

  const policyEngine = new PolicyEngine(config.policy);
  const auditLogger = new InMemoryAuditLogger();

  const provisioningService = new ProvisioningService(
    postmanClient,
    policyEngine,
    auditLogger,
    config
  );

  // ── Invite Guard (Andrew's #4: domain-scoped invite control) ──
  const inviteGuard = new InviteGuard(
    postmanClient,
    auditLogger,
    config.policy
  );

  // ── Compliance Guardrails (security floor + team overrides) ──
  const complianceGuardrails = new ComplianceGuardrailsService(config.compliance);

  // ── Collection Protection (branch protection for Postman) ──
  const collectionProtection = new CollectionProtectionService(
    postmanClient,
    auditLogger
  );

  // Wire Invite Guard into provisioning so new workspaces
  // automatically get an invite policy at creation time
  provisioningService.setInviteGuard(inviteGuard);

  // Wire Compliance Guardrails into provisioning so every
  // workspace is checked against the security floor
  provisioningService.setComplianceGuardrails(complianceGuardrails);

  // ── Create Express app ──────────────────────────────
  const app = express();

  // Security & parsing middleware
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  // Assign a unique request ID to every request (used in responses and logs)
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).requestId = req.headers["x-request-id"] as string || uuidv4();
    logger.debug(`${req.method} ${req.path}`, {
      requestId: (req as any).requestId,
      ip: req.ip,
      userAgent: req.get("user-agent"),
    });
    next();
  });

  // Health routes (no auth required)
  app.use("/health", createHealthRoutes());

  // Auth middleware (applied to all routes below)
  app.use(authMiddleware);

  // API routes
  app.use("/provision", createProvisionRoutes(provisioningService));
  app.use("/invite", createInviteRoutes(inviteGuard));
  app.use("/compliance", createComplianceRoutes(complianceGuardrails));
  app.use("/collections", createCollectionProtectionRoutes(collectionProtection));
  app.use("/audit", createAuditRoutes(auditLogger));

  // Live provisioning — always uses real Postman API (even in mock mode)
  if (config.postmanApiKey && config.postmanGoldenWorkspaceId) {
    app.use("/provision", createLiveProvisionRoutes(
      config.postmanApiKey,
      config.postmanApiBaseUrl,
      config.postmanGoldenWorkspaceId
    ));
    logger.info("Live provisioning enabled", {
      goldenWorkspace: config.postmanGoldenWorkspaceId,
    });
  }

  // Error handler (must be last)
  app.use(errorHandler);

  // ── Start server ────────────────────────────────────
  app.listen(config.port, () => {
    logger.info(`Service started on port ${config.port}`, {
      environment: config.nodeEnv,
      healthCheck: `http://localhost:${config.port}/health`,
    });
    logger.info("Available routes:", {
      routes: [
        "GET    /health",
        "GET    /health/ready",
        "POST   /provision/workspace",
        "GET    /provision/status/:id",
        "GET    /provision/list",
        "POST   /invite/workspace/:id          (send invites — policy-gated)",
        "POST   /invite/workspace/:id/check    (dry-run invite check)",
        "GET    /invite/workspace/:id/policy   (view invite policy)",
        "PUT    /invite/workspace/:id/policy   (update invite policy)",
        "GET    /invite/policies               (list all policies — admin)",
        "GET    /compliance/rules              (list global compliance rules)",
        "GET    /compliance/rules/:teamId      (effective rules for a team)",
        "POST   /compliance/check/workspace    (audit a workspace config)",
        "POST   /collections/protect             (protect a collection)",
        "GET    /collections/:uid/protection      (view protection rule)",
        "PUT    /collections/:uid/protection      (update protection rule)",
        "DELETE /collections/:uid/protection      (remove protection)",
        "GET    /collections/workspace/:id/rules  (list workspace rules)",
        "POST   /collections/pr                   (create pull request)",
        "GET    /collections/pr/:id               (get PR details)",
        "POST   /collections/pr/:id/review        (approve/reject PR)",
        "POST   /collections/pr/:id/merge         (merge approved PR)",
        "GET    /collections/workspace/:id/prs    (list workspace PRs)",
        "GET    /audit/logs",
        "GET    /audit/logs/:id",
        "GET    /audit/provision/:id",
        "GET    /provision/live/environments          (list source environments)",
        "POST   /provision/live                    (real Postman API provisioning)",
        "POST   /provision/live/cleanup             (reset target workspace)",
      ],
    });
  });
}

main().catch((err) => {
  logger.error("Failed to start service", { error: err });
  process.exit(1);
});
