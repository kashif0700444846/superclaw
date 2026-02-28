import { Tool, ToolResult } from '../gateway/types.js';
import { getConversationDB } from '../memory/ConversationDB.js';

export class ClearHistoryTool implements Tool {
  name = 'clear_history';
  description = `Clear the conversation history for the current user to free up context and speed up responses.
Use this when:
- The user says "clear history", "clear chat", "start fresh", "reset conversation", "clear memory"
- Responses are getting slow (large context)
- The user wants to start a new topic with a clean slate

This only clears the conversation messages — it does NOT clear the long-term memory (MEMORY.md) or SOUL.`;

  parameters = {
    type: 'object' as const,
    properties: {
      userId: {
        type: 'string',
        description: 'The user ID whose history to clear',
      },
      platform: {
        type: 'string',
        description: 'The platform (telegram or whatsapp)',
      },
    },
    required: ['userId', 'platform'],
  };

  async execute(args: { userId: string; platform: string }): Promise<ToolResult> {
    try {
      const countBefore = getConversationDB().getHistory(args.userId, args.platform, 1000).length;
      getConversationDB().clearHistory(args.userId, args.platform);
      return {
        success: true,
        data: `✅ Conversation history cleared! Removed ${countBefore} messages.\n\nYour context is now fresh and clean. Responses should be faster now. 🚀`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Failed to clear history: ${msg}` };
    }
  }
}

export const clearHistoryTool = new ClearHistoryTool();
export default clearHistoryTool;
