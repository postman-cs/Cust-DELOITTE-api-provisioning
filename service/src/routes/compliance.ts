/**
 * ─────────────────────────────────────────────────────────
 * Compliance Routes
 *
 * Governance dashboard endpoints for viewing and checking
 * compliance guardrails.
 *
 * GET  /compliance/rules           - List all rules (with optional team filter)
 * GET  /compliance/rules/:teamId   - List effective rules for a team
 * POST /compliance/check/workspace - Check a workspace config for compliance
 * ─────────────────────────────────────────────────────────
 */

import { Router, Request, Response, NextFunction } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { IComplianceGuardrails, WorkspaceComplianceInput } from "../services/compliance-guardrails";
import { requireRole } from "../middleware/auth";
import { AppError } from "../middleware/error-handler";

const WorkspaceComplianceSchema = z.object({
  workspace_id: z.string().min(1),
  workspace_type: z.enum(["personal", "private", "team", "partner"]),
  has_public_collections: z.boolean(),
  has_public_mock_servers: z.boolean(),
  has_unstripped_secrets: z.boolean(),
  member_count: z.number().int().min(0),
  has_fork_workflow: z.boolean(),
  has_direct_collection_creation: z.boolean(),
  has_valid_spec: z.boolean(),
  spec_version: z.string().optional(),
  has_security_schemes: z.boolean(),
  has_sso_enabled: z.boolean(),
  team_id: z.string().optional(),
});

export function createComplianceRoutes(
  complianceService: IComplianceGuardrails
): Router {
  const router = Router();

  /**
   * GET /compliance/rules
   * List all global compliance rules. Useful for governance dashboards.
   */
  router.get(
    "/rules",
    requireRole("admin", "provisioner", "viewer"),
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const rules = complianceService.listRules();

        res.json({
          success: true,
          data: {
            tier: "global",
            rules,
          },
          meta: {
            request_id: uuid(),
            timestamp: new Date().toISOString(),
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * GET /compliance/rules/:teamId
   * List effective rules for a specific team (global + team overrides merged).
   */
  router.get(
    "/rules/:teamId",
    requireRole("admin", "provisioner", "viewer"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const teamId = req.params.teamId;
        const rules = complianceService.listRules(teamId);
        const effectiveRules = complianceService.getEffectiveRules(teamId);

        res.json({
          success: true,
          data: {
            team_id: teamId,
            tier: rules.some((r) => r.source === "team_override") ? "team" : "global",
            rules,
            effective_config: effectiveRules,
          },
          meta: {
            request_id: uuid(),
            timestamp: new Date().toISOString(),
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * POST /compliance/check/workspace
   * Check an existing workspace's configuration against compliance rules.
   * Useful for auditing existing workspaces.
   */
  router.post(
    "/check/workspace",
    requireRole("admin", "provisioner"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = WorkspaceComplianceSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new AppError(400, "VALIDATION_ERROR", "Invalid workspace compliance input", {
            errors: parsed.error.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
          });
        }

        const input = parsed.data as WorkspaceComplianceInput;
        const result = complianceService.evaluateWorkspaceConfig(
          input,
          parsed.data.team_id
        );

        res.json({
          success: true,
          data: result,
          meta: {
            request_id: uuid(),
            timestamp: new Date().toISOString(),
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
