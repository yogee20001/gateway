#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
# AI Gateway — Termux Android Setup Script (Performance Optimized)
# ============================================================
# Run this script in Termux to automatically set up and
# start the AI Gateway on your Android phone.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/yogee20001/gateway/main/scripts/termux-setup.sh | bash
#
# Or after cloning:
#   bash scripts/termux-setup.sh
# ============================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   🚀 AI Gateway — Termux Android Setup                      ║"
echo "║   Performance Optimized for Mobile                          ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ============================================================
# Auto-detect available RAM for memory budget
# ============================================================
detect_memory_budget() {
    # Try to detect total RAM in MB
    local total_kb=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo "0")
    local total_mb=$((total_kb / 1024))

    if [ "$total_mb" -eq 0 ]; then
        # Fallback: assume 4GB device
        total_mb=4096
    fi

    # Set Node.js heap limit based on available RAM
    # Conservative: use 8-12% of total RAM, clamped between 128MB-768MB
    if [ "$total_mb" -le 3072 ]; then
        # 3GB or less devices (budget phones)
        echo "192"
    elif [ "$total_mb" -le 5120 ]; then
        # 4-5GB devices
        echo "320"
    elif [ "$total_mb" -le 8192 ]; then
        # 6-8GB devices (most common)
        echo "384"
    else
        # 12GB+ devices (flagship)
        echo "512"
    fi
}

MEMORY_BUDGET=$(detect_memory_budget)

# ============================================================
# Step 1: Check Environment
# ============================================================
echo -e "${BLUE}[1/7]${NC} Checking environment..."

# Verify we're in Termux
if [ ! -d "/data/data/com.termux" ] && [ ! -d "/data/data/com.termux.dev" ]; then
    echo -e "${RED}✗ This script must be run inside Termux on Android.${NC}"
    echo "  Download Termux from F-Droid: https://f-droid.org/packages/com.termux/"
    exit 1
fi
echo -e "${GREEN}✓${NC} Running in Termux"

# Check for storage permission
if [ ! -d "$HOME/storage" ]; then
    echo -e "${YELLOW}⚠ Storage permission not yet granted.${NC}"
    echo "  Running termux-setup-storage..."
    termux-setup-storage || true
fi

# ============================================================
# Step 2: Update Packages
# ============================================================
echo ""
echo -e "${BLUE}[2/7]${NC} Updating Termux packages..."
pkg update -y
pkg upgrade -y
echo -e "${GREEN}✓${NC} Packages updated"

# ============================================================
# Step 3: Install Dependencies
# ============================================================
echo ""
echo -e "${BLUE}[3/7]${NC} Installing Node.js, Git, and tools..."
pkg install -y nodejs git tmux curl net-tools
echo -e "${GREEN}✓${NC} Dependencies installed"

# Verify versions
echo ""
echo "  Node.js: $(node --version)"
echo "  npm:     $(npm --version)"
echo "  Git:     $(git --version 2>&1 | head -1)"

# ============================================================
# Step 4: Clone Repository
# ============================================================
echo ""
echo -e "${BLUE}[4/7]${NC} Setting up AI Gateway..."

REPO_URL="${1:-https://github.com/yogee20001/gateway.git}"
TARGET_DIR="$HOME/gateway"

if [ -d "$TARGET_DIR" ]; then
    echo -e "${YELLOW}⚠ Directory $TARGET_DIR already exists.${NC}"
    read -p "  Overwrite? (y/N): " CONFIRM
    if [ "$CONFIRM" = "y" ] || [ "$CONFIRM" = "Y" ]; then
        rm -rf "$TARGET_DIR"
    else
        echo "  Using existing directory."
    fi
fi

if [ ! -d "$TARGET_DIR" ]; then
    echo "  Cloning from $REPO_URL ..."
    git clone "$REPO_URL" "$TARGET_DIR"
    echo -e "${GREEN}✓${NC} Repository cloned"
fi

cd "$TARGET_DIR"

