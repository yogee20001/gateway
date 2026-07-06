# UI/UX Design Brief — AI Gateway

> **Version:** 1.0  
> **Status:** Draft  
> **Author:** AI Gateway Team  
> **Platform:** Desktop web browser (localhost)  
> **Framework:** Vanilla HTML/CSS/JS (no build step)

---

## 1. Design Philosophy

### 1.1 Principles

| Principle | Description |
|-----------|-------------|
| **Invisible when working** | The dashboard should be a tool you check occasionally, not a destination. Default state: everything is fine, no action needed. |
| **Status at a glance** | Key information (health, recent errors) should be visible without scrolling or clicking. |
| **Minimal configuration** | Adding a provider should take < 30 seconds. No wizards, no multi-step forms. |
| **Developer aesthetic** | Dark theme, monospace fonts, clean lines, no gradients or decorative elements. Looks like a dev tool, not a marketing site. |
| **Zero dependencies** | No React, no Tailwind, no npm packages for the frontend. Vanilla HTML/CSS/JS only. |

### 1.2 Color Palette

```
Background:       #0d1117  (GitHub dark)
Card background:  #161b22  (slightly lighter)
Border:           #30363d  (subtle borders)
Text primary:     #e6edf3  (light gray)
Text secondary:   #8b949e  (muted gray)
Accent blue:      #58a6ff  (links, active elements)
Success green:    #3fb950  (healthy status)
Warning yellow:   #d29922  (rate-limited status)
Error red:        #f85149  (error status)
```

### 1.3 Typography

```
Primary font:    'SF Mono', 'Cascadia Code', 'Fira Code', monospace
Fallback:        'Consolas', 'Courier New', monospace
Base size:       14px
Line height:     1.5
```

---

## 2. Page Layout

### 2.1 Overall Structure

```
┌─────────────────────────────────────────────────────────────┐
│  🚀 AI Gateway                              Status: Running │
│  http://localhost:8787                                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  STATS BAR                                            │  │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────────┐   │  │
│  │  │Total │ │Today │ │Active│ │Errors│ │Avg Resp  │   │  │
│  │  │ 1,234│ │  56  │ │  3   │ │  2   │ │ 1.2s     │   │  │
│  │  └──────┘ └──────┘ └──────┘ └──────┘ └──────────┘   │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  PROVIDERS                    [+ Add Provider]        │  │
│  │                                                       │  │
│  │  ┌──────────────────┐ ┌──────────────────┐           │  │
│  │  │ OpenAI           │ │ Anthropic        │           │  │
│  │  │ ● Active         │ │ ● Active         │           │  │
│  │  │ Keys: 3/3 healthy│ │ Keys: 2/2 healthy│           │  │
│  │  │ Models: gpt-*... │ │ Models: claude-* │           │  │
│  │  │ [Edit] [Delete]  │ │ [Edit] [Delete]  │           │  │
│  │  └──────────────────┘ └──────────────────┘           │  │
│  │                                                       │  │
│  │  ┌──────────────────┐ ┌──────────────────┐           │  │
│  │  │ Google Gemini    │ │ DeepSeek         │           │  │
│  │  │ ● Active         │ │ ○ Inactive       │           │  │
│  │  │ Keys: 1/1 healthy│ │ Keys: 0/1 healthy│           │  │
│  │  │ Models: gemini-* │ │ Models: deepseek │           │  │
│  │  │ [Edit] [Delete]  │ │ [Edit] [Delete]  │           │  │
│  │  └──────────────────┘ └──────────────────┘           │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  RECENT LOGS                              [Auto-refresh]│
│  │                                                       │  │
│  │  Time    Model     Provider  Key     Status  Duration │  │
│  │  12:34   gpt-4o   openai    sk-…x2  200     1,234ms  │  │
│  │  12:33   claude   anthropic sk-…y1  429       567ms  │  │
│  │  12:33   gemini   google    sk-…z3  200     2,100ms  │  │
│  │  12:32   gpt-4o   openai    sk-…x1  200       890ms  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Responsive Behavior

The dashboard is designed for desktop (1024px+). On smaller screens, provider cards stack vertically and the log table becomes horizontally scrollable. No mobile-specific layout is needed since the gateway runs on a local machine.

---

## 3. Component Specifications

### 3.1 Header

```
┌─────────────────────────────────────────────────────────────┐
│  ◉ AI Gateway                              ● Running :8787 │
│  One endpoint. Any provider. Maximum reliability.           │
└─────────────────────────────────────────────────────────────┘

Elements:
- Logo/icon: "◉" (green dot) + "AI Gateway" text
- Status indicator: "● Running" (green) or "● Stopped" (red)
- Port display: ":8787"
- Subtitle: tagline (smaller, muted)
```

### 3.2 Stats Bar

```
┌─────────────────────────────────────────────────────────────┐
│  Total Requests     Today      Active Providers    Errors   │
│  1,234              56         3                   2        │
│  ↑ 12% from yesterday         3 healthy           0 recent │
└─────────────────────────────────────────────────────────────┘

