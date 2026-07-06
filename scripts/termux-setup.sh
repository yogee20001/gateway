#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
# AI Gateway — Termux Android Setup Script
# ============================================================
# Run this script in Termux to automatically set up and
# start the AI Gateway on your Android phone.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/yourusername/ai-gateway/main/scripts/termux-setup.sh | bash
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
NC='\033[0m' # No Color

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   🚀 AI Gateway — Termux Android Setup                      ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

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

REPO_URL="${1:-https://github.com/yourusername/ai-gateway.git}"
TARGET_DIR="$HOME/ai-gateway"

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
# Step 5: Install npm Dependencies
# ============================================================
echo ""
echo -e "${BLUE}[5/7]${NC} Installing npm dependencies..."
npm install
echo -e "${GREEN}✓${NC} Dependencies installed"

# ============================================================
# Step 6: Create Helper Scripts
# ============================================================
echo ""
echo -e "${BLUE}[6/7]${NC} Creating helper scripts..."

# Start script
cat > "$TARGET_DIR/start.sh" << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# Start AI Gateway
cd "$(dirname "$0")"
echo "Starting AI Gateway..."
echo "Dashboard: http://localhost:8787"
echo "API:       http://localhost:8787/v1"
echo ""
npx tsx src/index.ts
EOF
chmod +x "$TARGET_DIR/start.sh"

# Start in background script
cat > "$TARGET_DIR/start-bg.sh" << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# Start AI Gateway in background (tmux)
cd "$(dirname "$0")"
SESSION="gateway"

if tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "Gateway is already running in tmux session '$SESSION'"
    echo "Reattach: tmux attach -t $SESSION"
    exit 0
fi

tmux new-session -d -s "$SESSION" "cd $(pwd) && npx tsx src/index.ts"
echo "✅ AI Gateway started in background (tmux session: $SESSION)"
echo "   Dashboard: http://localhost:8787"
echo "   API:       http://localhost:8787/v1"
echo ""
echo "   Commands:"
echo "   - View logs:  tmux attach -t $SESSION"
echo "   - Detach:     Ctrl+B, D"
echo "   - Stop:       tmux kill-session -t $SESSION"
EOF
chmod +x "$TARGET_DIR/start-bg.sh"

# Stop script
cat > "$TARGET_DIR/stop.sh" << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# Stop AI Gateway
SESSION="gateway"

if tmux has-session -t "$SESSION" 2>/dev/null; then
    tmux kill-session -t "$SESSION"
    echo "✅ AI Gateway stopped"
else
    # Try killing node process directly
    PID=$(pgrep -f "tsx src/index.ts" 2>/dev/null || true)
    if [ -n "$PID" ]; then
        kill "$PID" 2>/dev/null
        echo "✅ AI Gateway stopped (PID: $PID)"
    else
        echo "ℹ AI Gateway is not running"
    fi
fi
EOF
chmod +x "$TARGET_DIR/stop.sh"

# Status script
cat > "$TARGET_DIR/status.sh" << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# Check AI Gateway status
SESSION="gateway"

if tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "✅ AI Gateway is RUNNING"
    echo "   Dashboard: http://localhost:8787"
    echo "   API:       http://localhost:8787/v1"
    echo ""
    echo "   To view logs: tmux attach -t $SESSION"
else
    PID=$(pgrep -f "tsx src/index.ts" 2>/dev/null || true)
    if [ -n "$PID" ]; then
        echo "✅ AI Gateway is RUNNING (PID: $PID, no tmux session)"
    else
        echo "❌ AI Gateway is NOT running"
        echo "   Start it: bash start.sh or bash start-bg.sh"
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

# Remote access script
cat > "$TARGET_DIR/start-remote.sh" << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# Start AI Gateway accessible from other devices on the network
cd "$(dirname "$0")"

# Get IP address
IP=$(ip addr show wlan0 2>/dev/null | grep -E "inet " | awk '{print $2}' | cut -d/ -f1)
if [ -z "$IP" ]; then
    IP="<your-phone-ip>"
fi

echo "Starting AI Gateway on ALL network interfaces..."
echo "⚠  This exposes the gateway to everyone on your network!"
echo ""
echo "   Dashboard: http://$IP:8787"
echo "   API:       http://$IP:8787/v1"
echo ""

# Start with HOST=0.0.0.0 to bind to all interfaces
HOST=0.0.0.0 npx tsx src/index.ts
EOF
chmod +x "$TARGET_DIR/start-remote.sh"

echo -e "${GREEN}✓${NC} Helper scripts created:"
echo "   ./start.sh        — Start in foreground"
echo "   ./start-bg.sh     — Start in background (tmux)"
echo "   ./stop.sh         — Stop the gateway"
echo "   ./status.sh       — Check if running"
echo "   ./start-remote.sh — Start with network access"

# ============================================================
# Step 7: Create Boot Script (Optional)
# ============================================================
echo ""
echo -e "${BLUE}[7/7]${NC} Setting up auto-start on boot..."

BOOT_DIR="$HOME/.termux/boot"
mkdir -p "$BOOT_DIR"

cat > "$BOOT_DIR/ai-gateway.sh" << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# AI Gateway — Auto-start on device boot
# Installed by termux-setup.sh

# Wait for network to be available
sleep 15

# Start gateway in tmux session
cd ~/ai-gateway
tmux new-session -d -s gateway 'npx tsx src/index.ts' 2>/dev/null

# Optional: Show notification that gateway started
if command -v termux-notification &> /dev/null; then
    termux-notification \
        --title "AI Gateway" \
        --content "Gateway started on port 8787" \
        --button1 "Open Dashboard" \
        --button1-action "am start -a android.intent.action.VIEW -d http://localhost:8787" \
        --priority high
fi
EOF
chmod +x "$BOOT_DIR/ai-gateway.sh"

echo -e "${GREEN}✓${NC} Boot script created at: $BOOT_DIR/ai-gateway.sh"
echo "   (Requires Termux:Boot from F-Droid to activate)"

# ============================================================
# Summary
# ============================================================
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   ✅ Setup Complete!                                        ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "   AI Gateway is installed at: $TARGET_DIR"
echo ""
echo "   Quick Start:"
echo "   ─────────────────────────────────────────────"
echo "   cd ~/ai-gateway"
echo "   bash start-bg.sh     # Start in background"
echo "   bash status.sh       # Check status"
echo "   bash stop.sh         # Stop the gateway"
echo ""
echo "   Then open http://localhost:8787 in your browser"
echo "   to access the dashboard and add API keys."
echo ""
echo "   For remote access from other devices:"
echo "   bash start-remote.sh"
echo ""
echo "   📖 Full guide: docs/TERMUX-ANDROID-GUIDE.md"
echo ""

# Ask if user wants to start now
read -p "   Start the gateway now? (Y/n): " START_NOW
if [ "$START_NOW" != "n" ] && [ "$START_NOW" != "N" ]; then
    echo ""
    bash "$TARGET_DIR/start-bg.sh"
fi