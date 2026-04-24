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

sqlitebuild:
	@./scripts/build-sqlite-wasm-smc-local.sh

frontdev:
	@cd front && bun run dev
backdev:
	@cd back && cargo watch -x run
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

an:
	@cd front && BUNDLE_ANALYZE=true bun run build && open dist/report-web.html
