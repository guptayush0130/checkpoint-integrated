import { LLMClient, LLMResponseRequest, LLMResponseResult } from './types';

export interface OpenAIResponsesClientOptions {
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Thin client for OpenAI's `/v1/responses` API. Use any OpenAI-compatible
 * proxy via `OPENAI_BASE_URL`. We only depend on `fetch` so this works
 * across modern Node versions without extra deps.
 */
export class OpenAIResponsesClient implements LLMClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(opts: OpenAIResponsesClientOptions = {}) {
    this.apiKey = opts.apiKey || process.env.OPENAI_API_KEY || '';
    this.baseUrl =
      opts.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY is required to use OpenAIResponsesClient.');
    }
  }

  async createResponse(request: LLMResponseRequest): Promise<LLMResponseResult> {
    const body: Record<string, any> = {
      model: request.model,
      input: request.input
    };

    if (request.instructions) body.instructions = request.instructions;
    if (request.tools?.length) body.tools = request.tools;
    if (typeof request.temperature === 'number' && supportsTemperature(request.model)) {
      body.temperature = request.temperature;
    }
    if (typeof request.max_output_tokens === 'number') {
      body.max_output_tokens = request.max_output_tokens;
    }
    if (request.reasoning_effort && supportsReasoning(request.model)) {
      body.reasoning = { effort: request.reasoning_effort };
    }
    if (request.json_mode) {
      body.text = { format: { type: 'json_object' } };
    }

    const response = await fetch(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenAI Responses API error ${response.status}: ${errorBody}`);
    }

    const raw = await response.json();
    return {
      model: raw.model || request.model,
      outputText: raw.output_text || extractOutputText(raw.output || []),
      output: raw.output || [],
      raw
    };
  }
}

function supportsTemperature(model: string): boolean {
  // gpt-5 family rejects custom temperature.
  return !/^gpt-5/i.test(model);
}

function supportsReasoning(model: string): boolean {
  return /^(gpt-5|o\d|o-?\w+)/i.test(model);
}

function extractOutputText(output: any[]): string {
  const chunks: string[] = [];
  for (const item of output) {
    if (typeof item.content === 'string') {
      chunks.push(item.content);
      continue;
    }
    if (Array.isArray(item.content)) {
      for (const part of item.content) {
        if (typeof part?.text === 'string') chunks.push(part.text);
      }
    }
  }
  return chunks.join('\n').trim();
}
