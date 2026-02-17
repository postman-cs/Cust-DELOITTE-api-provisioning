# ─────────────────────────────────────────────────────────
# Deloitte API Provisioning Platform — Makefile
#
# One-command operations for the entire system.
# Run `make` or `make help` to see all targets.
# ─────────────────────────────────────────────────────────

.PHONY: help setup install dev test build clean demo demo-full \
        docker docker-up docker-down docker-test \
        lint check provision invite compliance \
        demo-ui demo-all

.DEFAULT_GOAL := help

BLUE  := \033[36m
GREEN := \033[32m
BOLD  := \033[1m
RESET := \033[0m

help: ## Show this help message
	@echo ""
	@echo "$(BOLD)Deloitte API Provisioning Platform$(RESET)"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@echo ""
	@echo "$(BOLD)Quick start:$(RESET)  make setup && make dev"
	@echo "$(BOLD)Web demo:$(RESET)     make dev  (terminal 1) + make demo-ui  (terminal 2)"
	@echo "$(BOLD)CLI demo:$(RESET)     make demo"
	@echo "$(BOLD)Run tests:$(RESET)    make test"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  $(BLUE)%-18s$(RESET) %s\n", $$1, $$2}'
	@echo ""

setup: ## First-time setup: install deps, create .env, run tests
	@echo "$(GREEN)Setting up API Provisioning Platform...$(RESET)"
	@echo ""
	@if [ ! -f service/.env ]; then \
		cp .env.example service/.env; \
		echo "  $(GREEN)✓$(RESET) Created service/.env from .env.example"; \
		echo ""; \
		echo "  $(BOLD)⚠  IMPORTANT: Edit service/.env with YOUR values:$(RESET)"; \
		echo "     - POSTMAN_API_KEY          (your Postman API key)"; \
		echo "     - POSTMAN_GOLDEN_WORKSPACE_ID  (source workspace)"; \
		echo "     - TARGET_WS_*              (target workspaces)"; \
		echo "     - PARTNER_NAME / PARTNER_DOMAIN"; \
		echo "     - ADMIN_ORG_NAME / ADMIN_ORG_DOMAIN"; \
		echo ""; \
	else \
		echo "  $(GREEN)✓$(RESET) service/.env already exists"; \
	fi
	@cd service && npm install --silent
	@echo "  $(GREEN)✓$(RESET) Dependencies installed"
	@cd service && npx tsc --noEmit 2>/dev/null && echo "  $(GREEN)✓$(RESET) TypeScript compiles cleanly" || echo "  ⚠ TypeScript errors detected"
	@echo ""
	@echo "$(GREEN)Setup complete!$(RESET)"
	@echo ""
	@echo "  Next steps:"
	@echo "    1. Edit $(BOLD)service/.env$(RESET) with your values"
	@echo "    2. $(BOLD)make dev$(RESET)       — start the backend (terminal 1)"
	@echo "    3. $(BOLD)make demo-ui$(RESET)   — start the UI      (terminal 2)"
	@echo "    4. Open $(BOLD)http://localhost:5173$(RESET)"
	@echo ""

install: ## Install dependencies only
	@cd service && npm install

dev: ## Start the service in dev mode (mock Postman, no auth)
	@echo "$(GREEN)Starting service in dev mode...$(RESET)"
	@echo "  Port: 3000"
	@echo ""
	@cd service && npm run dev

test: ## Run all tests with coverage
	@cd service && npm test

test-watch: ## Run tests in watch mode
	@cd service && npm run test:watch

lint: ## Lint the codebase
	@cd service && npx tsc --noEmit

build: ## Build for production
	@cd service && npm run build

clean: ## Remove build artifacts and coverage
	@rm -rf service/dist service/coverage
	@echo "Cleaned dist/ and coverage/"

check: ## Run all checks: lint + typecheck + tests
	@echo "$(BOLD)Running all checks...$(RESET)"
	@cd service && npx tsc --noEmit && echo "  Typecheck: PASS" || echo "  Typecheck: FAIL"
	@cd service && npm test -- --silent 2>/dev/null && echo "  Tests: PASS" || echo "  Tests: FAIL"

demo: ## Run the interactive CLI demo
	@bash scripts/demo.sh

demo-full: ## Run the full CLI demo with all features
	@bash scripts/demo.sh --full

demo-ui: ## Open the web-based demo UI (requires: make dev in another terminal)
	@echo "$(GREEN)Starting Demo UI at http://localhost:5173$(RESET)"
	@echo "  Make sure the service is running: $(BOLD)make dev$(RESET) (in another terminal)"
	@echo ""
	@cd demo-ui && npx --yes serve -s . -l 5173 --no-clipboard

demo-all: ## Start service + demo UI together (foreground)
	@echo "$(GREEN)Starting service and demo UI...$(RESET)"
	@echo "  Service: http://localhost:3000"
	@echo "  Demo UI: http://localhost:5173"
	@echo ""
	@cd service && npm run dev & \
	sleep 3 && \
	echo "" && \
	echo "$(GREEN)Opening Demo UI...$(RESET)" && \
	cd demo-ui && npx --yes serve -s . -l 5173 --no-clipboard

seed: ## Seed the golden Postman workspace from the OpenAPI spec
	@bash scripts/seed-workspace.sh

seed-github: ## Seed workspace by pulling spec from GitHub
	@bash scripts/seed-workspace.sh --from-github

provision: ## Provision a partner workspace (example)
	@bash scripts/provision.sh \
		--partner-name "Coca-Cola UK" \
		--partner-domains "coca-cola.com" \
		--api-packages "col-cloud-v3-uid" \
		--requested-by "admin@deloitte.com" \
		--team-id "team-cpg"

invite: ## Send a test invite
	@echo "Sending invite to bob@coca-cola.com..."
	@curl -s -X POST http://localhost:3000/invite/workspace/ws-test-001 \
		-H "Content-Type: application/json" \
		-d '{"invitees": [{"email": "bob@coca-cola.com", "role": "viewer"}]}' | \
		python3 -m json.tool 2>/dev/null || echo "Service not running. Run: make dev"

compliance: ## Check compliance rules
	@echo "Fetching compliance rules..."
	@curl -s http://localhost:3000/compliance/rules | \
		python3 -m json.tool 2>/dev/null || echo "Service not running. Run: make dev"
