.DEFAULT_GOAL := help

RUN ?=

help: ## Affiche cette aide
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

install: ## Installe les dépendances
	$(RUN) yarn install --frozen-lockfile

dev: ## Lance le serveur statique de développement (http://localhost:4098)
	$(RUN) yarn dev

include Makefile.qa.mk

.PHONY: help install dev
