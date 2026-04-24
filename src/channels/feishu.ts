import * as crypto from "node:crypto";
import * as Lark from "@larksuiteoapi/node-sdk";
import type { IncomingMessage, MessageHandler, OutgoingMessage } from "../types.js";
import { Channel, resolveAccountId } from "./base.js";

/**
 * Feishu / Lark channel implementation.
 *
 * Derived from openclaw/extensions/feishu/src/client.ts and send.ts.
 * Strips away OpenClaw runtime deps and keeps only the raw SDK usage.
 */

export interface FeishuAccountConfig {
  name?: string;
  enabled?: boolean;
  /** App ID from Feishu developer console */
  appId: string;
  /** App secret */
  appSecret: string;
  /** "feishu" | "lark" | custom URL */
  domain?: "feishu" | "lark" | string;
  /** Verification token for webhooks */
  verificationToken?: string;
  /** Encrypt key for webhooks (optional) */
  encryptKey?: string;
  /** HTTP timeout in ms */
  httpTimeoutMs?: number;
}

export interface FeishuChannelOptions {
  accounts: Record<string, FeishuAccountConfig>;
  defaultAccountId?: string;
  /** Express app to mount webhook handler on */
  webhookPath?: string;
}

function resolveDomain(
  domain: FeishuAccountConfig["domain"]
): Lark.Domain | string {
  if (domain === "lark") return Lark.Domain.Lark;
  if (domain === "feishu" || !domain) return Lark.Domain.Feishu;
  return domain.replace(/\/+$/, "");
}

function createClient(account: FeishuAccountConfig): Lark.Client {
  return new Lark.Client({
    appId: account.appId,
    appSecret: account.appSecret,
    appType: Lark.AppType.SelfBuild,
    domain: resolveDomain(account.domain),
  });
}

function parseMessageContent(rawContent: string, msgType: string): string {
  if (!rawContent) return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    return rawContent;
  }
  if (msgType === "text") {
    const text = (parsed as { text?: unknown })?.text;
    return typeof text === "string" ? text : "[Text message]";
  }
  if (msgType === "post") {
    // Simplified post parsing – extract all text tags
    const texts: string[] = [];
    const traverse = (node: unknown) => {
      if (Array.isArray(node)) node.forEach(traverse);
      else if (node && typeof node === "object") {
        const obj = node as Record<string, unknown>;
        if (typeof obj.text === "string") texts.push(obj.text);
        Object.values(obj).forEach(traverse);
      }
    };
    traverse(parsed);
    return texts.join("\n").trim() || "[Post message]";
  }
  if (msgType === "interactive") {
    const candidate = parsed as { elements?: unknown; body?: { elements?: unknown } };
    const elements = Array.isArray(candidate.elements)
      ? candidate.elements
      : Array.isArray(candidate.body?.elements)
        ? candidate.body.elements
        : null;
    if (!elements) return "[Interactive Card]";
    const texts: string[] = [];
    for (const el of elements) {
      if (!el || typeof el !== "object") continue;
      const item = el as { tag?: string; content?: string; text?: { content?: string } };
      if (item.tag === "div" && typeof item.text?.content === "string") texts.push(item.text.content);
      else if (item.tag === "markdown" && typeof item.content === "string") texts.push(item.content);
    }
    return texts.join("\n").trim() || "[Interactive Card]";
  }
  return `[${msgType || "unknown"} message]`;
}

export class FeishuChannel implements Channel {
  readonly id = "feishu";
  readonly name = "Feishu / Lark";

  private clients = new Map<string, Lark.Client>();
  private dispatcher?: Lark.EventDispatcher;
  private handler?: MessageHandler;
  private wsClients: Lark.WSClient[] = [];
  private abortController?: AbortController;

  constructor(private options: FeishuChannelOptions) {}

  private getAccount(accountId?: string): FeishuAccountConfig {
    const id = resolveAccountId(accountId, this.options.defaultAccountId ?? "default");
    const acc = this.options.accounts[id];
    if (!acc) throw new Error(`Feishu account "${id}" not found`);
    if (acc.enabled === false) throw new Error(`Feishu account "${id}" is disabled`);
    return acc;
  }

  private getClient(accountId?: string): Lark.Client {
    const acc = this.getAccount(accountId);
    const id = resolveAccountId(accountId, this.options.defaultAccountId ?? "default");
    const cached = this.clients.get(id);
    if (cached) return cached;
    const client = createClient(acc);
    this.clients.set(id, client);
    return client;
  }

  async start(handler: MessageHandler): Promise<void> {
    this.handler = handler;
    this.abortController = new AbortController();

    for (const [accountId, account] of Object.entries(this.options.accounts)) {
      if (account.enabled === false) continue;
      if (!account.appId || !account.appSecret) {
        console.warn(`[feishu] Account ${accountId} missing appId/appSecret, skipping.`);
        continue;
      }

      // Prefer WebSocket (real-time) if available; otherwise webhook would need an HTTP server mount.
      const wsClient = new Lark.WSClient({
        appId: account.appId,
        appSecret: account.appSecret,
        domain: resolveDomain(account.domain),
        loggerLevel: Lark.LoggerLevel.info,
      });
      this.wsClients.push(wsClient);

      const dispatcher = new Lark.EventDispatcher({
        encryptKey: account.encryptKey,
        verificationToken: account.verificationToken,
      });

      dispatcher.register({
        "im.message.receive_v1": (data) => {
          void this.handleMessageEvent(accountId, data);
        },
      });

      await wsClient.start({ eventDispatcher: dispatcher });
      console.log(`[feishu] Account ${accountId} WebSocket started`);
    }
  }

