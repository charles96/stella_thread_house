import { SetMetadata } from '@nestjs/common';

// 전역 JWT 가드(JwtAuthGuard)를 우회하는 공개 라우트 표시.
// 인증 없이 접근 가능한 라우트(로그인/가입/OAuth 등)에만 사용한다.
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
