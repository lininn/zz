# @lininn/zz

[简体中文](README.md) · English

zz is an AI coding workspace built on ZCode. One command lets you collaborate with AI in the terminal or in your browser.

## Installation

```bash
npm install -g @lininn/zz
```

Requires Node.js >= 24.

## Quick start

```bash
zz            # terminal TUI
zz --web      # local Web UI
```

[pc.d-1.top](https://pc.d-1.top) is a **remote-control portal, not a cloud version**. Install and start zz on the machine you want to control, run the connector there to bind your account, and then you can operate that machine from any browser, including a phone. Access requires an invitation code: follow the WeChat official account "html5开发分享" and reply "邀请码" to get one.

## Features

- **Multi-project workspace**: manage projects, tasks, and conversations across local and remote workspaces.
- **Agent crews**: multiple agents work by role, with automatic relay, approvals, and recovery.
- **Manager coordination**: a built-in "Manager" agent is created on first install. When a message does not @ a member, the manager dispatches work to the crew based on each member's role. Each crew allows at most one manager; any custom agent can be marked as one.
- **Automations and plugins**: scheduled tasks, plugin marketplace, UI Plugins, and Gen UI.
- **One workspace, three clients**: desktop, browser, and terminal CLI share the same agents and data.

## Usage

### Terminal TUI

```bash
zz
```

Starts the interactive terminal UI for chatting and coding with AI.

### One-shot prompt

```bash
zz -p "write a quicksort in Python"
```

### Web chat

```bash
zz --web
```

Starts a local web server (port 3030 by default) and opens the browser so you can chat with AI there.

If the port is taken, the next available port is used automatically. You can also set it explicitly:

```bash
zz --web --web-port 8080
```

### Model configuration page

```bash
zz --web-config
```

Opens a browser page for configuring custom model providers (Claude / OpenAI-compatible endpoints). Settings are written to `~/.zcode/`.

### Other commands

```bash
zz --version          # print version
zz --help             # print help
zz doctor             # diagnose the environment
zz login              # sign in
zz plugin             # manage plugins
zz skills             # manage skills
```

## Remote control (phone to PC)

1. Start `zz --web` (or the TUI) on the machine you want to control.
2. Run the connector (`zcode-relay` connector) on that same machine and bind your account.
3. Open [pc.d-1.top](https://pc.d-1.top) from a phone or any browser and sign in to control ZCode on that machine.

An invitation code is required to sign in: follow the WeChat official account "html5开发分享" and reply "邀请码" to get one.

The relay supports multiple versions: the page served to your phone automatically matches the ZCode version running on the PC.

## Configuration

- Config directory: `~/.zcode/`
- Provider config: `~/.zcode/v2/personal-provider-config.json` (edit it through `zz --web-config`)
- Environment variables:
  - `ZCODE_WEB_STATIC_ROOT` — static web assets directory served by `zz --web`
  - `PORT` — server port (3030 by default)

## License

See the project LICENSE file.
