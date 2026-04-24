import {
  Client,
  GatewayIntentBits,
  Partials,
  TextChannel,
  ThreadChannel,
  DMChannel,
} from "discord.js";
import type { IncomingMessage, MessageHandler, OutgoingMessage } from "../types.js";
import { Channel, resolveAccountId } from "./base.js";

/**
 * Discord channel implementation.
 *
 * Derived from openclaw/extensions/discord. Uses discord.js directly.
 */

export interface DiscordAccountConfig {
  name?: string;
  enabled?: boolean;
  /** Discord Bot Token */
  botToken: string;
}

export interface DiscordChannelOptions {
  accounts: Record<string, DiscordAccountConfig>;
  defaultAccountId?: string;
}

export class DiscordChannel implements Channel {
  readonly id = "discord";
  readonly name = "Discord";

  private clients = new Map<string, Client>();
  private handler?: MessageHandler;
  private abortController?: AbortController;

  constructor(private options: DiscordChannelOptions) {}

  private getAccount(accountId?: string): DiscordAccountConfig {
    const id = resolveAccountId(accountId, this.options.defaultAccountId ?? "default");
    const acc = this.options.accounts[id];
    if (!acc) throw new Error(`Discord account "${id}" not found`);
    if (acc.enabled === false) throw new Error(`Discord account "${id}" is disabled`);
    return acc;
  }

  async start(handler: MessageHandler): Promise<void> {
    this.handler = handler;
    this.abortController = new AbortController();

    for (const [accountId, account] of Object.entries(this.options.accounts)) {
      if (account.enabled === false) continue;
      if (!account.botToken) {
        console.warn(`[discord] Account ${accountId} missing botToken, skipping.`);
        continue;
      }

      const client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.DirectMessages,
        ],
        partials: [Partials.Channel],
      });
      this.clients.set(accountId, client);

      client.on("messageCreate", async (msg) => {
        if (msg.author.bot) return;

        const incoming: IncomingMessage = {
          messageId: msg.id,
          channel: this.id,
          accountId,
          conversationId: msg.channelId,
          threadId: msg.thread?.id,
          senderId: msg.author.id,
          senderName: msg.author.username,
          text: msg.content,
          contentType: "text",
          timestamp: msg.createdTimestamp,
          mentioned: msg.mentions.users.has(client.user?.id ?? ""),
          raw: msg,
        };

        try {
          await handler(incoming);
        } catch (err) {
          console.error(`[discord] Handler error:`, err);
        }
      });

      await client.login(account.botToken);
      console.log(`[discord] Account ${accountId} connected.`);
    }
  }

  async stop(): Promise<void> {
    this.abortController?.abort();
    for (const client of this.clients.values()) {
      client.destroy();
    }
    this.clients.clear();
  }

  async sendMessage(
    accountId: string | undefined,
    msg: OutgoingMessage
  ): Promise<{ messageId?: string; ok: boolean; error?: string }> {
    try {
      const id = resolveAccountId(accountId, this.options.defaultAccountId ?? "default");
      const client = this.clients.get(id);
      if (!client) throw new Error("Client not initialised");

      const channel = await client.channels.fetch(msg.to);
      if (!channel) throw new Error(`Channel ${msg.to} not found`);
      if (
        !(
          channel instanceof TextChannel ||
          channel instanceof ThreadChannel ||
          channel instanceof DMChannel
        )
      ) {
        throw new Error(`Channel ${msg.to} is not text-based`);
      }

      const options: {
        content: string;
        reply?: { messageReference: string };
      } = { content: msg.text };
      if (msg.replyToMessageId) {
        (options as unknown as { reply: { messageReference: string } }).reply = {
          messageReference: msg.replyToMessageId,
        };
      }

      const sent = await channel.send(options);
      return { ok: true, messageId: sent.id };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[discord] sendMessage error:`, error);
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
      const client = this.clients.get(id);
      if (!client) throw new Error("Client not initialised");
      // discord.js requires channel to edit; we fetch the message object first.
      // This is a simplified path.
      throw new Error("Discord editMessage requires channel context; use raw client for full control.");
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
      const id = resolveAccountId(accountId, this.options.defaultAccountId ?? "default");
      const client = this.clients.get(id);
      if (!client) throw new Error("Client not initialised");
      throw new Error("Discord deleteMessage requires channel context; use raw client for full control.");
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { ok: false, error };
    }
  }
}
