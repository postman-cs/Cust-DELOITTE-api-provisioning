/**
 * ─────────────────────────────────────────────────────────
 * Mock Postman Client
 *
 * In-memory implementation of IPostmanClient for local dev
 * and testing. Simulates API responses with deterministic
 * data. No real API calls are made.
 * ─────────────────────────────────────────────────────────
 */

import { v4 as uuid } from "uuid";
import {
  PostmanWorkspace,
  PostmanCollection,
  PostmanEnvironment,
  PostmanApi,
  PostmanApiVersion,
  PostmanForkResult,
  PostmanPullRequest,
  CreatePullRequestParams,
  MergePullRequestParams,
} from "../types";
import {
  IPostmanClient,
  CreateWorkspaceParams,
  CopyCollectionParams,
  ForkCollectionParams,
  SetWorkspacePermissionsParams,
  CopyEnvironmentParams,
} from "./postman-client.interface";

export class MockPostmanClient implements IPostmanClient {
  // In-memory stores
  private workspaces: Map<string, PostmanWorkspace> = new Map();
  private collections: Map<string, PostmanCollection> = new Map();
  private environments: Map<string, PostmanEnvironment> = new Map();
  private apis: Map<string, PostmanApi> = new Map();
  private pullRequests: Map<string, PostmanPullRequest> = new Map();
  private workspaceCollections: Map<string, string[]> = new Map(); // workspaceId -> collectionIds
  private workspaceEnvironments: Map<string, string[]> = new Map();
  private permissions: Map<string, Array<{ email: string; role: string }>> = new Map();

  constructor() {
    this.seedGoldenWorkspace();
  }

  /**
   * Seed the mock with a "Golden" workspace containing sample assets.
   */
  private seedGoldenWorkspace(): void {
    const goldenWsId = "golden-workspace-001";

    this.workspaces.set(goldenWsId, {
      id: goldenWsId,
      name: "Golden Source-of-Truth",
      type: "team",
      description: "Authoritative API workspace managed by CI/CD pipeline",
      created_at: new Date().toISOString(),
    });

    // Seed collections
    const collections = [
      { id: "col-cloud-v2", name: "Cloud Platform APIs v2", version: "2.0.0" },
      { id: "col-cloud-v3", name: "Cloud Platform APIs v3", version: "3.0.0" },
      { id: "col-data", name: "Data Analytics APIs", version: "1.0.0" },
      { id: "col-identity", name: "Identity & Access APIs", version: "1.5.0" },
    ];

    const colIds: string[] = [];
    for (const c of collections) {
      const uid = `${c.id}-uid`;
      this.collections.set(uid, {
        id: c.id,
        uid,
        name: c.name,
        description: `${c.name} - Golden copy`,
        version: c.version,
      });
      colIds.push(uid);
    }
    this.workspaceCollections.set(goldenWsId, colIds);

    // Seed environments
    const envs = [
      {
        id: "env-staging",
        name: "Staging",
        values: [
          { key: "base_url", value: "https://api.staging.deloitte.com", type: "default" as const, enabled: true },
          { key: "api_key", value: "", type: "secret" as const, enabled: true },
        ],
      },
      {
        id: "env-production",
        name: "Production",
        values: [
          { key: "base_url", value: "https://api.deloitte.com", type: "default" as const, enabled: true },
          { key: "api_key", value: "", type: "secret" as const, enabled: true },
        ],
      },
    ];

    const envIds: string[] = [];
    for (const e of envs) {
      const uid = `${e.id}-uid`;
      this.environments.set(uid, { id: e.id, uid, name: e.name, values: e.values });
      envIds.push(uid);
    }
    this.workspaceEnvironments.set(goldenWsId, envIds);

    // Seed API definition
    this.apis.set("api-cloud-platform", {
      id: "api-cloud-platform",
      name: "Cloud Platform API",
      summary: "Core cloud platform API",
      description: "Full-featured cloud platform API with CRUD operations",
      versions: [
        { id: "v2", name: "2.0.0", collection_uid: "col-cloud-v2-uid", created_at: new Date().toISOString() },
        { id: "v3", name: "3.0.0", collection_uid: "col-cloud-v3-uid", created_at: new Date().toISOString() },
      ],
    });
  }

  // ── Workspaces ──────────────────────────────────────

  async createWorkspace(params: CreateWorkspaceParams): Promise<PostmanWorkspace> {
    const ws: PostmanWorkspace = {
      id: `ws-${uuid().slice(0, 8)}`,
      name: params.name,
      type: params.type,
      description: params.description,
      created_at: new Date().toISOString(),
    };
    this.workspaces.set(ws.id, ws);
    this.workspaceCollections.set(ws.id, []);
    this.workspaceEnvironments.set(ws.id, []);
    return ws;
  }

