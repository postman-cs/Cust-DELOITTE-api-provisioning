/**
 * ─────────────────────────────────────────────────────────
 * Collection Protection Routes
 *
 * "Branch protection" for Postman collections.
 *
 * Protection rules:
 *   POST   /collections/protect                - Protect a collection
 *   GET    /collections/:uid/protection        - Get protection rule
 *   PUT    /collections/:uid/protection        - Update protection rule
 *   DELETE /collections/:uid/protection        - Remove protection (admin only)
 *   GET    /collections/workspace/:id/rules    - List workspace rules
 *
 * Pull request workflow:
 *   POST   /collections/pr                     - Create a PR
 *   GET    /collections/pr/:id                 - Get PR details
 *   POST   /collections/pr/:id/review          - Review (approve/reject)
 *   POST   /collections/pr/:id/merge           - Merge a PR
 *   GET    /collections/workspace/:id/prs      - List workspace PRs
 * ─────────────────────────────────────────────────────────
 */

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import {
  ICollectionProtection,
  ProtectCollectionParams,
  UpdateProtectionParams,
} from "../services/collection-protection";
import { requireRole } from "../middleware/auth";
import { AppError } from "../middleware/error-handler";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ProtectCollectionSchema = z.object({
  collection_uid: z.string().min(1),
  workspace_id: z.string().min(1),
  collection_name: z.string().min(1),
  required_approvals: z.number().int().min(1).max(5).default(1),
  designated_reviewers: z.array(z.string().regex(EMAIL_REGEX)).optional(),
  designated_mergers: z.array(z.string().regex(EMAIL_REGEX)).optional(),
  block_direct_edits: z.boolean().default(true),
  require_description: z.boolean().default(true),
  auto_delete_fork_on_merge: z.boolean().default(false),
});

const CreatePRSchema = z.object({
  source_collection_uid: z.string().min(1),
  target_collection_uid: z.string().min(1),
  workspace_id: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
});

const ReviewPRSchema = z.object({
  action: z.enum(["approve", "reject"]),
  comment: z.string().optional(),
});

const MergePRSchema = z.object({
  strategy: z.enum(["merge", "replace"]).default("merge"),
});

