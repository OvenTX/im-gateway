import { App } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import type { IncomingMessage, MessageHandler, OutgoingMessage } from "../types.js";
import { Channel, resolveAccountId } from "./base.js";

/**
 * Slack channel implementation.
 *
 * Derived from openclaw/extensions/slack. Uses @slack/bolt for receiving
 * and @slack/web-api for sending.
 */

export interface SlackAccountConfig {
  name?: string;
  enabled?: boolean;
  /** Slack Bot User OAuth Token (xoxb-...) */
  botToken: string;
  /** Slack App-Level Token (xapp-...) for Socket Mode */
  appToken: string;
  /** Signing secret for HTTP-mode webhooks (optional) */
  signingSecret?: string;
}

export interface SlackChannelOptions {
  accounts: Record<string, SlackAccountConfig>;
  defaultAccountId?: string;
  /** If true, use HTTP webhook mode instead of Socket Mode */
  useWebhookMode?: boolean;
  /** Port for HTTP webhook server (webhook mode only) */
  webhookPort?: number;
}

export class SlackChannel implements Channel {
  readonly id = "slack";
  readonly name = "Slack";

  private apps = new Map<string, App>();
  private webClients = new Map<string, WebClient>();
  private handler?: MessageHandler;
  private abortController?: AbortController;

  constructor(private options: SlackChannelOptions) {}

  private getAccount(accountId?: string): SlackAccountConfig {
    const id = resolveAccountId(accountId, this.options.defaultAccountId ?? "default");
    const acc = this.options.accounts[id];
    if (!acc) throw new Error(`Slack account "${id}" not found`);
    if (acc.enabled === false) throw new Error(`Slack account "${id}" is disabled`);
    return acc;
  }

  async start(handler: MessageHandler): Promise<void> {
    this.handler = handler;
    this.abortController = new AbortController();

    for (const [accountId, account] of Object.entries(this.options.accounts)) {
      if (account.enabled === false) continue;
      if (!account.botToken) {
        console.warn(`[slack] Account ${accountId} missing botToken, skipping.`);
        continue;
      }

      const web = new WebClient(account.botToken);
      this.webClients.set(accountId, web);

      const app = new App({
        token: account.botToken,
        appToken: this.options.useWebhookMode ? undefined : account.appToken,
        signingSecret: this.options.useWebhookMode ? account.signingSecret : undefined,
        socketMode: !this.options.useWebhookMode,
        port: this.options.useWebhookMode ? (this.options.webhookPort ?? 3000) : undefined,
      });
      this.apps.set(accountId, app);

      app.message(async ({ message, say }) => {
        // Filter out bot messages and subtype messages
        if (message.subtype) return;
        const msg = message as {
          ts: string;
          channel: string;
          thread_ts?: string;
          user?: string;
          text?: string;
          bot_id?: string;
        };
        if (msg.bot_id) return;

        const incoming: IncomingMessage = {
          messageId: msg.ts,
          channel: this.id,
          accountId,
          conversationId: msg.channel,
          threadId: msg.thread_ts,
          senderId: msg.user ?? "unknown",
          text: msg.text ?? "",
          contentType: "text",
          timestamp: Number(msg.ts.split(".")[0]) * 1000,
          mentioned: (msg.text ?? "").includes(`<@${(await web.auth.test()).user_id}>`),
          raw: message,
        };

        try {
          await handler(incoming);
        } catch (err) {
          console.error(`[slack] Handler error:`, err);
        }
      });

      await app.start();
      console.log(`[slack] Account ${accountId} ${this.options.useWebhookMode ? "webhook" : "Socket Mode"} started.`);
    }
  }

  async stop(): Promise<void> {
    this.abortController?.abort();
    for (const app of this.apps.values()) {
      await app.stop();
    }
    this.apps.clear();
    this.webClients.clear();
  }

  async sendMessage(
    accountId: string | undefined,
    msg: OutgoingMessage
  ): Promise<{ messageId?: string; ok: boolean; error?: string }> {
    try {
      const acc = this.getAccount(accountId);
      const id = resolveAccountId(accountId, this.options.defaultAccountId ?? "default");
      const web = this.webClients.get(id);
      if (!web) throw new Error("WebClient not initialised");

      const result = await web.chat.postMessage({
        channel: msg.to,
        text: msg.text,
        thread_ts: msg.replyInThread && msg.replyToMessageId ? msg.replyToMessageId : undefined,
      });

      return { ok: true, messageId: result.ts ?? undefined };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[slack] sendMessage error:`, error);
      return { ok: false, error };
    }
  }

  async editMessage(
    accountId: string | undefined,
    messageId: string,
    update: Pick<OutgoingMessage, "text" | "card">
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const id = resolveAccountId(accountId, this.options.defaultAccountId ?? "default");
      const web = this.webClients.get(id);
      if (!web) throw new Error("WebClient not initialised");
      // Slack requires channel+timestamp; we need the channel from caller context.
      // For the simplified API we assume the caller passes channel as accountId
      // or we simply note the limitation.
      throw new Error("Slack editMessage requires channel; use raw WebClient for full control.");
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { ok: false, error };
    }
  }
}