  async getWorkspace(workspaceId: string): Promise<PostmanWorkspace> {
    const ws = this.workspaces.get(workspaceId);
    if (!ws) throw new Error(`Workspace not found: ${workspaceId}`);
    return ws;
  }

  async listWorkspaces(): Promise<PostmanWorkspace[]> {
    return Array.from(this.workspaces.values());
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    if (!this.workspaces.has(workspaceId)) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    this.workspaces.delete(workspaceId);
    this.workspaceCollections.delete(workspaceId);
    this.workspaceEnvironments.delete(workspaceId);
    this.permissions.delete(workspaceId);
  }

  // ── Collections ─────────────────────────────────────

  async getCollection(collectionUid: string): Promise<PostmanCollection> {
    const col = this.collections.get(collectionUid);
    if (!col) throw new Error(`Collection not found: ${collectionUid}`);
    return col;
  }

  async listCollections(workspaceId: string): Promise<PostmanCollection[]> {
    const colIds = this.workspaceCollections.get(workspaceId) ?? [];
    return colIds
      .map((id) => this.collections.get(id))
      .filter((c): c is PostmanCollection => c !== undefined);
  }

  async copyCollection(params: CopyCollectionParams): Promise<PostmanCollection> {
    const source = this.collections.get(params.collection_uid);
    if (!source) throw new Error(`Source collection not found: ${params.collection_uid}`);

    const newUid = `${source.id}-copy-${uuid().slice(0, 8)}-uid`;
    const copy: PostmanCollection = {
      id: `${source.id}-copy-${uuid().slice(0, 8)}`,
      uid: newUid,
      name: params.new_name ?? `${source.name} (Copy)`,
      description: source.description,
      version: source.version,
    };

    this.collections.set(newUid, copy);
    const wsCollections = this.workspaceCollections.get(params.target_workspace_id) ?? [];
    wsCollections.push(newUid);
    this.workspaceCollections.set(params.target_workspace_id, wsCollections);

    return copy;
  }

  async forkCollection(params: ForkCollectionParams): Promise<PostmanForkResult> {
    const source = this.collections.get(params.collection_uid);
    if (!source) throw new Error(`Source collection not found: ${params.collection_uid}`);

    const forkId = `fork-${uuid().slice(0, 8)}`;
    const forkUid = `${forkId}-uid`;

    const forked: PostmanCollection = {
      id: forkId,
      uid: forkUid,
      name: `${source.name} [Fork: ${params.label}]`,
      description: `Forked from ${source.uid} - ${params.label}`,
      version: source.version,
    };

    this.collections.set(forkUid, forked);
    const wsCollections = this.workspaceCollections.get(params.target_workspace_id) ?? [];
    wsCollections.push(forkUid);
    this.workspaceCollections.set(params.target_workspace_id, wsCollections);

    return {
      collection_id: source.id,
      fork_id: forkId,
      fork_uid: forkUid,
      workspace_id: params.target_workspace_id,
    };
  }

  // ── Environments ────────────────────────────────────

  async getEnvironment(environmentUid: string): Promise<PostmanEnvironment> {
    const env = this.environments.get(environmentUid);
    if (!env) throw new Error(`Environment not found: ${environmentUid}`);
    return env;
  }

  async listEnvironments(workspaceId: string): Promise<PostmanEnvironment[]> {
    const envIds = this.workspaceEnvironments.get(workspaceId) ?? [];
    return envIds
      .map((id) => this.environments.get(id))
      .filter((e): e is PostmanEnvironment => e !== undefined);
  }

  async copyEnvironment(params: CopyEnvironmentParams): Promise<PostmanEnvironment> {
    const source = this.environments.get(params.environment_uid);
    if (!source) throw new Error(`Source environment not found: ${params.environment_uid}`);

    const newUid = `${source.id}-copy-${uuid().slice(0, 8)}-uid`;
    const copy: PostmanEnvironment = {
      id: `${source.id}-copy-${uuid().slice(0, 8)}`,
      uid: newUid,
      name: `${source.name} (Copy)`,
      values: source.values.map((v) => ({
        ...v,
        value: params.strip_secrets && v.type === "secret" ? "" : v.value,
      })),
    };

    this.environments.set(newUid, copy);
    const wsEnvs = this.workspaceEnvironments.get(params.target_workspace_id) ?? [];
    wsEnvs.push(newUid);
    this.workspaceEnvironments.set(params.target_workspace_id, wsEnvs);

    return copy;
  }

  // ── APIs ────────────────────────────────────────────

  async getApi(apiId: string): Promise<PostmanApi> {
    const api = this.apis.get(apiId);
    if (!api) throw new Error(`API not found: ${apiId}`);
    return api;
  }

