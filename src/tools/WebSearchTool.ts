import axios from 'axios';
import { Tool, ToolResult } from '../gateway/types';
import { config } from '../config';
import { logger } from '../logger';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export class WebSearchTool implements Tool {
  name = 'web_search';
  description = 'Searches the web and returns top 5 results with title, URL, and snippet. Uses SerpAPI if configured, otherwise DuckDuckGo.';
  parameters = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query',
      },
      num_results: {
        type: 'number',
        description: 'Number of results to return (default: 5)',
      },
    },
    required: ['query'],
  };

  private async searchSerpApi(query: string, numResults: number): Promise<SearchResult[]> {
    const response = await axios.get('https://serpapi.com/search', {
      params: {
        q: query,
        api_key: config.serpApiKey,
        num: numResults,
        engine: 'google',
      },
      timeout: 15000,
    });

    const results = response.data.organic_results || [];
    return results.slice(0, numResults).map((r: any) => ({
      title: r.title || '',
      url: r.link || '',
      snippet: r.snippet || '',
    }));
  }

  private async searchDuckDuckGo(query: string, numResults: number): Promise<SearchResult[]> {
    const response = await axios.get('https://api.duckduckgo.com/', {
      params: {
        q: query,
        format: 'json',
        no_html: 1,
        skip_disambig: 1,
      },
      timeout: 15000,
      headers: {
        'User-Agent': 'SuperClaw/1.0',
      },
    });

    const data = response.data;
    const results: SearchResult[] = [];

    if (data.AbstractText && data.AbstractURL) {
      results.push({
        title: data.Heading || query,
        url: data.AbstractURL,
        snippet: data.AbstractText,
      });
    }

    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics.slice(0, numResults - 1)) {
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Text.split(' - ')[0] || topic.Text,
            url: topic.FirstURL,
            snippet: topic.Text,
          });
        }
      }
    }

    return results.slice(0, numResults);
  }

  async execute(params: { query: string; num_results?: number }): Promise<ToolResult> {
    const { query, num_results = 5 } = params;

    logger.info(`WebSearchTool searching: ${query}`);

    try {
      let results: SearchResult[];

      if (config.serpApiKey) {
        results = await this.searchSerpApi(query, num_results);
      } else {
        results = await this.searchDuckDuckGo(query, num_results);
      }

      return {
        success: true,
        data: {
          query,
          results,
          count: results.length,
          source: config.serpApiKey ? 'serpapi' : 'duckduckgo',
        },
      };
    } catch (error: any) {
      logger.error(`WebSearchTool error`, { error });
      return { success: false, error: error.message };
    }
  }
}

export const webSearchTool = new WebSearchTool();
export default webSearchTool;
