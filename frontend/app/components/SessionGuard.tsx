'use client';

import { useEffect } from 'react';

// 세션 만료(JWT 7일) 시 백엔드 AuthGuard 가 401 을 반환한다.
// 앱 사용 도중 401 이 떨어지면 자동으로 /login 으로 보내기 위해
// window.fetch 를 한 번 감싸 모든 /api/* 응답의 401 을 가로챈다.
// (fetch 호출이 수십 군데라 호출부마다 고치는 대신 전역 1곳에서 처리)

// fast-refresh / 중복 마운트 시 이중 패치 방지용 플래그.
const PATCH_FLAG = '__stellaFetchPatched';
// 동시에 여러 요청이 401 을 받아도 리다이렉트는 한 번만.
let redirecting = false;

// 잘못된 비밀번호 등 "로그인 행위 자체"의 401 은 만료가 아니므로 제외.
const AUTH_EXEMPT = ['/api/auth/login', '/api/auth/register'];

function pathOf(input: RequestInfo | URL): string {
  try {
    let raw: string;
    if (typeof input === 'string') raw = input;
    else if (input instanceof URL) raw = input.href;
    else raw = input.url;
    return new URL(raw, window.location.origin).pathname;
  } catch {
    return '';
  }
}

export default function SessionGuard() {
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    if (w[PATCH_FLAG]) return;
    w[PATCH_FLAG] = true;

    const original = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await original(input, init);
      try {
        if (res.status === 401) {
          const path = pathOf(input);
          const isApi = path.startsWith('/api/');
          const isAuthAction = AUTH_EXEMPT.includes(path);
          const onLoginPage = window.location.pathname === '/login';
          if (isApi && !isAuthAction && !onLoginPage && !redirecting) {
            redirecting = true;
            window.location.replace('/login');
          }
        }
      } catch {
        // 가드 로직 오류가 원래 응답을 막지 않도록 무시.
      }
      return res;
    };
  }, []);

  return null;
}
