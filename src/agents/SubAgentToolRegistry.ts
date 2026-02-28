// src/agents/SubAgentToolRegistry.ts
// A ToolRegistry variant for sub-agents.
// Registers all core tools EXCEPT the 4 agent management tools
// (spawn_agent, check_agent, list_agents, kill_agent) to prevent
// recursive sub-agent spawning.

import fs from 'fs';
import { Tool } from '../gateway/types';
import { logger } from '../logger';

// Core tools — same as master but without agent management tools
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

// Android / Termux tools
import { termuxApiTool } from '../tools/TermuxApiTool';
import { rootShellTool } from '../tools/RootShellTool';
import { androidInfoTool } from '../tools/AndroidInfoTool';
import { daemonManagerTool } from '../tools/DaemonManagerTool';

// Agent management tool names — explicitly excluded from sub-agents
const AGENT_TOOL_NAMES = new Set([
  'spawn_agent',
  'check_agent',
  'list_agents',
  'kill_agent',
]);

export class SubAgentToolRegistry {
  private tools: Map<string, Tool> = new Map();

  constructor() {
    this.registerAll();
  }

  private registerAll(): void {
    const coreTools: Tool[] = [
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
      // Daemon / service management
      daemonManagerTool,
    ];

    for (const tool of coreTools) {
      if (!AGENT_TOOL_NAMES.has(tool.name)) {
        this.tools.set(tool.name, tool);
        logger.debug(`SubAgentToolRegistry: registered ${tool.name}`);
      }
    }

    // Optional: web_search
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { webSearchTool } = require('../tools/WebSearchTool');
      if (!AGENT_TOOL_NAMES.has(webSearchTool.name)) {
        this.tools.set(webSearchTool.name, webSearchTool);
        logger.debug('SubAgentToolRegistry: registered web_search');
      }
    } catch {
      // web_search not available — skip silently
    }

    // Optional: code_executor
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { codeExecutorTool } = require('../tools/CodeExecutorTool');
      if (!AGENT_TOOL_NAMES.has(codeExecutorTool.name)) {
        this.tools.set(codeExecutorTool.name, codeExecutorTool);
        logger.debug('SubAgentToolRegistry: registered code_executor');
      }
    } catch {
      // code_executor not available — skip silently
    }

    // Optional: browser_automate
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { browserAutomationTool } = require('../tools/BrowserAutomationTool');
      if (!AGENT_TOOL_NAMES.has(browserAutomationTool.name)) {
        this.tools.set(browserAutomationTool.name, browserAutomationTool);
        logger.debug('SubAgentToolRegistry: registered browser_automate');
      }
    } catch {
      // browser_automate not available — skip silently
    }

    // Android tools — conditionally registered based on environment
    const isTermux =
      !!process.env.TERMUX_VERSION || fs.existsSync('/data/data/com.termux');

    // termux_api — only in Termux environments
    if (isTermux) {
      this.tools.set(termuxApiTool.name, termuxApiTool);
      logger.debug('SubAgentToolRegistry: registered termux_api');
    } else {
      logger.debug('SubAgentToolRegistry: termux_api skipped — not a Termux environment');
    }

    // root_shell — always register (works on Android root and Linux sudo)
    this.tools.set(rootShellTool.name, rootShellTool);
    logger.debug('SubAgentToolRegistry: registered root_shell');

    // android_info — always register (gracefully handles non-Android environments)
    this.tools.set(androidInfoTool.name, androidInfoTool);
    logger.debug('SubAgentToolRegistry: registered android_info');

    logger.info(`SubAgentToolRegistry: ${this.tools.size} tools registered`);
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
}
