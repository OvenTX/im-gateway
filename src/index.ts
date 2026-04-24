import { FeishuChannel } from "./channels/feishu.js";
import { TelegramChannel } from "./channels/telegram.js";
import { SlackChannel } from "./channels/slack.js";
import { DiscordChannel } from "./channels/discord.js";
import { loadConfig } from "./config.js";
import { MessageRouter } from "./router.js";
import { createServer } from "./server.js";
import { startInteractiveCli } from "./cli.js";
import type { IncomingMessage } from "./types.js";

/**
 * Standalone IM Gateway entry point.
 *
 * This file wires up the stripped-down channel implementations and starts
 * both the message router and the HTTP control surface.
 *
 * Usage:
 *   1. Create a config.json (see README.md for shape).
 *   2. Run: node dist/index.js
 *   3. Incoming messages are logged to stdout.
 *   4. Outgoing messages can be sent via POST /send.
 */

async function main() {
  const config = loadConfig();
  const router = new MessageRouter();

  // Register Feishu
  if (config.channels.feishu && Object.keys(config.channels.feishu.accounts).length > 0) {
    const accounts: Record<string, import("./channels/feishu.js").FeishuAccountConfig> = {};
    for (const [id, acc] of Object.entries(config.channels.feishu.accounts)) {
      const { name, enabled, ...rest } = acc as Record<string, unknown>;
      accounts[id] = {
        name: typeof name === "string" ? name : undefined,
        enabled: typeof enabled === "boolean" ? enabled : undefined,
        appId: String((rest as Record<string, unknown>).appId ?? ""),
        appSecret: String((rest as Record<string, unknown>).appSecret ?? ""),
        domain: (rest as Record<string, unknown>).domain as "feishu" | "lark" | string | undefined,
        verificationToken: String((rest as Record<string, unknown>).verificationToken ?? ""),
        encryptKey: String((rest as Record<string, unknown>).encryptKey ?? ""),
        httpTimeoutMs: Number((rest as Record<string, unknown>).httpTimeoutMs) || undefined,
      };
    }
    router.register(
      new FeishuChannel({
        accounts,
        defaultAccountId: config.channels.feishu.defaultAccountId,
      })
    );
  }

  // Register Telegram
  if (config.channels.telegram && Object.keys(config.channels.telegram.accounts).length > 0) {
    const accounts: Record<string, import("./channels/telegram.js").TelegramAccountConfig> = {};
    for (const [id, acc] of Object.entries(config.channels.telegram.accounts)) {
      const { name, enabled, ...rest } = acc as Record<string, unknown>;
      accounts[id] = {
        name: typeof name === "string" ? name : undefined,
        enabled: typeof enabled === "boolean" ? enabled : undefined,
        botToken: String((rest as Record<string, unknown>).botToken ?? ""),
      };
    }
    router.register(
      new TelegramChannel({
        accounts,
        defaultAccountId: config.channels.telegram.defaultAccountId,
      })
    );
  }

  // Register Slack
  if (config.channels.slack && Object.keys(config.channels.slack.accounts).length > 0) {
    const accounts: Record<string, import("./channels/slack.js").SlackAccountConfig> = {};
    for (const [id, acc] of Object.entries(config.channels.slack.accounts)) {
      const { name, enabled, ...rest } = acc as Record<string, unknown>;
      accounts[id] = {
        name: typeof name === "string" ? name : undefined,
        enabled: typeof enabled === "boolean" ? enabled : undefined,
        botToken: String((rest as Record<string, unknown>).botToken ?? ""),
        appToken: String((rest as Record<string, unknown>).appToken ?? ""),
        signingSecret: String((rest as Record<string, unknown>).signingSecret ?? ""),
      };
    }
    router.register(
      new SlackChannel({
        accounts,
        defaultAccountId: config.channels.slack.defaultAccountId,
      })
    );
  }

  // Register Discord
  if (config.channels.discord && Object.keys(config.channels.discord.accounts).length > 0) {
    const accounts: Record<string, import("./channels/discord.js").DiscordAccountConfig> = {};
    for (const [id, acc] of Object.entries(config.channels.discord.accounts)) {
      const { name, enabled, ...rest } = acc as Record<string, unknown>;
      accounts[id] = {
        name: typeof name === "string" ? name : undefined,
        enabled: typeof enabled === "boolean" ? enabled : undefined,
        botToken: String((rest as Record<string, unknown>).botToken ?? ""),
      };
    }
    router.register(
      new DiscordChannel({
        accounts,
        defaultAccountId: config.channels.discord.defaultAccountId,
      })
    );
  }

  // Start router with a default handler that logs everything.
  await router.start((msg: IncomingMessage) => {
    console.log(
      `[inbound][${msg.channel}][${msg.accountId}] ${msg.senderName ?? msg.senderId}: ${msg.text}`
    );
  });

  // Start HTTP control surface
  const { server } = createServer(router, config.port ?? 3000);

  // Start interactive CLI for terminal-based sending
  await startInteractiveCli(router);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[main] Received ${signal}, shutting down...`);
    server.close();
    await router.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[main] Fatal error:", err);
  process.exit(1);
});
