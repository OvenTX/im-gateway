# IM Gateway

A **standalone** messaging gateway for IM platforms, extracted and reimplemented from the channel plugin system found in [OpenClaw](https://github.com/claw-ai/openclaw).

This project lives entirely outside the `openclaw/` directory and has **no dependency** on the OpenClaw runtime, plugin SDK, or internal config schema. It uses each platform's official SDK directly and provides a minimal, unified abstraction for sending and receiving messages.

## Supported Platforms

| Platform   | SDK Used                  | Receive Mode         | Send | Edit | Delete |
|------------|---------------------------|----------------------|------|------|--------|
| Feishu/Lark| `@larksuiteoapi/node-sdk` | WebSocket (real-time)| ✅   | ✅   | ✅     |
| Telegram   | `grammy`                  | Polling / Webhook    | ✅   | ✅   | ⚠️*    |
| Slack      | `@slack/bolt`             | Socket Mode / HTTP   | ✅   | ⚠️*  | ❌     |
| Discord    | `discord.js`              | WebSocket (Gateway)  | ✅   | ⚠️*  | ⚠️*    |

\* Requires extra context (channel/chat ID) that the simplified API does not always carry. Use the raw SDK for full control.

## Quick Start

### 1. Install dependencies

```bash
cd im-gateway
npm install
```

### 2. Create a config file

Copy the example below into `config.json` (or set `IM_GATEWAY_CONFIG` to point elsewhere):

```json
{
  "port": 3000,
  "channels": {
    "feishu": {
      "defaultAccountId": "default",
      "accounts": {
        "default": {
          "name": "My Feishu Bot",
          "enabled": true,
          "appId": "cli_xxxxxxxxxxxxxxxx",
          "appSecret": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
          "domain": "feishu",
          "verificationToken": "",
          "encryptKey": ""
        }
      }
    },
    "telegram": {
      "defaultAccountId": "default",
      "accounts": {
        "default": {
          "name": "My Telegram Bot",
          "enabled": true,
          "botToken": "1234567890:ABCDEF..."
        }
      }
    },
    "slack": {
      "defaultAccountId": "default",
      "accounts": {
        "default": {
          "name": "My Slack Bot",
          "enabled": true,
          "botToken": "xoxb-...",
          "appToken": "xapp-..."
        }
      }
    },
    "discord": {
      "defaultAccountId": "default",
      "accounts": {
        "default": {
          "name": "My Discord Bot",
          "enabled": true,
          "botToken": "..."
        }
      }
    }
  }
}
```

### 3. Build & run

```bash
npm run build
npm start
```

Incoming messages are printed to stdout:

```
[inbound][feishu][default] John Doe: Hello bot!
[inbound][telegram][default] johndoe: /start
```

### 4. Send messages via HTTP

```bash
curl -X POST http://localhost:3000/send \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "feishu",
    "to": "oc_xxxxxxxxxxxxxxxx",
    "text": "Hello from IM Gateway!"
  }'
```

## Architecture

```
┌─────────────────────────────────────────┐
│            HTTP Control Surface         │
│   POST /send | POST /edit | /health     │
└─────────────────────────────────────────┘
                   │
┌─────────────────────────────────────────┐
│           MessageRouter                 │
│   Multiplexes across Channel instances  │
└─────────────────────────────────────────┘
         │         │         │         │
    ┌────┘    ┌────┘    ┌────┘    ┌────┘
    ▼         ▼         ▼         ▼
 Feishu   Telegram   Slack    Discord
 Channel   Channel  Channel   Channel
```

### Design Decisions

- **No OpenClaw dependency** – The original `openclaw/extensions/*` plugins rely on `openclaw/plugin-sdk/*`, bundled entry loaders, config schemas, session bindings, approval handlers, etc. This project replaces all of that with ~50 lines of Zod validation and a plain JSON config file.
- **Direct SDK usage** – Instead of going through OpenClaw's lazy-runtime named exports and bundled plugin runtime, each channel instantiates the vendor SDK (`Lark.Client`, `grammy.Bot`, etc.) directly.
- **Unified surface** – `Channel` interface mirrors the *behaviour* of OpenClaw's `BundledChannelEntryContract` (`start`, `stop`, `sendMessage`, optional `editMessage`/`deleteMessage`) but removes every internal type.
- **Webhook-free where possible** – Feishu uses WebSocket (`WSClient`), Telegram uses polling (`@grammyjs/runner`), Slack uses Socket Mode (`@slack/bolt`), and Discord uses the Gateway WebSocket. This avoids the need for a public URL and reverse proxy during local development.

## Extending

To add a new channel (e.g. WhatsApp, Line, Matrix):

1. Implement the `Channel` interface in `src/channels/<platform>.ts`.
2. Add the platform-specific config parsing in `src/index.ts`.
3. Register the channel with `router.register(new MyChannel(...))`.

## License

MIT (same as OpenClaw)
