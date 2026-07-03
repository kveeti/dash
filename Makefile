ifneq (,$(wildcard ./.env))
	include .env
	export
endif

.PHONY: all
MAKEFLAGS += -j

backdev:
	@cd backend && go run .

# Mock OIDC provider for local login (see backend/cmd/devidp). Point OIDC_ISSUER at it.
devidp:
	@cd backend && go run ./cmd/devidp

frontdev:
	@cd frontend && pnpm run dev

dev: backdev frontdev

devi: devidp backdev frontdev

build-frontend:
	@cd frontend && pnpm install && pnpm run build

# Builds the frontend into backend/webdist, then the backend binary with it embedded.
build: build-frontend
	@cd backend && go build -o ../dist/dash .
