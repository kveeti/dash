ifneq (,$(wildcard ./.env))
	include .env
	export
endif

.PHONY: all
MAKEFLAGS += -j

frontinit:
	@cd front && bun install
backinit:
	@cd back && cargo fetch
	@cargo install sqlx-cli --no-default-features --features postgres
	@cargo install cargo-watch
init: backinit frontinit

mocks:
	@cd mock_integrations && bun --watch --no-clear-screen src/index.ts

frontdev:
	@cd react-local && bun run dev
backdev:
	@cd sync && cargo watch -x 'run'
dev: backdev frontdev

frontbuild:
	@cd front && bun run build
backbuild:
	@cd back && cargo build --release
build: backbuild frontbuild

frontpre:
	@cd front && bun run build && bun run preview
backpre:
	@cd back && cargo run --release
pre: backpre frontpre

db:
	@psql -U postgres -d postgres -h localhost -p 5556

dbreset:
	cd back && cargo sqlx migrate run

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
