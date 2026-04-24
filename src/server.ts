import express from "express";
import type { MessageRouter } from "./router.js";
import type { OutgoingMessage } from "./types.js";

/**
 * Minimal HTTP control surface for the gateway.
 *
 * Provides:
 *   POST /send        - Send a message to any channel
 *   POST /channels    - List registered channels
 *   GET  /health      - Health check
 *
 * This replaces OpenClaw's full canvas-host / gateway HTTP stack with
 * something you can curl or call from another service.
 */

export function createServer(router: MessageRouter, port = 3000) {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true, channels: router.listChannels().map((c) => ({ id: c.id, name: c.name })) });
  });

  app.get("/channels", (_req, res) => {
    res.json(
      router.listChannels().map((c) => ({
        id: c.id,
        name: c.name,
        capabilities: {
          send: true,
          edit: typeof c.editMessage === "function",
          delete: typeof c.deleteMessage === "function",
          react: typeof c.reactMessage === "function",
        },
      }))
    );
  });

  app.post("/send", async (req, res) => {
    const body = req.body as {
      channel: string;
      accountId?: string;
      to: string;
      text: string;
      replyToMessageId?: string;
      replyInThread?: boolean;
      card?: Record<string, unknown>;
    };

    if (!body.channel || !body.to || !body.text) {
      res.status(400).json({ ok: false, error: "Missing channel, to, or text" });
      return;
    }

    const message: OutgoingMessage = {
      to: body.to,
      text: body.text,
      replyToMessageId: body.replyToMessageId,
      replyInThread: body.replyInThread,
      card: body.card,
    };

    const result = await router.send(body.channel, body.accountId, message);
    res.status(result.ok ? 200 : 502).json(result);
  });

  app.post("/edit", async (req, res) => {
    const body = req.body as {
      channel: string;
      accountId?: string;
      messageId: string;
      text?: string;
      card?: Record<string, unknown>;
    };

    if (!body.channel || !body.messageId) {
      res.status(400).json({ ok: false, error: "Missing channel or messageId" });
      return;
    }

    const result = await router.edit(body.channel, body.accountId, body.messageId, {
      text: body.text ?? "",
      card: body.card,
    });
    res.status(result.ok ? 200 : 502).json(result);
  });

  app.post("/delete", async (req, res) => {
    const body = req.body as {
      channel: string;
      accountId?: string;
      messageId: string;
    };

    if (!body.channel || !body.messageId) {
      res.status(400).json({ ok: false, error: "Missing channel or messageId" });
      return;
    }

    const result = await router.delete(body.channel, body.accountId, body.messageId);
    res.status(result.ok ? 200 : 502).json(result);
  });

  const server = app.listen(port, () => {
    console.log(`[server] HTTP control surface listening on port ${port}`);
  });

  return { app, server };
}