# ============================================================
# Step 5: Install Dependencies & Build for Performance
# ============================================================
echo ""
echo -e "${BLUE}[5/7]${NC} Installing all dependencies and building production bundle..."
npm install --no-fund --no-audit
echo -e "${GREEN}✓${NC} Dependencies installed"

# Pre-build the gateway into a single JS bundle for fastest startup
# This avoids tsx runtime transpilation overhead entirely
echo ""
echo -e "${BLUE}   Building production bundle (no runtime transpilation)...${NC}"
npm run build
echo -e "${GREEN}✓${NC} Production bundle created: dist/index.mjs"

# Show bundle size
BUNDLE_SIZE=$(du -h "dist/index.mjs" 2>/dev/null | cut -f1 || echo "unknown")
echo "   Bundle size: $BUNDLE_SIZE"

# ============================================================
# Step 6: Create Performance-Optimized Helper Scripts
# ============================================================
echo ""
echo -e "${BLUE}[6/7]${NC} Creating performance-optimized helper scripts..."

# Build the NODE_OPTIONS string with detected memory budget
NODE_GC_FLAGS="--optimize-for-size --gc-interval=100 --max-semi-space-size=32"
NODE_MEM_FLAG="--max-old-space-size=${MEMORY_BUDGET}"

# Start script (foreground)
cat > "$TARGET_DIR/start.sh" << EOF
#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
# AI Gateway — Performance-Optimized Start Script (Foreground)
# ============================================================
# Auto-detected memory budget: ${MEMORY_BUDGET}MB
# To adjust: edit NODE_OPTIONS below
# ============================================================

cd "\$(dirname "\$0")"

# ---- Performance Settings (edit to tune) ----
export NODE_ENV=production
export NODE_OPTIONS="${NODE_MEM_FLAG} ${NODE_GC_FLAGS}"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   🚀 AI Gateway — Starting...                               ║"
echo "║   Memory budget: ${MEMORY_BUDGET}MB                          ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "   Dashboard: http://localhost:8787"
echo "   API:       http://localhost:8787/v1"
echo ""

# Use pre-built bundle if available (fastest startup)
if [ -f "dist/index.mjs" ]; then
    exec node dist/index.mjs
else
    # Fallback: use tsx directly (no npx overhead)
    exec node --import tsx/esm src/index.ts
fi
EOF
chmod +x "$TARGET_DIR/start.sh"

# Start in background script (tmux)
cat > "$TARGET_DIR/start-bg.sh" << EOF
#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
# AI Gateway — Performance-Optimized Start Script (Background)
# ============================================================
# Auto-detected memory budget: ${MEMORY_BUDGET}MB
# To adjust: edit NODE_OPTIONS below
# ============================================================

cd "\$(dirname "\$0")"
SESSION="gateway"

if tmux has-session -t "\$SESSION" 2>/dev/null; then
    echo "✅ Gateway is already running in tmux session '\$SESSION'"
    echo "   Reattach: tmux attach -t \$SESSION"
    exit 0
fi

# ---- Performance Settings (edit to tune) ----
export NODE_ENV=production
export NODE_OPTIONS="${NODE_MEM_FLAG} ${NODE_GC_FLAGS}"

# Determine the best way to run
if [ -f "dist/index.mjs" ]; then
    RUN_CMD="cd $(pwd) && node dist/index.mjs"
else
    RUN_CMD="cd $(pwd) && node --import tsx/esm src/index.ts"
fi

tmux new-session -d -s "\$SESSION" "\$RUN_CMD"
echo "✅ AI Gateway started in background (tmux session: \$SESSION)"
echo "   Dashboard: http://localhost:8787"
echo "   API:       http://localhost:8787/v1"
echo "   Memory budget: ${MEMORY_BUDGET}MB"
echo ""
echo "   Commands:"
echo "   - View logs:  tmux attach -t \$SESSION"
echo "   - Detach:     Ctrl+B, D"
echo "   - Stop:       tmux kill-session -t \$SESSION"
EOF
chmod +x "$TARGET_DIR/start-bg.sh"

