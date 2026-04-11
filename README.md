# Proxmox Manager — Stream Deck Plugin

Monitor Proxmox VE servers and control VMs and containers directly from your Elgato Stream Deck. Real-time status icons, resource gauges, and one-press lifecycle actions.

---

## Features

### Overview Buttons
Folder-type buttons that open a contextual view for a server, node, VM, or container. The icon reflects live status (online / degraded / offline / reconnecting).

### Stats Buttons
270° arc gauges showing real-time CPU, memory, disk, or network metrics. Colour-coded by load level.

### Action Buttons
Lifecycle controls for VMs and containers:

| Action | Trigger |
|---|---|
| Start | Standard press |
| Shutdown (graceful) | Long press |
| Force Stop | Long press |
| Reboot | Long press |

> Destructive actions require a long press to prevent accidental execution.

---

## Actions Reference

| Action | Description |
|---|---|
| **Server Overview** | Status icon for a Proxmox server |
| **Server Stats** | Resource gauge for a Proxmox server |
| **Node Overview** | Status icon for a Proxmox node |
| **Node Stats** | Resource gauge for a Proxmox node |
| **VM Overview** | Status icon for a virtual machine |
| **VM Stats** | Resource gauge for a virtual machine |
| **VM Start** | Start a VM |
| **VM Shutdown** | Gracefully shut down a VM |
| **VM Force Stop** | Force-stop a VM |
| **VM Reboot** | Reboot a VM |
| **CT Overview** | Status icon for a container |
| **CT Stats** | Resource gauge for a container |
| **CT Start** | Start a container |
| **CT Shutdown** | Gracefully shut down a container |
| **CT Force Stop** | Force-stop a container |
| **CT Reboot** | Reboot a container |

---

## Requirements

- [Elgato Stream Deck](https://www.elgato.com/stream-deck) hardware
- Stream Deck software **6.5** or later
- macOS 12+ or Windows 10+
- Node.js **20.5.1** or later (bundled by the Stream Deck runtime)
- A Proxmox VE server with API token access

---

## Proxmox Setup

1. In the Proxmox web UI, go to **Datacenter → Permissions → API Tokens**.
2. Create a token for a user that has at least `VM.Audit` and `Sys.Audit` privileges (add `VM.PowerMgmt` for lifecycle actions).
3. Note the token string — it will be in the form `USER@REALM!TOKENID=SECRET`.

> The plugin uses token-based auth (`PVEAPIToken` header). No session cookies are stored.
> Self-signed certificates are supported — you can disable SSL verification per server in the Property Inspector.

---

## Development Setup

All commands run from inside the plugin folder:

```bash
cd com.starklab.proxmox-manager.sdPlugin
```

### Install dependencies

```bash
npm install
```

### Build

Bundles `src/` → `bin/plugin.js` using esbuild:

```bash
npm run build
```

### Watch mode

Rebuilds automatically on file changes:

```bash
npm run watch
```

### Install for local development

Symlink the plugin into Stream Deck's plugins directory so it loads automatically:

```bash
# macOS
ln -s "$(pwd)" "$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins/com.starklab.proxmox-manager.sdPlugin"
```

Restart the Stream Deck software after linking.

### Package for distribution

Run from the **project root** (one level above the plugin folder):

```bash
npx @elgato/cli pack com.starklab.proxmox-manager.sdPlugin
```

---

## Project Structure

```
com.starklab.proxmox-manager.sdPlugin/
├── manifest.json           # Plugin manifest (actions, OS requirements, SDK version)
├── package.json
├── esbuild.config.mjs      # Build config
├── src/
│   ├── plugin.js           # Entry point — registers all actions
│   ├── api/
│   │   ├── proxmox-client.js   # REST client (auth, SSL, timeout, error classification)
│   │   └── poll-manager.js     # Singleton poller with TTL cache and event emitter
│   ├── actions/            # One file per Stream Deck action
│   ├── icons/
│   │   ├── svg-generator.js    # Shared SVG primitives (arc, text, shapes)
│   │   ├── status-icons.js     # Overview button icons
│   │   ├── gauge-icons.js      # Stats button gauge icons
│   │   └── action-icons.js     # Lifecycle action icons
│   └── utils/
│       ├── cache.js            # Server hierarchy cache
│       ├── constants.js        # Colour palette and shared constants
│       ├── format.js           # Human-readable formatters (bytes, uptime, rates)
│       └── settings.js         # Global settings helpers
├── pi/                     # Property Inspector UI (plain HTML + vanilla JS)
│   ├── styles.css
│   ├── cascading-selector.js   # Reusable server → node → VM/CT dropdowns
│   └── *.html              # One HTML file per action
└── imgs/                   # Static icons for the Stream Deck action gallery
```

---

## Architecture Notes

- **Poll Manager** is a singleton. Buttons subscribe to data updates — they never call the API directly.
- API requests are deduplicated by endpoint URL with TTL-based caching. Multiple buttons requesting the same resource share one HTTP call.
- All runtime state lives in memory. Server configurations persist via Stream Deck global settings (JSON on disk managed by the SDK).
- Server icons go through `running → reconnecting (blue) → offline (red)` after 3 consecutive failures, with exponential backoff capped at 60s.
- All icons are dynamically generated SVG at runtime — no static image assets are used for button states.

---

## License

MIT
