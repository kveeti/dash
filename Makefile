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

dbreset:
	@docker compose down -v -t 1 && docker compose up -d

an:
	@cd front && BUNDLE_ANALYZE=true pnpm build && open dist/report-web.html

backdepl:
	@cd back && \
		docker context use orbstack && \
		docker build . -t veetik/dash_backend:$(shell git rev-parse HEAD) && \
		docker push veetik/dash_backend:$(shell git rev-parse HEAD) && \
		cd .. && \
		docker context use SERVU && \
		COMMIT_SHA=$(shell git rev-parse HEAD) docker stack deploy -c stack.yml dash && \
		docker context use orbstack

frontdepl:
	@cd front && pnpm depl

depl:
	@make -j2 backdepl frontdepl