qa: lint format-check test-unit ## QA rapide : lint, format, tests unitaires

qa-full: qa test-e2e test-a11y ## QA complète

lint: ## html-validate, stylelint, ESLint
	$(RUN) yarn lint

lint-fix: ## Corrections automatiques CSS/JS
	$(RUN) yarn lint:fix

format: ## Prettier (écriture)
	$(RUN) yarn format

format-check: ## Prettier (vérification)
	$(RUN) yarn format:check

test: test-unit test-e2e test-a11y ## Tous les tests

test-unit: ## Tests unitaires (node:test)
	$(RUN) yarn test:unit

test-e2e: ## Tests end-to-end (Playwright)
	$(RUN) yarn test:e2e

test-a11y: ## Tests d'accessibilité (axe-core + Playwright)
	$(RUN) yarn test:a11y

.PHONY: qa qa-full lint lint-fix format format-check test test-unit test-e2e test-a11y
