import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { logger } from '../logger';

interface McpRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: any;
}

interface McpResponse {
  jsonrpc: '2.0';
  id: number;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface McpServerConfig {
  name: string;           // e.g., "filesystem"
  command: string;        // e.g., "npx"
  args: string[];         // e.g., ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
  env?: Record<string, string>;
  description?: string;
  installCommand?: string; // e.g., "npm install -g @modelcontextprotocol/server-filesystem"
}

export class McpClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: Function; reject: Function }>();
  private buffer = '';
  private tools: McpTool[] = [];
  private initialized = false;
  public readonly config: McpServerConfig;

  constructor(config: McpServerConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    // Spawn the MCP server process
    this.process = spawn(this.config.command, this.config.args, {
      env: { ...process.env, ...this.config.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Handle stdout (JSON-RPC responses)
    this.process.stdout!.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    // Handle stderr (logs from MCP server)
    this.process.stderr!.on('data', (data: Buffer) => {
      logger.debug(`MCP[${this.config.name}] stderr: ${data.toString().trim()}`);
    });

    // Handle process exit
    this.process.on('exit', (code) => {
      logger.info(`MCP[${this.config.name}] process exited with code ${code}`);
      this.initialized = false;
      this.emit('disconnected');
      // Reject all pending requests
      for (const [, { reject }] of this.pendingRequests) {
        reject(new Error(`MCP server ${this.config.name} disconnected`));
      }
      this.pendingRequests.clear();
    });

    this.process.on('error', (err) => {
      logger.error(`MCP[${this.config.name}] process error: ${err.message}`);
      this.emit('error', err);
    });

    // Wait for process to be ready (small delay)
    await new Promise(resolve => setTimeout(resolve, 500));

    // Send initialize request
    await this.initialize();
  }

  private processBuffer(): void {
    // MCP uses newline-delimited JSON
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const message = JSON.parse(trimmed) as McpResponse;
        if (message.id !== undefined) {
          const pending = this.pendingRequests.get(message.id);
          if (pending) {
            this.pendingRequests.delete(message.id);
            if (message.error) {
              pending.reject(new Error(message.error.message));
            } else {
              pending.resolve(message.result);
            }
          }
        }
      } catch (e) {
        // Not JSON, ignore
      }
    }
  }

  private async sendRequest(method: string, params?: any): Promise<any> {
    const id = ++this.requestId;
    const request: McpRequest = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      const resolveWithTimeout = (result: any) => {
        clearTimeout(timeout);
        resolve(result);
      };
      const rejectWithTimeout = (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      };

      this.pendingRequests.set(id, { resolve: resolveWithTimeout, reject: rejectWithTimeout });

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP request timeout: ${method}`));
      }, 30000);

      const line = JSON.stringify(request) + '\n';
      this.process!.stdin!.write(line);
    });
  }

  private async initialize(): Promise<void> {
    const result = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'superclaw', version: '1.0.0' },
    });

    logger.info(`MCP[${this.config.name}] initialized: ${JSON.stringify(result.serverInfo || {})}`);

    // Send initialized notification
    const notification = { jsonrpc: '2.0', method: 'notifications/initialized' };
    this.process!.stdin!.write(JSON.stringify(notification) + '\n');

    this.initialized = true;

    // Fetch tools list
    await this.refreshTools();
  }

  async refreshTools(): Promise<McpTool[]> {
    const result = await this.sendRequest('tools/list');
    this.tools = result.tools || [];
    logger.info(`MCP[${this.config.name}] loaded ${this.tools.length} tools: ${this.tools.map((t: McpTool) => t.name).join(', ')}`);
    return this.tools;
  }

  getTools(): McpTool[] {
    return this.tools;
  }

  async callTool(name: string, args: Record<string, any>): Promise<any> {
    if (!this.initialized) {
      throw new Error(`MCP server ${this.config.name} not initialized`);
    }

    const result = await this.sendRequest('tools/call', {
      name,
      arguments: args,
    });

    // MCP tool results have a content array
    if (result.content && Array.isArray(result.content)) {
      return result.content.map((c: any) => {
        if (c.type === 'text') return c.text;
        if (c.type === 'image') return `[Image: ${c.mimeType}]`;
        return JSON.stringify(c);
      }).join('\n');
    }

    return result;
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
      this.initialized = false;
    }
  }

  isConnected(): boolean {
    return this.initialized && this.process !== null && !this.process.killed;
  }
}
