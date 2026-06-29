ifneq (,$(wildcard ./.env))
	include .env
	export
endif

.PHONY: backdev dev
MAKEFLAGS += -j

backdev:
	@cd backend && go run .

# dev: backdev frontdev   # frontdev added later
dev: backdev