Each stat is a compact card with:
- Label (small, muted)
- Value (large, bold)
- Sub-label (tiny, colored: green/red for trends)
- Cards are equal width, flex layout
```

### 3.3 Provider Card

```
┌──────────────────────────────────┐
│  ◉ OpenAI                        │  ← Name with status dot
│  ──────────────────────────────  │
│  Status: ● Active                │  ← Active/Inactive toggle
│  Keys:   3/3 ●●● healthy         │  ← Key health dots
│  Models: gpt-*, o1-*, o3-*      │  ← Pattern chips
│  Strategy: Round Robin           │  ← Key strategy
│                                  │
│  [✏ Edit]  [🗑 Delete]           │  ← Action buttons
└──────────────────────────────────┘

States:
- Active: green dot, full opacity
- Inactive: gray dot, 50% opacity, "Inactive" badge
- Has unhealthy keys: yellow/red dot on key count
- No keys configured: "⚠ No keys" warning

Key health dots:
- ● green = healthy
- ● yellow = rate-limited
- ● red = error
- ○ gray = no keys
```

### 3.4 Add/Edit Provider Modal

```
┌─────────────────────────────────────────────┐
│  ✕  Add Provider                            │
│  ─────────────────────────────────────────  │
│                                             │
│  Provider ID *                              │
│  ┌─────────────────────────────────────┐   │
│  │ openai                               │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  Display Name *                             │
│  ┌─────────────────────────────────────┐   │
│  │ OpenAI                               │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  Base URL *                                 │
│  ┌─────────────────────────────────────┐   │
│  │ https://api.openai.com/v1           │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  Model Patterns (comma-separated)           │
│  ┌─────────────────────────────────────┐   │
│  │ gpt-*, o1-*, o3-*                   │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  API Keys *                                 │
│  ┌─────────────────────────────────────┐   │
│  │ sk-proj-xxxxxxxxxxxxxxxxxxxxxxx  [−]│   │
│  ├─────────────────────────────────────┤   │
│  │ sk-proj-yyyyyyyyyyyyyyyyyyyyyyy  [−]│   │
│  ├─────────────────────────────────────┤   │
│  │ sk-proj-zzzzzzzzzzzzzzzzzzzzzzz  [−]│   │
│  ├─────────────────────────────────────┤   │
│  │ [+ Add Another Key]                 │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  Key Strategy                                │
│  ┌─────────────────────────────────────┐   │
│  │ Round Robin                    ▼    │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ◻ Active (enabled)                         │
│                                             │
│  [Cancel]  [Save Provider]                  │
└─────────────────────────────────────────────┘

Behavior:
- Click outside modal → close (no save)
- Escape key → close (no save)
- Validation errors shown inline (red text below field)
- "Save" disabled until all required fields filled
- API keys masked as "sk-…x2" in list, full value in input
```

### 3.5 Log Table

```
┌─────────────────────────────────────────────────────────────┐
│  Recent Activity                    🔄 Auto-refresh (2s)    │
│  ─────────────────────────────────────────────────────────  │
│  ┌───────┬──────────┬──────────┬────────┬──────┬────────┐  │
│  │ Time  │ Model    │ Provider │ Key    │Status│ Duration│  │
│  ├───────┼──────────┼──────────┼────────┼──────┼────────┤  │
│  │12:34  │ gpt-4o   │ openai   │ sk…x2  │ 200  │ 1,234ms│  │
│  │12:33  │ claude-3 │ anthropic│ sk…y1  │ 429  │ 567ms  │  │
│  │12:33  │ gemini   │ google   │ sk…z3  │ 200  │ 2,100ms│  │
│  └───────┴──────────┴──────────┴────────┴──────┴────────┘  │
│                                                             │
│  Showing 3 of 1,000 entries              [Clear Logs]       │
└─────────────────────────────────────────────────────────────┘

Status color coding:
- 2xx: green text
- 4xx: yellow text
- 5xx: red text
- Other: gray text

