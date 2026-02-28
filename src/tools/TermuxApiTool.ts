import { execSync } from 'child_process';
import fs from 'fs';
import { Tool, ToolResult } from '../gateway/types';
import { logger } from '../logger';

/**
 * TermuxApiTool — wraps Termux:API CLI commands to interact with Android device features.
 *
 * Requires the `termux-api` package installed in Termux:
 *   pkg install termux-api
 *
 * Each action maps to a `termux-*` binary available in the Termux environment.
 * JSON output from commands is automatically parsed where applicable.
 */
export class TermuxApiTool implements Tool {
  name = 'termux_api';
  description =
    'Execute Termux:API commands to interact with Android device features. Requires termux-api package. Available actions: sms_send, sms_list, notification, notification_list, notification_remove, camera_photo, location, battery_status, clipboard_get, clipboard_set, vibrate, torch, wifi_connectioninfo, wifi_scaninfo, telephony_deviceinfo, contact_list, call_log, volume, tts_speak, media_player, sensor, fingerprint, dialog, share, storage_get, toast';

  parameters = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description:
          'The Termux:API action to perform (e.g. sms_send, battery_status, location, clipboard_get, etc.)',
      },
      args: {
        type: 'object',
        description:
          'Arguments specific to the action. Examples: { number: "+1234567890", body: "Hello" } for sms_send; { title: "Alert", content: "Message" } for notification; { text: "hello" } for clipboard_set or tts_speak.',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 30000)',
      },
    },
    required: ['action'],
  };

  /** Returns true when running inside a Termux environment. */
  private isTermux(): boolean {
    if (process.env.TERMUX_VERSION) return true;
    try {
      return fs.existsSync('/data/data/com.termux');
    } catch {
      return false;
    }
  }

  /**
   * Build the full shell command string for the given action and args.
   * Returns null if the action is unknown.
   */
  private buildCommand(action: string, args: Record<string, any> = {}): string | null {
    switch (action) {
      // ── SMS ──────────────────────────────────────────────────────────────
      case 'sms_send': {
        const number = args.number ?? '';
        const body = args.body ?? '';
        if (!number) throw new Error('sms_send requires args.number');
        if (!body) throw new Error('sms_send requires args.body');
        return `termux-sms-send -n ${shellQuote(number)} ${shellQuote(body)}`;
      }
      case 'sms_list': {
        const limit = args.limit ?? 10;
        const type = args.type ?? 'inbox';
        return `termux-sms-list -l ${limit} -t ${shellQuote(type)}`;
      }

      // ── Notifications ─────────────────────────────────────────────────────
      case 'notification': {
        const title = args.title ?? 'SuperClaw';
        const content = args.content ?? '';
        let cmd = `termux-notification --title ${shellQuote(title)} --content ${shellQuote(content)}`;
        if (args.id !== undefined) cmd += ` --id ${args.id}`;
        if (args.priority) cmd += ` --priority ${shellQuote(args.priority)}`;
        return cmd;
      }
      case 'notification_list':
        return 'termux-notification-list';
      case 'notification_remove': {
        const id = args.id;
        if (id === undefined) throw new Error('notification_remove requires args.id');
        return `termux-notification-remove ${id}`;
      }

      // ── Camera ────────────────────────────────────────────────────────────
      case 'camera_photo': {
        const camera = args.camera ?? 0;
        const filepath = args.filepath ?? `/sdcard/superclaw_photo_${Date.now()}.jpg`;
        return `termux-camera-photo -c ${camera} ${shellQuote(filepath)}`;
      }

      // ── Location ──────────────────────────────────────────────────────────
      case 'location': {
        const provider = args.provider ?? 'gps';
        const request = args.request ?? 'once';
        return `termux-location -p ${shellQuote(provider)} -r ${shellQuote(request)}`;
      }

      // ── Battery ───────────────────────────────────────────────────────────
      case 'battery_status':
        return 'termux-battery-status';

      // ── Clipboard ─────────────────────────────────────────────────────────
      case 'clipboard_get':
        return 'termux-clipboard-get';
      case 'clipboard_set': {
        const text = args.text ?? '';
        return `termux-clipboard-set ${shellQuote(text)}`;
      }

      // ── Vibrate ───────────────────────────────────────────────────────────
      case 'vibrate': {
        const duration = args.duration ?? 500;
        const force = args.force ? ' -f' : '';
        return `termux-vibrate -d ${duration}${force}`;
      }

      // ── Torch ─────────────────────────────────────────────────────────────
      case 'torch': {
        const state = args.state ?? 'on';
        return `termux-torch ${shellQuote(state)}`;
      }

      // ── Wi-Fi ─────────────────────────────────────────────────────────────
      case 'wifi_connectioninfo':
        return 'termux-wifi-connectioninfo';
      case 'wifi_scaninfo':
        return 'termux-wifi-scaninfo';

      // ── Telephony ─────────────────────────────────────────────────────────
      case 'telephony_deviceinfo':
        return 'termux-telephony-deviceinfo';

      // ── Contacts / Call log ───────────────────────────────────────────────
      case 'contact_list':
        return 'termux-contact-list';
      case 'call_log': {
        const limit = args.limit ?? 10;
        return `termux-call-log -l ${limit}`;
      }

      // ── Volume ────────────────────────────────────────────────────────────
      case 'volume': {
        if (args.stream !== undefined && args.volume !== undefined) {
          return `termux-volume ${shellQuote(String(args.stream))} ${args.volume}`;
        }
        return 'termux-volume';
      }

      // ── TTS ───────────────────────────────────────────────────────────────
      case 'tts_speak': {
        const text = args.text ?? '';
        if (!text) throw new Error('tts_speak requires args.text');
        let cmd = 'termux-tts-speak';
        if (args.language) cmd += ` -l ${shellQuote(args.language)}`;
        if (args.rate !== undefined) cmd += ` -r ${args.rate}`;
        if (args.pitch !== undefined) cmd += ` -p ${args.pitch}`;
        cmd += ` ${shellQuote(text)}`;
        return cmd;
      }

      // ── Media player ──────────────────────────────────────────────────────
      case 'media_player': {
        const subcommand = args.subcommand ?? 'info';
        let cmd = `termux-media-player ${shellQuote(subcommand)}`;
        if (args.file) cmd += ` ${shellQuote(args.file)}`;
        return cmd;
      }

      // ── Sensor ────────────────────────────────────────────────────────────
      case 'sensor': {
        if (args.list) return 'termux-sensor -l';
        const sensor = args.sensor ?? '';
        const count = args.count ?? 1;
        if (!sensor) throw new Error('sensor requires args.sensor (or args.list = true)');
        return `termux-sensor -s ${shellQuote(sensor)} -n ${count}`;
      }

      // ── Fingerprint ───────────────────────────────────────────────────────
      case 'fingerprint':
        return 'termux-fingerprint';

      // ── Dialog ────────────────────────────────────────────────────────────
      case 'dialog': {
        const type = args.type ?? 'text';
        let cmd = `termux-dialog ${shellQuote(type)}`;
        if (args.title) cmd += ` -t ${shellQuote(args.title)}`;
        if (args.hint) cmd += ` -i ${shellQuote(args.hint)}`;
        if (args.values) cmd += ` -v ${shellQuote(args.values)}`;
        return cmd;
      }

      // ── Share ─────────────────────────────────────────────────────────────
      case 'share': {
        let cmd = 'termux-share';
        if (args.action) cmd += ` -a ${shellQuote(args.action)}`;
        if (args.content_type) cmd += ` -c ${shellQuote(args.content_type)}`;
        if (args.default_wrap !== undefined) cmd += ` -d ${shellQuote(String(args.default_wrap))}`;
        if (args.title) cmd += ` -t ${shellQuote(args.title)}`;
        const target = args.file ?? args.text ?? '';
        if (!target) throw new Error('share requires args.file or args.text');
        cmd += ` ${shellQuote(target)}`;
        return cmd;
      }

      // ── Storage get ───────────────────────────────────────────────────────
      case 'storage_get': {
        const filepath = args.filepath ?? '';
        if (!filepath) throw new Error('storage_get requires args.filepath');
        return `termux-storage-get ${shellQuote(filepath)}`;
      }

      // ── Toast ─────────────────────────────────────────────────────────────
      case 'toast': {
        const text = args.text ?? '';
        if (!text) throw new Error('toast requires args.text');
        let cmd = 'termux-toast';
        if (args.short) cmd += ' -s';
        if (args.background) cmd += ` -b ${shellQuote(args.background)}`;
        if (args.color) cmd += ` -c ${shellQuote(args.color)}`;
        if (args.gravity) cmd += ` -g ${shellQuote(args.gravity)}`;
        cmd += ` ${shellQuote(text)}`;
        return cmd;
      }

      default:
        return null;
    }
  }

  async execute(params: {
    action: string;
    args?: Record<string, any>;
    timeout?: number;
  }): Promise<ToolResult> {
    const { action, args = {}, timeout = 30000 } = params;

    logger.info(`TermuxApiTool executing action: ${action}`, { args });

    if (!this.isTermux()) {
      return {
        success: false,
        error:
          'Not running in a Termux environment. TERMUX_VERSION env var not set and /data/data/com.termux not found.',
      };
    }

    let command: string | null;
    try {
      command = this.buildCommand(action, args);
    } catch (error: any) {
      return { success: false, error: `Invalid arguments for action "${action}": ${error.message}` };
    }

    if (command === null) {
      return {
        success: false,
        error: `Unknown Termux:API action: "${action}". See tool description for available actions.`,
      };
    }

    logger.info(`TermuxApiTool running: ${command}`);

    try {
      const stdout = execSync(command, {
        encoding: 'utf8',
        timeout,
      }).trim();

      // Attempt JSON parse for commands that return structured data
      let data: any = stdout;
      if (stdout.startsWith('{') || stdout.startsWith('[')) {
        try {
          data = JSON.parse(stdout);
        } catch {
          // Leave as raw string if JSON parse fails
        }
      }

      return { success: true, data };
    } catch (error: any) {
      const stderr: string = error.stderr?.toString().trim() ?? '';
      logger.error(`TermuxApiTool error for action "${action}"`, { error: error.message, stderr });
      return {
        success: false,
        error: error.message + (stderr ? `\nstderr: ${stderr}` : ''),
      };
    }
  }
}

/**
 * Wraps a string in single quotes and escapes any embedded single quotes,
 * making it safe to embed in a shell command string.
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export const termuxApiTool = new TermuxApiTool();
export default termuxApiTool;
