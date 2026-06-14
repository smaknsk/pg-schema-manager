-include .env
export

# Default values if not specified in .env
POSTGRES_DB ?= postgres
POSTGRES_USER ?= postgres
POSTGRES_PASSWORD ?= postgres
POSTGRES_HOST ?= localhost
POSTGRES_PORT ?= 5432
COMPOSE_FILE ?= compose.yaml

DATABASE_URL ?= postgresql://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@$(POSTGRES_HOST):$(POSTGRES_PORT)/$(POSTGRES_DB)

help: ## Show help message
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage: make <command> [command] [command]...\n\nCommands: \033[36m\033[0m\n"} /^[$$()% 0-9a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } ' $(MAKEFILE_LIST)

up: ## Start the postgres container
	docker compose -f $(COMPOSE_FILE) up -d postgres
	sleep 1

downv: ## Stop postgres container and remove its volume
	docker compose -f $(COMPOSE_FILE) down -v postgres

plan: ## Initialize database schema directly from declarative plan.sql
	psql "$(DATABASE_URL)" --variable=ON_ERROR_STOP=1 --file=src/schemas/plan.sql

reset: downv up ## Reset database (delete data and restart)

migrate: ## Run pending SQL migrations
	sh bin/migrate.sh

new: ## Create a new migration file: make new migration_name
	@NAME=$(filter-out $@,$(MAKECMDGOALS)); \
	if [ -z "$$NAME" ]; then echo "Error: migration name is required. Usage: make new migration_name"; exit 1; fi; \
	FILE="src/migrations/$$(date +%Y%m%d%H%M%S)--$$NAME.sql"; \
	touch $$FILE; \
	echo "Created $$FILE"

minc: ## Rewrite/compile includes in the last migration file
	sh bin/migrate-includes.sh

seeds: ## Run seeds plan.sql
	psql "$(DATABASE_URL)" --variable=ON_ERROR_STOP=1 --file=src/seeds/plan.sql

regenerate: ## Regenerate all schemas from postgres database metadata
	node bin/regenerate-schemas.js

dump-seeds: ## Dump seed data from database tables based on seeds plan.sql
	sh bin/dump-seeds.sh

trigger-updated_at: ## Generate updated_at triggers for a schema: make trigger-updated_at schema_name
	@SCHEMA=$(filter-out $@,$(MAKECMDGOALS)); \
	if [ -z "$$SCHEMA" ]; then echo "Error: schema name is required. Usage: make trigger-updated_at schema_name"; exit 1; fi; \
	sh bin/trigger-updated_at.sh $$SCHEMA

rms: reset migrate seeds ## Full reset: restart database, run all migrations, apply seeds
rps: reset plan seeds ## Fast reset: restart database, run declarative plan.sql, apply seeds

%:
	@:
