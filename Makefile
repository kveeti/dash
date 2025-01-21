ifneq (,$(wildcard ./.env))
	include .env
	export
endif

.PHONY: all

frontdev: 
	@cd front && pnpm dev

backdev:
	@cd back && pnpm dev

dev: 
	@make -j2 backdev frontdev

frontbuild:
	@cd front && pnpm build

backbuild:
	@cd back && pnpm build

build:
	@make -j2 backbuild frontbuild

frontpre:
	@cd front && pnpm preview

backpre:
	@cd back && pnpm preview

pre:
	@make -j2 backpre frontpre

db:
	@docker exec -it dash_db psql -U pg -d db