# Stop script
cat > "$TARGET_DIR/stop.sh" << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
# AI Gateway — Stop Script
# ============================================================
SESSION="gateway"

if tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "⏳ Stopping AI Gateway (tmux session)..."
    tmux kill-session -t "$SESSION"
    echo "✅ AI Gateway stopped"
else
    # Try killing node process directly (matches any gateway process)
    PID=$(pgrep -f "node.*index\.[jt]s" 2>/dev/null || true)
    if [ -n "$PID" ]; then
        echo "⏳ Stopping AI Gateway (PID: $PID)..."
        kill "$PID" 2>/dev/null
        sleep 1
        # Force kill if still running
        kill -0 "$PID" 2>/dev/null && kill -9 "$PID" 2>/dev/null || true
        echo "✅ AI Gateway stopped"
    else
        echo "ℹ AI Gateway is not running"
    fi
fi
EOF
chmod +x "$TARGET_DIR/stop.sh"

# Status script
cat > "$TARGET_DIR/status.sh" << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
# AI Gateway — Status Check Script
# ============================================================
SESSION="gateway"

# Memory usage stats
MEM_USAGE=""

if tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "✅ AI Gateway is RUNNING (tmux)"
    echo "   Dashboard: http://localhost:8787"
    echo "   API:       http://localhost:8787/v1"
    echo ""
    echo "   To view logs: tmux attach -t $SESSION"
else
    PID=$(pgrep -f "node.*index\.[jt]s" 2>/dev/null || true)
    if [ -n "$PID" ]; then
        echo "✅ AI Gateway is RUNNING (PID: $PID)"
        # Show memory usage for the process
        if command -v ps &> /dev/null; then
            RSS=$(ps -o rss= -p "$PID" 2>/dev/null || echo "0")
            MEM_MB=$((RSS / 1024))
            echo "   Memory: ${MEM_MB}MB RSS"
        fi
    else
        echo "❌ AI Gateway is NOT running"
        echo "   Start it: bash start.sh or bash start-bg.sh"
        exit 1
    fi
fi

# Test the API
if command -v curl &> /dev/null; then
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8787/api/ping 2>/dev/null || echo "000")
    if [ "$RESPONSE" = "200" ]; then
        echo "   API ping: OK (HTTP $RESPONSE)"
    else
        echo "   API ping: No response (HTTP $RESPONSE)"
    fi
fi
EOF
chmod +x "$TARGET_DIR/status.sh"

# Remote access info script (0.0.0.0 is now the default, but this shows your IP)
cat > "$TARGET_DIR/start-remote.sh" << EOF
#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
# AI Gateway — Remote Access Helper
# ============================================================
# The gateway now binds to 0.0.0.0 by default.
# This script just helps you find your phone's IP address
# so you can access the dashboard from other devices.
# ============================================================

cd "\$(dirname "\$0")"

# Get IP address
IP=\$(ip addr show wlan0 2>/dev/null | grep -E "inet " | awk '{print \$2}' | cut -d/ -f1)
if [ -z "\$IP" ]; then
    IP="<your-phone-ip>"
fi

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   🌐 Remote Access Info                                     ║"
echo "║                                                              ║"
echo "║   ✅ Gateway is configured to listen on ALL interfaces       ║"
echo "║                                                                ║"
echo "║   📱 On this phone:                                          ║"
echo "║      http://localhost:8787                                    ║"
echo "║                                                              ║"
echo "║   💻 From other devices (same WiFi):                         ║"
echo "║      Dashboard: http://\$IP:8787                                ║"
echo "║      API:       http://\$IP:8787/v1                             ║"
echo "║                                                              ║"
echo "║   ⚠  SECURITY WARNING                                        ║"
echo "║   Anyone on your network can access the gateway.             ║"
echo "║   Restrict to localhost only with:                           ║"
echo "║      HOST=127.0.0.1 bash start.sh                            ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ---- Performance Settings ----
export NODE_ENV=production
export NODE_OPTIONS="${NODE_MEM_FLAG} ${NODE_GC_FLAGS}"