  async listApis(workspaceId: string): Promise<PostmanApi[]> {
    // In mock: return all APIs (in real impl, filter by workspace)
    void workspaceId;
    return Array.from(this.apis.values());
  }

  async createApiVersion(
    apiId: string,
    version: PostmanApiVersion
  ): Promise<PostmanApiVersion> {
    const api = this.apis.get(apiId);
    if (!api) throw new Error(`API not found: ${apiId}`);

    const newVersion: PostmanApiVersion = {
      ...version,
      id: version.id || uuid().slice(0, 8),
      created_at: new Date().toISOString(),
    };

    api.versions = api.versions ?? [];
    api.versions.push(newVersion);
    return newVersion;
  }

  // ── Permissions ─────────────────────────────────────

  async setWorkspacePermissions(
    params: SetWorkspacePermissionsParams
  ): Promise<void> {
    if (!this.workspaces.has(params.workspace_id)) {
      throw new Error(`Workspace not found: ${params.workspace_id}`);
    }
    // Merge with existing permissions (don't replace)
    const existing = this.permissions.get(params.workspace_id) ?? [];
    const merged = [...existing];
    for (const member of params.members) {
      const idx = merged.findIndex((m) => m.email.toLowerCase() === member.email.toLowerCase());
      if (idx >= 0) {
        merged[idx] = member; // Update role if already exists
      } else {
        merged.push(member);
      }
    }
    this.permissions.set(params.workspace_id, merged);
  }

  // ── Pull Requests ──────────────────────────────────

  async createPullRequest(params: CreatePullRequestParams): Promise<PostmanPullRequest> {
    const prId = `pr-${uuid().slice(0, 8)}`;
    const now = new Date().toISOString();

    const pr: PostmanPullRequest = {
      id: prId,
      source_collection_uid: params.source_collection_uid,
      target_collection_uid: params.target_collection_uid,
      workspace_id: params.workspace_id,
      title: params.title,
      description: params.description,
      status: "open",
      created_by: params.created_by,
      created_at: now,
      updated_at: now,
    };

    this.pullRequests.set(prId, pr);
    return pr;
  }

  async getPullRequest(prId: string): Promise<PostmanPullRequest> {
    const pr = this.pullRequests.get(prId);
    if (!pr) throw new Error(`Pull request not found: ${prId}`);
    return pr;
  }

  async listPullRequests(workspaceId: string): Promise<PostmanPullRequest[]> {
    return Array.from(this.pullRequests.values()).filter(
      (pr) => pr.workspace_id === workspaceId
    );
  }

  async mergePullRequest(params: MergePullRequestParams): Promise<PostmanPullRequest> {
    const pr = this.pullRequests.get(params.pr_id);
    if (!pr) throw new Error(`Pull request not found: ${params.pr_id}`);

    if (pr.status !== "approved") {
      throw new Error(`Cannot merge PR ${params.pr_id}: status is "${pr.status}", must be "approved"`);
    }

    const now = new Date().toISOString();
    pr.status = "merged";
    pr.merged_at = now;
    pr.updated_at = now;
    this.pullRequests.set(params.pr_id, pr);
    return pr;
  }

  // ── Import / Publish ────────────────────────────────

  async importOpenApiSpec(
    workspaceId: string,
    specContent: string
  ): Promise<PostmanApi> {
    void specContent;
    const apiId = `api-imported-${uuid().slice(0, 8)}`;
    const api: PostmanApi = {
      id: apiId,
      name: "Imported API",
      summary: "Imported from OpenAPI spec",
      description: "Auto-generated from OpenAPI specification",
    };
    this.apis.set(apiId, api);
    // Associate with workspace
    void workspaceId;
    return api;
  }

  async updateApiSchema(
    apiId: string,
    versionId: string,
    schemaContent: string
  ): Promise<void> {
    const api = this.apis.get(apiId);
    if (!api) throw new Error(`API not found: ${apiId}`);
    // In mock, just validate the version exists
    const version = api.versions?.find((v) => v.id === versionId);
    if (!version) throw new Error(`Version ${versionId} not found for API ${apiId}`);
    void schemaContent;
  }

  // ── Test helpers ────────────────────────────────────

  /** Get current state for assertions in tests */
  getState() {
    return {
      workspaces: new Map(this.workspaces),
      collections: new Map(this.collections),
      environments: new Map(this.environments),
      apis: new Map(this.apis),
      pullRequests: new Map(this.pullRequests),
      permissions: new Map(this.permissions),
      workspaceCollections: new Map(this.workspaceCollections),
      workspaceEnvironments: new Map(this.workspaceEnvironments),
    };
  }
}
