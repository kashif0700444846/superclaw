import fs from 'fs';
import path from 'path';
import { SuperclawConfig } from './types/SuperclawConfig';
import { logger } from './logger';

const CONFIG_PATH = path.resolve(process.cwd(), 'superclaw.config.json');

const DEFAULT_CONFIG: SuperclawConfig = {
  schemaVersion: 1,
  platforms: ['telegram', 'whatsapp'],
  whatsappDriver: 'puppeteer',
  enabledTools: [
    'shell_execute', 'file_read', 'file_write', 'file_list',
    'http_request', 'package_manager', 'service_manager', 'cron_manager',
    'process_manager', 'system_info', 'memory_read', 'memory_write',
    'ai_query', 'web_search', 'code_executor',
  ],
  disabledTools: [],
  estimatedRamMb: 600,
  generatedAt: new Date().toISOString(),
};

function loadSuperclawConfig(): SuperclawConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    logger.info('No superclaw.config.json found — using defaults (all platforms/tools enabled)');
    return DEFAULT_CONFIG;
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as SuperclawConfig;
    logger.info(
      `Loaded superclaw.config.json — platforms: [${parsed.platforms.join(', ')}], ` +
      `driver: ${parsed.whatsappDriver}, estimated RAM: ${parsed.estimatedRamMb} MB`
    );
    return parsed;
  } catch (error: any) {
    logger.warn(`Failed to parse superclaw.config.json: ${error.message} — using defaults`);
    return DEFAULT_CONFIG;
  }
}

export const superclawConfig = loadSuperclawConfig();

export function isPlatformEnabled(platform: 'telegram' | 'whatsapp'): boolean {
  return superclawConfig.platforms.includes(platform);
}

export function isToolEnabled(toolName: string): boolean {
  if (superclawConfig.disabledTools.includes(toolName)) return false;
  return superclawConfig.enabledTools.includes(toolName);
}

export function getWhatsAppDriver(): 'baileys' | 'puppeteer' {
  return superclawConfig.whatsappDriver;
}

export default superclawConfig;
