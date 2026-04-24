import readline from "node:readline";
import type { MessageRouter } from "./router.js";

/**
 * Interactive CLI for sending messages directly from the terminal.
 *
 * When the gateway starts, this prompts the user for a default target,
 * then loops reading lines from stdin and sending them via the router.
 */

export async function startInteractiveCli(router: MessageRouter): Promise<void> {
  const channels = router.listChannels();
  if (channels.length === 0) {
    console.log("[cli] No channels configured, interactive mode disabled.");
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve));

  console.log("\n========================================");
  console.log("  IM Gateway Interactive Mode");
  console.log("========================================");
  console.log(`Available channels: ${channels.map((c) => c.id).join(", ")}`);

  // Choose channel
  let channelId = channels[0].id;
  if (channels.length > 1) {
    const ch = await ask(`Select channel [${channels.map((c) => c.id).join("/")}] (default: ${channelId}): `);
    if (ch.trim()) {
      const found = channels.find((c) => c.id === ch.trim());
      if (found) channelId = found.id;
      else console.warn(`[cli] Unknown channel "${ch.trim()}", using default "${channelId}"`);
    }
  }

  // Print Feishu target hints
  if (channelId === "feishu") {
    console.log("\n[feishu] Target formats:");
    console.log("  Group chat : oc_xxxxxx            (or chat_id:oc_xxxxxx)");
    console.log("  User (open_id): ou_xxxxxx         (or open_id:ou_xxxxxx / user:ou_xxxxxx)");
    console.log("  User (user_id): 12345678          (or user_id:12345678)");
    console.log("  Email      : name@example.com     (or email:name@example.com)");
    console.log("Tip: if someone messages the bot, the [inbound] log shows their IDs.\n");
  }

  // Choose target
  const target = (await ask("Target (chat_id / open_id / user_id etc.): ")).trim();
  if (!target) {
    console.log("[cli] No target set, interactive mode disabled.");
    rl.close();
    return;
  }

  console.log(`\nTarget: ${target} via ${channelId}`);
  console.log("Commands:");
  console.log("  :to <target>     — change target");
  console.log("  :channel <id>    — change channel");
  console.log("  :status          — show current channel & target");
  console.log("  :quit            — exit interactive mode");
  console.log("Anything else is sent as a message.\n");

  let currentChannel = channelId;
  let currentTarget = target;

  const promptLoop = () => {
    rl.question("> ", async (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        promptLoop();
        return;
      }

      if (trimmed === ":quit" || trimmed === ":q") {
        console.log("[cli] Bye!");
        rl.close();
        return;
      }

      if (trimmed === ":status") {
        console.log(`  channel: ${currentChannel}`);
        console.log(`  target:  ${currentTarget}`);
        promptLoop();
        return;
      }

      if (trimmed.startsWith(":to ")) {
        currentTarget = trimmed.slice(4).trim();
        console.log(`[cli] Target changed to: ${currentTarget}`);
        promptLoop();
        return;
      }

      if (trimmed.startsWith(":channel ")) {
        const ch = trimmed.slice(9).trim();
        const found = router.listChannels().find((c) => c.id === ch);
        if (found) {
          currentChannel = ch;
          console.log(`[cli] Channel changed to: ${currentChannel}`);
        } else {
          console.warn(`[cli] Unknown channel "${ch}"`);
        }
        promptLoop();
        return;
      }

      // Send message
      const result = await router.send(currentChannel, undefined, {
        to: currentTarget,
        text: trimmed,
      });

      if (result.ok) {
        console.log(`[send] ok — messageId: ${result.messageId ?? "n/a"}`);
      } else {
        console.log(`[send] failed — ${result.error ?? "unknown error"}`);
        if (currentChannel === "feishu" && result.error?.includes("receive_id")) {
          console.log("[feishu] Hint: make sure the target ID is correct and the bot is in the group / has permission.");
          console.log("[feishu] Use :status to see current target, or :to <new_target> to switch.");
        }
      }

      promptLoop();
    });
  };

  promptLoop();
}
