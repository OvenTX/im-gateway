/**
 * Shared types for the IM Gateway.
 *
 * This is a stripped-down, standalone reimplementation of the messaging
 * primitives found in OpenClaw's channel plugin system. The goal is to
 * provide a minimal abstraction that lets you send and receive messages
 * across Feishu/Lark, Telegram, Slack and Discord without pulling in the
 * full OpenClaw runtime.
 */

export interface IncomingMessage {
  /** Unique message ID from the upstream platform */
  messageId: string;
  /** Channel kind */
  channel: string;
  /** Account / bot ID within the channel */
  accountId: string;
  /** Conversation / chat / channel ID */
  conversationId: string;
  /** For thread/topic support */
  threadId?: string;
  /** Sender identifier */
  senderId: string;
  /** Sender display name (best-effort) */
  senderName?: string;
  /** Plain-text content */
  text: string;
  /** Raw message type from the platform */
  contentType?: string;
  /** Unix timestamp (ms) */
  timestamp: number;
  /** Whether the bot was explicitly mentioned */
  mentioned?: boolean;
  /** Optional raw payload for advanced use */
  raw?: unknown;
}

export interface OutgoingMessage {
  /** Target conversation ID */
  to: string;
  /** Message text (markdown supported where the platform allows) */
  text: string;
  /** Reply to an existing message */
  replyToMessageId?: string;
  /** For thread/topic support */
  replyInThread?: boolean;
  /** Optional structured card / interactive payload */
  card?: Record<string, unknown>;
  /** Optional media URL */
  mediaUrl?: string;
}

export interface ChannelAccountConfig {
  /** Human-readable account name */
  name?: string;
  /** Whether this account is active */
  enabled?: boolean;
}

export interface ChannelConfig {
  /** Default account used when no accountId is supplied */
  defaultAccountId?: string;
  /** Per-account credentials/settings */
  accounts: Record<string, ChannelAccountConfig>;
}

export interface GatewayConfig {
  /** HTTP port for webhooks */
  port?: number;
  /** Base public URL (for webhook registration) */
  publicUrl?: string;
  /** Per-channel configurations */
  channels: {
    feishu?: ChannelConfig;
    telegram?: ChannelConfig;
    slack?: ChannelConfig;
    discord?: ChannelConfig;
  };
}

export type MessageHandler = (message: IncomingMessage) => void | Promise<void>;
