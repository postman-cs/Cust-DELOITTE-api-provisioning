/**
 * ─────────────────────────────────────────────────────────
 * Audit Logger — Unit Tests
 * ─────────────────────────────────────────────────────────
 */

import { InMemoryAuditLogger, createProvisionAuditEntry } from "../src/audit/audit-logger";

describe("InMemoryAuditLogger", () => {
  let logger: InMemoryAuditLogger;

  beforeEach(() => {
    logger = new InMemoryAuditLogger();
  });

  it("should log entries with auto-generated id and timestamp", () => {
    const entry = logger.log({
      action: "provision.requested",
      actor: "user@deloitte.com",
      provision_id: "prov-001",
    });

    expect(entry.id).toBeDefined();
    expect(entry.timestamp).toBeDefined();
    expect(entry.action).toBe("provision.requested");
    expect(entry.actor).toBe("user@deloitte.com");
  });

  it("should retrieve entry by ID", () => {
    const entry = logger.log({
      action: "provision.requested",
      actor: "user@deloitte.com",
    });

    const retrieved = logger.getById(entry.id);
    expect(retrieved).toEqual(entry);
  });

  it("should retrieve entries by provision ID", () => {
    logger.log({
      action: "provision.requested",
      actor: "user@deloitte.com",
      provision_id: "prov-001",
    });
    logger.log({
      action: "provision.completed",
      actor: "user@deloitte.com",
      provision_id: "prov-001",
    });
    logger.log({
      action: "provision.requested",
      actor: "user@deloitte.com",
      provision_id: "prov-002",
    });

    const entries = logger.getByProvisionId("prov-001");
    expect(entries).toHaveLength(2);
    entries.forEach((e) => expect(e.provision_id).toBe("prov-001"));
  });

  describe("query", () => {
    beforeEach(() => {
      logger.log({
        action: "provision.requested",
        actor: "alice@deloitte.com",
        provision_id: "prov-001",
        partner_name: "Acme Corp",
      });
      logger.log({
        action: "provision.completed",
        actor: "alice@deloitte.com",
        provision_id: "prov-001",
        partner_name: "Acme Corp",
      });
      logger.log({
        action: "provision.requested",
        actor: "bob@deloitte.com",
        provision_id: "prov-002",
        partner_name: "Beta Inc",
      });
    });

    it("should filter by action", () => {
      const results = logger.query({ action: "provision.requested" });
      expect(results).toHaveLength(2);
    });

    it("should filter by actor", () => {
      const results = logger.query({ actor: "alice@deloitte.com" });
      expect(results).toHaveLength(2);
    });

    it("should filter by provision_id", () => {
      const results = logger.query({ provision_id: "prov-002" });
      expect(results).toHaveLength(1);
    });

    it("should filter by partner_name (partial match)", () => {
      const results = logger.query({ partner_name: "acme" });
      expect(results).toHaveLength(2);
    });

    it("should support pagination", () => {
      const page1 = logger.query({ limit: 2, offset: 0 });
      expect(page1).toHaveLength(2);

      const page2 = logger.query({ limit: 2, offset: 2 });
      expect(page2).toHaveLength(1);
    });

    it("should sort by timestamp descending", () => {
      const results = logger.query({});
      for (let i = 1; i < results.length; i++) {
        expect(
          new Date(results[i - 1].timestamp).getTime()
        ).toBeGreaterThanOrEqual(
          new Date(results[i].timestamp).getTime()
        );
      }
    });
  });

  describe("createProvisionAuditEntry helper", () => {
    it("should create well-formed audit entry", () => {
      const entry = createProvisionAuditEntry(
        "provision.requested",
        "user@deloitte.com",
        "prov-001",
        "Acme Corp",
        ["acme.com"],
        ["col-1"],
        undefined,
        { key: "value" }
      );

      expect(entry.action).toBe("provision.requested");
      expect(entry.actor).toBe("user@deloitte.com");
      expect(entry.provision_id).toBe("prov-001");
      expect(entry.partner_name).toBe("Acme Corp");
      expect(entry.partner_domains).toEqual(["acme.com"]);
      expect(entry.api_package_ids).toEqual(["col-1"]);
      expect(entry.details).toEqual({ key: "value" });
    });
  });
});