if [ -f "dist/index.mjs" ]; then
    exec node dist/index.mjs
else
    exec node --import tsx/esm src/index.ts
fi
EOF
chmod +x "$TARGET_DIR/start-remote.sh"

echo -e "${GREEN}✓${NC} Performance-optimized helper scripts created:"
echo "   ./start.sh        — Start in foreground (memory: ${MEMORY_BUDGET}MB)"
echo "   ./start-bg.sh     — Start in background (tmux)"
echo "   ./stop.sh         — Stop the gateway"
echo "   ./status.sh       — Check status with memory usage"
echo "   ./start-remote.sh — Start with network access"
echo ""
echo -e "${CYAN}   ⚡ V8 flags: ${NODE_GC_FLAGS}${NC}"

# ============================================================
# Step 7: Create Boot Script (Optional)
# ============================================================
echo ""
echo -e "${BLUE}[7/7]${NC} Setting up auto-start on boot..."

BOOT_DIR="$HOME/.termux/boot"
mkdir -p "$BOOT_DIR"

MEMORY_BUDGET_HEX=$(printf '%d' "$MEMORY_BUDGET")

cat > "$BOOT_DIR/ai-gateway.sh" << EOF
#!/data/data/com.termux/files/usr/bin/bash
# AI Gateway — Auto-start on device boot (Performance Optimized)
# Installed by termux-setup.sh

# Wait for network to be available
sleep 15

export NODE_ENV=production
export NODE_OPTIONS="--max-old-space-size=${MEMORY_BUDGET} --optimize-for-size --gc-interval=100 --max-semi-space-size=32"

cd ~/gateway

if [ -f "dist/index.mjs" ]; then
    tmux new-session -d -s gateway 'node dist/index.mjs' 2>/dev/null
else
    tmux new-session -d -s gateway 'node --import tsx/esm src/index.ts' 2>/dev/null
fi

# Wait for gateway to be ready (up to 30s)
for i in \$(seq 1 30); do
    if curl -s -o /dev/null http://localhost:8787/api/ping 2>/dev/null; then
        GATEWAY_READY=true
        break
    fi
    sleep 1
done

# Show notification with status
if command -v termux-notification &> /dev/null; then
    if [ "\$GATEWAY_READY" = "true" ]; then
        termux-notification \
            --title "AI Gateway ✅" \
            --content "Running on port 8787 (${MEMORY_BUDGET}MB budget)" \
            --button1 "Open Dashboard" \
            --button1-action "am start -a android.intent.action.VIEW -d http://localhost:8787" \
            --priority low
    else
        termux-notification \
            --title "AI Gateway ⚠️" \
            --content "Started but not responding yet on port 8787" \
            --priority high
    fi
fi
EOF
chmod +x "$BOOT_DIR/ai-gateway.sh"

echo -e "${GREEN}✓${NC} Boot script created at: $BOOT_DIR/ai-gateway.sh"
echo "   (Requires Termux:Boot from F-Droid to activate)"

