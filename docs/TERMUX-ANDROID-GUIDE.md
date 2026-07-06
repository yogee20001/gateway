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

```bash
# Start the gateway
npm start
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

# Start a new tmux session named "gateway"
tmux new -s gateway

# Start the gateway inside tmux
cd ~/gateway
npm start
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

By default, the gateway listens only on `127.0.0.1` (localhost), meaning only your phone can access it. To access it from other devices on the same WiFi network:

### Step 1: Find Your Phone's IP Address

```bash
# In Termux, run:
ip addr show | grep -E "inet " | grep -v "127.0.0.1"

# Or use:
ifconfig
# Look for "wlan0" section — the IP looks like 192.168.x.x
```

### Step 2: Start Gateway on All Interfaces

Stop the gateway if running (`Ctrl+C`), then start it on `0.0.0.0`:

```bash
# Method 1: Set environment variable (recommended)
HOST=0.0.0.0 npx tsx src/index.ts

# Method 2: Or use the helper script
bash start-remote.sh
```

### Step 3: Access from Other Devices

On your laptop, tablet, or another phone:

```
Dashboard: http://192.168.1.XXX:8787
API:       http://192.168.1.XXX:8787/v1
```

Replace `192.168.1.XXX` with your phone's actual IP address.

### Step 4: Use with OpenAI SDK from Any Device

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

> ⚠️ **Security Note**: Binding to `0.0.0.0` exposes the gateway to **everyone on your network**. Anyone who knows your phone's IP can use your API keys. Only do this on trusted networks (your home WiFi).

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

## 9. Advanced: Using with AI Chat Apps

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

## 10. Performance Tips

### Optimize Node.js for Mobile

```bash
# Set Node.js memory limit (adjust based on your phone's RAM)
export NODE_OPTIONS="--max-old-space-size=512"

# Use the --expose-gc flag for better memory management
export NODE_OPTIONS="--max-old-space-size=512 --expose-gc"

# Start with these options
NODE_OPTIONS="--max-old-space-size=512" npm start
```

### Reduce Battery Drain

1. **Use tmux** instead of keeping Termux in foreground
2. **Disable unused providers** in the dashboard (fewer health checks)
3. **Increase health check interval** (edit `key-pool.ts` if needed)
4. **Use Termux:API wake lock** only when actively using the gateway

### Monitor Resource Usage

```bash
# Check CPU and memory usage
top

# Check Node.js memory specifically
ps aux | grep node

# Check disk usage
df -h

# Check Termux data size
du -sh ~/gateway
```

### Network Performance

```bash
# Test network speed (for upstream API calls)
pkg install speedtest-cli -y
speedtest-cli

# Check WiFi signal strength
pkg install wpa-supplicant -y
iw dev wlan0 link
```

---

## Quick Reference Card

```bash
# ┌─────────────────────────────────────────────┐
# │         AI Gateway on Termux                │
# │         Quick Reference                     │
# └─────────────────────────────────────────────┘

# First time setup
pkg update && pkg upgrade -y
pkg install nodejs git tmux -y
git clone https://github.com/yogee20001/gateway.git
cd gateway && npm install

# Start
cd ~/gateway && npm start

# Start in background (tmux)
tmux new -s gateway -d 'cd ~/gateway && npm start'

# Reattach to tmux
tmux attach -t gateway

# Detach from tmux
# Ctrl+B, D

# Test
curl http://localhost:8787/api/ping

# Dashboard
# Open http://localhost:8787 in browser

# Remote access
HOST=0.0.0.0 npx tsx src/index.ts

# Stop
# Ctrl+C (in tmux) or: tmux kill-session -t gateway

# Auto-start on boot
mkdir -p ~/.termux/boot/
cat > ~/.termux/boot/gateway.sh << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
sleep 10
cd ~/gateway
tmux new-session -d -s gateway 'npm start'
EOF
chmod +x ~/.termux/boot/gateway.sh
```

---

## Appendix: Required Termux Packages

| Package | Purpose | Install Command |
|---------|---------|-----------------|
| `nodejs` | JavaScript runtime | `pkg install nodejs -y` |
| `git` | Clone repository | `pkg install git -y` |
| `tmux` | Background sessions | `pkg install tmux -y` |
| `termux-api` | Wake lock, notifications | `pkg install termux-api -y` |
| `curl` | Test API endpoints | `pkg install curl -y` |
| `net-tools` | Network diagnostics | `pkg install net-tools -y` |

---

*Last updated: July 2026*
*Tested on: Android 14, Termux 0.118.0, Node.js 22.x*