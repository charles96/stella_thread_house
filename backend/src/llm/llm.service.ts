import { Injectable } from '@nestjs/common';
import { LlmProvider } from './llm-provider.interface';
import { OllamaProvider } from './providers/ollama.provider';
import { OpenAICompatibleProvider } from './providers/openai-compatible.provider';

// 공급자 레지스트리 — system_config.ai.provider 값으로 구현체를 선택한다.
// 미설정/미지원 값은 기존 동작 유지를 위해 ollama 로 폴백.
@Injectable()
export class LlmService {
  constructor(
    private readonly ollama: OllamaProvider,
    private readonly openai: OpenAICompatibleProvider,
  ) {}

  resolve(provider?: string): LlmProvider {
    switch (provider) {
      case 'openai-compatible':
        return this.openai;
      case 'ollama':
      default:
        return this.ollama;
    }
  }
}
