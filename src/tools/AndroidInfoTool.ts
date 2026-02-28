import { execSync } from 'child_process';
import fs from 'fs';
import { Tool, ToolResult } from '../gateway/types';
import { logger } from '../logger';

/**
 * AndroidInfoTool — provides comprehensive Android device information.
 *
 * Collects data from Termux:API commands, Android system properties (`getprop`),
 * Linux pseudo-filesystems (`/proc`, `/sys`), and standard POSIX utilities.
 *
 * All sub-collectors are individually wrapped in try-catch so a missing binary
 * or permission error in one section never prevents the others from running.
 */
export class AndroidInfoTool implements Tool {
  name = 'android_info';
  description =
    'Get comprehensive Android device information including battery, storage, memory, running apps, Android version, device model, root status, installed packages, and Termux environment details.';

  parameters = {
    type: 'object',
    properties: {
      info_type: {
        type: 'string',
        enum: [
          'all',
          'battery',
          'storage',
          'memory',
          'device',
          'root_status',
          'termux_env',
          'running_apps',
          'network',
          'sensors',
        ],
        description:
          'Which category of information to retrieve. Use "all" to collect everything.',
      },
    },
    required: ['info_type'],
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Run a command and return trimmed stdout, or null on error. */
  private run(cmd: string, timeout = 10000): string | null {
    try {
      return execSync(cmd, { encoding: 'utf8', timeout }).trim();
    } catch {
      return null;
    }
  }

  /** Run a command and parse its stdout as JSON, or return null on error. */
  private runJson(cmd: string, timeout = 10000): any | null {
    const raw = this.run(cmd, timeout);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw; // return raw string if not valid JSON
    }
  }

  /** Read a file and return its trimmed content, or null if unreadable. */
  private readFile(path: string): string | null {
    try {
      return fs.readFileSync(path, 'utf8').trim();
    } catch {
      return null;
    }
  }

  /** Check whether a file or directory exists. */
  private exists(path: string): boolean {
    try {
      return fs.existsSync(path);
    } catch {
      return false;
    }
  }

  // ── Section collectors ────────────────────────────────────────────────────

  /** Battery information via Termux:API or /sys fallback. */
  private getBattery(): any {
    // Prefer Termux:API — returns rich JSON
    const termuxResult = this.runJson('termux-battery-status', 8000);
    if (termuxResult) return { source: 'termux-api', ...termuxResult };

    // Fallback: read sysfs power_supply files
    const base = '/sys/class/power_supply/battery';
    if (!this.exists(base)) return { error: 'Battery info unavailable' };

    const readSys = (file: string) => this.readFile(`${base}/${file}`);
    return {
      source: 'sysfs',
      status: readSys('status'),
      capacity: readSys('capacity'),
      health: readSys('health'),
      technology: readSys('technology'),
      voltage_now: readSys('voltage_now'),
      current_now: readSys('current_now'),
      temp: readSys('temp'),
      charge_full: readSys('charge_full'),
      charge_now: readSys('charge_now'),
    };
  }

  /** Storage information from `df -h` plus Android-specific mount points. */
  private getStorage(): any {
    const result: any = {};

    // Generic df output
    const dfRaw = this.run('df -h');
    if (dfRaw) {
      const lines = dfRaw.split('\n').slice(1); // skip header
      result.filesystems = lines
        .filter((l) => l.trim())
        .map((line) => {
          const parts = line.trim().split(/\s+/);
          return {
            filesystem: parts[0],
            size: parts[1],
            used: parts[2],
            available: parts[3],
            use_percent: parts[4],
            mount: parts[5],
          };
        });
    }

    // Android-specific storage paths
    const androidPaths = [
      '/sdcard',
      '/storage/emulated/0',
      '/storage/sdcard1',
      '/data',
    ];
    result.android_storage = androidPaths.map((p) => ({
      path: p,
      exists: this.exists(p),
      df: this.run(`df -h ${p} 2>/dev/null | tail -1`),
    }));

    return result;
  }

