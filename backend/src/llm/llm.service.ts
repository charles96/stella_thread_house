import { Injectable } from '@nestjs/common';
import { LlmProvider } from './llm-provider.interface';
import { OpenAICompatibleProvider } from './providers/openai-compatible.provider';

// 단일 공급자(OpenAI 호환) 레지스트리.
// vLLM·LM Studio·llama.cpp 등 로컬 OpenAI 호환 런타임도 /v1 엔드포인트로 접속한다.
@Injectable()
export class LlmService {
  constructor(private readonly openai: OpenAICompatibleProvider) {}

  // 현재는 OpenAI 호환 단일 구현.
  get provider(): LlmProvider {
    return this.openai;
  }
}
