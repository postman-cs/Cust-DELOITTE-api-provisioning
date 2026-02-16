/**
 * ─────────────────────────────────────────────────────────
 * Postman API Adapter Interface (Contract)
 *
 * This is the abstraction layer between the provisioning
 * service and the Postman platform API. Swap implementations
 * (mock vs. live) via config without changing business logic.
 * ─────────────────────────────────────────────────────────
 */

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

export interface CreateWorkspaceParams {
  name: string;
  type: "personal" | "private" | "team" | "partner";
  description?: string;
}

export interface CopyCollectionParams {
  collection_uid: string;
  target_workspace_id: string;
  /** Optional: rename the copy */
  new_name?: string;
}

export interface ForkCollectionParams {
  collection_uid: string;
  target_workspace_id: string;
  label: string;
}

export interface SetWorkspacePermissionsParams {
  workspace_id: string;
  /** Users to add with their roles */
  members: Array<{
    email: string;
    role: "viewer" | "editor";
  }>;
}

export interface CopyEnvironmentParams {
  environment_uid: string;
  target_workspace_id: string;
  /** Optionally strip secret values */
  strip_secrets?: boolean;
}

export interface IPostmanClient {
  // ── Workspaces ──────────────────────────────────────
  createWorkspace(params: CreateWorkspaceParams): Promise<PostmanWorkspace>;
  getWorkspace(workspaceId: string): Promise<PostmanWorkspace>;
  listWorkspaces(): Promise<PostmanWorkspace[]>;
  deleteWorkspace(workspaceId: string): Promise<void>;

  // ── Collections ─────────────────────────────────────
  getCollection(collectionUid: string): Promise<PostmanCollection>;
  listCollections(workspaceId: string): Promise<PostmanCollection[]>;
  copyCollection(params: CopyCollectionParams): Promise<PostmanCollection>;
  forkCollection(params: ForkCollectionParams): Promise<PostmanForkResult>;

  // ── Environments ────────────────────────────────────
  getEnvironment(environmentUid: string): Promise<PostmanEnvironment>;
  listEnvironments(workspaceId: string): Promise<PostmanEnvironment[]>;
  copyEnvironment(params: CopyEnvironmentParams): Promise<PostmanEnvironment>;

  // ── APIs ────────────────────────────────────────────
  getApi(apiId: string): Promise<PostmanApi>;
  listApis(workspaceId: string): Promise<PostmanApi[]>;
  createApiVersion(apiId: string, version: PostmanApiVersion): Promise<PostmanApiVersion>;

  // ── Permissions ─────────────────────────────────────
  setWorkspacePermissions(params: SetWorkspacePermissionsParams): Promise<void>;

  // ── Pull Requests (fork → PR → merge workflow) ──────
  createPullRequest(params: CreatePullRequestParams): Promise<PostmanPullRequest>;
  getPullRequest(prId: string): Promise<PostmanPullRequest>;
  listPullRequests(workspaceId: string): Promise<PostmanPullRequest[]>;
  mergePullRequest(params: MergePullRequestParams): Promise<PostmanPullRequest>;

  // ── Import / Publish ────────────────────────────────
  importOpenApiSpec(workspaceId: string, specContent: string): Promise<PostmanApi>;
  updateApiSchema(apiId: string, versionId: string, schemaContent: string): Promise<void>;
}
