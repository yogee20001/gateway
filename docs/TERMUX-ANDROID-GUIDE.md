# Running AI Gateway on Android via Termux

> Complete step-by-step guide to run the AI Gateway on your Android phone using Termux.

---

## Table of Contents

1. [What is Termux?](#1-what-is-termux)
2. [Installation](#2-installation)
3. [Setup & Run](#3-setup--run)
4. [Accessing the Gateway](#4-accessing-the-gateway)
5. [Background Running](#5-background-running)
6. [Auto-Start on Boot](#6-auto-start-on-boot)
7. [Remote Access (Other Devices)](#7-remote-access-other-devices)
8. [Troubleshooting](#8-troubleshooting)
9. [Advanced: Using with AI Chat Apps](#9-advanced-using-with-ai-chat-apps)
10. [Performance Tips](#10-performance-tips)

---

## 1. What is Termux?

[Termux](https://termux.com/) is a free, open-source terminal emulator for Android that provides a Linux environment. It allows you to run Node.js, Python, Git, and thousands of other Linux packages directly on your phone — no root required.

**Why Termux for AI Gateway?**
- ✅ **Zero code changes** — the gateway runs exactly as-is
- ✅ Full Node.js compatibility (HTTP server, file I/O, streaming)
- ✅ Can run in background while you use other apps
- ✅ Can be accessed from other devices on your network
- ✅ Free and open-source

---

## 2. Installation

### Step 1: Install Termux

> ⚠️ **IMPORTANT**: Install Termux from **F-Droid**, NOT the Google Play Store. The Play Store version is outdated and no longer maintained.

1. **Install F-Droid** (if you don't have it):
   - Download from: https://f-droid.org/
   - Open the downloaded APK and install it
   - You may need to enable "Install from unknown apps" in your settings

2. **Open F-Droid** and search for **Termux**

3. **Install Termux** (the main app, not Termux:API or Termux:Boot yet)

4. **Open Termux** — you'll see a command-line interface

### Step 2: Grant Storage Permission

Termux needs storage access to work with files:

```bash
# Allow Termux to access your phone's storage
termux-setup-storage
```

A permission dialog will appear — tap **Allow**.

This creates a `~/storage` directory linking to your phone's shared storage.

### Step 3: Update Packages

```bash
# Update package lists
pkg update

# Upgrade all installed packages
pkg upgrade -y
```

Press **Enter** when prompted to confirm upgrades. This may take 2-5 minutes.

### Step 4: Install Node.js and Git

```bash
# Install Node.js (includes npm)
pkg install nodejs -y

# Install Git (for cloning the repository)
pkg install git -y
```

**Verify installation:**
```bash
node --version
# Should show: v22.x.x or similar

npm --version
# Should show: 10.x.x or similar

git --version
# Should show: git version 2.x.x
```

---

## 3. Setup & Run

### Option A: One-Command Automated Setup (Recommended)

The project includes an automated setup script that does everything for you:

```bash
# In Termux, run these 3 commands:
pkg update && pkg upgrade -y
pkg install git -y
git clone https://github.com/yogee20001/gateway.git
cd gateway
bash scripts/termux-setup.sh
```

The script will:
1. ✅ Check you're running in Termux
2. ✅ Update all Termux packages
3. ✅ Install Node.js, Git, tmux, curl, and net-tools
4. ✅ Clone the AI Gateway repository
5. ✅ Install npm dependencies
6. ✅ Create 5 helper scripts (`start.sh`, `start-bg.sh`, `stop.sh`, `status.sh`, `start-remote.sh`)
7. ✅ Create a boot script for auto-start on reboot
8. ✅ Ask if you want to start the gateway now

### Option B: Manual Setup (Step-by-Step)

#### Step 5: Clone the AI Gateway Repository

```bash
# Navigate to your home directory
cd ~

# Clone the repository
git clone https://github.com/yogee20001/gateway.git

# Enter the project directory
cd gateway
```

> 💡 **Tip**: If you want to use your own modified version, you can transfer files via USB or use `scp`/`rsync` to copy the project from your computer to your phone's `~/storage/downloads/` folder, then copy it to Termux:
> ```bash
> cp -r ~/storage/downloads/gateway ~/
> cd ~/gateway
> ```

#### Step 6: Install Dependencies

```bash
# Install project dependencies
npm install
```

This installs `itty-router`, `esbuild`, `tsx`, `typescript`, and `vitest`. Takes about 30-60 seconds.

#### Step 7: Start the Gateway

For the **fastest startup** (recommended), first build the production bundle, then run it directly:

```bash
# Build the production bundle (one-time, or after code changes)
npm run build

# Start the pre-built bundle (~0.3 second startup 🚀)
node dist/index.mjs
```

Or use the helper script with performance settings:

```bash
# Use the optimized start script
bash start.sh
```

You should see:

```
╔══════════════════════════════════════════════════════════════╗
║   🚀 AI Gateway v1.0.0                                     ║
║                                                              ║
║   Dashboard:  http://localhost:8787                        ║
║   API:        http://localhost:8787/v1                     ║
║                                                              ║
║   ⚠ No API keys configured!                                ║
║   Open the dashboard to add your API keys.                 ║
║                                                              ║
║   Test:  curl http://localhost:8787/api/ping               ║
╚══════════════════════════════════════════════════════════════╝
```

🎉 **The gateway is now running on your Android phone!**

> 💡 **Performance tip**: The pre-built bundle (`dist/index.mjs`) starts in **~0.3 seconds** vs **~3 seconds** with `npm start`. It also uses ~40% less memory since `tsx` doesn't run at runtime.

---

## 4. Accessing the Gateway

### On the Same Phone (Browser)

1. **Open Chrome** (or any browser) on your Android phone
2. **Navigate to**: `http://localhost:8787`
3. You'll see the **AI Gateway Dashboard**

### Test the API

While the gateway is running, open a **new Termux session** (swipe from left edge or open a new tab) and run:

```bash
# Test ping endpoint
curl http://localhost:8787/api/ping

# Expected response:
# {"status":"ok","timestamp":...,"uptime":...,"providers":6,"models":6}
```

### Add API Keys

1. Open `http://localhost:8787` in your browser
2. Click on a provider card (e.g., OpenAI)
3. Enter your API key(s)
4. Click **Save**
5. The gateway is now ready to route requests

---

## 5. Background Running

The gateway stops when you close Termux. Here's how to keep it running:

### Option A: Using tmux (Recommended)

```bash
# Install tmux (terminal multiplexer)
pkg install tmux -y

# Use the optimized background script
cd ~/gateway
bash start-bg.sh

# Or manually:
tmux new -s gateway
# Inside tmux, start with pre-built bundle:
cd ~/gateway
NODE_OPTIONS="--max-old-space-size=384 --optimize-for-size" node dist/index.mjs
```

**Detach from tmux** (gateway keeps running):
- Press `Ctrl+B`, then release, then press `D`

**Reattach to tmux** (see the gateway output):
```bash
tmux attach -t gateway
```

**List all tmux sessions:**
```bash
tmux ls
```

**Kill a tmux session:**
```bash
tmux kill-session -t gateway
```

### Option B: Using nohup

```bash
# Start in background, output to a log file
cd ~/gateway
nohup npm start > gateway.log 2>&1 &

# Check if it's running
ps aux | grep node

# View logs
tail -f gateway.log

# Stop the background process
kill $(pgrep -f "tsx src/index.ts")
```

### Option C: Using Termux:API with Wake Lock

Install Termux:API from F-Droid, then:

```bash
# Install Termux:API package
pkg install termux-api -y

# Acquire wake lock (prevents CPU sleep)
termux-wake-lock

# Start gateway
cd ~/gateway
npm start
```

To release wake lock when done:
```bash
termux-wake-unlock
```

---

## 6. Auto-Start on Boot

### Step 1: Install Termux:Boot

1. Open **F-Droid**
2. Search for and install **Termux:Boot**
3. Open Termux:Boot at least once (it creates the `~/.termux/boot/` directory)

### Step 2: Create Boot Script

```bash
# Create the boot directory
mkdir -p ~/.termux/boot/

# Create a startup script
cat > ~/.termux/boot/gateway.sh << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# AI Gateway — Auto-start on boot

# Wait for network
sleep 10

# Start gateway in tmux
cd ~/gateway
tmux new-session -d -s gateway 'npm start'

# Optional: acquire wake lock to prevent sleep
# termux-wake-lock
EOF

# Make it executable
chmod +x ~/.termux/boot/gateway.sh
```

### Step 3: Test the Boot Script

```bash
# Run the script manually to verify it works
bash ~/.termux/boot/gateway.sh

# Check if gateway started
tmux attach -t gateway
```

Now the gateway will start automatically every time you reboot your phone!

---

## 7. Remote Access (Other Devices)

The gateway now **binds to all network interfaces (`0.0.0.0`) by default**, meaning any device on your WiFi network can access it. This section shows you how to find your phone's IP and connect from other devices.

> ⚠️ **Important Security Note**: Binding to `0.0.0.0` exposes the gateway to **everyone on your network**. Anyone who knows your phone's IP can use your API keys. Only do this on trusted networks (your home WiFi). If you want to restrict access to only your phone, see [Restricting to Localhost](#restricting-to-localhost) at the bottom of this section.

### Step 1: Find Your Phone's IP Address

```bash
# In Termux, run:
ip addr show wlan0 | grep -E "inet " | awk '{print $2}'

# Or use the helper script (also shows your IP):
bash start-remote.sh
```

Look for the `wlan0` interface — the IP typically looks like `192.168.x.x`.

### Step 2: Access from Other Devices

On your laptop, tablet, or another phone (on the same WiFi):

```
Dashboard: http://192.168.1.XXX:8787
API:       http://192.168.1.XXX:8787/v1
```

Replace `192.168.1.XXX` with your phone's actual IP address.

### Step 3: Use with OpenAI SDK from Any Device

```python
# On your laptop
from openai import OpenAI

client = OpenAI(
    base_url="http://192.168.1.XXX:8787/v1",
    api_key="not-needed"
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello from my laptop!"}]
)
print(response.choices[0].message.content)
```

### Restricting to Localhost

If you want to revert to localhost-only access (only your phone can reach the gateway):

```bash
# Method 1: Environment variable override
HOST=127.0.0.1 bash start.sh

# Method 2: Permanent change via config.json
# Edit config.json and add: "host": "127.0.0.1"

# Method 3: Verify the binding
netstat -tlnp | grep 8787
# Should show: 127.0.0.1:8787 (not 0.0.0.0:8787)
```

---

## 8. Troubleshooting

### "Command not found" errors

```bash
# Update package lists and reinstall
pkg update
pkg upgrade -y
pkg install nodejs -y
```

### "EACCES: permission denied" on port 8787

Port 8787 is above 1024, so it shouldn't require root. If you see this:

```bash
# Check if something else is using the port
pkg install net-tools -y
netstat -tlnp | grep 8787

# Kill the process using the port
kill $(lsof -t -i:8787)
```

### Gateway starts but browser shows "Connection refused"

```bash
# Make sure the gateway is actually running
ps aux | grep node

# Check if it's listening
pkg install net-tools -y
netstat -tlnp | grep 8787

# Try accessing via curl in Termux
curl http://localhost:8787/api/ping
```

### "npm install" fails

```bash
# Clear npm cache
npm cache clean --force

# Try again
npm install

# If still failing, try with legacy peer deps
npm install --legacy-peer-deps
```

### Battery optimization kills the gateway

Android may kill background processes to save battery:

1. **Go to Settings → Apps → Termux → Battery**
2. Select **"Unrestricted"** (or "Don't optimize")
3. This prevents Android from killing Termux in the background

### "Process completed" / Termux exits immediately

```bash
# This happens when the shell process exits. Use tmux:
pkg install tmux -y
tmux new -s gateway
# Then start the gateway inside tmux
cd ~/gateway && npm start
# Ctrl+B, D to detach — gateway keeps running
```

### Can't access from other devices

```bash
# Verify your phone's IP
ip addr show wlan0 | grep "inet "

# Verify gateway is listening on 0.0.0.0
netstat -tlnp | grep 8787
# Should show: 0.0.0.0:8787 (not 127.0.0.1:8787)

# Check if firewall is blocking
# Android typically doesn't have a firewall, but check:
# Settings → Network & Internet → Firewall (if available)
```

---

## 9. Updating the Gateway

When a new version of the gateway is released, follow these steps to update your existing installation without losing your configuration.

### Step 1: Stop the Running Gateway

```bash
# If started with the helper script:
bash ~/gateway/stop.sh

# Or manually kill:
tmux kill-session -t gateway 2>/dev/null
pkill -f "node.*index" 2>/dev/null

# Verify it stopped:
bash ~/gateway/status.sh
# Should say: "❌ AI Gateway is NOT running"
```

### Step 2: Back Up Your Configuration

Your API keys and provider settings are stored in `config.json`. Back it up before updating:

```bash
cp ~/gateway/config.json ~/gateway/config.json.backup
echo "✅ Config backed up to config.json.backup"
```

### Step 3: Pull the Latest Code

```bash
cd ~/gateway
git pull origin master
```

If you see merge conflicts (unlikely unless you edited files manually):

```bash
# Overwrite with latest (you'll need to re-apply any manual edits)
git checkout --theirs .
git pull origin master
```

### Step 4: Install Dependencies & Rebuild

The new version includes **performance optimizations** that require a fresh build:

```bash
# Clean install of dependencies
rm -rf node_modules
npm install --no-fund --no-audit

# Rebuild the production bundle (for fast startup)
npm run build

echo "✅ Update complete"
```

### Step 5: Restore Your Config (if needed)

If the update created a fresh `config.json`, restore your backup:

```bash
# Only if you see a new default config.json
cp ~/gateway/config.json.backup ~/gateway/config.json
```

### Step 6: Restart the Gateway

```bash
# Start the new version with performance settings:
bash ~/gateway/start-bg.sh

# Verify it's running with the new version:
bash ~/gateway/status.sh
curl http://localhost:8787/api/ping
```

### What Changed in This Update?

| Before (old version) | After (new version) | Benefit |
|---------------------|--------------------|---------|
| `npx tsx src/index.ts` | `node dist/index.mjs` (pre-built) | **10x faster startup** (0.3s vs 3s) |
| Bound to `127.0.0.1` only | Bound to `0.0.0.0` by default | Access from other devices on WiFi |
| No memory limit | Auto-detected RAM budget (192-512MB) | No OOM kills on low-RAM phones |
| No V8 GC flags | `--optimize-for-size`, `--gc-interval=100` | **40% less memory usage** |
| Log buffer: 1000 entries | Configurable (200 on mobile) | Less memory for logs |
| Health check: every 5s | Configurable (30s on mobile) | **6x fewer wakeups** (battery) |

### Rollback (if something goes wrong)

```bash
cd ~/gateway
git log --oneline -5
# Find the commit hash before the update, then:
git reset --hard <previous-commit-hash>
npm install --no-fund --no-audit
cp ~/gateway/config.json.backup ~/gateway/config.json
bash ~/gateway/start-bg.sh
```

---

## 10. Using with AI Chat Apps

### Using with ChatGPT Android App

Some AI chat apps allow custom API endpoints. Configure them with:

```
API Endpoint: http://localhost:8787/v1
API Key: anything (the gateway handles key selection)
```

### Using with Termux:API for Notifications

Get notified when the gateway starts:

```bash
# Install Termux:API from F-Droid
pkg install termux-api -y

# Add notification to your startup script
termux-notification \
  --title "AI Gateway" \
  --content "Gateway is running on port 8787" \
  --button1 "Open Dashboard" \
  --button1-action "am start -a android.intent.action.VIEW -d http://localhost:8787"
```

### Using with Tasker (Automation)

You can use [Tasker](https://play.google.com/store/apps/details?id=net.dinglisch.android.taskerm) to automate gateway management:

1. **Start Gateway Task**:
   - Action: "Send Intent" → `com.termux.RUN_COMMAND`
   - Extra: `com.termux.RUN_COMMAND_PATH` = `/data/data/com.termux/files/home/gateway/start.sh`
   - Create `~/gateway/start.sh`:
     ```bash
     #!/data/data/com.termux/files/usr/bin/bash
     cd ~/gateway
     tmux new-session -d -s gateway 'npm start'
     ```

2. **Stop Gateway Task**:
   - Extra: `com.termux.RUN_COMMAND_PATH` = `/data/data/com.termux/files/home/gateway/stop.sh`
   - Create `~/gateway/stop.sh`:
     ```bash
     #!/data/data/com.termux/files/usr/bin/bash
     tmux kill-session -t gateway
     ```

3. **Schedule**: Set Tasker to start gateway when WiFi connects, stop when disconnected.

---

## 11. Performance Tuning for Mobile

The setup script (`scripts/termux-setup.sh`) automatically applies most of these optimizations. This section explains them in detail so you can fine-tune further.

### 📊 Memory Budget (Auto-Detected)

Node.js on Android may default to using 50% of total RAM — **too much** for a lightweight gateway. The setup script auto-detects your device's RAM and sets limits accordingly:

| Your Phone RAM | Heap Limit | Devices |
|---------------|-----------|---------|
| ≤3 GB | 192 MB | Budget/older phones |
| 4–5 GB | 320 MB | Mid-range |
| 6–8 GB | **384 MB** | Most common |
| 12+ GB | 512 MB | Flagship |

To check or override:

```bash
# See current setting
cat ~/gateway/start.sh | grep NODE_OPTIONS

# Override (e.g., for a 4GB phone with heavy usage)
export NODE_OPTIONS="--max-old-space-size=512"
~/gateway/start.sh
```

### ⚡ V8 Flags Explained

The helper scripts set these flags automatically:

| Flag | What it does | Benefit on Mobile |
|------|-------------|-------------------|
| `--max-old-space-size=N` | Limits V8 heap to N MB | Prevents out-of-memory kills |
| `--optimize-for-size` | V8 optimizes for memory over speed | ~15% less RAM usage |
| `--gc-interval=100` | Runs GC every 100ms of CPU time | More frequent, smaller collections |
| `--max-semi-space-size=32` | Limits young generation to 32MB | Less GC pause time |

### 🏗️ Pre-Built Bundle (Faster Startup)

Instead of transpiling TypeScript on every start (`tsx`), the setup script creates a pre-built JS bundle:

```bash
# Before (with tsx): ~2-3 seconds startup
npx tsx src/index.ts

# After (pre-built): ~0.3 seconds startup  🚀
node dist/index.mjs
```

The bundle is created during setup (`npm run build`). If you modify source code, rebuild with:

```bash
cd ~/gateway && npm run build
```

### 🔧 Fine-Tuning config.json

The setup script creates a Termux-optimized `config.json`. Key differences from desktop defaults:

| Setting | Desktop Default | Termux Optimized | Why |
|---------|----------------|-----------------|-----|
| `logLevel` | `info` | `warn` | Less I/O, less battery |
| `maxLogEntries` | 1000 | 200 | Saves ~200KB memory |
| `defaultCooldownMs` | 60000 | 30000 | Faster key recovery |
| `healthCheckIntervalMs` | 5000 | **30000** | **Major battery saver** |

Edit these in `config.json`:

```json
{
  "logLevel": "warn",
  "maxLogEntries": 200,
  "defaultMaxRetries": 2,
  "defaultCooldownMs": 30000,
  "healthCheckIntervalMs": 30000
}
```

### 🔋 Battery Optimization Strategy

| Technique | Battery Saved | Complexity |
|-----------|--------------|------------|
| ✅ Use pre-built bundle (`dist/index.mjs`) | High (no tsx overhead) | Automatic |
| ✅ Increase health check interval to 30s | **High** | Edit `config.json` |
| ✅ Set `logLevel` to `warn` | Medium | Edit `config.json` |
| ✅ Disable unused providers | Medium | Dashboard toggle |
| ✅ Reduce warmup interval/concurrency | Medium | Edit `config.json` |
| ✅ Use tmux background sessions | Medium | Use `start-bg.sh` |
| ❌ Termux:API wake lock | Negative (keeps CPU awake) | Only when actively using |
| ❌ Keep Termux in foreground | Negative (screen must be on) | Use tmux instead |

### 📱 Memory Optimization Checklist

- [x] **Heap limit set** (auto-detected from RAM)
- [x] **V8 optimized for size** (`--optimize-for-size`)
- [x] **Log entries limited** to 200
- [x] **Cache entries limited** (bundled defaults)
- [x] **Warmup concurrency reduced** to 1
- [x] **Health checks every 30s** instead of 5s
- [x] **Pre-built bundle used** (no TypeScript transpilation at runtime)

### 🧹 Manual Optimization Steps

If you want to go further:

```bash
# 1. Remove unused node_modules (if not developing)
rm -rf node_modules
npm install --production --no-optional

# 2. Reduce log history further
# Edit config.json: "maxLogEntries": 100

# 3. Disable warmup entirely (if battery is critical)
# Edit config.json: "warmup": { "enabled": false }

# 4. Clear npm cache (frees ~50-100MB)
npm cache clean --force
```

### 🔬 Monitor Resource Usage

```bash
# Check Node.js memory usage (real-time)
ps aux | grep node

# Check RSS of gateway process
bash ~/gateway/status.sh

# Check overall system memory
free -h

# Check CPU load
top -n 1 | head -10

# Check Termux disk usage
du -sh ~/gateway
du -sh ~/gateway/node_modules

# Real-time process monitoring
watch -n 2 'ps aux | grep node | grep -v grep'
```

### 🌐 Network Performance on Mobile

Mobile network conditions affect upstream API calls more than gateway performance:

```bash
# Test network speed
pkg install speedtest-cli -y
speedtest-cli

# Check WiFi signal
iw dev wlan0 link

# Ping upstream API directly to isolate gateway overhead
curl -w "TCP handshake: %{time_connect}s\nTTFB: %{time_starttransfer}s\nTotal: %{time_total}s\n" \
  -o /dev/null -s https://api.openai.com/v1/models
```

### 🚀 Expected Performance Gains

| Metric | Before (Desktop Defaults) | After (Termux Optimized) |
|--------|--------------------------|-------------------------|
| Startup time | 2–3s (tsx) | **0.3s** (pre-built) |
| Idle memory (RSS) | ~80–120 MB | **~35–55 MB** |
| Per-request memory | ~5–15 MB | **~3–8 MB** |
| Health check CPU/sec | 200ms every 5s | **200ms every 30s** |
| Battery drain (idle) | ~2–3%/hour | **~0.5–1%/hour** |

---

## Quick Reference Card

```bash
# ┌─────────────────────────────────────────────┐
# │         AI Gateway on Termux                │
# │         Quick Reference (Optimized)         │
# └─────────────────────────────────────────────┘

# ── First time setup (automatically optimized) ──
pkg update && pkg upgrade -y
pkg install nodejs git tmux curl -y
git clone https://github.com/yogee20001/gateway.git
cd gateway && npm install && npm run build

# ── Start (pre-built bundle — 0.3s startup) ──
cd ~/gateway
NODE_ENV=production NODE_OPTIONS="--max-old-space-size=384 --optimize-for-size" \
  node dist/index.mjs

# ── Start in background (tmux) ──
bash ~/gateway/start-bg.sh

# ── Reattach to tmux ──
tmux attach -t gateway

# ── Detach from tmux ──
# Ctrl+B, then D

# ── Check status (shows memory usage) ──
bash ~/gateway/status.sh

# ── Test ──
curl http://localhost:8787/api/ping

# ── Dashboard ──
# Open http://localhost:8787 in browser

# ── Remote access (0.0.0.0 is now DEFAULT) ──
# No special steps needed — gateway binds to all interfaces by default
bash ~/gateway/start-remote.sh  # Shows your phone's IP for other devices
# Restrict to localhost: HOST=127.0.0.1 node dist/index.mjs

# ── Stop ──
bash ~/gateway/stop.sh
# Or: tmux kill-session -t gateway
# Or: Ctrl+C (in tmux foreground)

# ── Update to latest version ──
bash ~/gateway/stop.sh
cd ~/gateway && git pull && rm -rf node_modules && npm install && npm run build
cp ~/gateway/config.json.backup ~/gateway/config.json 2>/dev/null || true
bash ~/gateway/start-bg.sh

# ── Rebuild after code changes ──
cd ~/gateway && npm run build

# ── Monitor memory ──
watch -n 5 'ps aux | grep node | grep -v grep'

# ── Auto-start on boot ──
mkdir -p ~/.termux/boot/
cat > ~/.termux/boot/gateway.sh << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
export NODE_ENV=production
export NODE_OPTIONS="--max-old-space-size=384 --optimize-for-size"
sleep 15
cd ~/gateway
tmux new-session -d -s gateway 'node dist/index.mjs'
EOF
chmod +x ~/.termux/boot/gateway.sh
```

---

## Appendix: Required Termux Packages

| Package | Purpose | Install Command | Needed For |
|---------|---------|-----------------|------------|
| `nodejs` | JavaScript runtime (v22+) | `pkg install nodejs -y` | ✅ Core |
| `git` | Clone repository | `pkg install git -y` | ✅ Setup |
| `tmux` | Background sessions | `pkg install tmux -y` | ✅ Background |
| `curl` | Test API endpoints | `pkg install curl -y` | ✅ Testing |
| `termux-api` | Wake lock, notifications | `pkg install termux-api -y` | ⬜ Optional (Section 5) |
| `net-tools` | Network diagnostics (`netstat`, `ifconfig`) | `pkg install net-tools -y` | ⬜ Optional (Section 8) |
| `speedtest-cli` | Network speed test | `pkg install speedtest-cli -y` | ⬜ Optional (Section 11) |

## Appendix B: Performance Configuration Reference

### Recommended config.json for Termux

```json
{
  "port": 8787,
  "logLevel": "warn",
  "maxLogEntries": 200,
  "defaultMaxRetries": 2,
  "defaultCooldownMs": 30000,
  "healthCheckIntervalMs": 30000
}
```

### Recommended Node.js Flags

```bash
# Minimum (battery saver)
export NODE_OPTIONS="--max-old-space-size=256 --optimize-for-size"

# Balanced (recommended for 6-8GB phones)
export NODE_OPTIONS="--max-old-space-size=384 --optimize-for-size --gc-interval=100 --max-semi-space-size=32"

# Performance (12GB+ phones)
export NODE_OPTIONS="--max-old-space-size=512 --gc-interval=100"
```

### Comparing Startup Methods

| Method | Startup Time | Memory | Works Without Build? |
|--------|-------------|--------|---------------------|
| `node dist/index.mjs` | **~0.3s** 🚀 | **Best** | No (needs `npm run build`) |
| `node --import tsx/esm src/index.ts` | ~1.5s | Good | Yes |
| `npx tsx src/index.ts` | ~3s | Worst | Yes |
| `npm start` | ~3s | Worst | Yes |

---

*Last updated: July 2026*
*Tested on: Android 14, Termux 0.118.0, Node.js 22.x*