// ============================================================
// AI Gateway — Generic OpenAI-Compatible Provider Adapter
// ============================================================

import type { ChatCompletionRequest, ChatCompletionResponse } from '../types';

export function adaptRequest(body: ChatCompletionRequest): object {
  // Passthrough — no translation needed for OpenAI-compatible providers
  return body as object;
}

export function adaptResponse(response: any): ChatCompletionResponse {
  // Passthrough — already OpenAI format
  return response as ChatCompletionResponse;
}

export function adaptStreamChunk(chunk: string): string {
  // Passthrough — already OpenAI SSE format
  return chunk;
}