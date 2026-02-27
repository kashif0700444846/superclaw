import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { Tool, ToolResult } from '../gateway/types';
import { config } from '../config';
import { logger } from '../logger';

export class AiQueryTool implements Tool {
  name = 'ai_query';
  description = 'Sends a question to the AI to get instructions or information when the agent does not know how to accomplish a task.';
  parameters = {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'The question or task description to send to the AI',
      },
      context: {
        type: 'string',
        description: 'Additional context to include with the question',
      },
    },
    required: ['question'],
  };

  async execute(params: { question: string; context?: string }): Promise<ToolResult> {
    const { question, context } = params;
    const prompt = context ? `Context:\n${context}\n\nQuestion:\n${question}` : question;

    logger.info(`AiQueryTool querying ${config.aiProvider} with: ${question.substring(0, 100)}`);

    try {
      let response: string;

      switch (config.aiProvider) {
        case 'openai':
        case 'groq': {
          const clientConfig: any = {
            apiKey: config.aiProvider === 'openai' ? config.openaiApiKey : config.groqApiKey,
          };
          if (config.aiProvider === 'groq') {
            clientConfig.baseURL = 'https://api.groq.com/openai/v1';
          }
          const client = new OpenAI(clientConfig);
          const completion = await client.chat.completions.create({
            model: config.aiModel,
            messages: [
              {
                role: 'system',
                content: 'You are a helpful Linux systems expert. Provide clear, actionable instructions.',
              },
              { role: 'user', content: prompt },
            ],
            max_tokens: 2000,
          });
          response = completion.choices[0]?.message?.content || 'No response';
          break;
        }

        case 'anthropic': {
          const client = new Anthropic({ apiKey: config.anthropicApiKey });
          const message = await client.messages.create({
            model: config.aiModel,
            max_tokens: 2000,
            system: 'You are a helpful Linux systems expert. Provide clear, actionable instructions.',
            messages: [{ role: 'user', content: prompt }],
          });
          response = message.content[0].type === 'text' ? message.content[0].text : 'No response';
          break;
        }

        case 'ollama': {
          const res = await axios.post(`${config.ollamaBaseUrl}/api/generate`, {
            model: config.aiModel,
            prompt,
            stream: false,
          });
          response = res.data.response || 'No response';
          break;
        }

        default:
          return { success: false, error: `Unsupported AI provider: ${config.aiProvider}` };
      }

      return { success: true, data: { response } };
    } catch (error: any) {
      logger.error(`AiQueryTool error`, { error });
      return { success: false, error: error.message };
    }
  }
}

export const aiQueryTool = new AiQueryTool();
export default aiQueryTool;
