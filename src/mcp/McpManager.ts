import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { McpClient, McpServerConfig } from './McpClient';
import { logger } from '../logger';
import { Tool, ToolResult } from '../gateway/types';

const MCP_CONFIG_PATH = path.join(process.cwd(), 'mcp-servers.json');

export class McpManager {
  private clients = new Map<string, McpClient>();
  private configs: McpServerConfig[] = [];

  constructor() {
    this.loadConfigs();
  }

  private loadConfigs(): void {
    if (fs.existsSync(MCP_CONFIG_PATH)) {
      try {
        const data = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf8'));
        this.configs = data.servers || [];
        logger.info(`McpManager: loaded ${this.configs.length} MCP server configs`);
      } catch (e: any) {
        logger.error(`McpManager: failed to load configs: ${e.message}`);
        this.configs = [];
      }
    }
  }

  private saveConfigs(): void {
    fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify({ servers: this.configs }, null, 2));
  }

  async startAll(): Promise<void> {
    for (const config of this.configs) {
      try {
        await this.startServer(config.name);
      } catch (e: any) {
        logger.error(`McpManager: failed to start ${config.name}: ${e.message}`);
      }
    }
  }

  async startServer(name: string): Promise<void> {
    const config = this.configs.find(c => c.name === name);
    if (!config) throw new Error(`MCP server config not found: ${name}`);

    if (this.clients.has(name) && this.clients.get(name)!.isConnected()) {
      logger.info(`McpManager: ${name} already running`);
      return;
    }

    const client = new McpClient(config);
    await client.connect();
    this.clients.set(name, client);
    logger.info(`McpManager: started ${name}`);
  }

  async stopServer(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (client) {
      await client.disconnect();
      this.clients.delete(name);
    }
  }

  async addServer(config: McpServerConfig): Promise<void> {
    // Remove existing config with same name
    this.configs = this.configs.filter(c => c.name !== config.name);
    this.configs.push(config);
    this.saveConfigs();

    // Start the server
    await this.startServer(config.name);
  }

  async removeServer(name: string): Promise<void> {
    await this.stopServer(name);
    this.configs = this.configs.filter(c => c.name !== name);
    this.saveConfigs();
  }

  getStatus(): Array<{ name: string; connected: boolean; tools: number; config: McpServerConfig }> {
    return this.configs.map(config => {
      const client = this.clients.get(config.name);
      return {
        name: config.name,
        connected: client?.isConnected() ?? false,
        tools: client?.getTools().length ?? 0,
        config,
      };
    });
  }

  // Get all MCP tools as SuperClaw Tool objects for registration in ToolRegistry
  getMcpTools(): Tool[] {
    const tools: Tool[] = [];

    for (const [serverName, client] of this.clients) {
      if (!client.isConnected()) continue;

      for (const mcpTool of client.getTools()) {
        const tool: Tool = {
          name: `mcp_${serverName}_${mcpTool.name}`,
          description: `[MCP:${serverName}] ${mcpTool.description}`,
          parameters: mcpTool.inputSchema,
          execute: async (params: any): Promise<ToolResult> => {
            try {
              const result = await client.callTool(mcpTool.name, params);
              return { success: true, data: result };
            } catch (error: any) {
              return { success: false, error: error.message };
            }
          },
        };
        tools.push(tool);
      }
    }

    return tools;
  }

  // Install an MCP server package
  async installPackage(packageName: string): Promise<string> {
    logger.info(`McpManager: installing ${packageName}`);
    const output = execSync(`npm install -g ${packageName}`, { encoding: 'utf8', timeout: 120000 });
    return output;
  }
}

// Singleton
export const mcpManager = new McpManager();
