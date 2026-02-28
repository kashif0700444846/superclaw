import { Tool } from '../gateway/types';
import { logger } from '../logger';
import { isToolEnabled } from '../superclawConfig';

// Core tools — always imported (small, no heavy deps)
import { SelfUpdateTool } from '../tools/SelfUpdateTool';
import { shellTool } from '../tools/ShellTool';
import { fileReadTool } from '../tools/FileReadTool';
import { fileWriteTool } from '../tools/FileWriteTool';
import { fileListTool } from '../tools/FileListTool';
import { httpRequestTool } from '../tools/HttpRequestTool';
import { packageManagerTool } from '../tools/PackageManagerTool';
import { serviceManagerTool } from '../tools/ServiceManagerTool';
import { cronManagerTool } from '../tools/CronManagerTool';
import { processManagerTool } from '../tools/ProcessManagerTool';
import { systemInfoTool } from '../tools/SystemInfoTool';
import { memoryReadTool } from '../tools/MemoryReadTool';
import { memoryWriteTool } from '../tools/MemoryWriteTool';
import { aiQueryTool } from '../tools/AiQueryTool';

// Sub-agent management tools
import { spawnAgentTool } from '../tools/SpawnAgentTool';
import { checkAgentTool } from '../tools/CheckAgentTool';
import { listAgentsTool } from '../tools/ListAgentsTool';
import { killAgentTool } from '../tools/KillAgentTool';

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  constructor() {
    this.registerAll();
  }

  private registerAll(): void {
    // Core tools — always registered regardless of config
    const coreTools: Tool[] = [
      new SelfUpdateTool(),
      shellTool,
      fileReadTool,
      fileWriteTool,
      fileListTool,
      httpRequestTool,
      packageManagerTool,
      serviceManagerTool,
      cronManagerTool,
      processManagerTool,
      systemInfoTool,
      memoryReadTool,
      memoryWriteTool,
      aiQueryTool,
      // Sub-agent management tools
      spawnAgentTool,
      checkAgentTool,
      listAgentsTool,
      killAgentTool,
    ];

    for (const tool of coreTools) {
      this.tools.set(tool.name, tool);
      logger.debug(`Registered core tool: ${tool.name}`);
    }

    // Optional: web_search — only if enabled in config
    if (isToolEnabled('web_search')) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { webSearchTool } = require('../tools/WebSearchTool');
        this.tools.set(webSearchTool.name, webSearchTool);
        logger.debug('Registered optional tool: web_search');
      } catch (e: any) {
        logger.warn('web_search tool failed to load', { error: e.message });
      }
    } else {
      logger.debug('web_search tool disabled by config');
    }

    // Optional: code_executor — only if enabled in config
    if (isToolEnabled('code_executor')) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { codeExecutorTool } = require('../tools/CodeExecutorTool');
        this.tools.set(codeExecutorTool.name, codeExecutorTool);
        logger.debug('Registered optional tool: code_executor');
      } catch (e: any) {
        logger.warn('code_executor tool failed to load', { error: e.message });
      }
    } else {
      logger.debug('code_executor tool disabled by config');
    }

    logger.info(`ToolRegistry: ${this.tools.size} tools registered`);
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
    logger.info(`Registered tool: ${tool.name}`);
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  toOpenAiFunctions(): Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, any>;
    };
  }> {
    return this.getAllTools().map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  toDescriptionList(): string {
    return this.getAllTools()
      .map((tool) => `- **${tool.name}**: ${tool.description}`)
      .join('\n');
  }

  /**
   * Set the notify callback on SpawnAgentTool so sub-agent progress
   * notifications are pushed to the current user's chat.
   */
  setNotifyCallback(cb: (message: string) => void): void {
    const spawnTool = this.tools.get('spawn_agent') as (typeof spawnAgentTool) | undefined;
    if (spawnTool && typeof (spawnTool as any).setNotifyCallback === 'function') {
      // SpawnAgentTool delegates to agentOrchestrator directly, so we set
      // the callback on the orchestrator instead (Brain.ts does this).
      // This method is kept for API compatibility.
    }
  }
}

export const toolRegistry = new ToolRegistry();
export default toolRegistry;
