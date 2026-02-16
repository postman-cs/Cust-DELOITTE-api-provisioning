/**
 * ─────────────────────────────────────────────────────────
 * Live Postman API Client
 *
 * Real implementation of IPostmanClient using Postman REST API.
 * Replace the mock with this by setting USE_MOCK_POSTMAN_CLIENT=false.
 *
 * Postman API docs: https://www.postman.com/postman/workspace/postman-public-workspace/documentation/12959542-c8142d51-e97c-46b6-bd77-52bb8632f583
 * ─────────────────────────────────────────────────────────
 */

import axios, { AxiosInstance } from "axios";
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

export class LivePostmanClient implements IPostmanClient {
  private client: AxiosInstance;

  constructor(apiKey: string, baseUrl: string = "https://api.getpostman.com") {
    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });
  }

  // ── Workspaces ──────────────────────────────────────

  async createWorkspace(params: CreateWorkspaceParams): Promise<PostmanWorkspace> {
    const { data } = await this.client.post("/workspaces", {
      workspace: {
        name: params.name,
        type: params.type,
        description: params.description || "",
      },
    });
    return {
      id: data.workspace.id,
      name: data.workspace.name,
      type: params.type,
      description: params.description,
      created_at: new Date().toISOString(),
    };
  }

  async getWorkspace(workspaceId: string): Promise<PostmanWorkspace> {
    const { data } = await this.client.get(`/workspaces/${workspaceId}`);
    const ws = data.workspace;
    return {
      id: ws.id,
      name: ws.name,
      type: ws.type,
      description: ws.description,
    };
  }

  async listWorkspaces(): Promise<PostmanWorkspace[]> {
    const { data } = await this.client.get("/workspaces");
    return (data.workspaces || []).map((ws: Record<string, string>) => ({
      id: ws.id,
      name: ws.name,
      type: ws.type,
    }));
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    await this.client.delete(`/workspaces/${workspaceId}`);
  }

  // ── Collections ─────────────────────────────────────

  async getCollection(collectionUid: string): Promise<PostmanCollection> {
    const { data } = await this.client.get(`/collections/${collectionUid}`);
    const col = data.collection;
    return {
      id: col.info._postman_id,
      uid: collectionUid,
      name: col.info.name,
      description: col.info.description,
    };
  }

  async listCollections(workspaceId: string): Promise<PostmanCollection[]> {
    const { data } = await this.client.get("/collections", {
      params: { workspace: workspaceId },
    });
    return (data.collections || []).map((c: Record<string, string>) => ({
      id: c.id,
      uid: c.uid,
      name: c.name,
    }));
  }

  async copyCollection(params: CopyCollectionParams): Promise<PostmanCollection> {
    // Postman API: to copy, we GET the full collection then POST it into the target workspace
    const source = await this.getCollection(params.collection_uid);
    const { data: fullCollection } = await this.client.get(
      `/collections/${params.collection_uid}`
    );

    if (params.new_name) {
      fullCollection.collection.info.name = params.new_name;
    }

    const { data } = await this.client.post(
      `/collections?workspace=${params.target_workspace_id}`,
      { collection: fullCollection.collection }
    );

    return {
      id: data.collection.id,
      uid: data.collection.uid,
      name: params.new_name ?? source.name,
    };
  }

  async forkCollection(params: ForkCollectionParams): Promise<PostmanForkResult> {
    const { data } = await this.client.post(
      `/collections/fork/${params.collection_uid}`,
      { label: params.label, workspace: params.target_workspace_id }
    );
    return {
      collection_id: data.collection.id,
      fork_id: data.collection.fork?.id || data.collection.id,
      fork_uid: data.collection.uid,
      workspace_id: params.target_workspace_id,
    };
  }

  // ── Environments ────────────────────────────────────

  async getEnvironment(environmentUid: string): Promise<PostmanEnvironment> {
    const { data } = await this.client.get(`/environments/${environmentUid}`);
    const env = data.environment;
    return {
      id: env.id,
      uid: environmentUid,
      name: env.name,
      values: (env.values || []).map((v: Record<string, string | boolean>) => ({
        key: v.key,
        value: v.value,
        type: v.type || "default",
        enabled: v.enabled !== false,
      })),
    };
  }

  async listEnvironments(workspaceId: string): Promise<PostmanEnvironment[]> {
    const { data } = await this.client.get("/environments", {
      params: { workspace: workspaceId },
    });
    return (data.environments || []).map((e: Record<string, string>) => ({
      id: e.id,
      uid: e.uid,
      name: e.name,
      values: [],
    }));
  }

  async copyEnvironment(params: CopyEnvironmentParams): Promise<PostmanEnvironment> {
    const source = await this.getEnvironment(params.environment_uid);

    const values = source.values.map((v) => ({
      ...v,
      value: params.strip_secrets && v.type === "secret" ? "" : v.value,
    }));

    const { data } = await this.client.post(
      `/environments?workspace=${params.target_workspace_id}`,
      {
        environment: {
          name: `${source.name} (Copy)`,
          values,
        },
      }
    );

    return {
      id: data.environment.id,
      uid: data.environment.uid,
      name: data.environment.name,
      values,
    };
  }

  // ── APIs ────────────────────────────────────────────

  async getApi(apiId: string): Promise<PostmanApi> {
    const { data } = await this.client.get(`/apis/${apiId}`);
    return {
      id: data.api.id,
      name: data.api.name,
      summary: data.api.summary,
      description: data.api.description,
    };
  }

  async listApis(workspaceId: string): Promise<PostmanApi[]> {
    const { data } = await this.client.get("/apis", {
      params: { workspace: workspaceId },
    });
    return (data.apis || []).map((a: Record<string, string>) => ({
      id: a.id,
      name: a.name,
      summary: a.summary,
    }));
  }

  async createApiVersion(
    apiId: string,
    version: PostmanApiVersion
  ): Promise<PostmanApiVersion> {
    const { data } = await this.client.post(`/apis/${apiId}/versions`, {
      version: {
        name: version.name,
        source: version.collection_uid
          ? { type: "collection", id: version.collection_uid }
          : undefined,
      },
    });
    return {
      id: data.version.id,
      name: data.version.name,
      created_at: new Date().toISOString(),
    };
  }

  // ── Permissions ─────────────────────────────────────

  async setWorkspacePermissions(
    params: SetWorkspacePermissionsParams
  ): Promise<void> {
    // Postman uses the /workspaces/{id} PATCH or specific role API
    // This is a simplified version
    await this.client.patch(`/workspaces/${params.workspace_id}`, {
      workspace: {
        members: params.members.map((m) => ({
          email: m.email,
          role: m.role === "viewer" ? "viewer" : "editor",
        })),
      },
    });
  }

  // ── Pull Requests ──────────────────────────────────

  async createPullRequest(params: CreatePullRequestParams): Promise<PostmanPullRequest> {
    const { data } = await this.client.post(`/collection-merges`, {
      source: params.source_collection_uid,
      destination: params.target_collection_uid,
      title: params.title,
      description: params.description,
    });

    return {
      id: data.pull_request?.id ?? data.id,
      source_collection_uid: params.source_collection_uid,
      target_collection_uid: params.target_collection_uid,
      workspace_id: params.workspace_id,
      title: params.title,
      description: params.description,
      status: "open",
      created_by: params.created_by,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  async getPullRequest(prId: string): Promise<PostmanPullRequest> {
    const { data } = await this.client.get(`/collection-merges/${prId}`);
    return data.pull_request ?? data;
  }

  async listPullRequests(workspaceId: string): Promise<PostmanPullRequest[]> {
    // Postman API may not have a direct list-by-workspace endpoint for PRs.
    // In practice, this would filter from collection-level PR listings.
    void workspaceId;
    return [];
  }

  async mergePullRequest(params: MergePullRequestParams): Promise<PostmanPullRequest> {
    const { data } = await this.client.put(`/collection-merges/${params.pr_id}/merge`, {
      strategy: params.strategy,
    });
    return data.pull_request ?? data;
  }

  // ── Import / Publish ────────────────────────────────

  async importOpenApiSpec(
    workspaceId: string,
    specContent: string
  ): Promise<PostmanApi> {
    const { data } = await this.client.post("/import/openapi", {
      type: "string",
      input: specContent,
      workspace: workspaceId,
    });
    return {
      id: data.api?.id || data.collection?.id,
      name: data.api?.name || "Imported API",
    };
  }

  async updateApiSchema(
    apiId: string,
    versionId: string,
    schemaContent: string
  ): Promise<void> {
    await this.client.put(`/apis/${apiId}/versions/${versionId}/schemas`, {
      schema: {
        type: "openapi3",
        language: "yaml",
        schema: schemaContent,
      },
    });
  }
}
