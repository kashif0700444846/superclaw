import axios, { AxiosRequestConfig, Method } from 'axios';
import { Tool, ToolResult } from '../gateway/types';
import { logger } from '../logger';

export class HttpRequestTool implements Tool {
  name = 'http_request';
  description = 'Makes HTTP requests (GET, POST, PUT, DELETE). Supports custom headers, body, and authentication.';
  parameters = {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to request' },
      method: {
        type: 'string',
        enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
        description: 'HTTP method (default: GET)',
      },
      headers: {
        type: 'object',
        description: 'Custom HTTP headers as key-value pairs',
      },
      body: {
        description: 'Request body (for POST/PUT/PATCH)',
      },
      auth: {
        type: 'object',
        properties: {
          username: { type: 'string' },
          password: { type: 'string' },
        },
        description: 'Basic auth credentials',
      },
      timeout: {
        type: 'number',
        description: 'Request timeout in milliseconds (default: 15000)',
      },
    },
    required: ['url'],
  };

  async execute(params: {
    url: string;
    method?: Method;
    headers?: Record<string, string>;
    body?: any;
    auth?: { username: string; password: string };
    timeout?: number;
  }): Promise<ToolResult> {
    const { url, method = 'GET', headers = {}, body, auth, timeout = 15000 } = params;

    logger.info(`HttpRequestTool: ${method} ${url}`);

    try {
      const config: AxiosRequestConfig = {
        url,
        method,
        headers,
        data: body,
        auth,
        timeout,
        validateStatus: () => true, // Don't throw on non-2xx
      };

      const response = await axios(config);

      return {
        success: true,
        data: {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          body: response.data,
        },
      };
    } catch (error: any) {
      logger.error(`HttpRequestTool error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}

export const httpRequestTool = new HttpRequestTool();
export default httpRequestTool;
