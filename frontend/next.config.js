/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Docker runtime 이미지를 경량화 — .next/standalone 만 복사하면 동작.
  output: 'standalone',
  // 브라우저는 항상 same-origin /api/* 로 호출. Next 가 백엔드(:4100) 로 프록시.
  // 결과: NEXT_PUBLIC_API_URL 같은 절대 URL env 불필요, CORS 도 사실상 무관.
  // BACKEND_URL env 로 백엔드 호스트 변경 가능 (기본 http://localhost:4100).
  async rewrites() {
    const backend =
      process.env.BACKEND_URL?.replace(/\/$/, '') ?? 'http://localhost:4100';
    return [{ source: '/api/:path*', destination: `${backend}/:path*` }];
  },
};

module.exports = nextConfig;