# ============================================================
# Create performance-optimized config template
# ============================================================
if [ ! -f "$TARGET_DIR/config.json" ]; then
    echo ""
    echo -e "${BLUE}   Creating performance-optimized config...${NC}"
    cat > "$TARGET_DIR/config.json" << 'ENDCONFIG'
{
  "port": 8787,
  "host": "0.0.0.0",
  "logLevel": "warn",
  "maxLogEntries": 200,
  "defaultMaxRetries": 2,
  "defaultCooldownMs": 30000,
  "healthCheckIntervalMs": 30000,
  "providers": [
    {
      "id": "openai",
      "name": "OpenAI",
      "baseUrl": "https://api.openai.com/v1",
      "apiKeys": [],
      "keyStrategy": "round-robin",
      "modelPatterns": ["gpt-*", "o1-*", "o3-*", "davinci-*", "text-*"],
      "isActive": false,
      "rateLimit": { "requestsPerWindow": 500, "windowMs": 60000, "maxConcurrent": 4 }
    },
    {
      "id": "anthropic",
      "name": "Anthropic",
      "baseUrl": "https://api.anthropic.com/v1",
      "apiKeys": [],
      "keyStrategy": "round-robin",
      "modelPatterns": ["claude-*"],
      "isActive": false,
      "rateLimit": { "requestsPerWindow": 50, "windowMs": 60000, "maxConcurrent": 2 }
    },
    {
      "id": "google",
      "name": "Google Gemini",
      "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
      "apiKeys": [],
      "keyStrategy": "round-robin",
      "modelPatterns": ["gemini-*", "palm-*"],
      "isActive": false,
      "rateLimit": { "requestsPerWindow": 60, "windowMs": 60000, "maxConcurrent": 2 }
    },
    {
      "id": "nvidia",
      "name": "NVIDIA",
      "baseUrl": "https://integrate.api.nvidia.com/v1",
      "apiKeys": [],
      "keyStrategy": "least-used",
      "modelPatterns": [
        "nvidia/*", "meta/*", "mistralai/*",
        "deepseek-ai/*", "stepfun-ai/*", "minimaxai/*",
        "openai/*", "moonshotai/*", "z-ai/*"
      ],
      "isActive": true,
      "rateLimit": { "requestsPerWindow": 32, "windowMs": 60000, "maxConcurrent": 2 }
    }
  ],
  "warmup": {
    "enabled": true,
    "intervalMs": 120000,
    "warmupModels": [],
    "warmupPrompt": "ping",
    "maxTokens": 1,
    "timeoutMs": 10000,
    "concurrency": 1,
    "skipIfRecentRequest": true,
    "recentRequestWindowMs": 60000,
    "smartWarming": true,
    "priorityIntervalMs": 30000,
    "maxPriorityModels": 3,
    "priorityWindowMs": 600000
  }
}
ENDCONFIG
    echo -e "${GREEN}✓${NC} Performance config created (logLevel: warn, logs: 200, healthCheck: 30s)"
fi

# ============================================================
# Summary
# ============================================================
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   ✅ Setup Complete!                                        ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "   AI Gateway is installed at: $TARGET_DIR"
echo "   Memory budget: ${MEMORY_BUDGET}MB"
echo ""
echo "   ⚡ Performance Optimizations Applied:"
echo "   • V8 memory limit: ${MEMORY_BUDGET}MB (auto-detected from RAM)"
echo "   • GC tuned for mobile: optimize-for-size + gc-interval=100"
echo "   • Pre-built bundle (no tsx overhead at runtime)"
echo "   • Reduced log entries: 200"
echo "   • Health check interval: 30s (saves battery)"
echo "   • Warmup concurrency: 1 (reduced CPU load)"
echo "   • NODE_ENV=production (disables dev paths)"
echo ""
echo "   🌐 Network: Bound to 0.0.0.0 (all interfaces) by default"
echo "   🔒 To restrict to localhost only: HOST=127.0.0.1 bash start.sh"
echo ""
echo "   Quick Start:"
echo "   ─────────────────────────────────────────────"
echo "   cd ~/gateway"
echo "   bash start-bg.sh     # Start in background"
echo "   bash status.sh       # Check status"
echo "   bash stop.sh         # Stop the gateway"
echo ""
echo "   Then open http://localhost:8787 in your browser"
echo "   to access the dashboard and add API keys."
echo ""
echo "   From other devices on your WiFi:"
echo "   bash start-remote.sh (shows your phone's IP address)"
echo ""
echo "   📖 Full guide: docs/TERMUX-ANDROID-GUIDE.md"
echo "   ⚡ Fine-tune: Edit config.json or NODE_OPTIONS in start.sh"
echo ""

# Ask if user wants to start now
read -p "   Start the gateway now? (Y/n): " START_NOW
if [ "$START_NOW" != "n" ] && [ "$START_NOW" != "N" ]; then
    echo ""
    bash "$TARGET_DIR/start-bg.sh"
fi