// AI 설정(system_config 'ai' row)의 공용 타입 + 정규화 유틸.
// Reasoning / Vision 두 그룹이 각각 독립된 endpoint / apiKey / model 을 가진다.
// 과거(flat) 스키마({ endpoint, apiKey, reasoningModel, visionModel })도 읽어서
// 두 그룹으로 자연스럽게 승격(migrate)한다 → 기존 설정이 깨지지 않음.

export type AiGroup = {
  endpoint?: string;
  apiKey?: string;
  model?: string;
  // 답변 출력 토큰 상한(모델 최대 출력에 맞춤). 웹/일반 구분 없이 공통 적용. 미설정이면 기본값.
  maxTokens?: number;
};

export type AiConfigValue = {
  // 신규(중첩) 스키마.
  reasoning?: AiGroup;
  vision?: AiGroup;
  // 레거시(flat) 스키마 — 읽기 폴백 전용.
  endpoint?: string;
  reasoningModel?: string;
  visionModel?: string;
  apiKey?: string;
};

export type AiGroups = { reasoning: AiGroup; vision: AiGroup };

const clean = (v: unknown): string | undefined => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : undefined;
};

// 양수 정수만 허용 — 그 외(0/음수/NaN/빈값)는 미설정(undefined)으로 처리.
const cleanNum = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
};

// raw 'ai' value → { reasoning, vision }. 각 그룹의 빈 필드는 레거시 flat 값으로 채운다.
export function normalizeAiConfig(value: AiConfigValue | undefined): AiGroups {
  const v = value ?? {};
  const legacyEndpoint = clean(v.endpoint);
  const legacyApiKey = clean(v.apiKey);
  const group = (g: AiGroup | undefined, legacyModel?: string): AiGroup => ({
    endpoint: clean(g?.endpoint) ?? legacyEndpoint,
    apiKey: clean(g?.apiKey) ?? legacyApiKey,
    model: clean(g?.model) ?? clean(legacyModel),
    maxTokens: cleanNum(g?.maxTokens),
  });
  return {
    reasoning: group(v.reasoning, v.reasoningModel),
    vision: group(v.vision, v.visionModel),
  };
}

// 런타임 동작용 — vision 그룹의 빈 endpoint/apiKey/model 은 reasoning 그룹으로 폴백.
// (Reasoning 만 설정해도 Vision 이 동일 설정으로 동작하도록. UI/저장 값은 그대로 독립.)
export function resolveAiGroups(value: AiConfigValue | undefined): AiGroups {
  const { reasoning, vision } = normalizeAiConfig(value);
  return {
    reasoning,
    vision: {
      endpoint: vision.endpoint ?? reasoning.endpoint,
      apiKey: vision.apiKey ?? reasoning.apiKey,
      model: vision.model ?? reasoning.model,
      maxTokens: vision.maxTokens ?? reasoning.maxTokens,
    },
  };
}
