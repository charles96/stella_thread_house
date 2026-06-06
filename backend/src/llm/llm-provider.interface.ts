import type { ChatMessage, ModelInfo } from '../chat/chat.service';

// 공급자(OpenAI 호환)가 내보내는 정규화된 스트림 이벤트.
// chat.service 의 StreamPart 중 '모델 추론 출력'에 해당하는 부분집합과 구조적으로 동일하다.
// (search/pages/status 등 chat 고유 이벤트는 ChatService 가 담당하고, 공급자는 관여하지 않는다.)
export type LlmStreamPart =
  | { type: 'content' | 'thinking'; text: string }
  | {
      type: 'metric';
      tokens: number;
      durationMs: number;
      tokensPerSec: number;
      promptTokens?: number;
    };

// 공급자에 전달되는, 전송에 필요한 최소 입력.
// endpoint/model 은 호출 측(ChatService)이 이미 해석(resolve)해 넘긴다 — 공급자는 transport 만 책임진다.
export interface LlmChatOptions {
  // 해석 완료된 base URL (trailing slash 없음).
  endpoint: string;
  // 해석 완료된 모델 이름.
  model: string;
  // 최종 메시지 배열 (system 분리/이미지 base64 환원/인용 프롬프트 주입까지 끝난 상태).
  messages: ChatMessage[];
  // 클라이언트 abort 전파용.
  signal?: AbortSignal;
  // 출력 토큰 상한 (OpenAI max_tokens 로 매핑).
  maxTokens?: number;
  // 인증이 필요한 공급자용 API 키 (로컬 서버는 비워둠).
  apiKey?: string;
  // 샘플링 온도. 분류/추출 등 결정적 보조 호출은 낮게(예: 0.2). 미지정 시 공급자 기본값.
  temperature?: number;
  // 추론(thinking) 사용 여부 힌트. OpenAI 호환은 강제 끄기가 불가하나, <think> 태그를
  // thinking 으로 분리하므로 content 오염은 방지된다. 미지정 시 true.
  think?: boolean;
}

// 사용 가능한 모델 목록 조회 입력.
export interface LlmListModelsOptions {
  endpoint: string;
  apiKey?: string;
}

// 모든 LLM 공급자가 구현하는 전략(Strategy) 인터페이스.
// 각 구현체의 유일한 책임: 자신의 wire 포맷 ↔ LlmStreamPart / ModelInfo 변환.
export interface LlmProvider {
  readonly id: string;
  streamChat(opts: LlmChatOptions): AsyncGenerator<LlmStreamPart>;
  listModels(opts: LlmListModelsOptions): Promise<ModelInfo[]>;
}
