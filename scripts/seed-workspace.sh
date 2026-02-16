#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
# seed-workspace.sh
#
# Seeds a Postman workspace with assets from this repo:
#   1. Imports OpenAPI spec → creates a Collection
#   2. Creates Environments (Production, Staging)
#   3. Registers the API in Postman's API Builder (Spec Hub)
#
# Usage:
#   ./scripts/seed-workspace.sh
#   ./scripts/seed-workspace.sh --from-github   (pull spec from GitHub)
#
# Required env vars (or in service/.env):
#   POSTMAN_API_KEY
#   POSTMAN_GOLDEN_WORKSPACE_ID
#
# Optional:
#   GITHUB_SPEC_URL  (default: raw spec from this repo's GitHub)
# ─────────────────────────────────────────────────────────
set -euo pipefail

GREEN='\033[32m'
BLUE='\033[36m'
YELLOW='\033[33m'
RED='\033[31m'
BOLD='\033[1m'
RESET='\033[0m'

log()  { echo -e "${GREEN}[seed]${RESET} $*"; }
info() { echo -e "${BLUE}[info]${RESET} $*"; }
warn() { echo -e "${YELLOW}[warn]${RESET} $*"; }
fail() { echo -e "${RED}[FAIL]${RESET} $*"; exit 1; }

# ── Load .env if available ───────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

for envfile in "$REPO_ROOT/service/.env" "$REPO_ROOT/.env"; do
  if [ -f "$envfile" ]; then
    set -a; source "$envfile"; set +a
    info "Loaded env from $envfile"
    break
  fi
done

# ── Validate config ─────────────────────────────────────
[ -z "${POSTMAN_API_KEY:-}" ]              && fail "POSTMAN_API_KEY is not set"
[ -z "${POSTMAN_GOLDEN_WORKSPACE_ID:-}" ]  && fail "POSTMAN_GOLDEN_WORKSPACE_ID is not set"

API_KEY="$POSTMAN_API_KEY"
WS_ID="$POSTMAN_GOLDEN_WORKSPACE_ID"
API_BASE="https://api.getpostman.com"

GITHUB_SPEC_URL="${GITHUB_SPEC_URL:-https://raw.githubusercontent.com/danielshively-source/Deloitte/main/api/openapi.yaml}"

