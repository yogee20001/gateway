// ============================================================
// AI Gateway — Google Gemini Provider Adapter
// ============================================================
// Translates OpenAI-compatible requests to Google Gemini API format
// and Google responses back to OpenAI-compatible format.

import type { ChatCompletionRequest, ChatCompletionResponse } from '../types';

// ============================================================
// Request Translation: OpenAI → Google Gemini
// ============================================================
export function adaptRequest(body: ChatCompletionRequest): object {
  const messages = body.messages || [];
  let systemInstruction: string | undefined;

  // Extract system message
  const nonSystemMessages = messages.filter(msg => {
    if (msg.role === 'system' && typeof msg.content === 'string') {
      systemInstruction = systemInstruction
        ? systemInstruction + '\n' + msg.content
        : msg.content;
      return false;
    }
    return true;
  });

  // Map messages to Google contents format
  const contents = nonSystemMessages.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: typeof msg.content === 'string'
      ? [{ text: msg.content }]
      : msg.content.map((part: any) => {
          if (part.type === 'text') return { text: part.text };
          if (part.type === 'image_url') return { inlineData: { mimeType: 'image/jpeg', data: part.image_url?.url || '' } };
          return { text: JSON.stringify(part) };
        }),
  }));

  const result: Record<string, any> = {
    contents,
    generationConfig: {},
  };

  if (systemInstruction) {
    result.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  if (body.max_tokens !== undefined) {
    result.generationConfig.maxOutputTokens = body.max_tokens;
  }

  if (body.temperature !== undefined) {
    result.generationConfig.temperature = body.temperature;
  }

  if (body.top_p !== undefined) {
    result.generationConfig.topP = body.top_p;
  }

  if (body.stop) {
    result.generationConfig.stopSequences = Array.isArray(body.stop) ? body.stop : [body.stop];
  }

  // Google doesn't support: frequency_penalty, presence_penalty, logit_bias, n, tools, tool_choice
  // These are intentionally omitted

  return result;
}

// ============================================================
// Response Translation: Google Gemini → OpenAI
// ============================================================
export function adaptResponse(googleResponse: any): ChatCompletionResponse {
  const candidates = googleResponse.candidates || [];
  const firstCandidate = candidates[0] || {};
  const content = firstCandidate.content || {};
  const parts = content.parts || [];
  const textContent = parts.map((p: any) => p.text || '').join('');
  const usage = googleResponse.usageMetadata || {};

  return {
    id: `gemini-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: googleResponse.model || 'unknown',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: textContent || null,
        },
        finish_reason: mapFinishReason(firstCandidate.finishReason),
      },
    ],
    usage: {
      prompt_tokens: usage.promptTokenCount || 0,
      completion_tokens: usage.candidatesTokenCount || 0,
      total_tokens: usage.totalTokenCount || 0,
    },
  };
}

// ============================================================
// Streaming Chunk Translation: Google SSE → OpenAI SSE
// ============================================================
export function adaptStreamChunk(chunk: string): string {
  try {
    const lines = chunk.split('\n').filter(l => l.startsWith('data: '));
    if (lines.length === 0) return chunk;

    const results: string[] = [];

    for (const line of lines) {
      const jsonStr = line.slice(6);
      if (jsonStr === '[DONE]') {
        results.push('data: [DONE]');
        continue;
      }

      try {
        const data = JSON.parse(jsonStr);
        const candidates = data.candidates || [];
        const firstCandidate = candidates[0] || {};
        const content = firstCandidate.content || {};
        const parts = content.parts || [];
        const text = parts.map((p: any) => p.text || '').join('');

        if (text) {
          const openaiChunk = {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: data.model || 'unknown',
            choices: [
              {
                index: 0,
                delta: { content: text },
                finish_reason: null,
              },
            ],
          };
          results.push(`data: ${JSON.stringify(openaiChunk)}`);
        }

        // Check for finish reason
        if (firstCandidate.finishReason && firstCandidate.finishReason !== 'NULL') {
          const finishChunk = {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: data.model || 'unknown',
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: mapFinishReason(firstCandidate.finishReason),
              },
            ],
          };
          results.push(`data: ${JSON.stringify(finishChunk)}`);
          results.push('data: [DONE]');
        }
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
function mapFinishReason(reason: string | null | undefined): string | null {
  const map: Record<string, string> = {
    'STOP': 'stop',
    'MAX_TOKENS': 'length',
    'SAFETY': 'content_filter',
    'RECITATION': 'content_filter',
    'OTHER': 'stop',
    'NULL': null as any,
  };
  return reason ? (map[reason] || null) : null;
}