PROD_COMPOSE = docker compose --env-file .env.production -f docker-compose.prod.yml
LOCAL_COMPOSE = docker compose

.PHONY: prod-up prod-down prod-logs prod-ps prod-health prod-smoke prod-migrate prod-backup-db local-up local-down

prod-up:
	$(PROD_COMPOSE) up -d --build

prod-down:
	$(PROD_COMPOSE) down

prod-logs:
	$(PROD_COMPOSE) logs -f --tail=200

prod-ps:
	$(PROD_COMPOSE) ps

prod-health:
	API_DOMAIN=$$(grep -E '^API_DOMAIN=' .env.production | cut -d= -f2-); \
	curl -fsS https://$$API_DOMAIN/health; \
	curl -fsS https://$$API_DOMAIN/ready

prod-smoke:
	./scripts/smoke_check.sh

prod-migrate:
	$(PROD_COMPOSE) exec api python -c "from app.db import init_db; init_db(); print('schema ready')"

prod-backup-db:
	./scripts/backup_db.sh

local-up:
	$(LOCAL_COMPOSE) up -d --build

local-down:
	$(LOCAL_COMPOSE) down