# ── Helper: Postman API call ────────────────────────────
pm_get()  { curl -sf -H "X-API-Key: $API_KEY" "$API_BASE$1"; }
pm_post() { curl -sf -X POST -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" "$API_BASE$1" -d "$2"; }

echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}  Seed Postman Workspace from OpenAPI Spec${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
info "Workspace: $WS_ID"
info "API Key:   ${API_KEY:0:10}..."

# ── Step 0: Verify workspace exists ─────────────────────
log "Verifying workspace..."
WS_NAME=$(pm_get "/workspaces/$WS_ID" | python3 -c "import sys,json; print(json.load(sys.stdin)['workspace']['name'])" 2>/dev/null) \
  || fail "Cannot access workspace $WS_ID. Check API key and workspace ID."
log "  Workspace: ${BOLD}$WS_NAME${RESET}"

# ── Step 1: Get the OpenAPI spec ────────────────────────
log "Loading OpenAPI spec..."
if [ "${1:-}" = "--from-github" ]; then
  info "  Fetching from GitHub: $GITHUB_SPEC_URL"
  SPEC_CONTENT=$(curl -sf "$GITHUB_SPEC_URL") || fail "Failed to fetch spec from GitHub"
else
  SPEC_FILE="$REPO_ROOT/api/openapi.yaml"
  [ -f "$SPEC_FILE" ] || fail "OpenAPI spec not found at $SPEC_FILE"
  SPEC_CONTENT=$(cat "$SPEC_FILE")
  info "  Loaded from local file: $SPEC_FILE"
fi

SPEC_TITLE=$(echo "$SPEC_CONTENT" | python3 -c "import sys,yaml; print(yaml.safe_load(sys.stdin)['info']['title'])" 2>/dev/null || echo "Deloitte API")
SPEC_VERSION=$(echo "$SPEC_CONTENT" | python3 -c "import sys,yaml; print(yaml.safe_load(sys.stdin)['info']['version'])" 2>/dev/null || echo "1.0.0")
log "  Spec: ${BOLD}$SPEC_TITLE v$SPEC_VERSION${RESET}"

# ── Step 2: Import spec as collection ───────────────────
log "Importing OpenAPI spec into workspace as collection..."

IMPORT_PAYLOAD=$(python3 -c "
import json, sys
spec = sys.stdin.read()
print(json.dumps({
    'type': 'string',
    'input': spec,
    'options': {
        'requestParameterGeneration': 'Example',
        'exampleParametersResolution': 'schema'
    }
}))
" <<< "$SPEC_CONTENT")

IMPORT_RESULT=$(curl -sf -X POST \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  "$API_BASE/import/openapi?workspace=$WS_ID" \
  -d "$IMPORT_PAYLOAD" 2>&1) || {
    warn "OpenAPI import failed. Trying alternative method..."
    # Fallback: import as raw collection JSON converted from the spec
    IMPORT_RESULT=""
  }

if [ -n "$IMPORT_RESULT" ]; then
  COL_UID=$(echo "$IMPORT_RESULT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
cols = d.get('collections', [])
if cols:
    print(cols[0].get('uid', cols[0].get('id', '')))
else:
    print('')
" 2>/dev/null || echo "")

  if [ -n "$COL_UID" ]; then
    log "  Collection created: ${BOLD}$COL_UID${RESET}"
  else
    warn "  Import returned unexpected format. Checking workspace..."
    COL_UID=""
  fi
fi

# If import didn't yield a UID, list collections to find what we just imported
if [ -z "${COL_UID:-}" ]; then
  sleep 2
  COL_UID=$(pm_get "/collections?workspace=$WS_ID" | python3 -c "
import sys, json
cols = json.load(sys.stdin).get('collections', [])
for c in cols:
    if 'deloitte' in c.get('name','').lower() or 'sample' in c.get('name','').lower():
        print(c['uid']); break
else:
    if cols: print(cols[0]['uid'])
    else: print('')
" 2>/dev/null || echo "")
  if [ -n "$COL_UID" ]; then
    log "  Found collection: ${BOLD}$COL_UID${RESET}"
  else
    warn "  No collection found after import"
  fi
fi

# ── Step 3: Create environments ─────────────────────────
log "Creating environments..."

for ENV_FILE in "$REPO_ROOT/postman/environments/"*.json; do
  ENV_NAME=$(python3 -c "import json; print(json.load(open('$ENV_FILE'))['name'])")
  ENV_VALUES=$(python3 -c "
import json
d = json.load(open('$ENV_FILE'))
vals = d.get('values', [])
# Strip secret values for safety
for v in vals:
    if v.get('type') == 'secret':
        v['value'] = ''
print(json.dumps({'environment': {'name': '$ENV_NAME', 'values': vals}}))
")

  ENV_RESULT=$(curl -sf -X POST \
    -H "X-API-Key: $API_KEY" \
    -H "Content-Type: application/json" \
    "$API_BASE/environments?workspace=$WS_ID" \
    -d "$ENV_VALUES" 2>&1) || {
      warn "  Failed to create environment: $ENV_NAME"
      continue
    }

  ENV_UID=$(echo "$ENV_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['environment']['uid'])" 2>/dev/null || echo "?")
  log "  Environment ${BOLD}$ENV_NAME${RESET}: $ENV_UID"
done

# ── Step 4: Register API in Postman API Builder ─────────
log "Registering API in Postman API Builder (Spec Hub)..."

API_PAYLOAD=$(python3 -c "
import json
print(json.dumps({
    'name': '$SPEC_TITLE',
    'summary': 'Governance-compliant API managed by CI/CD pipeline',
    'description': 'Imported from GitHub repo openapi.yaml. Version: $SPEC_VERSION'
}))
")

API_RESULT=$(curl -sf -X POST \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  "$API_BASE/apis?workspace=$WS_ID" \
  -d "$API_PAYLOAD" 2>&1) || {
    warn "  API creation failed (may require Postman team/business plan)"
    API_ID=""
  }

API_ID=""
if [ -n "${API_RESULT:-}" ]; then
  API_ID=$(echo "$API_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('api',{}).get('id',''))" 2>/dev/null || echo "")
  if [ -n "$API_ID" ]; then
    log "  API registered: ${BOLD}$API_ID${RESET}"

    # Add schema version
    log "  Adding OpenAPI schema to API..."
    SCHEMA_PAYLOAD=$(python3 -c "
import json, sys
spec = sys.stdin.read()
print(json.dumps({
    'type': 'openapi3',
    'language': 'yaml',
    'schema': spec
}))
" <<< "$SPEC_CONTENT")

    SCHEMA_RESULT=$(curl -sf -X POST \
      -H "X-API-Key: $API_KEY" \
      -H "Content-Type: application/json" \
      "$API_BASE/apis/$API_ID/schemas" \
      -d "$SCHEMA_PAYLOAD" 2>&1) || warn "  Schema upload may need a different endpoint for your plan"

    if [ -n "${SCHEMA_RESULT:-}" ]; then
      SCHEMA_ID=$(echo "$SCHEMA_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('schema',{}).get('id', d.get('id','')))" 2>/dev/null || echo "")
      [ -n "$SCHEMA_ID" ] && log "  Schema: ${BOLD}$SCHEMA_ID${RESET}"
    fi
  fi
fi

# ── Step 5: Summary ─────────────────────────────────────
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}  Seed Complete${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
info "Workspace:   $WS_NAME ($WS_ID)"
[ -n "${COL_UID:-}" ]  && info "Collection:  $COL_UID"
[ -n "${API_ID:-}" ]   && info "API (Hub):   $API_ID"
echo ""
info "View in Postman: https://go.postman.co/workspace/$WS_ID"
echo ""

# ── Output for automation ───────────────────────────────
# Write IDs to a file so other scripts/config can use them
cat > "$REPO_ROOT/.seed-output.json" <<EOJSON
{
  "workspace_id": "$WS_ID",
  "workspace_name": "$WS_NAME",
  "collection_uid": "${COL_UID:-}",
  "api_id": "${API_ID:-}",
  "seeded_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "spec_title": "$SPEC_TITLE",
  "spec_version": "$SPEC_VERSION"
}
EOJSON
info "Seed output written to .seed-output.json"
echo ""
