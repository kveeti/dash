ifneq (,$(wildcard ./.env))
	include .env
	export
endif

.PHONY: all

frontdev: 
	@cd front2 && bun run dev

backdev:
	@cd back2 && cargo watch -x run

dev: 
	@make -j2 backdev frontdev

frontbuild:
	@cd front2 && bun run build

backbuild:
	@cd back && cargo build --release

build:
	@make -j2 backbuild frontbuild

frontpre:
	@cd front2 && bun run preview

backpre:
	@cd back && cargo run --release

pre:
	@make -j2 backpre frontpre

db:
	@docker exec -it dash_db psql -U pg -d db

dbreset:
	@docker-compose down -v -t 1 && \
	docker-compose up -d && \
	sleep 2 && \
	cd back2 && sqlx migrate run

an:
	@cd front && BUNDLE_ANALYZE=true pnpm build && open dist/report-web.html

backdepl:
	@docker build ./back2 -t veetik/dash_backend:$(shell git rev-parse HEAD) && \
		docker push veetik/dash_backend:$(shell git rev-parse HEAD) && \
		COMMIT_SHA=$(shell git rev-parse HEAD) docker --context=SERVU stack deploy -c stack.yml dash

frontdepl:
	@cd front && pnpm depl

depl:
	@make -j2 backdepl frontdepl

e2e:
	@cd back2 && cargo run &
	bash -c 'for i in {1..30}; do curl -s http://localhost:8000/api/health && break || (sleep 1 && echo "Waiting for server..."); done'
	cd front2 && bunx playwright test --ui
	pkill -f backend