const UpdateProtectionSchema = z.object({
  required_approvals: z.number().int().min(1).max(5).optional(),
  designated_reviewers: z.array(z.string().regex(EMAIL_REGEX)).optional(),
  designated_mergers: z.array(z.string().regex(EMAIL_REGEX)).optional(),
  block_direct_edits: z.boolean().optional(),
  require_description: z.boolean().optional(),
  auto_delete_fork_on_merge: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

export function createCollectionProtectionRoutes(
  protectionService: ICollectionProtection
): Router {
  const router = Router();

  // ── Protection rules ──────────────────────────────────

  router.post(
    "/protect",
    requireRole("admin", "provisioner"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = ProtectCollectionSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new AppError(400, "VALIDATION_ERROR", "Invalid protection request", {
            errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          });
        }

        const rule = protectionService.protectCollection(parsed.data as ProtectCollectionParams);

        res.status(201).json({
          success: true,
          data: rule,
          meta: { request_id: uuid(), timestamp: new Date().toISOString() },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    "/:uid/protection",
    requireRole("admin", "provisioner", "viewer"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const rule = protectionService.getProtectionRule(req.params.uid);
        if (!rule) {
          throw new AppError(404, "NOT_FOUND", `No protection rule for collection ${req.params.uid}`);
        }
        res.json({
          success: true,
          data: rule,
          meta: { request_id: uuid(), timestamp: new Date().toISOString() },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.put(
    "/:uid/protection",
    requireRole("admin", "provisioner"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = UpdateProtectionSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new AppError(400, "VALIDATION_ERROR", "Invalid update", {
            errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          });
        }

        const rule = protectionService.updateProtectionRule(
          req.params.uid,
          parsed.data as UpdateProtectionParams,
          req.user!
        );

        res.json({
          success: true,
          data: rule,
          meta: { request_id: uuid(), timestamp: new Date().toISOString() },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    "/workspace/:id/rules",
    requireRole("admin", "provisioner", "viewer"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const rules = protectionService.listProtectionRules(req.params.id);
        res.json({
          success: true,
          data: rules,
          meta: { request_id: uuid(), timestamp: new Date().toISOString(), total: rules.length },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * DELETE /collections/:uid/protection
   * Remove protection from a collection. Admin only.
   */
  router.delete(
    "/:uid/protection",
    requireRole("admin"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const removed = protectionService.removeProtection(req.params.uid);
        if (!removed) {
          throw new AppError(404, "NOT_FOUND", `No protection rule found for collection ${req.params.uid}`);
        }
        res.json({
          success: true,
          data: { collection_uid: req.params.uid, protection_removed: true },
          meta: { request_id: uuid(), timestamp: new Date().toISOString() },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ── Pull request workflow ─────────────────────────────

  router.post(
    "/pr",
    requireRole("admin", "provisioner", "viewer"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = CreatePRSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new AppError(400, "VALIDATION_ERROR", "Invalid PR request", {
            errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          });
        }

        const pr = await protectionService.createPullRequest(
          { ...parsed.data, created_by: req.user!.email },
          req.user!
        );

        res.status(201).json({
          success: true,
          data: pr,
          meta: { request_id: uuid(), timestamp: new Date().toISOString() },
        });
      } catch (err) {
        if (err instanceof Error && err.message.includes("requires a PR description")) {
          next(new AppError(422, "POLICY_VIOLATION", err.message));
        } else {
          next(err);
        }
      }
    }
  );

  router.get(
    "/pr/:id",
    requireRole("admin", "provisioner", "viewer"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const pr = protectionService.getPullRequest(req.params.id);
        if (!pr) {
          throw new AppError(404, "NOT_FOUND", `Pull request ${req.params.id} not found`);
        }
        res.json({
          success: true,
          data: pr,
          meta: { request_id: uuid(), timestamp: new Date().toISOString() },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/pr/:id/review",
    requireRole("admin", "provisioner", "viewer"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = ReviewPRSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new AppError(400, "VALIDATION_ERROR", "Invalid review", {
            errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          });
        }

        const pr = await protectionService.reviewPullRequest(
          {
            pr_id: req.params.id,
            action: parsed.data.action,
            reviewer: req.user!.email,
            comment: parsed.data.comment,
          },
          req.user!
        );

        res.json({
          success: true,
          data: pr,
          meta: { request_id: uuid(), timestamp: new Date().toISOString() },
        });
      } catch (err) {
        if (err instanceof Error && (
          err.message.includes("not a designated reviewer") ||
          err.message.includes("Cannot review your own")
        )) {
          next(new AppError(403, "FORBIDDEN", err.message));
        } else {
          next(err);
        }
      }
    }
  );

  router.post(
    "/pr/:id/merge",
    requireRole("admin", "provisioner"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = MergePRSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new AppError(400, "VALIDATION_ERROR", "Invalid merge request", {
            errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          });
        }

        const pr = await protectionService.mergePullRequest(
          {
            pr_id: req.params.id,
            merged_by: req.user!.email,
            strategy: parsed.data.strategy,
          },
          req.user!
        );

        res.json({
          success: true,
          data: pr,
          meta: { request_id: uuid(), timestamp: new Date().toISOString() },
        });
      } catch (err) {
        if (err instanceof Error && err.message.includes("must be approved")) {
          next(new AppError(422, "POLICY_VIOLATION", err.message));
        } else if (err instanceof Error && err.message.includes("not authorized to merge")) {
          next(new AppError(403, "FORBIDDEN", err.message));
        } else {
          next(err);
        }
      }
    }
  );

  router.get(
    "/workspace/:id/prs",
    requireRole("admin", "provisioner", "viewer"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const prs = protectionService.listPullRequests(req.params.id);
        res.json({
          success: true,
          data: prs,
          meta: { request_id: uuid(), timestamp: new Date().toISOString(), total: prs.length },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
