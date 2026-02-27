import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import { Tool, ToolResult } from '../gateway/types';
import { logger } from '../logger';

const execAsync = promisify(exec);

export class SystemInfoTool implements Tool {
  name = 'system_info';
  description = 'Returns comprehensive system information: CPU usage, RAM, disk usage, network interfaces, uptime, and OS version.';
  parameters = {
    type: 'object',
    properties: {
      section: {
        type: 'string',
        enum: ['all', 'cpu', 'memory', 'disk', 'network', 'uptime', 'os'],
        description: 'Which section to return (default: all)',
      },
    },
    required: [],
  };

  private formatBytes(bytes: number): string {
    const gb = bytes / (1024 ** 3);
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    const mb = bytes / (1024 ** 2);
    return `${mb.toFixed(2)} MB`;
  }

  private async getCpuUsage(): Promise<number> {
    return new Promise((resolve) => {
      const start = os.cpus().map((c) => c.times);
      setTimeout(() => {
        const end = os.cpus().map((c) => c.times);
        let totalIdle = 0, totalTick = 0;
        for (let i = 0; i < start.length; i++) {
          const startTimes = start[i];
          const endTimes = end[i];
          const idle = endTimes.idle - startTimes.idle;
          const total = Object.values(endTimes).reduce((a, b) => a + b, 0) -
                        Object.values(startTimes).reduce((a, b) => a + b, 0);
          totalIdle += idle;
          totalTick += total;
        }
        resolve(Math.round((1 - totalIdle / totalTick) * 100));
      }, 500);
    });
  }

  async execute(params: { section?: string }): Promise<ToolResult> {
    const { section = 'all' } = params;

    try {
      const result: any = {};

      if (section === 'all' || section === 'cpu') {
        const cpuUsage = await this.getCpuUsage();
        result.cpu = {
          usage_percent: cpuUsage,
          model: os.cpus()[0]?.model || 'Unknown',
          cores: os.cpus().length,
          load_avg: os.loadavg(),
        };
      }

      if (section === 'all' || section === 'memory') {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        result.memory = {
          total: this.formatBytes(totalMem),
          used: this.formatBytes(usedMem),
          free: this.formatBytes(freeMem),
          usage_percent: Math.round((usedMem / totalMem) * 100),
        };
      }

      if (section === 'all' || section === 'disk') {
        try {
          const { stdout } = await execAsync("df -h --output=source,size,used,avail,pcent,target | tail -n +2");
          const disks = stdout.trim().split('\n').map((line) => {
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
          result.disk = disks;
        } catch {
          result.disk = 'Unable to retrieve disk info';
        }
      }

      if (section === 'all' || section === 'network') {
        const interfaces = os.networkInterfaces();
        result.network = Object.entries(interfaces).map(([name, addrs]) => ({
          interface: name,
          addresses: (addrs || []).map((a) => ({
            address: a.address,
            family: a.family,
            internal: a.internal,
          })),
        }));
      }

      if (section === 'all' || section === 'uptime') {
        const uptimeSeconds = os.uptime();
        const days = Math.floor(uptimeSeconds / 86400);
        const hours = Math.floor((uptimeSeconds % 86400) / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);
        result.uptime = {
          seconds: uptimeSeconds,
          formatted: `${days}d ${hours}h ${minutes}m`,
        };
      }

      if (section === 'all' || section === 'os') {
        result.os = {
          platform: os.platform(),
          release: os.release(),
          arch: os.arch(),
          hostname: os.hostname(),
          type: os.type(),
        };
      }

      return { success: true, data: result };
    } catch (error: any) {
      logger.error(`SystemInfoTool error`, { error });
      return { success: false, error: error.message };
    }
  }
}

export const systemInfoTool = new SystemInfoTool();
export default systemInfoTool;
