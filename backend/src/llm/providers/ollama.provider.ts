import { Injectable, Logger } from '@nestjs/common';
import type { ModelInfo } from '../../chat/chat.service';
import {
  LlmChatOptions,
  LlmListModelsOptions,
  LlmProvider,
  LlmStreamPart,
} from '../llm-provider.interface';

// Ollama native /api/chat 공급자.
// NDJSON 스트림을 파싱해 thinking/content/metric 으로 정규화한다.
// Harmony 포맷(<channel|>analysis…)을 content 로 누출하는 모델 대응 로직 포함.
@Injectable()
export class OllamaProvider implements LlmProvider {
  readonly id = 'ollama';
  private readonly logger = new Logger(OllamaProvider.name);

  async listModels(opts: LlmListModelsOptions): Promise<ModelInfo[]> {
    const res = await fetch(`${opts.endpoint}/api/tags`);
    if (!res.ok) {
      throw new Error(`Ollama tags ${res.status}: ${res.statusText}`);
    }
    const json = (await res.json()) as {
      models?: Array<{
        name: string;
        size?: number;
        modified_at?: string;
        details?: { family?: string; parameter_size?: string };
      }>;
    };
    return (json.models ?? []).map((m) => ({
      name: m.name,
      size: m.size,
      modifiedAt: m.modified_at,
      family: m.details?.family,
      parameterSize: m.details?.parameter_size,
    }));
  }

  async *streamChat(opts: LlmChatOptions): AsyncGenerator<LlmStreamPart> {
    const res = await fetch(`${opts.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: opts.signal,
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        stream: true,
        think: true,
        // 표 깨짐(잘못된 영문 토큰 삽입, 줄바꿈 누락 등) 빈도를 줄이기 위해
        // 다소 보수적인 샘플링 옵션 적용. 너무 낮추면 다양성 손실.
        // num_predict 는 thinking + content 합산 토큰 상한.
        options: {
          temperature: 0.6,
          top_p: 0.9,
          num_predict: opts.maxTokens ?? 8192,
        },
      }),
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama error ${res.status}: ${text || res.statusText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // signal abort 시 reader 도 즉시 cancel 하여 fetch 중단 전파.
    const onAbort = () => {
      this.logger.log('[streamChat] abort received — cancelling Ollama reader');
      reader.cancel().catch(() => {});
    };
    opts.signal?.addEventListener('abort', onAbort);

    // Harmony format(<channel|>analysis<|message|>... <channel|>final<|message|>...) 을
    // content 로 그대로 흘리는 모델 대응. 첫 청크가 누출 패턴(---/결thought/<channel|> 등)일
    // 때만 버퍼링 모드로 진입해 마커까지 모은 뒤 thinking/content 로 분리.
    // 정상 응답은 그대로 실시간 스트리밍.
    const LEAK_PREFIX_RE =
      /^(?:---\s*\n)?(?:thought\b|analysis\b|<\|?channel\|>|결thought)/i;
    const CHANNEL_MARKER_RE = /<\|?channel\|>[^<]*?(?:<\|message\|>|\n)/i;
    let leakMode: 'unknown' | 'normal' | 'buffering' = 'unknown';
    let leakBuffer = '';

    let finished = false;
    try {
      while (!finished) {
        if (opts.signal?.aborted) break;
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const json = JSON.parse(trimmed);
            const thinking: string | undefined = json?.message?.thinking;
            if (thinking) yield { type: 'thinking', text: thinking };
            const content: string | undefined = json?.message?.content;
            if (content) {
              if (leakMode === 'unknown') {
                leakMode = LEAK_PREFIX_RE.test(content)
                  ? 'buffering'
                  : 'normal';
              }
              if (leakMode === 'buffering') {
                leakBuffer += content;
                const mk = leakBuffer.match(CHANNEL_MARKER_RE);
                if (mk && mk.index !== undefined) {
                  const before = leakBuffer.substring(0, mk.index);
                  const after = leakBuffer.substring(mk.index + mk[0].length);
                  if (before) yield { type: 'thinking', text: before };
                  if (after) yield { type: 'content', text: after };
                  leakMode = 'normal';
                  leakBuffer = '';
                } else if (leakBuffer.length > 16000) {
                  // 마커를 찾지 못한 채 버퍼가 너무 커지면 포기 — content 로 flush.
                  yield { type: 'content', text: leakBuffer };
                  leakMode = 'normal';
                  leakBuffer = '';
                }
              } else {
                yield { type: 'content', text: content };
              }
            }
            if (json.done) {
              const evalCount =
                typeof json.eval_count === 'number' ? json.eval_count : 0;
              const evalDurNs =
                typeof json.eval_duration === 'number' ? json.eval_duration : 0;
              const promptCount =
                typeof json.prompt_eval_count === 'number'
                  ? json.prompt_eval_count
                  : undefined;
              if (evalCount > 0 && evalDurNs > 0) {
                const durationMs = evalDurNs / 1_000_000;
                const tokensPerSec = (evalCount * 1_000) / durationMs;
                yield {
                  type: 'metric',
                  tokens: evalCount,
                  durationMs,
                  tokensPerSec,
                  promptTokens: promptCount,
                };
              }
              finished = true;
              break;
            }
          } catch {
            this.logger.warn(`Failed to parse line: ${trimmed}`);
          }
        }
      }
    } finally {
      // 버퍼링 모드에서 마커를 끝내 못 찾고 끝났다면 잔여를 thinking 으로 떨굼
      // (분명 누출 패턴이었으므로 content 로 보내면 또 깨짐).
      if (leakBuffer) {
        yield { type: 'thinking', text: leakBuffer };
        leakBuffer = '';
      }
      opts.signal?.removeEventListener('abort', onAbort);
      try {
        reader.releaseLock();
      } catch {
        // already released
      }
    }
  }
}
