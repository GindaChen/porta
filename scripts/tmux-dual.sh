#!/bin/bash
# Dual Porta deployment: stable + dev
# Usage: bash scripts/tmux-dual.sh

set -e

STABLE_DIR="/Users/jundac/Projects/porta-stable"
DEV_DIR="/Users/jundac/Projects/porta"
SESSION="porta"

# Kill existing session if any
tmux kill-session -t "$SESSION" 2>/dev/null || true
sleep 1

# Create session with first window: stable proxy
tmux new-session -d -s "$SESSION" -n "stable-proxy" \
  "cd $STABLE_DIR && pnpm --filter @porta/proxy dev; read"

# Window 1: stable web (preview = production build served by Vite)
tmux new-window -t "$SESSION" -n "stable-web" \
  "cd $STABLE_DIR && pnpm --filter @porta/web preview; read"

# Window 2: dev proxy
tmux new-window -t "$SESSION" -n "dev-proxy" \
  "cd $DEV_DIR && pnpm --filter @porta/proxy dev; read"

# Window 3: dev web (Vite dev server with HMR)
tmux new-window -t "$SESSION" -n "dev-web" \
  "cd $DEV_DIR && pnpm --filter @porta/web dev; read"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  Dual Porta deployment started!                  ║"
echo "║                                                  ║"
echo "║  Stable: http://100.86.10.16:5175  (production)  ║"
echo "║  Dev:    http://100.86.10.16:5174  (HMR)         ║"
echo "║                                                  ║"
echo "║  tmux attach -t porta                            ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
