ifneq (,$(wildcard ./.env))
	include .env
	export
endif

.PHONY: all

mocks:
	@cd mock_integrations && bun --watch --no-clear-screen src/index.ts

frontdev:
	@cd front && bun run dev

backdev:
	@cd back && cargo watch -x run

dev: 
	@make -j3 backdev frontdev mocks

frontbuild:
	@cd front && bun run build

backbuild:
	@cd back && cargo build --release

build:
	@make -j2 backbuild frontbuild

frontpre:
	@cd front && bun run build && bun run preview

backpre:
	@cd back && cargo run --release

pre:
	@make -j2 backpre frontpre

db:
	@docker exec -it dash_db psql -U pg -d db -p 35432

dbreset:
	@docker-compose down db -v -t 1 && \
	docker-compose up db -d && \
	sleep 2 && \
	cd back && sqlx migrate run

up:
	@docker compose up -d

trace:
	@docker compose --profile trace up -d

down:
	@docker compose --profile trace down -v -t 1

an:
	@cd front && BUNDLE_ANALYZE=true bun run build && open dist/report-web.html

e2e:
	@cd back && cargo run &
	bash -c 'for i in {1..30}; do curl -s http://localhost:8000/api/health && break || (sleep 1 && echo "Waiting for server..."); done'
	cd front && bunx playwright test --ui
	pkill -f backend
