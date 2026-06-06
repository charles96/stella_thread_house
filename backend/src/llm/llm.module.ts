import { Module } from '@nestjs/common';
import { LlmService } from './llm.service';
import { OpenAICompatibleProvider } from './providers/openai-compatible.provider';

// LLM 공급자(OpenAI 호환)를 공유 모듈로 노출 — ChatModule / PageModule 등이 함께 import.
@Module({
  providers: [LlmService, OpenAICompatibleProvider],
  exports: [LlmService],
})
export class LlmModule {}
