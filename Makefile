# Makefile — opencode-bgrun dev/prod plugin switcher
# Variables
LOCAL_PLUGIN  := /Users/lloyd.engebretsen/sk/opencode-bgrun/plugin/bgrun-wake.js
OPENCODE_CONFIG := $(HOME)/.config/opencode/opencode.json

# Read version from package.json at make-time
VERSION := $(shell node -p "require('./package.json').version")
NPM_ENTRY := @stablekernel/opencode-bgrun@$(VERSION)

.PHONY: help dev prod status test lint install install-cli uninstall

## help: show this usage summary (default target)
help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "Targets:"
	@echo "  dev     Switch OpenCode plugin to local dev path"
	@echo "  prod    Switch OpenCode plugin to npm pin (@stablekernel/opencode-bgrun@$(VERSION))"
	@echo "  status  Show which mode the bgrun plugin is currently in"
	@echo "  install   Run install.sh (full dev install: npm deps + CLI + plugin + skill symlinks)"
	@echo "  install-cli Run install.sh --cli-only (CLI scripts on PATH only)"
	@echo "  uninstall Remove symlinks created by install.sh"
	@echo "  test    Run npm test"
	@echo "  lint    Run npm run lint"
	@echo "  help    Show this message (default)"

## dev: switch plugin to local absolute path
dev:
	@node -e " \
	  const fs = require('fs'); \
	  const path = '$(OPENCODE_CONFIG)'; \
	  const local = '$(LOCAL_PLUGIN)'; \
	  const npm = '@stablekernel/opencode-bgrun'; \
	  const cfg = JSON.parse(fs.readFileSync(path, 'utf8')); \
	  const plugins = cfg.plugin || []; \
	  const idx = plugins.findIndex(p => p === local); \
	  if (idx !== -1) { \
	    console.log('Already in dev mode — no changes made.'); \
	    process.exit(0); \
	  } \
	  const npmIdx = plugins.findIndex(p => p.startsWith(npm)); \
	  if (npmIdx === -1) { \
	    console.error('ERROR: bgrun plugin entry not found in config.'); \
	    process.exit(1); \
	  } \
	  plugins[npmIdx] = local; \
	  cfg.plugin = plugins; \
	  fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n'); \
	  console.log('✓ Plugin set to local path. Restart OpenCode to pick up changes.'); \
	"

## prod: switch plugin to npm pin
prod:
	@node -e " \
	  const fs = require('fs'); \
	  const path = '$(OPENCODE_CONFIG)'; \
	  const local = '$(LOCAL_PLUGIN)'; \
	  const entry = '$(NPM_ENTRY)'; \
	  const npm = '@stablekernel/opencode-bgrun'; \
	  const cfg = JSON.parse(fs.readFileSync(path, 'utf8')); \
	  const plugins = cfg.plugin || []; \
	  const idx = plugins.findIndex(p => p === entry); \
	  if (idx !== -1) { \
	    console.log('Already in prod mode — no changes made.'); \
	    process.exit(0); \
	  } \
	  const localIdx = plugins.findIndex(p => p === local); \
	  const npmIdx = plugins.findIndex(p => p.startsWith(npm)); \
	  const targetIdx = localIdx !== -1 ? localIdx : npmIdx; \
	  if (targetIdx === -1) { \
	    console.error('ERROR: bgrun plugin entry not found in config.'); \
	    process.exit(1); \
	  } \
	  plugins[targetIdx] = entry; \
	  cfg.plugin = plugins; \
	  fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n'); \
	  console.log('✓ Plugin set to $(NPM_ENTRY). Restart OpenCode to pick up changes.'); \
	"

## status: show current bgrun plugin mode
status:
	@node -e " \
	  const fs = require('fs'); \
	  const path = '$(OPENCODE_CONFIG)'; \
	  const local = '$(LOCAL_PLUGIN)'; \
	  const npm = '@stablekernel/opencode-bgrun'; \
	  const cfg = JSON.parse(fs.readFileSync(path, 'utf8')); \
	  const plugins = cfg.plugin || []; \
	  const entry = plugins.find(p => p === local || p.startsWith(npm)); \
	  if (!entry) { \
	    console.log('bgrun plugin: UNKNOWN (not found in config)'); \
	  } else if (entry === local) { \
	    console.log('bgrun plugin: LOCAL (dev mode) \u2192 ' + local); \
	  } else { \
	    console.log('bgrun plugin: NPM \u2192 ' + entry); \
	  } \
	"

## install: full dev install (npm deps + CLI + plugin + skill symlinks)
install:
	./install.sh

## install-cli: CLI scripts on PATH only (for npm plugin users)
install-cli:
	./install.sh --cli-only

## uninstall: remove symlinks created by install.sh
uninstall:
	./uninstall.sh

## test: run npm test
test:
	npm test

## lint: run npm run lint
lint:
	npm run lint
