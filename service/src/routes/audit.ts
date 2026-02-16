/**
 * ─────────────────────────────────────────────────────────
 * Audit Routes
 *
 * GET /audit/logs          - Query audit logs with filters
 * GET /audit/logs/:id      - Get a specific audit entry
 * GET /audit/provision/:id - Get audit trail for a provision
 * ─────────────────────────────────────────────────────────
 */

import { Router, Request, Response, NextFunction } from "express";
import { v4 as uuid } from "uuid";
import { IAuditLogger } from "../audit/audit-logger";
import { requireRole } from "../middleware/auth";
import { AppError } from "../middleware/error-handler";
import { AuditAction, AuditQuery } from "../types";

/** Valid audit action values for input validation */
const VALID_ACTIONS: AuditAction[] = [
  // Provisioning
  "provision.requested",
  "provision.policy_check",
  "provision.workspace_created",
  "provision.assets_copied",
  "provision.permissions_set",
  "provision.updates_enrolled",
  "provision.completed",
  "provision.failed",
  "provision.rolled_back",
  // Sync
  "sync.started",
  "sync.completed",
  "sync.failed",
  // Publish
  "publish.started",
  "publish.completed",
  "publish.failed",
  // Invite
  "invite.requested",
  "invite.policy_check",
  "invite.sent",
  "invite.rejected",
  "invite.policy_updated",
  // Pull requests
  "pr.created",
  "pr.approved",
  "pr.rejected",
  "pr.merged",
  // Collection protection
  "collection.protected",
  "collection.protection_updated",
];

export function createAuditRoutes(auditLogger: IAuditLogger): Router {
  const router = Router();

  /**
   * GET /audit/logs
   * Query audit logs with optional filters.
   *
   * Query params:
   *  - action: filter by action type (must be a valid AuditAction)
   *  - actor: filter by actor email
   *  - provision_id: filter by provision ID
   *  - partner_name: filter by partner name (partial match)
   *  - from_date: ISO date string
   *  - to_date: ISO date string
   *  - limit: max results (default 50, max 500)
   *  - offset: pagination offset (min 0)
   */
  router.get(
    "/logs",
    requireRole("admin", "provisioner"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        // Validate action parameter
        const actionParam = req.query.action as string | undefined;
        if (actionParam && !VALID_ACTIONS.includes(actionParam as AuditAction)) {
          throw new AppError(400, "VALIDATION_ERROR",
            `Invalid action filter: "${actionParam}". Valid values: [${VALID_ACTIONS.join(", ")}]`
          );
        }

        // Validate date parameters
        if (req.query.from_date && isNaN(Date.parse(req.query.from_date as string))) {
          throw new AppError(400, "VALIDATION_ERROR", "Invalid from_date: must be a valid ISO date string");
        }
        if (req.query.to_date && isNaN(Date.parse(req.query.to_date as string))) {
          throw new AppError(400, "VALIDATION_ERROR", "Invalid to_date: must be a valid ISO date string");
        }

        // Validate and clamp limit/offset
        const rawLimit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
        const rawOffset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

        if (isNaN(rawLimit) || isNaN(rawOffset)) {
          throw new AppError(400, "VALIDATION_ERROR", "limit and offset must be valid integers");
        }

        const limit = Math.max(1, Math.min(rawLimit, 500));
        const offset = Math.max(0, rawOffset);

        const query: AuditQuery = {
          action: actionParam as AuditAction | undefined,
          actor: req.query.actor as string | undefined,
          provision_id: req.query.provision_id as string | undefined,
          partner_name: req.query.partner_name as string | undefined,
          from_date: req.query.from_date as string | undefined,
          to_date: req.query.to_date as string | undefined,
          limit,
          offset,
        };

        const entries = auditLogger.query(query);

        res.json({
          success: true,
          data: entries,
          meta: {
            request_id: uuid(),
            timestamp: new Date().toISOString(),
            count: entries.length,
            filters_applied: Object.entries(query)
              .filter(([, v]) => v !== undefined)
              .map(([k]) => k),
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * GET /audit/logs/:id
   * Get a specific audit entry by ID.
   */
  router.get(
    "/logs/:id",
    requireRole("admin", "provisioner"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const entry = auditLogger.getById(req.params.id);
        if (!entry) {
          throw new AppError(404, "NOT_FOUND", `Audit entry ${req.params.id} not found`);
        }

        res.json({
          success: true,
          data: entry,
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
   * GET /audit/provision/:id
   * Get the full audit trail for a specific provision.
   */
  router.get(
    "/provision/:id",
    requireRole("admin", "provisioner", "viewer"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const entries = auditLogger.getByProvisionId(req.params.id);

        res.json({
          success: true,
          data: entries,
          meta: {
            request_id: uuid(),
            timestamp: new Date().toISOString(),
            provision_id: req.params.id,
            total_events: entries.length,
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