Row hover: subtle highlight (#1c2128)
Click row: expand to show full details (request body, response body, error message)
```

### 3.6 Empty States

**No providers configured:**
```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│              🔧 No providers configured yet                 │
│                                                             │
│  Add your first AI provider to start routing requests.      │
│  You'll need at least one API key to get started.           │
│                                                             │
│  [➕ Add Your First Provider]                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**No logs yet:**
```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│              📭 No requests yet                             │
│                                                             │
│  Send a request to /v1/chat/completions to see logs here.   │
│                                                             │
│  Example: curl http://localhost:8787/v1/chat/completions \   │
│    -H "Content-Type: application/json" \                    │
│    -d '{"model":"gpt-4o","messages":[{"role":"user",        │
│          "content":"Hello"}]}'                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Interaction Details

### 4.1 Provider Card Interactions

| Action | Behavior |
|--------|----------|
| Click toggle | Instant toggle active/inactive, PUT /api/config, card grays out |
| Click Edit | Open modal pre-filled with provider data |
| Click Delete | Show confirmation dialog, then remove |
| Hover card | Subtle border highlight (#58a6ff) |
| Key health dots | Tooltip on hover: "Key 2: Rate-limited (cooldown 45s remaining)" |

### 4.2 Form Validation

| Field | Validation | Error Message |
|-------|-----------|---------------|
| Provider ID | Required, unique, alphanumeric + hyphens only | "Provider ID is required" / "Provider ID must be unique" / "Only letters, numbers, and hyphens allowed" |
| Display Name | Required | "Display name is required" |
| Base URL | Required, valid URL | "Valid URL is required" |
| API Keys | At least one required | "At least one API key is required" |
| Model Patterns | Optional, but must be valid glob | "Invalid pattern format" |

### 4.3 Auto-Refresh Behavior

| Component | Interval | Behavior |
|-----------|----------|----------|
| Health status | 5 seconds | Update key health dots, provider status |
| Log table | 2 seconds | Append new entries, maintain scroll position |
| Stats bar | 10 seconds | Update aggregate counts |

---

## 5. Microcopy & Messaging

### 5.1 Status Messages

| State | Message |
|-------|---------|
| Gateway starting | "🚀 AI Gateway starting..." |
| Gateway running | "🚀 AI Gateway running on http://localhost:8787" |
| No keys configured | "⚠ No API keys configured! Open the dashboard to add keys." |
| Key rate-limited | "⏳ Key rate-limited, cooling down for 60s" |
| Key restored | "✅ Key restored to healthy" |
| All keys exhausted | "❌ All keys rate-limited for {provider}" |
| Config saved | "✅ Configuration saved" |
| Config error | "❌ Invalid configuration: {details}" |

### 5.2 Error Messages

| Scenario | Message |
|----------|---------|
| Unknown model | "No provider found for model '{model}'. Check your model patterns." |
| No healthy keys | "No healthy API keys available for {provider}. Keys will be restored automatically." |
| Upstream error | "Upstream provider returned {status} for {provider}. Retrying..." |
| Config parse error | "Failed to parse config.json. Check the file format." |

---

## 6. Accessibility

| Requirement | Implementation |
|-------------|----------------|
| Keyboard navigation | All interactive elements focusable, Tab order logical |
| Focus indicators | Visible outline on focused elements (#58a6ff, 2px) |
| Color contrast | All text meets WCAG AA (4.5:1 ratio) |
| Screen reader labels | aria-label on icon buttons, role attributes on custom elements |
| Reduced motion | Respect prefers-reduced-motion, disable auto-refresh animations |

---

## 7. Loading States

### 7.1 Skeleton Screens

```
Provider cards while loading:
┌──────────────────────────────┐
│  ████████                    │  ← Shimmer placeholder for name
│  ──────────────────────────  │
│  Status: ████                │
│  Keys:   ███████             │
│  Models: ████████████        │
│                              │
│  [████]  [████]              │
└──────────────────────────────┘

Log table while loading:
┌───────┬──────────┬──────────┬────────┬──────┬────────┐
│ █████ │ ████████ │ ████████ │ ██████ │ ████ │ ██████ │
│ █████ │ ████████ │ ████████ │ ██████ │ ████ │ ██████ │
│ █████ │ ████████ │ ████████ │ ██████ │ ████ │ ██████ │
└───────┴──────────┴──────────┴────────┴──────┴────────┘
```

### 7.2 Toast Notifications

```
┌────────────────────────────────────────────┐
│  ✅ Configuration saved                    │
│  ────────────────────────────────────────  │
│  Provider "OpenAI" has been updated.       │
└────────────────────────────────────────────┘

Position: Top-right corner
Auto-dismiss: 3 seconds
Types: success (green), error (red), warning (yellow), info (blue)
```

---

## 8. Console Output (Non-UI)

When the gateway starts, the terminal output should be clean and informative:

```
🚀 AI Gateway v1.0.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Dashboard:  http://localhost:8787
  API:        http://localhost:8787/v1
  Providers:  3 active, 2 inactive
  Keys:       6 total, 6 healthy
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [12:34:56] ← POST /v1/chat/completions  model=gpt-4o  → openai  → 200 (1,234ms)
  [12:34:57] ← POST /v1/chat/completions  model=claude  → anthropic → 429 (567ms) ⚠ retry 1
  [12:34:58] ← POST /v1/chat/completions  model=claude  → anthropic → 200 (890ms) ✓ retry 2
```

---

*End of UI/UX Design Brief*