  async stop(): Promise<void> {
    this.abortController?.abort();
    for (const ws of this.wsClients) {
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
    this.wsClients = [];
    this.clients.clear();
  }

  private async handleMessageEvent(
    accountId: string,
    event: {
      message?: {
        message_id?: string;
        chat_id?: string;
        chat_type?: string;
        message_type?: string;
        parent_id?: string;
        create_time?: string;
        content?: string;
        body?: { content?: string };
      };
      sender?: {
        sender_type?: string;
        sender_id?: {
          open_id?: string;
          user_id?: string;
          union_id?: string;
        };
      };
    }
  ): Promise<void> {
    const message = event.message;
    if (!message) return;

    const sender = event.sender;
    const rawContent = message.body?.content ?? message.content ?? "";
    const text = parseMessageContent(rawContent, message.message_type ?? "text");

    const incoming: IncomingMessage = {
      messageId: message.message_id ?? "",
      channel: this.id,
      accountId,
      conversationId: message.chat_id ?? "",
      threadId: message.parent_id || undefined,
      senderId: sender?.sender_id?.open_id ?? sender?.sender_id?.user_id ?? "unknown",
      senderName: undefined,
      text,
      contentType: message.message_type ?? "text",
      timestamp: message.create_time ? Number(message.create_time) : Date.now(),
      mentioned: text.includes("@_user_"),
      raw: event,
    };

    try {
      await this.handler?.(incoming);
    } catch (err) {
      console.error(`[feishu] Handler error:`, err);
    }
  }

  async sendMessage(
    accountId: string | undefined,
    msg: OutgoingMessage
  ): Promise<{ messageId?: string; ok: boolean; error?: string }> {
    // Heuristic: infer id type from well-known prefixes even when no explicit prefix is given
    function inferReceiveIdType(raw: string): "open_id" | "email" | "union_id" | "user_id" | "chat_id" {
      if (raw.startsWith("user_id:")) return "user_id";
      if (raw.startsWith("open_id:") || raw.startsWith("user:")) return "open_id";
      if (raw.startsWith("email:")) return "email";
      if (raw.startsWith("union_id:")) return "union_id";
      if (/^\d+@/.test(raw)) return "email"; // numeric email-like
      if (/^ou_[a-f0-9]+$/i.test(raw)) return "open_id"; // Feishu user open_id pattern
      if (/^on_[a-f0-9]+$/i.test(raw)) return "open_id"; // Feishu user open_id (tenant)
      if (/^union_[a-f0-9]+$/i.test(raw)) return "union_id";
      if (/^\d+$/i.test(raw)) return "user_id"; // plain numeric user_id
      // default — most common for group messages
      return "chat_id";
    }

    const receiveIdType = inferReceiveIdType(msg.to);
    const receiveId = msg.to.replace(/^(chat|group|channel|user_id|open_id|email|union_id|user):/i, "").trim();

    try {
      const client = this.getClient(accountId);
      const { to, text, replyToMessageId, replyInThread, card } = msg;

      let content: string;
      let msgType: string;

      if (card) {
        content = JSON.stringify(card);
        msgType = "interactive";
      } else {
        content = JSON.stringify({
          zh_cn: {
            content: [[{ tag: "md", text: text ?? "" }]],
          },
        });
        msgType = "post";
      }

      if (replyToMessageId) {
        const response = await client.im.message.reply({
          path: { message_id: replyToMessageId },
          data: {
            content,
            msg_type: msgType,
            ...(replyInThread ? { reply_in_thread: true } : {}),
          },
        });
        if (response.code !== 0) {
          throw new Error(`reply failed: ${response.msg || `code ${response.code}`}`);
        }
        return { ok: true, messageId: response.data?.message_id ?? undefined };
      }

      const response = await client.im.message.create({
        params: { receive_id_type: receiveIdType },
        data: { receive_id: receiveId, content, msg_type: msgType },
      });
      if (response.code !== 0) {
        throw new Error(`send failed: ${response.msg || `code ${response.code}`}`);
      }
      return { ok: true, messageId: response.data?.message_id ?? undefined };
    } catch (err) {
      let error = err instanceof Error ? err.message : String(err);
      // Append debug context so the user can see what was actually sent
      error += ` (debug: receive_id_type=${receiveIdType}, receive_id=${receiveId})`;
      console.error(`[feishu] sendMessage error:`, error);
      return { ok: false, error };
    }
  }

  async editMessage(
    accountId: string | undefined,
    messageId: string,
    update: Pick<OutgoingMessage, "text" | "card">
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const client = this.getClient(accountId);
      const hasText = typeof update.text === "string" && update.text.trim().length > 0;
      const hasCard = Boolean(update.card);
      if (hasText === hasCard) {
        throw new Error("Feishu edit requires exactly one of text or card.");
      }

      let content: string;
      if (update.card) {
        content = JSON.stringify(update.card);
      } else {
        content = JSON.stringify({
          zh_cn: {
            content: [[{ tag: "md", text: update.text! }]],
          },
        });
      }

      const response = await client.im.message.patch({
        path: { message_id: messageId },
        data: { content },
      });
      if (response.code !== 0) {
        throw new Error(`edit failed: ${response.msg || `code ${response.code}`}`);
      }
      return { ok: true };
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
      const client = this.getClient(accountId);
      const response = await client.im.message.delete({
        path: { message_id: messageId },
      });
      if (response.code !== 0) {
        throw new Error(`delete failed: ${response.msg || `code ${response.code}`}`);
      }
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { ok: false, error };
    }
  }
}
