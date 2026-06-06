import { Injectable, Logger } from '@nestjs/common';
import type { ChatMessage, ModelInfo } from '../../chat/chat.service';
import {
  LlmChatOptions,
  LlmListModelsOptions,
  LlmProvider,
  LlmStreamPart,
} from '../llm-provider.interface';

// OpenAI 호환(/v1/chat/completions) 공급자.
// OpenAI 클라우드 + 로컬 런타임(vLLM, LM Studio, llama.cpp server, LocalAI, Ollama /v1)을 모두 커버.
// endpoint 는 base URL(예: https://api.openai.com/v1, http://localhost:1234/v1)을 가리킨다.
type OpenAiMessage =
  | { role: string; content: string }
  | {
      role: string;
      content: Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      >;
    };

function toOpenAiMessage(m: ChatMessage): OpenAiMessage {
  if (m.images && m.images.length > 0) {
    return {
      role: m.role,
      content: [
        ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
        ...m.images.map((b64) => ({
          type: 'image_url' as const,
          // Ollama 메시지의 images 는 raw base64(접두사 없음)일 수 있으므로 data URL 로 감싼다.
          image_url: {
            url: b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`,
          },
        })),
      ],
    };
  }
  return { role: m.role, content: m.content };
}

@Injectable()
export class OpenAICompatibleProvider implements LlmProvider {
  readonly id = 'openai-compatible';
  private readonly logger = new Logger(OpenAICompatibleProvider.name);

  private authHeaders(apiKey?: string): Record<string, string> {
    return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  }

  async listModels(opts: LlmListModelsOptions): Promise<ModelInfo[]> {
    const res = await fetch(`${opts.endpoint}/models`, {
      headers: this.authHeaders(opts.apiKey),
    });
    if (!res.ok) {
      throw new Error(`OpenAI models ${res.status}: ${res.statusText}`);
    }
    const json = (await res.json()) as { data?: Array<{ id: string }> };
    return (json.data ?? []).map((m) => ({ name: m.id }));
  }

  async *streamChat(opts: LlmChatOptions): AsyncGenerator<LlmStreamPart> {
    const startedAt = Date.now();
    const res = await fetch(`${opts.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeaders(opts.apiKey),
      },
      signal: opts.signal,
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages.map(toOpenAiMessage),
        stream: true,
        // 마지막 청크에 usage 를 받기 위해 필요 (OpenAI 스펙).
        stream_options: { include_usage: true },
        max_tokens: opts.maxTokens ?? 8192,
        temperature: 0.6,
        top_p: 0.9,
      }),
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenAI error ${res.status}: ${text || res.statusText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let completionTokens = 0;
    let promptTokens: number | undefined;

    const onAbort = () => {
      this.logger.log('[streamChat] abort received — cancelling OpenAI reader');
      reader.cancel().catch(() => {});
    };
    opts.signal?.addEventListener('abort', onAbort);

    try {
      while (true) {
        if (opts.signal?.aborted) break;
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const raw of lines) {
          const line = raw.trim();
          if (!line || !line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          let json: {
            choices?: Array<{
              delta?: {
                content?: string;
                reasoning_content?: string;
                reasoning?: string;
              };
            }>;
            usage?: { completion_tokens?: number; prompt_tokens?: number };
            // LM Studio 등은 HTTP 200 으로 스트림을 시작한 뒤 `event: error` +
            // `data: {"error": {...}}` 로 에러를 흘린다 (컨텍스트 초과 등).
            error?: { message?: string } | string;
            message?: string;
          };
          try {
            json = JSON.parse(data);
          } catch {
            this.logger.warn(`Failed to parse SSE data: ${data}`);
            continue;
          }
          // 스트림 도중 에러 페이로드 — 조용히 삼키지 말고 throw 해서
          // 컨트롤러가 사용자에게 {error} 로 노출하도록 한다.
          if (json.error) {
            const msg =
              (typeof json.error === 'string' ? json.error : json.error.message) ||
              json.message ||
              'unknown error';
            throw new Error(`OpenAI 호환 공급자 오류: ${msg}`);
          }
          const delta = json.choices?.[0]?.delta;
          // reasoning_content(vLLM/DeepSeek 등) / reasoning 필드를 thinking 으로 매핑.
          const reasoning = delta?.reasoning_content ?? delta?.reasoning;
          if (reasoning) yield { type: 'thinking', text: reasoning };
          if (delta?.content) yield { type: 'content', text: delta.content };
          if (json.usage) {
            if (typeof json.usage.completion_tokens === 'number') {
              completionTokens = json.usage.completion_tokens;
            }
            if (typeof json.usage.prompt_tokens === 'number') {
              promptTokens = json.usage.prompt_tokens;
            }
          }
        }
      }
    } finally {
      opts.signal?.removeEventListener('abort', onAbort);
      try {
        reader.releaseLock();
      } catch {
        // already released
      }
    }

    // OpenAI 는 duration 을 주지 않으므로 벽시계로 토큰/초를 산출.
    if (completionTokens > 0) {
      const durationMs = Math.max(1, Date.now() - startedAt);
      yield {
        type: 'metric',
        tokens: completionTokens,
        durationMs,
        tokensPerSec: (completionTokens * 1000) / durationMs,
        promptTokens,
      };
    }
  }
}
