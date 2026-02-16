/**
 * ─────────────────────────────────────────────────────────
 * Audit Logger
 *
 * Records every provisioning action with full context.
 * Default: in-memory store (swap for database in production).
 * ─────────────────────────────────────────────────────────
 */

import { v4 as uuid } from "uuid";
import { AuditEntry, AuditAction, AuditQuery, PolicyDecision } from "../types";
import { createLogger } from "../middleware/logger";

const logger = createLogger("audit");

export interface IAuditLogger {
  log(entry: Omit<AuditEntry, "id" | "timestamp">): AuditEntry;
  query(filters: AuditQuery): AuditEntry[];
  getById(id: string): AuditEntry | undefined;
  getByProvisionId(provisionId: string): AuditEntry[];
}

/**
 * In-memory audit logger for local development and testing.
 * In production, replace with a database-backed implementation.
 */
export class InMemoryAuditLogger implements IAuditLogger {
  private entries: AuditEntry[] = [];

  log(entry: Omit<AuditEntry, "id" | "timestamp">): AuditEntry {
    const fullEntry: AuditEntry = {
      ...entry,
      id: uuid(),
      timestamp: new Date().toISOString(),
    };

    this.entries.push(fullEntry);

    // Also write to structured log
    logger.info("Audit event", {
      audit_id: fullEntry.id,
      action: fullEntry.action,
      actor: fullEntry.actor,
      provision_id: fullEntry.provision_id,
      partner_name: fullEntry.partner_name,
    });

    return fullEntry;
  }

  query(filters: AuditQuery): AuditEntry[] {
    let results = [...this.entries];

    if (filters.action) {
      results = results.filter((e) => e.action === filters.action);
    }
    if (filters.actor) {
      results = results.filter((e) => e.actor === filters.actor);
    }
    if (filters.provision_id) {
      results = results.filter((e) => e.provision_id === filters.provision_id);
    }
    if (filters.partner_name) {
      results = results.filter((e) =>
        e.partner_name?.toLowerCase().includes(filters.partner_name!.toLowerCase())
      );
    }
    if (filters.from_date) {
      const from = new Date(filters.from_date);
      results = results.filter((e) => new Date(e.timestamp) >= from);
    }
    if (filters.to_date) {
      const to = new Date(filters.to_date);
      results = results.filter((e) => new Date(e.timestamp) <= to);
    }

    // Sort by timestamp descending (newest first)
    results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Pagination
    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? 50;
    return results.slice(offset, offset + limit);
  }

  getById(id: string): AuditEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  getByProvisionId(provisionId: string): AuditEntry[] {
    return this.entries
      .filter((e) => e.provision_id === provisionId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  /** Helper for tests: get all entries */
  getAll(): AuditEntry[] {
    return [...this.entries];
  }

  /** Helper for tests: clear all entries */
  clear(): void {
    this.entries = [];
  }
}

/**
 * Create an audit log entry helper for provision workflows.
 */
export function createProvisionAuditEntry(
  action: AuditAction,
  actor: string,
  provisionId: string,
  partnerName?: string,
  partnerDomains?: string[],
  apiPackageIds?: string[],
  policyDecision?: PolicyDecision,
  details?: Record<string, unknown>
): Omit<AuditEntry, "id" | "timestamp"> {
  return {
    action,
    actor,
    provision_id: provisionId,
    partner_name: partnerName,
    partner_domains: partnerDomains,
    api_package_ids: apiPackageIds,
    policy_decision: policyDecision,
    details,
  };
}

/**
 * Create an audit log entry helper for invite operations.
 */
export function createInviteAuditEntry(
  action: AuditAction,
  actor: string,
  details: Record<string, unknown>
): Omit<AuditEntry, "id" | "timestamp"> {
  return {
    action,
    actor,
    partner_name: details.partner_name as string | undefined,
    details,
  };
}

/**
 * Create a generic audit log entry (for collection protection, PRs, etc.)
 */
export function createGenericAuditEntry(
  action: AuditAction,
  actor: string,
  details: Record<string, unknown>
): Omit<AuditEntry, "id" | "timestamp"> {
  return {
    action,
    actor,
    details,
  };
}
