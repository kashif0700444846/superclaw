import { Tool, ToolResult } from '../gateway/types';
import { logger } from '../logger';
import { mcpManager } from '../mcp/McpManager';
import { McpServerConfig } from '../mcp/McpClient';

export class McpTool implements Tool {
  name = 'mcp_manager';
  description = `Manage MCP (Model Context Protocol) servers. MCP servers extend SuperClaw with additional tools from the ecosystem. Browse servers at https://glama.ai/mcp/servers.
  
Actions:
- list: List all configured MCP servers and their status
- search: Search for MCP servers on glama.ai (fetches from API)
- install: Install and start an MCP server by package name
- add: Add a custom MCP server configuration
- start: Start a stopped MCP server
- stop: Stop a running MCP server
- remove: Remove an MCP server
- tools: List all tools provided by connected MCP servers
- restart: Restart an MCP server`;

  parameters = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'search', 'install', 'add', 'start', 'stop', 'remove', 'tools', 'restart'],
        description: 'Action to perform',
      },
      name: {
        type: 'string',
        description: 'MCP server name (for start/stop/remove/restart/tools actions)',
      },
      query: {
        type: 'string',
        description: 'Search query (for search action)',
      },
      package: {
        type: 'string',
        description: 'npm package name to install (for install action, e.g. "@modelcontextprotocol/server-filesystem")',
      },
      config: {
        type: 'object',
        description: 'MCP server configuration (for add action)',
        properties: {
          name: { type: 'string' },
          command: { type: 'string' },
          args: { type: 'array', items: { type: 'string' } },
          env: { type: 'object' },
          description: { type: 'string' },
        },
      },
    },
    required: ['action'],
  };

  async execute(params: {
    action: string;
    name?: string;
    query?: string;
    package?: string;
    config?: McpServerConfig;
  }): Promise<ToolResult> {
    try {
      switch (params.action) {
        case 'list': {
          const status = mcpManager.getStatus();
          if (status.length === 0) {
            return { success: true, data: 'No MCP servers configured. Use action "search" to find servers or "install" to add one.' };
          }
          return { success: true, data: status };
        }

        case 'search': {
          const query = params.query || '';
          // Fetch from glama.ai MCP servers API
          const url = `https://glama.ai/api/mcp/v1/servers?query=${encodeURIComponent(query)}&first=10`;
          const response = await fetch(url, {
            headers: { 'Accept': 'application/json', 'User-Agent': 'SuperClaw/1.0' },
          });

          if (!response.ok) {
            // Fallback: return well-known MCP servers
            return {
              success: true,
              data: {
                message: 'Could not reach glama.ai API. Here are popular MCP servers:',
                servers: POPULAR_MCP_SERVERS,
              },
            };
          }

          const data = await response.json() as any;
          return { success: true, data: data };
        }

        case 'install': {
          if (!params.package) {
            return { success: false, error: 'package parameter required for install action' };
          }

          // Install the npm package
          logger.info(`McpTool: installing ${params.package}`);
          const installOutput = await mcpManager.installPackage(params.package);

          // Auto-detect server name from package name
          const serverName = params.name || params.package.replace('@modelcontextprotocol/server-', '').replace(/[@\/]/g, '-').replace(/^-/, '');

          // Create a default config based on the package
          const config: McpServerConfig = {
            name: serverName,
            command: 'npx',
            args: ['-y', params.package],
            description: `MCP server: ${params.package}`,
            installCommand: `npm install -g ${params.package}`,
          };

          await mcpManager.addServer(config);

          return {
            success: true,
            data: {
              message: `MCP server "${serverName}" installed and started`,
              package: params.package,
              serverName,
              tools: mcpManager.getMcpTools().filter(t => t.name.startsWith(`mcp_${serverName}_`)).map(t => t.name),
              installOutput: installOutput.slice(0, 500),
            },
          };
        }

        case 'add': {
          if (!params.config) {
            return { success: false, error: 'config parameter required for add action' };
          }
          await mcpManager.addServer(params.config);
          return { success: true, data: `MCP server "${params.config.name}" added and started` };
        }

        case 'start': {
          if (!params.name) return { success: false, error: 'name parameter required' };
          await mcpManager.startServer(params.name);
          return { success: true, data: `MCP server "${params.name}" started` };
        }

        case 'stop': {
          if (!params.name) return { success: false, error: 'name parameter required' };
          await mcpManager.stopServer(params.name);
          return { success: true, data: `MCP server "${params.name}" stopped` };
        }

        case 'restart': {
          if (!params.name) return { success: false, error: 'name parameter required' };
          await mcpManager.stopServer(params.name);
          await new Promise(r => setTimeout(r, 1000));
          await mcpManager.startServer(params.name);
          return { success: true, data: `MCP server "${params.name}" restarted` };
        }

        case 'remove': {
          if (!params.name) return { success: false, error: 'name parameter required' };
          await mcpManager.removeServer(params.name);
          return { success: true, data: `MCP server "${params.name}" removed` };
        }

        case 'tools': {
          const mcpTools = mcpManager.getMcpTools();
          if (params.name) {
            const filtered = mcpTools.filter(t => t.name.startsWith(`mcp_${params.name}_`));
            return { success: true, data: filtered.map(t => ({ name: t.name, description: t.description })) };
          }
          return { success: true, data: mcpTools.map(t => ({ name: t.name, description: t.description })) };
        }

        default:
          return { success: false, error: `Unknown action: ${params.action}` };
      }
    } catch (error: any) {
      logger.error(`McpTool error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}

// Popular MCP servers as fallback when API is unavailable
const POPULAR_MCP_SERVERS = [
  { name: 'filesystem', package: '@modelcontextprotocol/server-filesystem', description: 'Read/write local files' },
  { name: 'github', package: '@modelcontextprotocol/server-github', description: 'GitHub API integration' },
  { name: 'postgres', package: '@modelcontextprotocol/server-postgres', description: 'PostgreSQL database access' },
  { name: 'sqlite', package: '@modelcontextprotocol/server-sqlite', description: 'SQLite database access' },
  { name: 'brave-search', package: '@modelcontextprotocol/server-brave-search', description: 'Brave Search API' },
  { name: 'puppeteer', package: '@modelcontextprotocol/server-puppeteer', description: 'Browser automation' },
  { name: 'slack', package: '@modelcontextprotocol/server-slack', description: 'Slack integration' },
  { name: 'google-maps', package: '@modelcontextprotocol/server-google-maps', description: 'Google Maps API' },
  { name: 'memory', package: '@modelcontextprotocol/server-memory', description: 'Persistent memory/knowledge graph' },
  { name: 'fetch', package: '@modelcontextprotocol/server-fetch', description: 'HTTP fetch tool' },
];

export const mcpTool = new McpTool();
