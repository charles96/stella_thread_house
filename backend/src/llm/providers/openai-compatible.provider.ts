import { Injectable, Logger } from '@nestjs/common';
import type { ChatMessage, ModelInfo } from '../../chat/chat.service';
import {
  LlmChatOptions,
  LlmListModelsOptions,
  LlmProvider,
  LlmStreamPart,
} from '../llm-provider.interface';

// OpenAI 호환(/v1/chat/completions) 공급자.
// OpenAI 클라우드 + 로컬 런타임(vLLM, LM Studio, llama.cpp server, LocalAI 등)을 모두 커버.
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

// 많은 OpenAI 호환 런타임(llama.cpp, LM Studio, reasoning 파서 미적용 vLLM 등)은
// 추론을 별도 reasoning_content 가 아니라 일반 content 안의 <think>...</think> 로 흘린다.
// 이를 thinking 으로 분리해 답변 본문 오염을 막는 스트리밍 상태 머신.
// think:false 보조 호출에 주입하는 "추론 최소화" 시스템 지시.
// 여러 런타임의 관용 토큰을 함께 담아 reasoning 모델의 thinking 지연을 줄인다.
//   - gpt-oss : "Reasoning: low"
//   - Qwen 계열: "/no_think"
//   - 일반     : 직접 답하라는 지시
const NO_THINK_SYSTEM =
  'Reasoning: low\nAnswer directly and concisely. Do not produce any chain-of-thought or <think> reasoning. /no_think';

const THINK_TAGS = ['<think>', '</think>', '<thinking>', '</thinking>'];
const THINK_OPEN_RE = /<think(?:ing)?>/i;
const THINK_CLOSE_RE = /<\/think(?:ing)?>/i;

// 청크 경계에 걸친 부분 태그 가능성 — 끝부분이 알려진 태그의 접두사인지.
function couldBePartialTag(s: string): boolean {
  const low = s.toLowerCase();
  return THINK_TAGS.some((t) => t.startsWith(low) && t !== low);
}

// content 청크를 누적 상태(state)와 함께 content/thinking 파트로 분리.
// 부분 태그 가능성이 있는 꼬리는 state.carry 에 보류했다가 다음 청크와 합쳐 처리.
interface ThinkState {
  inThink: boolean;
  carry: string;
}
function splitThink(state: ThinkState, chunk: string): LlmStreamPart[] {
  const out: LlmStreamPart[] = [];
  state.carry += chunk;
  for (;;) {
    if (!state.inThink) {
      const m = state.carry.match(THINK_OPEN_RE);
      if (m && m.index !== undefined) {
        const before = state.carry.slice(0, m.index);
        if (before) out.push({ type: 'content', text: before });
        state.carry = state.carry.slice(m.index + m[0].length);
        state.inThink = true;
        continue;
      }
      const lt = state.carry.lastIndexOf('<');
      if (lt >= 0 && couldBePartialTag(state.carry.slice(lt))) {
        const before = state.carry.slice(0, lt);
        if (before) out.push({ type: 'content', text: before });
        state.carry = state.carry.slice(lt);
      } else {
        if (state.carry) out.push({ type: 'content', text: state.carry });
        state.carry = '';
      }
      break;
    } else {
      const m = state.carry.match(THINK_CLOSE_RE);
      if (m && m.index !== undefined) {
        const before = state.carry.slice(0, m.index);
        if (before) out.push({ type: 'thinking', text: before });
        state.carry = state.carry.slice(m.index + m[0].length);
        state.inThink = false;
        continue;
      }
      const lt = state.carry.lastIndexOf('<');
      if (lt >= 0 && couldBePartialTag(state.carry.slice(lt))) {
        const before = state.carry.slice(0, lt);
        if (before) out.push({ type: 'thinking', text: before });
        state.carry = state.carry.slice(lt);
      } else {
        if (state.carry) out.push({ type: 'thinking', text: state.carry });
        state.carry = '';
      }
      break;
    }
  }
  return out;
}

function toOpenAiMessage(m: ChatMessage): OpenAiMessage {
  if (m.images && m.images.length > 0) {
    return {
      role: m.role,
      content: [
        ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
        ...m.images.map((b64) => ({
          type: 'image_url' as const,
          // 일부 런타임의 images 는 raw base64(접두사 없음)일 수 있으므로 data URL 로 감싼다.
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
    // 잘못된/응답 없는 엔드포인트에서 무한 대기 방지 — 8초 타임아웃.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(`${opts.endpoint}/models`, {
        headers: this.authHeaders(opts.apiKey),
        signal: ctrl.signal,
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new Error('OpenAI models: 응답 시간 초과 (8s)');
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new Error(`OpenAI models ${res.status}: ${res.statusText}`);
    }
    const json = (await res.json()) as { data?: Array<{ id: string }> };
    return (json.data ?? []).map((m) => ({ name: m.id }));
  }

  async *streamChat(opts: LlmChatOptions): AsyncGenerator<LlmStreamPart> {
    const startedAt = Date.now();
    // think:false(분류·재작성 등 보조 호출)는 추론을 끄도록 시스템 지시를 주입한다.
    // OpenAI 호환 API 엔 표준 off 플래그가 없어, reasoning 모델이 간단한 작업에도
    // thinking 하느라 지연되는 것을 줄이기 위함. (gpt-oss=Reasoning: low, Qwen=/no_think 등)
    const messages: ChatMessage[] =
      opts.think === false
        ? [{ role: 'system', content: NO_THINK_SYSTEM }, ...opts.messages]
        : opts.messages;
    const res = await fetch(`${opts.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeaders(opts.apiKey),
      },
      signal: opts.signal,
      body: JSON.stringify({
        model: opts.model,
        messages: messages.map(toOpenAiMessage),
        stream: true,
        // 마지막 청크에 usage 를 받기 위해 필요 (OpenAI 스펙).
        stream_options: { include_usage: true },
        max_tokens: opts.maxTokens ?? 8192,
        temperature: opts.temperature ?? 0.6,
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
    // content 내 <think> 분리용 상태 (청크 경계 보류 버퍼 포함).
    const think: ThinkState = { inThink: false, carry: '' };

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
          // content 는 <think>...</think> 를 thinking 으로 분리해서 흘린다.
          if (delta?.content) {
            for (const part of splitThink(think, delta.content)) yield part;
          }
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
    // 보류 버퍼에 남은 잔여 — 미완성 태그였을 수 있으나 스트림 종료 시 그대로 흘린다.
    if (think.carry) {
      yield think.inThink
        ? { type: 'thinking', text: think.carry }
        : { type: 'content', text: think.carry };
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
