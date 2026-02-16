# Contract: Postman API Adapter

The Postman adapter abstracts all interactions with the Postman platform API.
Any implementation must satisfy this interface.

---

## Interface: IPostmanClient

```typescript
interface IPostmanClient {
  // Workspaces
  createWorkspace(params: CreateWorkspaceParams): Promise<PostmanWorkspace>;
  getWorkspace(workspaceId: string): Promise<PostmanWorkspace>;
  listWorkspaces(): Promise<PostmanWorkspace[]>;
  deleteWorkspace(workspaceId: string): Promise<void>;

  // Collections
  getCollection(collectionUid: string): Promise<PostmanCollection>;
  listCollections(workspaceId: string): Promise<PostmanCollection[]>;
  copyCollection(params: CopyCollectionParams): Promise<PostmanCollection>;
  forkCollection(params: ForkCollectionParams): Promise<PostmanForkResult>;

  // Environments
  getEnvironment(environmentUid: string): Promise<PostmanEnvironment>;
  listEnvironments(workspaceId: string): Promise<PostmanEnvironment[]>;
  copyEnvironment(params: CopyEnvironmentParams): Promise<PostmanEnvironment>;

  // APIs
  getApi(apiId: string): Promise<PostmanApi>;
  listApis(workspaceId: string): Promise<PostmanApi[]>;
  createApiVersion(apiId: string, version: PostmanApiVersion): Promise<PostmanApiVersion>;

  // Permissions
  setWorkspacePermissions(params: SetWorkspacePermissionsParams): Promise<void>;

  // Import/Publish
  importOpenApiSpec(workspaceId: string, specContent: string): Promise<PostmanApi>;
  updateApiSchema(apiId: string, versionId: string, schemaContent: string): Promise<void>;
}
```

---

## Implementations

### MockPostmanClient
- In-memory data stores
- Seeded with a "Golden" workspace containing sample collections
- Deterministic — same calls produce same results
- Includes `getState()` for test assertions

### LivePostmanClient
- Uses axios to call Postman REST API
- Requires `POSTMAN_API_KEY` environment variable
- Base URL configurable (default: `https://api.getpostman.com`)
- 30-second timeout per request

### Implementing a new adapter
To add a new adapter (e.g., for a different API management platform):

1. Create a new file in `service/src/adapters/`
2. Implement the `IPostmanClient` interface
3. Register it in `service/src/index.ts` based on config

---

## Postman API Reference

Key endpoints used:

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Create workspace | POST | `/workspaces` |
| Get workspace | GET | `/workspaces/{id}` |
| List collections | GET | `/collections?workspace={id}` |
| Get collection | GET | `/collections/{uid}` |
| Create collection | POST | `/collections?workspace={id}` |
| Fork collection | POST | `/collections/fork/{uid}` |
| List environments | GET | `/environments?workspace={id}` |
| Create environment | POST | `/environments?workspace={id}` |
| Import OpenAPI | POST | `/import/openapi` |
| Update schema | PUT | `/apis/{id}/versions/{vid}/schemas` |

All requests require header: `X-API-Key: {POSTMAN_API_KEY}`
