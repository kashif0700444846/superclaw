export type WhatsAppDriver = 'baileys' | 'puppeteer';
export type PlatformName = 'telegram' | 'whatsapp';
export type ToolName =
  | 'shell_execute'
  | 'file_read'
  | 'file_write'
  | 'file_list'
  | 'http_request'
  | 'package_manager'
  | 'service_manager'
  | 'cron_manager'
  | 'process_manager'
  | 'system_info'
  | 'memory_read'
  | 'memory_write'
  | 'ai_query'
  | 'web_search'
  | 'code_executor'
  | 'browser_automate'
  | 'termux_api'
  | 'root_shell'
  | 'android_info'
  | 'daemon_manager'
  | 'mcp_manager';

export interface SuperclawConfig {
  /** Schema version for future migrations */
  schemaVersion: 1;

  /** Which messaging platforms to load */
  platforms: PlatformName[];

  /** Which WhatsApp driver to use (only relevant if 'whatsapp' in platforms) */
  whatsappDriver: WhatsAppDriver;

  /** Tools explicitly enabled */
  enabledTools: string[];

  /** Tools explicitly disabled (takes precedence over enabledTools) */
  disabledTools: string[];

  /** Estimated RAM tier for display purposes */
  estimatedRamMb: number;

  /** Timestamp when config was generated */
  generatedAt: string;

  /** Android/Termux capability detection results (populated at startup) */
  androidSupport?: {
    termuxApiAvailable: boolean;
    rootAvailable: boolean;
    termuxBootAvailable: boolean;
  };
}
