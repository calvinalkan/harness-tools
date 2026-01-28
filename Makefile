# Harness Tools - Coding Agent Customizations
# Single source of truth for all agent extensions, prompts, themes, etc.
#
# Usage:
#   make link     - Create symlinks to install all customizations
#   make unlink   - Remove all symlinks
#   make status   - Show current link status
#   make help     - Show this help

SHELL := /bin/bash
.PHONY: link unlink status help link-pi unlink-pi status-pi link-codex unlink-codex status-codex clean format typecheck check lint

# Directories
HARNESS_DIR := $(shell pwd)
PI_SRC := $(HARNESS_DIR)/packages/pi
PI_DIR := $(HOME)/.pi/agent
CODEX_SRC := $(HARNESS_DIR)/packages/codex/AGENTS.md
CODEX_DIR := $(HOME)/.codex
CODEX_DEST := $(CODEX_DIR)/AGENTS.md

# Colors for output
GREEN := \033[0;32m
RED := \033[0;31m
YELLOW := \033[0;33m
BLUE := \033[0;34m
NC := \033[0m # No Color

help:
	@echo "Harness Tools - Coding Agent Customizations"
	@echo ""
	@echo "Usage:"
	@echo "  make link       Create symlinks to install all customizations"
	@echo "  make unlink     Remove all symlinks"
	@echo "  make status     Show current link status"
	@echo "  make check      Run format and typecheck"
	@echo "  make format     Format code with oxfmt"
	@echo "  make typecheck  Type check with tsgo"
	@echo "  make clean      Remove node_modules"
	@echo ""
	@echo "Agent-specific targets:"
	@echo "  make link-pi    Link only Pi agent customizations"
	@echo "  make unlink-pi  Unlink only Pi agent customizations"
	@echo "  make status-pi  Show Pi agent link status"
	@echo "  make link-codex    Link Codex global AGENTS.md"
	@echo "  make unlink-codex  Unlink Codex global AGENTS.md"
	@echo "  make status-codex  Show Codex AGENTS.md link status"

# ============================================================================
# Main targets
# ============================================================================

link: link-pi link-codex
	@echo -e "$(GREEN)✓ All agent customizations linked$(NC)"

unlink: unlink-pi unlink-codex
	@echo -e "$(GREEN)✓ All agent customizations unlinked$(NC)"

status: status-pi status-codex

clean:
	@echo -e "$(BLUE)Removing node_modules...$(NC)"
	@rm -rf node_modules packages/*/node_modules
	@echo -e "$(GREEN)✓ Cleaned$(NC)"

check: typecheck lint

format:
	@bun run format

typecheck:
	@bun run typecheck

lint:
	@for script in backpressure/*.sh; do \
	   [ -x "$$script" ] || continue; \
	   echo -e "$(BLUE)Running $$script...$(NC)"; \
	   ./$$script || exit 1; \
	done
	@bun run lint

# ============================================================================
# Pi Agent
# ============================================================================

link-pi:
	@echo -e "$(BLUE)Linking Pi agent customizations...$(NC)"
	@mkdir -p "$(PI_DIR)"
	@failed=0; \
	for dir in extensions themes skills prompts; do \
		src="$(PI_SRC)/$$dir"; \
		dest="$(PI_DIR)/$$dir"; \
		[ -d "$$src" ] || continue; \
		if [ -L "$$dest" ]; then \
			target=$$(readlink "$$dest"); \
			if [ "$$target" = "$$src" ]; then \
				echo -e "$(GREEN)  ✓ $$dir (already linked)$(NC)"; \
			else \
				echo -e "$(RED)  ✗ $$dir is linked elsewhere: $$target$(NC)"; \
				failed=1; \
			fi; \
		elif [ -e "$$dest" ]; then \
			echo -e "$(RED)  ✗ $$dir exists and is not a symlink$(NC)"; \
			failed=1; \
		else \
			ln -s "$$src" "$$dest"; \
			echo -e "$(GREEN)  ✓ $$dir$(NC)"; \
		fi; \
	done; \
	src="$(PI_SRC)/AGENTS.md"; \
	dest="$(PI_DIR)/AGENTS.md"; \
	if [ -f "$$src" ]; then \
		if [ -L "$$dest" ]; then \
			target=$$(readlink "$$dest"); \
			if [ "$$target" = "$$src" ]; then \
				echo -e "$(GREEN)  ✓ AGENTS.md (already linked)$(NC)"; \
			else \
				echo -e "$(RED)  ✗ AGENTS.md is linked elsewhere: $$target$(NC)"; \
				failed=1; \
			fi; \
		elif [ -e "$$dest" ]; then \
			echo -e "$(RED)  ✗ AGENTS.md exists and is not a symlink$(NC)"; \
			failed=1; \
		else \
			ln -s "$$src" "$$dest"; \
			echo -e "$(GREEN)  ✓ AGENTS.md$(NC)"; \
		fi; \
	fi; \
	[ $$failed -eq 0 ] || (echo -e "$(RED)Some items could not be linked. Remove or move them first.$(NC)" && exit 1)

unlink-pi:
	@echo -e "$(BLUE)Unlinking Pi agent customizations...$(NC)"
	@for dir in extensions themes skills prompts; do \
		src="$(PI_SRC)/$$dir"; \
		dest="$(PI_DIR)/$$dir"; \
		if [ -L "$$dest" ] && [ "$$(readlink "$$dest")" = "$$src" ]; then \
			rm "$$dest"; \
			echo -e "$(GREEN)  ✓ $$dir$(NC)"; \
		elif [ -L "$$dest" ]; then \
			echo -e "$(YELLOW)  ⚠ $$dir linked elsewhere, skipping$(NC)"; \
		elif [ -e "$$dest" ]; then \
			echo -e "$(YELLOW)  ⚠ $$dir is not a symlink, skipping$(NC)"; \
		else \
			echo -e "$(YELLOW)  ⊘ $$dir (not linked)$(NC)"; \
		fi; \
	done
	@src="$(PI_SRC)/AGENTS.md"; \
	dest="$(PI_DIR)/AGENTS.md"; \
	if [ -L "$$dest" ] && [ "$$(readlink "$$dest")" = "$$src" ]; then \
		rm "$$dest"; \
		echo -e "$(GREEN)  ✓ AGENTS.md$(NC)"; \
	elif [ -L "$$dest" ]; then \
		echo -e "$(YELLOW)  ⚠ AGENTS.md linked elsewhere, skipping$(NC)"; \
	elif [ -e "$$dest" ]; then \
		echo -e "$(YELLOW)  ⚠ AGENTS.md is not a symlink, skipping$(NC)"; \
	else \
		echo -e "$(YELLOW)  ⊘ AGENTS.md (not linked)$(NC)"; \
	fi

status-pi:
	@echo -e "$(BLUE)Pi Agent (~/.pi/agent/)$(NC)"
	@for dir in extensions themes skills prompts; do \
		src="$(PI_SRC)/$$dir"; \
		dest="$(PI_DIR)/$$dir"; \
		[ -d "$$src" ] || continue; \
		if [ -L "$$dest" ]; then \
			target=$$(readlink "$$dest"); \
			if [ "$$target" = "$$src" ]; then \
				echo -e "  $(GREEN)✓$(NC) $$dir → $$src"; \
			else \
				echo -e "  $(YELLOW)⚠$(NC) $$dir → $$target (not ours)"; \
			fi; \
		elif [ -e "$$dest" ]; then \
			echo -e "  $(RED)✗$(NC) $$dir (exists, not a symlink)"; \
		else \
			echo -e "  $(YELLOW)⊘$(NC) $$dir (not linked)"; \
		fi; \
	done
	@src="$(PI_SRC)/AGENTS.md"; \
	dest="$(PI_DIR)/AGENTS.md"; \
	if [ -f "$$src" ]; then \
		if [ -L "$$dest" ]; then \
			target=$$(readlink "$$dest"); \
			if [ "$$target" = "$$src" ]; then \
				echo -e "  $(GREEN)✓$(NC) AGENTS.md → $$src"; \
			else \
				echo -e "  $(YELLOW)⚠$(NC) AGENTS.md → $$target (not ours)"; \
			fi; \
		elif [ -e "$$dest" ]; then \
			echo -e "  $(RED)✗$(NC) AGENTS.md (exists, not a symlink)"; \
		else \
			echo -e "  $(YELLOW)⊘$(NC) AGENTS.md (not linked)"; \
		fi; \
	fi

# ============================================================================
# Codex
# ============================================================================

link-codex:
	@echo -e "$(BLUE)Linking Codex global AGENTS.md...$(NC)"
	@mkdir -p "$(CODEX_DIR)"
	@if [ -L "$(CODEX_DEST)" ]; then \
		target=$$(readlink "$(CODEX_DEST)"); \
		if [ "$$target" = "$(CODEX_SRC)" ]; then \
			echo -e "$(GREEN)  ✓ AGENTS.md (already linked)$(NC)"; \
		else \
			echo -e "$(RED)  ✗ AGENTS.md is linked elsewhere: $$target$(NC)"; \
			exit 1; \
		fi; \
	elif [ -e "$(CODEX_DEST)" ]; then \
		echo -e "$(RED)  ✗ AGENTS.md exists and is not a symlink$(NC)"; \
		exit 1; \
	else \
		ln -s "$(CODEX_SRC)" "$(CODEX_DEST)"; \
		echo -e "$(GREEN)  ✓ AGENTS.md$(NC)"; \
	fi

unlink-codex:
	@echo -e "$(BLUE)Unlinking Codex global AGENTS.md...$(NC)"
	@if [ -L "$(CODEX_DEST)" ] && [ "$$(readlink "$(CODEX_DEST)")" = "$(CODEX_SRC)" ]; then \
		rm "$(CODEX_DEST)"; \
		echo -e "$(GREEN)  ✓ AGENTS.md$(NC)"; \
	elif [ -L "$(CODEX_DEST)" ]; then \
		echo -e "$(YELLOW)  ⚠ AGENTS.md linked elsewhere, skipping$(NC)"; \
	elif [ -e "$(CODEX_DEST)" ]; then \
		echo -e "$(YELLOW)  ⚠ AGENTS.md is not a symlink, skipping$(NC)"; \
	else \
		echo -e "$(YELLOW)  ⊘ AGENTS.md (not linked)$(NC)"; \
	fi

status-codex:
	@echo -e "$(BLUE)Codex (~/.codex/AGENTS.md)$(NC)"
	@if [ -L "$(CODEX_DEST)" ]; then \
		target=$$(readlink "$(CODEX_DEST)"); \
		if [ "$$target" = "$(CODEX_SRC)" ]; then \
			echo -e "  $(GREEN)✓$(NC) AGENTS.md → $(CODEX_SRC)"; \
		else \
			echo -e "  $(YELLOW)⚠$(NC) AGENTS.md → $$target (not ours)"; \
		fi; \
	elif [ -e "$(CODEX_DEST)" ]; then \
		echo -e "  $(RED)✗$(NC) AGENTS.md (exists, not a symlink)"; \
	else \
		echo -e "  $(YELLOW)⊘$(NC) AGENTS.md (not linked)"; \
	fi