  /** Memory information from /proc/meminfo. */
  private getMemory(): any {
    const raw = this.readFile('/proc/meminfo');
    if (!raw) return { error: '/proc/meminfo not readable' };

    const parsed: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const match = line.match(/^(\S+):\s+(.+)$/);
      if (match) parsed[match[1]] = match[2].trim();
    }
    return { source: '/proc/meminfo', ...parsed };
  }

  /** Device identity from getprop and /proc/cpuinfo. */
  private getDevice(): any {
    const getprop = (key: string) => this.run(`getprop ${key} 2>/dev/null`);

    const cpuinfoRaw = this.readFile('/proc/cpuinfo');
    const cpuLines: Record<string, string> = {};
    if (cpuinfoRaw) {
      for (const line of cpuinfoRaw.split('\n')) {
        const match = line.match(/^([^:]+):\s*(.+)$/);
        if (match) {
          const key = match[1].trim();
          if (!cpuLines[key]) cpuLines[key] = match[2].trim();
        }
      }
    }

    return {
      model: getprop('ro.product.model'),
      manufacturer: getprop('ro.product.manufacturer'),
      brand: getprop('ro.product.brand'),
      device: getprop('ro.product.device'),
      android_version: getprop('ro.build.version.release'),
      sdk_version: getprop('ro.build.version.sdk'),
      build_id: getprop('ro.build.id'),
      build_type: getprop('ro.build.type'),
      hardware: getprop('ro.hardware'),
      cpu_abi: getprop('ro.product.cpu.abi'),
      cpu_model: cpuLines['Hardware'] ?? cpuLines['model name'] ?? null,
      cpu_cores: this.run('nproc 2>/dev/null'),
      kernel: this.run('uname -r 2>/dev/null'),
      arch: this.run('uname -m 2>/dev/null'),
    };
  }

  /** Root status detection via common su/Magisk/SuperSU paths. */
  private getRootStatus(): any {
    const suPaths = [
      '/system/bin/su',
      '/sbin/su',
      '/system/xbin/su',
      '/system/sd/xbin/su',
    ];
    const foundSu = suPaths.filter((p) => this.exists(p));

    const magiskPaths = ['/sbin/.magisk', '/data/adb/magisk', '/data/adb/ksu'];
    const foundMagisk = magiskPaths.filter((p) => this.exists(p));

    const supersuPaths = [
      '/system/app/Superuser.apk',
      '/system/app/SuperSU/SuperSU.apk',
    ];
    const foundSuperSU = supersuPaths.filter((p) => this.exists(p));

    const suOnPath = this.run('which su 2>/dev/null');
    const sudoOnPath = this.run('which sudo 2>/dev/null');

    // Try to actually run a root command as a definitive test
    let canRunRoot: boolean | null = null;
    try {
      execSync('su -c "id" 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
      canRunRoot = true;
    } catch {
      canRunRoot = false;
    }

    const isRooted =
      foundSu.length > 0 ||
      foundMagisk.length > 0 ||
      foundSuperSU.length > 0 ||
      canRunRoot === true;

    return {
      is_rooted: isRooted,
      can_run_root_commands: canRunRoot,
      su_binaries_found: foundSu,
      su_on_path: suOnPath,
      sudo_on_path: sudoOnPath,
      magisk_paths_found: foundMagisk,
      supersu_paths_found: foundSuperSU,
    };
  }

  /** Termux environment details. */
  private getTermuxEnv(): any {
    const termuxVersion = process.env.TERMUX_VERSION ?? null;
    const prefix = process.env.PREFIX ?? null;
    const home = process.env.HOME ?? null;
    const isTermux = !!(termuxVersion || this.exists('/data/data/com.termux'));

    // Check for optional Termux add-ons
    const termuxApiAvailable = !!this.run('which termux-battery-status 2>/dev/null');
    const termuxBootPath = `${prefix ?? '/data/data/com.termux/files/usr'}/var/service/boot`;
    const termuxBootInstalled = this.exists(termuxBootPath);
    const termuxWidgetPath = '/data/data/com.termux.widget';
    const termuxWidgetInstalled = this.exists(termuxWidgetPath);

    // Installed Termux packages count (best-effort)
    const pkgCount = this.run('dpkg -l 2>/dev/null | grep -c "^ii"');

    return {
      is_termux: isTermux,
      termux_version: termuxVersion,
      prefix,
      home,
      shell: process.env.SHELL ?? null,
      path: process.env.PATH ?? null,
      termux_api_available: termuxApiAvailable,
      termux_boot_installed: termuxBootInstalled,
      termux_widget_installed: termuxWidgetInstalled,
      installed_package_count: pkgCount ? parseInt(pkgCount, 10) : null,
      node_version: process.version,
      node_arch: process.arch,
      node_platform: process.platform,
    };
  }

  /** Running processes filtered to interesting entries. */
  private getRunningApps(): any {
    // Try `ps aux` first (Termux/Linux), fall back to `ps -A` (BusyBox Android)
    let psOutput = this.run('ps aux 2>/dev/null');
    let format = 'aux';
    if (!psOutput || psOutput.split('\n').length < 3) {
      psOutput = this.run('ps -A 2>/dev/null');
      format = '-A';
    }

    if (!psOutput) return { error: 'ps command unavailable' };

    const lines = psOutput.split('\n').filter((l) => l.trim());
    const header = lines[0];
    const processes = lines.slice(1).map((line) => {
      const parts = line.trim().split(/\s+/);
      if (format === 'aux') {
        return {
          user: parts[0],
          pid: parts[1],
          cpu: parts[2],
          mem: parts[3],
          command: parts.slice(10).join(' '),
        };
      }
      // BusyBox ps -A: USER PID PPID VSIZE RSS WCHAN PC NAME
      return {
        user: parts[0],
        pid: parts[1],
        ppid: parts[2],
        command: parts[parts.length - 1],
      };
    });

    // Filter for interesting processes (non-kernel, non-trivial)
    const interesting = processes.filter((p) => {
      const cmd = (p.command ?? '').toLowerCase();
      return (
        cmd.includes('node') ||
        cmd.includes('python') ||
        cmd.includes('java') ||
        cmd.includes('termux') ||
        cmd.includes('ssh') ||
        cmd.includes('nginx') ||
        cmd.includes('apache') ||
        cmd.includes('mysql') ||
        cmd.includes('postgres') ||
        cmd.includes('redis') ||
        cmd.includes('pm2') ||
        cmd.includes('superclaw')
      );
    });

    return {
      total_processes: processes.length,
      ps_format: format,
      header,
      interesting_processes: interesting,
      all_processes: processes,
    };
  }

  /** Network interface and routing information. */
  private getNetwork(): any {
    const ipAddr = this.run('ip addr show 2>/dev/null');
    const ipRoute = this.run('ip route show 2>/dev/null');
    const ifconfig = ipAddr ? null : this.run('ifconfig 2>/dev/null'); // fallback

    // DNS servers
    const resolvConf = this.readFile('/etc/resolv.conf');

    // Active connections (best-effort)
    const netstat = this.run('ss -tunp 2>/dev/null') ?? this.run('netstat -tunp 2>/dev/null');

    return {
      ip_addr: ipAddr ?? ifconfig,
      ip_route: ipRoute,
      resolv_conf: resolvConf,
      active_connections: netstat,
    };
  }

  /** Sensor list via termux-sensor. */
  private getSensors(): any {
    const sensorList = this.runJson('termux-sensor -l 2>/dev/null', 10000);
    if (!sensorList) {
      return {
        error:
          'termux-sensor not available. Install termux-api package: pkg install termux-api',
      };
    }
    return { sensors: sensorList };
  }

  // ── Main execute ──────────────────────────────────────────────────────────

  async execute(params: { info_type: string }): Promise<ToolResult> {
    const { info_type } = params;

    logger.info(`AndroidInfoTool executing info_type: ${info_type}`);

    try {
      const result: any = {};

      if (info_type === 'all' || info_type === 'battery') {
        try {
          result.battery = this.getBattery();
        } catch (e: any) {
          result.battery = { error: e.message };
        }
      }

      if (info_type === 'all' || info_type === 'storage') {
        try {
          result.storage = this.getStorage();
        } catch (e: any) {
          result.storage = { error: e.message };
        }
      }

      if (info_type === 'all' || info_type === 'memory') {
        try {
          result.memory = this.getMemory();
        } catch (e: any) {
          result.memory = { error: e.message };
        }
      }

      if (info_type === 'all' || info_type === 'device') {
        try {
          result.device = this.getDevice();
        } catch (e: any) {
          result.device = { error: e.message };
        }
      }

      if (info_type === 'all' || info_type === 'root_status') {
        try {
          result.root_status = this.getRootStatus();
        } catch (e: any) {
          result.root_status = { error: e.message };
        }
      }

      if (info_type === 'all' || info_type === 'termux_env') {
        try {
          result.termux_env = this.getTermuxEnv();
        } catch (e: any) {
          result.termux_env = { error: e.message };
        }
      }

      if (info_type === 'all' || info_type === 'running_apps') {
        try {
          result.running_apps = this.getRunningApps();
        } catch (e: any) {
          result.running_apps = { error: e.message };
        }
      }

      if (info_type === 'all' || info_type === 'network') {
        try {
          result.network = this.getNetwork();
        } catch (e: any) {
          result.network = { error: e.message };
        }
      }

      if (info_type === 'all' || info_type === 'sensors') {
        try {
          result.sensors = this.getSensors();
        } catch (e: any) {
          result.sensors = { error: e.message };
        }
      }

      return { success: true, data: result };
    } catch (error: any) {
      logger.error('AndroidInfoTool error', { error: error.message });
      return { success: false, error: error.message };
    }
  }
}

export const androidInfoTool = new AndroidInfoTool();
export default androidInfoTool;
