# Postman API Call Examples

Reference examples of the Postman API calls used by this system.
All calls require the `X-API-Key` header (stored as GitHub/CI secret).

> **Security**: Never hardcode API keys. Use environment variables or secret managers.

---

## 1. Create a Workspace

```bash
curl -X POST https://api.getpostman.com/workspaces \
  -H "X-API-Key: ${POSTMAN_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "workspace": {
      "name": "Partner: Coca-Cola Global",
      "type": "partner",
      "description": "Partner workspace for Coca-Cola Global. Domains: coca-cola.com. | Managed by Deloitte API Platform"
    }
  }'
```

**Response:**
```json
{
  "workspace": {
    "id": "ws-abc123",
    "name": "Partner: Coca-Cola Global"
  }
}
```

---

## 2. List Collections in a Workspace

```bash
curl https://api.getpostman.com/collections?workspace=${WORKSPACE_ID} \
  -H "X-API-Key: ${POSTMAN_API_KEY}"
```

---

## 3. Copy a Collection to Another Workspace

```bash
# Step 1: Get the full collection
COLLECTION=$(curl -s https://api.getpostman.com/collections/${COLLECTION_UID} \
  -H "X-API-Key: ${POSTMAN_API_KEY}")

# Step 2: POST it into the target workspace
echo $COLLECTION | curl -X POST "https://api.getpostman.com/collections?workspace=${TARGET_WORKSPACE_ID}" \
  -H "X-API-Key: ${POSTMAN_API_KEY}" \
  -H "Content-Type: application/json" \
  -d @-
```

---

## 4. Fork a Collection

```bash
curl -X POST https://api.getpostman.com/collections/fork/${COLLECTION_UID} \
  -H "X-API-Key: ${POSTMAN_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "label": "Coca-Cola Global - 2026-02-15",
    "workspace": "${TARGET_WORKSPACE_ID}"
  }'
```

---

## 5. Copy an Environment (with secret stripping)

```bash
# Step 1: Get the environment
ENV=$(curl -s https://api.getpostman.com/environments/${ENV_UID} \
  -H "X-API-Key: ${POSTMAN_API_KEY}")

# Step 2: Strip secrets and POST to target workspace
# (The service handles this programmatically)
echo $ENV | jq '.environment.values |= map(if .type == "secret" then .value = "" else . end)' | \
  curl -X POST "https://api.getpostman.com/environments?workspace=${TARGET_WORKSPACE_ID}" \
  -H "X-API-Key: ${POSTMAN_API_KEY}" \
  -H "Content-Type: application/json" \
  -d @-
```

---

## 6. Import an OpenAPI Spec

```bash
curl -X POST https://api.getpostman.com/import/openapi \
  -H "X-API-Key: ${POSTMAN_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"string\",
    \"input\": $(cat api/openapi.yaml | jq -Rs .),
    \"workspace\": \"${GOLDEN_WORKSPACE_ID}\"
  }"
```

---

## 7. Set Workspace Permissions

```bash
# Note: Exact API depends on your Postman plan (Enterprise features)
curl -X PATCH "https://api.getpostman.com/workspaces/${WORKSPACE_ID}" \
  -H "X-API-Key: ${POSTMAN_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "workspace": {
      "members": [
        { "email": "partner-lead@coca-cola.com", "role": "viewer" },
        { "email": "provisioner@deloitte.com", "role": "editor" }
      ]
    }
  }'
```

---

## Notes

- **Rate limits**: Postman API has rate limits (varies by plan). The service handles retries.
- **Partner workspaces**: Require Postman Enterprise plan for the `partner` workspace type.
- **Forks vs copies**: Forks maintain a link to the source (useful for PR-like flow). Copies are independent.
- **Secrets**: Always strip secret environment values when copying to partner workspaces.
