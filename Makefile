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
