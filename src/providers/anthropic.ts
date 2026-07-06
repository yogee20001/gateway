// ============================================================
// AI Gateway — Anthropic Provider Adapter
// ============================================================
// Translates OpenAI-compatible requests to Anthropic API format
// and Anthropic responses back to OpenAI-compatible format.

import type { ChatCompletionRequest, ChatCompletionResponse, ChatMessage } from '../types';

// ============================================================
// Request Translation: OpenAI → Anthropic
// ============================================================
export function adaptRequest(body: ChatCompletionRequest): object {
  const messages = body.messages || [];
  let system: string | undefined;

  // Extract system message
  const nonSystemMessages = messages.filter(msg => {
    if (msg.role === 'system' && typeof msg.content === 'string') {
      system = system ? system + '\n' + msg.content : msg.content;
      return false;
    }
    return true;
  });

  // Map messages to Anthropic format
  const anthropicMessages = nonSystemMessages.map(msg => ({
    role: msg.role === 'assistant' ? 'assistant' : 'user',
    content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
  }));

  const result: Record<string, any> = {
    model: body.model,
    messages: anthropicMessages,
    max_tokens: body.max_tokens || 4096,
  };

  if (system) {
    result.system = system;
  }

  if (body.temperature !== undefined) {
    result.temperature = body.temperature;
  }

  if (body.stream !== undefined) {
    result.stream = body.stream;
  }

  if (body.stop) {
    result.stop_sequences = Array.isArray(body.stop) ? body.stop : [body.stop];
  }

  // Anthropic doesn't support: top_p, frequency_penalty, presence_penalty, logit_bias, n, tools, tool_choice
  // These are intentionally omitted

  return result;
}

// ============================================================
// Response Translation: Anthropic → OpenAI
// ============================================================
export function adaptResponse(anthropicResponse: any): ChatCompletionResponse {
  const content = extractTextContent(anthropicResponse.content);

  return {
    id: anthropicResponse.id || `msg_${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: anthropicResponse.model || 'unknown',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: content,
        },
        finish_reason: mapStopReason(anthropicResponse.stop_reason),
      },
    ],
    usage: anthropicResponse.usage ? {
      prompt_tokens: anthropicResponse.usage.input_tokens || 0,
      completion_tokens: anthropicResponse.usage.output_tokens || 0,
      total_tokens: (anthropicResponse.usage.input_tokens || 0) + (anthropicResponse.usage.output_tokens || 0),
    } : undefined,
  };
}

// ============================================================
// Streaming Chunk Translation: Anthropic SSE → OpenAI SSE
// ============================================================
export function adaptStreamChunk(chunk: string): string {
  try {
    // Anthropic SSE format: data: {"type": "content_block_delta", ...}
    const lines = chunk.split('\n').filter(l => l.startsWith('data: '));
    if (lines.length === 0) return chunk;

    const results: string[] = [];

    for (const line of lines) {
      const jsonStr = line.slice(6); // Remove "data: "
      if (jsonStr === '[DONE]') {
        results.push('data: [DONE]');
        continue;
      }

      try {
        const data = JSON.parse(jsonStr);

        if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
          // Convert to OpenAI SSE format
          const openaiChunk = {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: data.model || 'unknown',
            choices: [
              {
                index: 0,
                delta: { content: data.delta.text },
                finish_reason: null,
              },
            ],
          };
          results.push(`data: ${JSON.stringify(openaiChunk)}`);
        } else if (data.type === 'message_stop') {
          // Final chunk with finish_reason
          const openaiChunk = {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: data.model || 'unknown',
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: 'stop',
              },
            ],
          };
          results.push(`data: ${JSON.stringify(openaiChunk)}`);
          results.push('data: [DONE]');
        }
        // Ignore other event types (content_block_start, content_block_stop, ping, etc.)
      } catch {
        results.push(line);
      }
    }

    return results.join('\n') + '\n';
  } catch {
    return chunk;
  }
}

// ============================================================
// Helpers
// ============================================================
function extractTextContent(content: any[] | undefined): string | null {
  if (!content || !Array.isArray(content)) return null;
  const textParts = content
    .filter((part: any) => part.type === 'text')
    .map((part: any) => part.text);
  return textParts.length > 0 ? textParts.join('') : null;
}

function mapStopReason(reason: string | null | undefined): string | null {
  const map: Record<string, string> = {
    'end_turn': 'stop',
    'max_tokens': 'length',
    'stop_sequence': 'stop',
    'tool_use': 'tool_calls',
  };
  return reason ? (map[reason] || null) : null;
}