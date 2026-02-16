/**
 * ─────────────────────────────────────────────────────────
 * Live Provisioning Route
 *
 * POST /provision/live
 *
 * Copies collections and environments from the golden
 * workspace to a target workspace using the REAL Postman API.
 * Always uses the live client, regardless of mock mode.
 *
 * This is the "wow" demo step: you see assets appear in a
 * completely different Postman workspace in real time.
 * ─────────────────────────────────────────────────────────
 */

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import axios, { AxiosInstance } from "axios";
import { requireRole } from "../middleware/auth";
import { AppError } from "../middleware/error-handler";
import { createLogger } from "../middleware/logger";

const logger = createLogger("provision-live");

const LiveProvisionSchema = z.object({
  target_workspace_id: z.string().min(1, "target_workspace_id is required"),
  partner_name: z.string().min(1).default("Partner"),
  copy_collections: z.boolean().default(true),
  copy_environments: z.boolean().default(true),
});

interface LiveProvisionStep {
  name: string;
  status: "completed" | "failed" | "skipped";
  detail: string;
  asset_id?: string;
  timestamp: string;
}

export function createLiveProvisionRoutes(
  apiKey: string,
  baseUrl: string,
  goldenWorkspaceId: string
): Router {
  const router = Router();

  const pm: AxiosInstance = axios.create({
    baseURL: baseUrl,
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    timeout: 30000,
  });

  /**
   * POST /provision/live
   *
   * Real cross-workspace provisioning:
   *  1. Verify golden workspace is accessible
   *  2. Verify target workspace is accessible
   *  3. List collections in golden workspace
   *  4. Copy each collection to the target
   *  5. List environments in golden workspace
   *  6. Copy each environment to the target (stripping secrets)
   */
  router.post(
    "/live",
    requireRole("admin", "provisioner"),
    async (req: Request, res: Response, next: NextFunction) => {
      const requestId = uuid();
      const steps: LiveProvisionStep[] = [];

      const step = (name: string, status: LiveProvisionStep["status"], detail: string, asset_id?: string) => {
        steps.push({ name, status, detail, asset_id, timestamp: new Date().toISOString() });
      };

      try {
        const parsed = LiveProvisionSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new AppError(400, "VALIDATION_ERROR", "Invalid live provision request", {
            errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          });
        }

        const { target_workspace_id, partner_name, copy_collections, copy_environments } = parsed.data;

        logger.info("Live provisioning started", { requestId, goldenWorkspaceId, target_workspace_id, partner_name });

        // ── Step 1: Verify golden workspace ──────────────
        let goldenName = "";
        try {
          const { data } = await pm.get(`/workspaces/${goldenWorkspaceId}`);
          goldenName = data.workspace.name;
          step("Verify Golden Workspace", "completed", `"${goldenName}" (${goldenWorkspaceId})`);
        } catch {
          step("Verify Golden Workspace", "failed", `Cannot access golden workspace ${goldenWorkspaceId}`);
          throw new AppError(502, "UPSTREAM_ERROR", "Cannot access golden workspace. Check API key and workspace ID.");
        }

        // ── Step 2: Verify target workspace ──────────────
        let targetName = "";
        try {
          const { data } = await pm.get(`/workspaces/${target_workspace_id}`);
          targetName = data.workspace.name;
          step("Verify Target Workspace", "completed", `"${targetName}" (${target_workspace_id})`);
        } catch {
          step("Verify Target Workspace", "failed", `Cannot access target workspace ${target_workspace_id}`);
          throw new AppError(502, "UPSTREAM_ERROR", "Cannot access target workspace. Check workspace ID.");
        }

        // ── Step 3: Copy collections ─────────────────────
        const copiedCollections: Array<{ uid: string; name: string }> = [];
        if (copy_collections) {
          let goldenCollections: Array<{ uid: string; name: string }> = [];
          try {
            const { data } = await pm.get("/collections", { params: { workspace: goldenWorkspaceId } });
            goldenCollections = (data.collections || []).map((c: Record<string, string>) => ({ uid: c.uid, name: c.name }));
            step("List Golden Collections", "completed", `Found ${goldenCollections.length} collection(s)`);
          } catch {
            step("List Golden Collections", "failed", "Could not list collections");
          }

          for (const col of goldenCollections) {
            try {
              // Fetch full collection, then POST it to the target workspace
              const { data: fullCol } = await pm.get(`/collections/${col.uid}`);
              // Rename for the partner
              fullCol.collection.info.name = `${partner_name}: ${col.name}`;

              const { data: created } = await pm.post(
                `/collections?workspace=${target_workspace_id}`,
                { collection: fullCol.collection }
              );

              const newUid = created.collection?.uid || created.collection?.id || "";
              copiedCollections.push({ uid: newUid, name: fullCol.collection.info.name });
              step(`Copy Collection: ${col.name}`, "completed", `→ ${newUid}`, newUid);
            } catch (err) {
              const msg = err instanceof Error ? err.message : "Unknown error";
              step(`Copy Collection: ${col.name}`, "failed", msg);
            }
          }
        } else {
          step("Copy Collections", "skipped", "Disabled by request");
        }

        // ── Step 4: Copy environments ────────────────────
        const copiedEnvironments: Array<{ uid: string; name: string }> = [];
        if (copy_environments) {
          let goldenEnvs: Array<{ uid: string; name: string }> = [];
          try {
            const { data } = await pm.get("/environments", { params: { workspace: goldenWorkspaceId } });
            goldenEnvs = (data.environments || []).map((e: Record<string, string>) => ({ uid: e.uid, name: e.name }));
            step("List Golden Environments", "completed", `Found ${goldenEnvs.length} environment(s)`);
          } catch {
            step("List Golden Environments", "failed", "Could not list environments");
          }

          for (const env of goldenEnvs) {
            try {
              const { data: fullEnv } = await pm.get(`/environments/${env.uid}`);
              const values = (fullEnv.environment.values || []).map((v: Record<string, unknown>) => ({
                ...v,
                // Strip secret values — never copy credentials to partner workspace
                value: v.type === "secret" ? "" : v.value,
              }));

              const { data: created } = await pm.post(
                `/environments?workspace=${target_workspace_id}`,
                {
                  environment: {
                    name: `${partner_name}: ${env.name}`,
                    values,
                  },
                }
              );

              const newUid = created.environment?.uid || created.environment?.id || "";
              copiedEnvironments.push({ uid: newUid, name: `${partner_name}: ${env.name}` });
              step(`Copy Environment: ${env.name}`, "completed", `→ ${newUid} (secrets stripped)`, newUid);
            } catch (err) {
              const msg = err instanceof Error ? err.message : "Unknown error";
              step(`Copy Environment: ${env.name}`, "failed", msg);
            }
          }
        } else {
          step("Copy Environments", "skipped", "Disabled by request");
        }

        // ── Result ───────────────────────────────────────
        const anyFailed = steps.some((s) => s.status === "failed");
        const result = {
          id: requestId,
          status: anyFailed ? "partial" : "completed",
          golden_workspace: { id: goldenWorkspaceId, name: goldenName },
          target_workspace: {
            id: target_workspace_id,
            name: targetName,
            url: `https://go.postman.co/workspace/${target_workspace_id}`,
          },
          partner_name,
          collections_copied: copiedCollections,
          environments_copied: copiedEnvironments,
          steps,
          created_at: new Date().toISOString(),
        };

        logger.info("Live provisioning complete", {
          requestId,
          status: result.status,
          collections: copiedCollections.length,
          environments: copiedEnvironments.length,
        });

        res.status(201).json({
          success: !anyFailed,
          data: result,
          meta: { request_id: requestId, timestamp: new Date().toISOString() },
        });
      } catch (err) {
        if (err instanceof AppError) {
          return next(err);
        }
        step("Unexpected Error", "failed", err instanceof Error ? err.message : "Unknown");
        res.status(500).json({
          success: false,
          data: { steps },
          error: { message: err instanceof Error ? err.message : "Unknown error" },
          meta: { request_id: requestId, timestamp: new Date().toISOString() },
        });
      }
    }
  );

  /**
   * POST /provision/live/cleanup
   *
   * Remove all collections and environments from a target workspace.
   * Useful for resetting the demo between runs.
   */
  router.post(
    "/live/cleanup",
    requireRole("admin"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { target_workspace_id } = req.body;
        if (!target_workspace_id) {
          throw new AppError(400, "VALIDATION_ERROR", "target_workspace_id is required");
        }

        const removed: string[] = [];

        // Delete collections
        const { data: colData } = await pm.get("/collections", { params: { workspace: target_workspace_id } });
        for (const col of colData.collections || []) {
          try { await pm.delete(`/collections/${col.uid}`); removed.push(`collection:${col.uid}`); } catch { /* skip */ }
        }

        // Delete environments
        const { data: envData } = await pm.get("/environments", { params: { workspace: target_workspace_id } });
        for (const env of envData.environments || []) {
          try { await pm.delete(`/environments/${env.uid}`); removed.push(`environment:${env.uid}`); } catch { /* skip */ }
        }

        res.json({
          success: true,
          data: { target_workspace_id, removed, count: removed.length },
          meta: { request_id: uuid(), timestamp: new Date().toISOString() },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
