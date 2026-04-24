import type { IncomingMessage, MessageHandler, OutgoingMessage } from "../types.js";

/**
 * Base interface that every IM channel must implement.
 *
 * This mirrors the *surface* of OpenClaw's bundled channel entry contract
 * (see openclaw/src/plugin-sdk/channel-entry-contract.ts) but removes all
 * dependencies on the OpenClaw runtime, plugin loader, config schema, etc.
 */
export interface Channel {
  /** Platform identifier, e.g. "feishu", "telegram" */
  readonly id: string;
  /** Human-readable label */
  readonly name: string;

  /**
   * Start listening for incoming messages.
   *
   * Implementations may use webhooks, WebSocket, long-polling or any
   * transport the underlying SDK provides.
   */
  start(handler: MessageHandler): Promise<void>;

  /** Gracefully stop listening. */
  stop(): Promise<void>;

  /**
   * Send a message.
   *
   * @param accountId - Which account to send from (uses default if omitted).
   * @param message   - Outgoing payload.
   */
  sendMessage(accountId: string | undefined, message: OutgoingMessage): Promise<{
    messageId?: string;
    ok: boolean;
    error?: string;
  }>;

  /**
   * Optional: edit an existing message.
   */
  editMessage?(
    accountId: string | undefined,
    messageId: string,
    update: Pick<OutgoingMessage, "text" | "card">
  ): Promise<{ ok: boolean; error?: string }>;

  /**
   * Optional: delete a message.
   */
  deleteMessage?(accountId: string | undefined, messageId: string): Promise<{ ok: boolean; error?: string }>;

  /**
   * Optional: react to a message with an emoji.
   */
  reactMessage?(
    accountId: string | undefined,
    messageId: string,
    emoji: string
  ): Promise<{ ok: boolean; error?: string }>;
}

/**
 * Small helper to normalise an account ID, falling back to "default"
 * when the caller does not specify one.
 */
export function resolveAccountId(
  accountId: string | undefined,
  defaultId = "default"
): string {
  return (accountId ?? defaultId).trim() || defaultId;
}
