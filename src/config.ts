import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { GatewayConfig } from "./types.js";

const AccountSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional().default(true),
});

const ChannelConfigSchema = z.object({
  defaultAccountId: z.string().optional(),
  accounts: z.record(z.string(), AccountSchema.and(z.record(z.string(), z.unknown()))).default({}),
});

const GatewayConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).optional().default(3000),
  publicUrl: z.string().url().optional(),
  channels: z.object({
    feishu: ChannelConfigSchema.optional(),
    telegram: ChannelConfigSchema.optional(),
    slack: ChannelConfigSchema.optional(),
    discord: ChannelConfigSchema.optional(),
  }).default({}),
});

export type ParsedGatewayConfig = z.infer<typeof GatewayConfigSchema>;

const CONFIG_ENV_VAR = "IM_GATEWAY_CONFIG";
const DEFAULT_CONFIG_PATH = "config.json";

export function loadConfig(): GatewayConfig {
  const configPath = process.env[CONFIG_ENV_VAR] || DEFAULT_CONFIG_PATH;
  const absolutePath = path.resolve(configPath);

  if (!fs.existsSync(absolutePath)) {
    // Return a minimal default so the process can start and warn the user.
    console.warn(`[config] Config file not found at ${absolutePath}; using empty defaults.`);
    return { channels: {} };
  }

  const raw = JSON.parse(fs.readFileSync(absolutePath, "utf-8"));
  const parsed = GatewayConfigSchema.parse(raw);
  return parsed as GatewayConfig;
}

export function saveConfig(config: GatewayConfig, filePath?: string): void {
  const target = filePath || (process.env[CONFIG_ENV_VAR] || DEFAULT_CONFIG_PATH);
  fs.writeFileSync(path.resolve(target), JSON.stringify(config, null, 2), "utf-8");
}
