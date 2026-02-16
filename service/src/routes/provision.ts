/**
 * ─────────────────────────────────────────────────────────
 * Provision Routes
 *
 * POST /provision/workspace  - Create a partner workspace
 * GET  /provision/status/:id - Check provisioning status
 * GET  /provision/list       - List all provisions (admin)
 * ─────────────────────────────────────────────────────────
 */

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { ProvisioningService } from "../services/provisioning-service";
import { requireRole } from "../middleware/auth";
import { AppError } from "../middleware/error-handler";
import { ProvisionRequest } from "../types";

/**
 * Domain regex: validates proper domain format.
 * - Labels separated by dots
 * - Labels must start/end with alphanumeric
 * - TLD must be 2+ chars
 * - No consecutive dots, no leading/trailing dots or hyphens
 */
const DOMAIN_REGEX = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

/**
 * Input validation schema using Zod.
 */
const ProvisionRequestSchema = z.object({
  partner_name: z
    .string()
    .min(1, "partner_name is required")
    .max(200, "partner_name must be <= 200 chars"),
  partner_domains: z
    .array(z.string().regex(DOMAIN_REGEX, "Invalid domain format (e.g., 'partner.com')"))
    .min(1, "At least one partner domain is required"),
  api_package_ids: z
    .array(z.string().min(1))
    .min(1, "At least one API package ID is required"),
  update_mode: z.enum(["manual", "auto"]).default("manual"),
  workspace_policy: z.enum(["standard", "restricted", "open-internal"]).default("standard"),
  requested_by: z.string().email("requested_by must be a valid email"),
  team_id: z.string().optional(),
  metadata: z.record(z.string()).optional(),
});

export function createProvisionRoutes(
  provisioningService: ProvisioningService
): Router {
  const router = Router();

  /**
   * POST /provision/workspace
   * Create a new partner workspace with policy enforcement.
   */
  router.post(
    "/workspace",
    requireRole("admin", "provisioner"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        // Validate input
        const parsed = ProvisionRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new AppError(400, "VALIDATION_ERROR", "Invalid provision request", {
            errors: parsed.error.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
          });
        }

        const provisionRequest: ProvisionRequest = parsed.data;

        // Execute provisioning
        const result = await provisioningService.provision(
          provisionRequest,
          req.user!
        );

        const statusCode = result.status === "failed" ? 422 : 201;

        res.status(statusCode).json({
          success: result.status !== "failed",
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

  /**
   * GET /provision/status/:id
   * Get the status of a provisioning request.
   * Requires at least viewer role to prevent unauthenticated access.
   */
  router.get(
    "/status/:id",
    requireRole("admin", "provisioner", "viewer"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = provisioningService.getStatus(req.params.id);
        if (!result) {
          throw new AppError(404, "NOT_FOUND", `Provision ${req.params.id} not found`);
        }

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

  /**
   * GET /provision/list
   * List all provisioning results (admin only).
   */
  router.get(
    "/list",
    requireRole("admin"),
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const results = provisioningService.listAll();

        res.json({
          success: true,
          data: results,
          meta: {
            request_id: uuid(),
            timestamp: new Date().toISOString(),
            total: results.length,
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
