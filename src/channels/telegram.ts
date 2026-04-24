import { Bot, GrammyError, HttpError } from "grammy";
import type { IncomingMessage, MessageHandler, OutgoingMessage } from "../types.js";
import { Channel, resolveAccountId } from "./base.js";

/**
 * Telegram channel implementation.
 *
 * Derived from openclaw/extensions/telegram. Uses grammY directly.
 */

export interface TelegramAccountConfig {
  name?: string;
  enabled?: boolean;
  /** Bot token from @BotFather */
  botToken: string;
}

export interface TelegramChannelOptions {
  accounts: Record<string, TelegramAccountConfig>;
  defaultAccountId?: string;
  /** Webhook configuration (optional; uses polling if omitted) */
  webhook?: {
    domain?: string;
    port?: number;
    path?: string;
    secretToken?: string;
  };
}

export class TelegramChannel implements Channel {
  readonly id = "telegram";
  readonly name = "Telegram";

  private bots = new Map<string, Bot>();
  private handler?: MessageHandler;
  private abortController?: AbortController;
  private runner?: { stop: () => Promise<void> };

  constructor(private options: TelegramChannelOptions) {}

  private getAccount(accountId?: string): TelegramAccountConfig {
    const id = resolveAccountId(accountId, this.options.defaultAccountId ?? "default");
    const acc = this.options.accounts[id];
    if (!acc) throw new Error(`Telegram account "${id}" not found`);
    if (acc.enabled === false) throw new Error(`Telegram account "${id}" is disabled`);
    return acc;
  }

  async start(handler: MessageHandler): Promise<void> {
    this.handler = handler;
    this.abortController = new AbortController();

    for (const [accountId, account] of Object.entries(this.options.accounts)) {
      if (account.enabled === false) continue;
      if (!account.botToken) {
        console.warn(`[telegram] Account ${accountId} missing botToken, skipping.`);
        continue;
      }

      const bot = new Bot(account.botToken);
      this.bots.set(accountId, bot);

      bot.on("message:text", async (ctx) => {
        const msg = ctx.message;
        const chat = msg.chat;
        const from = msg.from;

        const incoming: IncomingMessage = {
          messageId: String(msg.message_id),
          channel: this.id,
          accountId,
          conversationId: String(chat.id),
          threadId: msg.message_thread_id ? String(msg.message_thread_id) : undefined,
          senderId: from ? String(from.id) : "unknown",
          senderName: from ? [from.first_name, from.last_name].filter(Boolean).join(" ") : undefined,
          text: msg.text ?? "",
          contentType: "text",
          timestamp: msg.date * 1000,
          mentioned: msg.entities?.some((e) => e.type === "mention") ?? false,
          raw: msg,
        };

        try {
          await handler(incoming);
        } catch (err) {
          console.error(`[telegram] Handler error:`, err);
        }
      });

      bot.catch((err) => {
        console.error(`[telegram][${accountId}] Bot error:`, err);
      });

      if (this.options.webhook?.domain) {
        await bot.api.setWebhook(`${this.options.webhook.domain}${this.options.webhook.path ?? "/telegram"}`, {
          secret_token: this.options.webhook.secretToken,
        });
        // grammY webhook adapter would need an HTTP server; for simplicity we log.
        console.log(`[telegram] Account ${accountId} webhook configured.`);
      } else {
        // Polling
        const { run } = await import("@grammyjs/runner");
        const r = run(bot);
        this.runner = r;
        console.log(`[telegram] Account ${accountId} polling started.`);
      }
    }
  }

  async stop(): Promise<void> {
    this.abortController?.abort();
    if (this.runner) {
      await this.runner.stop();
      this.runner = undefined;
    }
    for (const bot of this.bots.values()) {
      await bot.stop();
    }
    this.bots.clear();
  }

  async sendMessage(
    accountId: string | undefined,
    msg: OutgoingMessage
  ): Promise<{ messageId?: string; ok: boolean; error?: string }> {
    try {
      const acc = this.getAccount(accountId);
      const bot = this.bots.get(resolveAccountId(accountId, this.options.defaultAccountId ?? "default"));
      if (!bot) throw new Error("Bot not initialised");

      const chatId = msg.to;
      let sent;

      if (msg.replyToMessageId) {
        sent = await bot.api.sendMessage(chatId, msg.text, {
          reply_parameters: { message_id: Number(msg.replyToMessageId) },
        });
      } else {
        sent = await bot.api.sendMessage(chatId, msg.text);
      }

      return { ok: true, messageId: String(sent.message_id) };
    } catch (err) {
      let error = String(err);
      if (err instanceof GrammyError) error = `Telegram API error: ${err.description}`;
      else if (err instanceof HttpError) error = `Network error: ${err.message}`;
      console.error(`[telegram] sendMessage error:`, error);
      return { ok: false, error };
    }
  }

  async editMessage(
    accountId: string | undefined,
    messageId: string,
    update: Pick<OutgoingMessage, "text" | "card">
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const bot = this.bots.get(resolveAccountId(accountId, this.options.defaultAccountId ?? "default"));
      if (!bot) throw new Error("Bot not initialised");
      // Telegram editMessageText requires chat_id; the simplified interface does not carry it.
      throw new Error("Telegram editMessage requires chatId; use raw bot API for full control.");
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { ok: false, error };
    }
  }

  async deleteMessage(
    accountId: string | undefined,
    messageId: string
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const bot = this.bots.get(resolveAccountId(accountId, this.options.defaultAccountId ?? "default"));
      if (!bot) throw new Error("Bot not initialised");
      throw new Error("Telegram deleteMessage requires chatId; use raw bot API for full control.");
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { ok: false, error };
    }
  }
}
