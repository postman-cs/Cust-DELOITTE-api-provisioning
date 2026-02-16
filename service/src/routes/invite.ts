/**
 * ─────────────────────────────────────────────────────────
 * Invite Routes
 *
 * These routes power the "Invite Guard" — Andrew's #4
 * requirement for domain-level invitation controls that
 * let non-admins self-serve within guardrails.
 *
 * POST /invite/workspace/:id         - Send invites (policy-gated)
 * GET  /invite/workspace/:id/policy  - Get invite policy
 * PUT  /invite/workspace/:id/policy  - Update invite policy
 * GET  /invite/policies              - List all invite policies
 * POST /invite/workspace/:id/check   - Dry-run: check if invite would pass
 * ─────────────────────────────────────────────────────────
 */

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { IInviteGuard, UpdatePolicyParams } from "../services/invite-guard";
import { requireRole } from "../middleware/auth";
import { AppError } from "../middleware/error-handler";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_REGEX = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

// ── Validation Schemas ──────────────────────────────────

const InviteRequestSchema = z.object({
  invitees: z
    .array(
      z.object({
        email: z.string().regex(EMAIL_REGEX, "Invalid email format"),
        role: z.enum(["viewer", "editor"]).default("viewer"),
      })
    )
    .min(1, "At least one invitee is required")
    .max(50, "Maximum 50 invitees per request"),
});

const UpdatePolicySchema = z.object({
  add_domains: z
    .array(z.string().regex(DOMAIN_REGEX, "Invalid domain format"))
    .optional(),
  remove_domains: z.array(z.string()).optional(),
  add_managers: z
    .array(z.string().regex(EMAIL_REGEX, "Invalid email format"))
    .optional(),
  remove_managers: z.array(z.string()).optional(),
  allow_member_invites: z.boolean().optional(),
  max_members: z.number().int().min(1).optional(),
});

// ── Route Factory ────────────────────────────────────────

export function createInviteRoutes(inviteGuard: IInviteGuard): Router {
  const router = Router();

  /**
   * POST /invite/workspace/:id
   *
   * Send invitations to a partner workspace.
   * Policy-gated: the caller must be authorized (admin, provisioner,
   * workspace manager, or member if member-invites are enabled).
   * Each invitee's domain is checked against the workspace's allowed domains.
   *
   * This is the core of the "Invite Guard" — it replaces Postman's
   * native "anyone can invite anyone" with domain-scoped self-service.
   */
  router.post(
    "/workspace/:id",
    requireRole("admin", "provisioner", "viewer"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceId = req.params.id;

        // Validate input
        const parsed = InviteRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new AppError(400, "VALIDATION_ERROR", "Invalid invite request", {
            errors: parsed.error.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
          });
        }

        // Process invite through the guard
        const result = await inviteGuard.processInvite(
          {
            workspace_id: workspaceId,
            invitees: parsed.data.invitees,
          },
          req.user!
        );

        // Determine status code based on results
        const allRejected = result.invited.every((i) => i.status === "rejected");
        const anyRejected = result.invited.some((i) => i.status === "rejected");
        const statusCode = allRejected ? 403 : anyRejected ? 207 : 201;

        res.status(statusCode).json({
          success: !allRejected,
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
   * POST /invite/workspace/:id/check
   *
   * Dry-run invite check. Returns what WOULD happen if these
   * invites were sent, without actually sending them.
   * Useful for UIs that want to validate before confirming.
   */
  router.post(
    "/workspace/:id/check",
    requireRole("admin", "provisioner", "viewer"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceId = req.params.id;

        const parsed = InviteRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new AppError(400, "VALIDATION_ERROR", "Invalid invite request", {
            errors: parsed.error.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
          });
        }

        const decision = inviteGuard.evaluateInvite(
          {
            workspace_id: workspaceId,
            invitees: parsed.data.invitees,
          },
          req.user!
        );

        res.json({
          success: true,
          data: {
            dry_run: true,
            decision,
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
   * GET /invite/workspace/:id/policy
   *
   * Retrieve the invite policy for a workspace.
   * Anyone with viewer+ role can see the policy (transparency).
   */
  router.get(
    "/workspace/:id/policy",
    requireRole("admin", "provisioner", "viewer"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const policy = inviteGuard.getPolicy(req.params.id);
        if (!policy) {
          throw new AppError(
            404,
            "NOT_FOUND",
            `No invite policy found for workspace ${req.params.id}`
          );
        }

        res.json({
          success: true,
          data: policy,
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
   * PUT /invite/workspace/:id/policy
   *
   * Update the invite policy for a workspace.
   * Only admins and provisioners can modify policies.
   *
   * This is how Andrew's team would add "deloitte.ca" to a workspace
   * without needing a global admin or re-provisioning.
   */
  router.put(
    "/workspace/:id/policy",
    requireRole("admin", "provisioner"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceId = req.params.id;

        const parsed = UpdatePolicySchema.safeParse(req.body);
        if (!parsed.success) {
          throw new AppError(400, "VALIDATION_ERROR", "Invalid policy update", {
            errors: parsed.error.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
          });
        }

        const updated = inviteGuard.updatePolicy(
          workspaceId,
          parsed.data as UpdatePolicyParams,
          req.user!
        );

        res.json({
          success: true,
          data: updated,
          meta: {
            request_id: uuid(),
            timestamp: new Date().toISOString(),
          },
        });
      } catch (err) {
        // Map known errors to proper HTTP codes
        if (err instanceof Error && err.message.includes("not authorized")) {
          next(new AppError(403, "FORBIDDEN", err.message));
        } else if (err instanceof Error && err.message.includes("No invite policy found")) {
          next(new AppError(404, "NOT_FOUND", err.message));
        } else if (err instanceof Error && err.message.includes("blocked domains")) {
          next(new AppError(422, "POLICY_VIOLATION", err.message));
        } else {
          next(err);
        }
      }
    }
  );

  /**
   * GET /invite/policies
   *
   * List all workspace invite policies. Admin only.
   * Useful for a dashboard view of all partner workspace invite configs.
   */
  router.get(
    "/policies",
    requireRole("admin"),
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const policies = inviteGuard.listPolicies();

        res.json({
          success: true,
          data: policies,
          meta: {
            request_id: uuid(),
            timestamp: new Date().toISOString(),
            total: policies.length,
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
