import type { Channel } from "./channels/base.js";
import type { IncomingMessage, MessageHandler, OutgoingMessage } from "./types.js";

/**
 * Simple message router that multiplexes across multiple channels.
 *
 * In OpenClaw this is handled by the channel registry, inbound debounce,
 * session binding, mention gating, etc. Here we keep only the bare
 * minimum: receive from any channel, optionally route replies back.
 */

export class MessageRouter {
  private channels = new Map<string, Channel>();
  private handler?: MessageHandler;

  register(channel: Channel): void {
    if (this.channels.has(channel.id)) {
      throw new Error(`Channel "${channel.id}" already registered`);
    }
    this.channels.set(channel.id, channel);
  }

  async start(handler: MessageHandler): Promise<void> {
    this.handler = handler;
    for (const channel of this.channels.values()) {
      await channel.start(async (msg) => {
        try {
          await handler(msg);
        } catch (err) {
          console.error(`[router][${channel.id}] Handler error:`, err);
        }
      });
    }
  }

  async stop(): Promise<void> {
    for (const channel of this.channels.values()) {
      await channel.stop();
    }
    this.channels.clear();
  }

  getChannel(id: string): Channel | undefined {
    return this.channels.get(id);
  }

  listChannels(): Channel[] {
    return Array.from(this.channels.values());
  }

  async send(
    channelId: string,
    accountId: string | undefined,
    message: OutgoingMessage
  ): Promise<{ messageId?: string; ok: boolean; error?: string }> {
    const channel = this.channels.get(channelId);
    if (!channel) {
      return { ok: false, error: `Channel "${channelId}" not found` };
    }
    return channel.sendMessage(accountId, message);
  }

  async edit(
    channelId: string,
    accountId: string | undefined,
    messageId: string,
    update: Pick<OutgoingMessage, "text" | "card">
  ): Promise<{ ok: boolean; error?: string }> {
    const channel = this.channels.get(channelId);
    if (!channel) {
      return { ok: false, error: `Channel "${channelId}" not found` };
    }
    if (!channel.editMessage) {
      return { ok: false, error: `Channel "${channelId}" does not support editMessage` };
    }
    return channel.editMessage(accountId, messageId, update);
  }

  async delete(
    channelId: string,
    accountId: string | undefined,
    messageId: string
  ): Promise<{ ok: boolean; error?: string }> {
    const channel = this.channels.get(channelId);
    if (!channel) {
      return { ok: false, error: `Channel "${channelId}" not found` };
    }
    if (!channel.deleteMessage) {
      return { ok: false, error: `Channel "${channelId}" does not support deleteMessage` };
    }
    return channel.deleteMessage(accountId, messageId);
  }
}
