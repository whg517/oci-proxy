.PHONY: dev deploy test test-e2e test-docker-hub test-kind clean-e2e clean help

# ─── Variables ────────────────────────────────────────────────────
PROXY_URL  ?= https://docker.example.com
NODE_BIN   := node_modules/.bin

# ─── Development ─────────────────────────────────────────────────

dev: ## Start local dev server (http://localhost:8787)
	npx wrangler dev

# ─── Deployment ───────────────────────────────────────────────────

deploy: ## Deploy to Cloudflare Workers
	npx wrangler deploy

tail: ## Stream Worker logs
	npx wrangler tail

# ─── Testing ──────────────────────────────────────────────────────

test: test-e2e ## Run all e2e tests

test-e2e: ## Run all e2e test scenarios
	@PROXY_URL=$(PROXY_URL) bash e2e/run.sh all

test-docker-hub: ## Run Docker Hub proxy e2e tests only
	@PROXY_URL=$(PROXY_URL) bash e2e/run.sh docker-hub

test-kind: ## Run Kind cluster e2e tests only
	@PROXY_URL=$(PROXY_URL) bash e2e/run.sh kind

# ─── Cleanup ──────────────────────────────────────────────────────

clean-e2e: ## Clean up e2e test resources (kind clusters)
	@PROXY_URL=$(PROXY_URL) bash e2e/kind/03-cleanup.sh

clean: clean-e2e ## Clean up everything

# ─── Help ────────────────────────────────────────────────────────

help: ## Show this help
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Variables:"
	@echo "  PROXY_URL   Proxy URL (default: $(PROXY_URL))"
	@echo "               Usage: make test-docker-hub PROXY_URL=https://docker.example.com"

.DEFAULT_GOAL := help
