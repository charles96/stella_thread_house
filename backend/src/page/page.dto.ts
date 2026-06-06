import { ApiProperty } from '@nestjs/swagger';

export class PageExtractRequestDto {
  @ApiProperty({
    example: 'https://news.ycombinator.com',
    description: '추출할 웹 페이지 URL (http/https)',
  })
  url!: string;
}

export class PageImageDto {
  @ApiProperty({ example: 'https://example.com/img.jpg' })
  src!: string;

  @ApiProperty({ required: false, example: 'cover photo' })
  alt?: string;
}

export class PageExtractResponseDto {
  @ApiProperty({ example: 'https://example.com/article' })
  url!: string;

  @ApiProperty({
    example: 'https://example.com/article',
    description: '리다이렉트가 발생한 경우 최종 URL',
  })
  finalUrl!: string;

  @ApiProperty({ example: 200 })
  status!: number;

  @ApiProperty({ required: false, example: '기사 제목' })
  title?: string;

  @ApiProperty({
    description: 'og:*, twitter:*, article:*, fb:* 메타태그 모음',
    example: {
      'og:title': '...',
      'og:description': '...',
      'og:image': 'https://...',
      'twitter:card': 'summary_large_image',
    },
  })
  ogTags!: Record<string, string>;

  @ApiProperty({
    description: '본문 텍스트 (HTML 태그 제거, 블록 단위 줄바꿈)',
    example: '본문 내용...\n다음 단락...',
  })
  text!: string;

  @ApiProperty({ type: [PageImageDto] })
  images!: PageImageDto[];

  @ApiProperty({ example: 84213, description: '응답 바이트 수' })
  bytes!: number;
}

export class PageExtractByTitleRequestDto {
  @ApiProperty({
    example: 'https://example.com/article',
    description: '추출할 웹 페이지 URL',
  })
  url!: string;

  @ApiProperty({
    required: false,
    example: 'gemma4:26b',
    description: '사용할 모델 (미지정 시 AI_DEFAULT_MODEL 기본값)',
  })
  model?: string;
}

export class PageExtractByTitleResponseDto {
  @ApiProperty({ example: 'https://example.com/article' })
  url!: string;

  @ApiProperty({ example: 'https://example.com/article' })
  finalUrl!: string;

  @ApiProperty({ example: '기사 제목' })
  title?: string;

  @ApiProperty({
    description: 'og:*, twitter:* 메타태그',
    example: { 'og:title': '...', 'og:image': '...' },
  })
  ogTags!: Record<string, string>;

  @ApiProperty({
    description: '제목과 직접 관련된 본문 텍스트만 추출 (AI 결과)',
    example: '제목 주제에 해당하는 본문 단락들...',
  })
  content!: string;

  @ApiProperty({ example: 'gemma4:26b', description: '사용된 모델' })
  model!: string;

  @ApiProperty({ example: 5234, description: '원본 본문 길이 (글자수)' })
  originalChars!: number;

  @ApiProperty({ example: 1820, description: '필터링 후 본문 길이 (글자수)' })
  filteredChars!: number;
}

export class PageImageAnalysisDto {
  @ApiProperty({ example: 'https://example.com/img.jpg' })
  src!: string;

  @ApiProperty({ required: false, example: 'cover photo' })
  alt?: string;

  @ApiProperty({ example: true, description: '제목과 직접 관련 있는지 여부' })
  relevant!: boolean;

  @ApiProperty({
    example: '본문 주제인 제품의 정면 사진',
    description: '비전 모델이 한 줄로 묘사한 이미지 내용',
  })
  description!: string;

  @ApiProperty({ required: false, description: '분석 실패 사유' })
  error?: string;
}

export class PageWithImageAnalysisRequestDto {
  @ApiProperty({ example: 'https://example.com/article' })
  url!: string;

  @ApiProperty({ required: false, example: 'gemma4:26b' })
  model?: string;

  @ApiProperty({
    required: false,
    example: 'gemma4:26b',
    description: '비전 분석에 쓸 모델 (이미지 입력 가능 모델)',
  })
  visionModel?: string;

  @ApiProperty({
    required: false,
    example: 4,
    description: '분석할 최대 이미지 개수 (기본 4)',
  })
  maxImages?: number;
}

export class PageWithImageAnalysisResponseDto extends PageExtractByTitleResponseDto {
  @ApiProperty({ type: [PageImageAnalysisDto] })
  imageAnalyses!: PageImageAnalysisDto[];

  @ApiProperty({ example: 'gemma4:26b', description: '비전 분석 모델' })
  imageAnalysisModel!: string;
}
