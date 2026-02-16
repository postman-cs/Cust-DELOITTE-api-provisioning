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
	@echo "$(GREEN)Setting up Deloitte API Provisioning Platform...$(RESET)"
	@if [ ! -f service/.env ]; then \
		cp .env.example service/.env; \
		echo "  Created service/.env from .env.example"; \
	else \
		echo "  service/.env already exists, skipping"; \
	fi
	@cd service && npm install --silent
	@echo "  Dependencies installed"
	@cd service && npx tsc --noEmit 2>/dev/null && echo "  TypeScript compiles cleanly" || echo "  Warning: TypeScript errors detected"
	@cd service && npm test -- --silent 2>/dev/null && echo "  All tests pass" || echo "  Warning: Some tests failed"
	@echo ""
	@echo "$(GREEN)Setup complete!$(RESET) Run $(BOLD)make dev$(RESET) to start the service."

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
