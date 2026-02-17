/**
 * ─────────────────────────────────────────────────────────
 * Live Provisioning Route
 *
 * GET  /provision/live/environments   - List available source environments
 * POST /provision/live                - Provision from one or more sources
 * POST /provision/live/cleanup        - Reset a target workspace
 *
 * Demonstrates tech-agnostic provisioning: collections and
 * environments from completely different tech stacks (AWS,
 * Azure, On-Prem) are provisioned into a target workspace
 * using the REAL Postman API.
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
  /** Filter by source environment tag prefix, e.g. "AWS", "Azure", "On-Prem", or "all" */
  source_environment: z.string().default("all"),
  copy_collections: z.boolean().default(true),
  copy_environments: z.boolean().default(true),
});

interface LiveProvisionStep {
  name: string;
  status: "completed" | "failed" | "skipped";
  detail: string;
  asset_id?: string;
  source_env?: string;
  timestamp: string;
}

interface SourceEnvironmentInfo {
  tag: string;
  label: string;
  description: string;
  collections: Array<{ uid: string; name: string }>;
  environments: Array<{ uid: string; name: string }>;
}

/**
 * Extract the tag from a "[Tag] Name" formatted string.
 * Returns the tag (e.g. "AWS") or null if no tag.
 */
function extractTag(name: string): string | null {
  const match = name.match(/^\[([^\]]+)\]/);
  return match ? match[1] : null;
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
   * Helper: List all assets in the golden workspace grouped by source env tag.
   */
  async function getSourceInventory(): Promise<SourceEnvironmentInfo[]> {
    const [colResp, envResp] = await Promise.all([
      pm.get("/collections", { params: { workspace: goldenWorkspaceId } }),
      pm.get("/environments", { params: { workspace: goldenWorkspaceId } }),
    ]);

    const collections = (colResp.data.collections || []).map(
      (c: Record<string, string>) => ({ uid: c.uid, name: c.name, tag: extractTag(c.name) })
    );
    const environments = (envResp.data.environments || []).map(
      (e: Record<string, string>) => ({ uid: e.uid, name: e.name, tag: extractTag(e.name) })
    );

    // Group by tag
    const tagMap = new Map<string, SourceEnvironmentInfo>();

    const descriptions: Record<string, { label: string; desc: string }> = {
      AWS: {
        label: "AWS Cloud Services",
        desc: "API Gateway + Lambda + DynamoDB — us-east-1",
      },
      Azure: {
        label: "Azure Enterprise",
        desc: "Azure API Management + App Service + Cosmos DB — West Europe",
      },
      "On-Prem": {
        label: "On-Premises Legacy",
        desc: "Traditional data center — US-DC-01",
      },
    };

    for (const col of collections) {
      const tag = col.tag || "Other";
      if (!tagMap.has(tag)) {
        tagMap.set(tag, {
          tag,
          label: descriptions[tag]?.label || tag,
          description: descriptions[tag]?.desc || "",
          collections: [],
          environments: [],
        });
      }
      tagMap.get(tag)!.collections.push({ uid: col.uid, name: col.name });
    }

    for (const env of environments) {
      const tag = env.tag || "Other";
      if (!tagMap.has(tag)) {
        tagMap.set(tag, {
          tag,
          label: descriptions[tag]?.label || tag,
          description: descriptions[tag]?.desc || "",
          collections: [],
          environments: [],
        });
      }
      tagMap.get(tag)!.environments.push({ uid: env.uid, name: env.name });
    }

    return Array.from(tagMap.values());
  }

  /**
   * GET /provision/live/environments
   *
   * Lists all available source environments in the golden workspace,
   * grouped by tag (AWS, Azure, On-Prem). Used by the demo UI to
   * render the environment picker.
   */
  router.get(
    "/live/environments",
    requireRole("admin", "provisioner", "viewer"),
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const inventory = await getSourceInventory();
        const wsResp = await pm.get(`/workspaces/${goldenWorkspaceId}`);

        res.json({
          success: true,
          data: {
            golden_workspace: {
              id: goldenWorkspaceId,
              name: wsResp.data.workspace.name,
              url: `https://go.postman.co/workspace/${goldenWorkspaceId}`,
            },
            source_environments: inventory,
            total_collections: inventory.reduce((n, e) => n + e.collections.length, 0),
            total_environments: inventory.reduce((n, e) => n + e.environments.length, 0),
          },
          meta: { request_id: uuid(), timestamp: new Date().toISOString() },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * POST /provision/live
   *
   * Real cross-workspace provisioning with source environment filtering:
   *  1. Verify golden workspace is accessible
   *  2. Verify target workspace is accessible
   *  3. List collections in golden workspace, filtered by source_environment
   *  4. Copy each matching collection to the target
   *  5. List environments in golden workspace, filtered by source_environment
   *  6. Copy each matching environment to the target (stripping secrets)
   */
  router.post(
    "/live",
    requireRole("admin", "provisioner"),
    async (req: Request, res: Response, next: NextFunction) => {
      const requestId = uuid();
      const steps: LiveProvisionStep[] = [];

      const step = (
        name: string,
        status: LiveProvisionStep["status"],
        detail: string,
        asset_id?: string,
        source_env?: string
      ) => {
        steps.push({ name, status, detail, asset_id, source_env, timestamp: new Date().toISOString() });
      };

      try {
        const parsed = LiveProvisionSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new AppError(400, "VALIDATION_ERROR", "Invalid live provision request", {
            errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          });
        }

        const { target_workspace_id, partner_name, source_environment, copy_collections, copy_environments } =
          parsed.data;

        const filterAll = source_environment === "all";
        // Support comma-separated tags: "AWS,Azure"
        const filterTags = filterAll
          ? []
          : source_environment.split(",").map((t) => t.trim());

        const matchesFilter = (name: string): boolean => {
          if (filterAll) return true;
          const tag = extractTag(name);
          return tag !== null && filterTags.includes(tag);
        };

        logger.info("Live provisioning started", {
          requestId,
          goldenWorkspaceId,
          target_workspace_id,
          partner_name,
          source_environment,
        });

        step("Source Filter", "completed", filterAll ? "All environments" : `Filtering: ${filterTags.join(", ")}`);

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
        const copiedCollections: Array<{ uid: string; name: string; source_env: string }> = [];
        if (copy_collections) {
          let goldenCollections: Array<{ uid: string; name: string }> = [];
          try {
            const { data } = await pm.get("/collections", { params: { workspace: goldenWorkspaceId } });
            const allCols = (data.collections || []).map((c: Record<string, string>) => ({
              uid: c.uid,
              name: c.name,
            }));
            goldenCollections = allCols.filter((c: { name: string }) => matchesFilter(c.name));
            step(
              "List Golden Collections",
              "completed",
              `Found ${allCols.length} total, ${goldenCollections.length} matching filter`
            );
          } catch {
            step("List Golden Collections", "failed", "Could not list collections");
          }

          for (const col of goldenCollections) {
            const tag = extractTag(col.name) || "Unknown";
            try {
              const { data: fullCol } = await pm.get(`/collections/${col.uid}`);
              fullCol.collection.info.name = `${partner_name}: ${col.name}`;

              const { data: created } = await pm.post(`/collections?workspace=${target_workspace_id}`, {
                collection: fullCol.collection,
              });

              const newUid = created.collection?.uid || created.collection?.id || "";
              copiedCollections.push({ uid: newUid, name: fullCol.collection.info.name, source_env: tag });
              step(`Copy Collection`, "completed", `${col.name} → ${newUid}`, newUid, tag);
            } catch (err) {
              const msg = err instanceof Error ? err.message : "Unknown error";
              step(`Copy Collection: ${col.name}`, "failed", msg, undefined, tag);
            }
          }
        } else {
          step("Copy Collections", "skipped", "Disabled by request");
        }

        // ── Step 4: Copy environments ────────────────────
        const copiedEnvironments: Array<{ uid: string; name: string; source_env: string }> = [];
        if (copy_environments) {
          let goldenEnvs: Array<{ uid: string; name: string }> = [];
          try {
            const { data } = await pm.get("/environments", { params: { workspace: goldenWorkspaceId } });
            const allEnvs = (data.environments || []).map((e: Record<string, string>) => ({
              uid: e.uid,
              name: e.name,
            }));
            goldenEnvs = allEnvs.filter((e: { name: string }) => matchesFilter(e.name));
            step(
              "List Golden Environments",
              "completed",
              `Found ${allEnvs.length} total, ${goldenEnvs.length} matching filter`
            );
          } catch {
            step("List Golden Environments", "failed", "Could not list environments");
          }

          for (const env of goldenEnvs) {
            const tag = extractTag(env.name) || "Unknown";
            try {
              const { data: fullEnv } = await pm.get(`/environments/${env.uid}`);
              const values = (fullEnv.environment.values || []).map((v: Record<string, unknown>) => ({
                ...v,
                value: v.type === "secret" ? "" : v.value,
              }));

              const { data: created } = await pm.post(`/environments?workspace=${target_workspace_id}`, {
                environment: {
                  name: `${partner_name}: ${env.name}`,
                  values,
                },
              });

              const newUid = created.environment?.uid || created.environment?.id || "";
              copiedEnvironments.push({ uid: newUid, name: `${partner_name}: ${env.name}`, source_env: tag });
              step(`Copy Environment`, "completed", `${env.name} → ${newUid} (secrets stripped)`, newUid, tag);
            } catch (err) {
              const msg = err instanceof Error ? err.message : "Unknown error";
              step(`Copy Environment: ${env.name}`, "failed", msg, undefined, tag);
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
          source_environment: source_environment,
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
          source_environment,
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

        const { data: colData } = await pm.get("/collections", { params: { workspace: target_workspace_id } });
        for (const col of colData.collections || []) {
          try {
            await pm.delete(`/collections/${col.uid}`);
            removed.push(`collection:${col.uid}`);
          } catch {
            /* skip */
          }
        }

        const { data: envData } = await pm.get("/environments", { params: { workspace: target_workspace_id } });
        for (const env of envData.environments || []) {
          try {
            await pm.delete(`/environments/${env.uid}`);
            removed.push(`environment:${env.uid}`);
          } catch {
            /* skip */
          }
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
