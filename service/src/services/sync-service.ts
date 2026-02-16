/**
 * ─────────────────────────────────────────────────────────
 * Sync Service
 *
 * Handles downstream change management:
 *  - Manual pull: partner re-requests latest from Golden
 *  - Auto-enroll: scheduled sync keeps partner workspace in sync
 *
 * In production, this would be backed by a job scheduler
 * (e.g., Bull, node-cron, AWS EventBridge, Azure Functions timer).
 * ─────────────────────────────────────────────────────────
 */

import { IPostmanClient } from "../adapters/postman-client.interface";
import { IAuditLogger, createProvisionAuditEntry } from "../audit/audit-logger";
import { AppConfig } from "../config";
import { createLogger } from "../middleware/logger";
import { UpdateMode } from "../types";

const logger = createLogger("sync");

export interface SyncRegistration {
  provision_id: string;
  partner_workspace_id: string;
  golden_workspace_id: string;
  collection_mappings: Array<{
    golden_collection_uid: string;
    partner_collection_uid: string;
  }>;
  update_mode: UpdateMode;
  last_synced_at?: string;
  next_sync_at?: string;
}

export class SyncService {
  /** In-memory registry of sync enrollments */
  private registrations: Map<string, SyncRegistration> = new Map();

  constructor(
    private readonly postmanClient: IPostmanClient,
    private readonly auditLogger: IAuditLogger,
    private readonly config: AppConfig
  ) {}

  /**
   * Register a provisioned workspace for sync tracking.
   */
  register(registration: SyncRegistration): void {
    this.registrations.set(registration.provision_id, registration);
    logger.info("Sync registration added", {
      provisionId: registration.provision_id,
      updateMode: registration.update_mode,
    });
  }

  /**
   * Manually trigger a sync for a specific provision.
   */
  async syncNow(provisionId: string, actor: string): Promise<void> {
    const reg = this.registrations.get(provisionId);
    if (!reg) {
      throw new Error(`No sync registration found for provision: ${provisionId}`);
    }

    this.auditLogger.log(
      createProvisionAuditEntry(
        "sync.started",
        actor,
        provisionId,
        undefined,
        undefined,
        undefined,
        undefined,
        { trigger: "manual" }
      )
    );

    try {
      // For each collection mapping, re-copy from Golden to partner
      for (const mapping of reg.collection_mappings) {
        const goldenCollection = await this.postmanClient.getCollection(
          mapping.golden_collection_uid
        );

        // In a real implementation, we'd do a diff-based update.
        // For simplicity, we re-copy (overwrite).
        await this.postmanClient.copyCollection({
          collection_uid: mapping.golden_collection_uid,
          target_workspace_id: reg.partner_workspace_id,
          new_name: goldenCollection.name,
        });

        logger.debug("Collection synced", {
          golden: mapping.golden_collection_uid,
          partner: mapping.partner_collection_uid,
        });
      }

      reg.last_synced_at = new Date().toISOString();
      this.registrations.set(provisionId, reg);

      this.auditLogger.log(
        createProvisionAuditEntry(
          "sync.completed",
          actor,
          provisionId,
          undefined,
          undefined,
          undefined,
          undefined,
          { collections_synced: reg.collection_mappings.length }
        )
      );

      logger.info("Sync completed", { provisionId });
    } catch (err) {
      this.auditLogger.log(
        createProvisionAuditEntry(
          "sync.failed",
          actor,
          provisionId,
          undefined,
          undefined,
          undefined,
          undefined,
          { error: err instanceof Error ? err.message : "Unknown" }
        )
      );
      throw err;
    }
  }

  /**
   * Run auto-sync for all auto-enrolled workspaces.
   * Call this from a scheduler (cron, timer trigger, etc.).
   */
  async runAutoSync(actor: string = "system"): Promise<{ synced: number; failed: number }> {
    let synced = 0;
    let failed = 0;

    for (const [provisionId, reg] of this.registrations) {
      if (reg.update_mode !== "auto") continue;

      try {
        await this.syncNow(provisionId, actor);
        synced++;
      } catch (err) {
        logger.error("Auto-sync failed for provision", {
          provisionId,
          error: err instanceof Error ? err.message : "Unknown",
        });
        failed++;
      }
    }

    logger.info("Auto-sync batch completed", { synced, failed });
    return { synced, failed };
  }

  /**
   * Get sync status for a provision.
   */
  getRegistration(provisionId: string): SyncRegistration | undefined {
    return this.registrations.get(provisionId);
  }

  /**
   * List all sync registrations.
   */
  listRegistrations(): SyncRegistration[] {
    return Array.from(this.registrations.values());
  }

  /**
   * Change update mode for an existing registration.
   */
  setUpdateMode(provisionId: string, mode: UpdateMode): void {
    const reg = this.registrations.get(provisionId);
    if (!reg) {
      throw new Error(`No sync registration found for provision: ${provisionId}`);
    }
    reg.update_mode = mode;
    this.registrations.set(provisionId, reg);
  }
}
