#!/bin/bash
# Docker 이미지를 git tag 기준으로 빌드하고 private registry에 푸시한다.
# GoCD build-and-push stage에서 실행됨.
set -euo pipefail

# ── 1. Git tag 감지 ─────────────────────────────────────────────────────────
# GoCD는 특정 revision에서 체크아웃하므로 HEAD에 달린 태그를 읽는다.
# DEPLOY_VERSION 환경변수가 있으면 그 값을 우선 사용 (수동 트리거 시 유용).
GIT_TAG="${DEPLOY_VERSION:-$(git describe --tags --exact-match HEAD 2>/dev/null || echo "")}"

if [ -z "$GIT_TAG" ]; then
  echo "ERROR: HEAD에 git tag가 없습니다."
  echo "  현재 HEAD: $(git rev-parse HEAD)"
  echo "  근처 태그: $(git describe --tags 2>/dev/null || echo '없음')"
  echo ""
  echo "  해결 방법:"
  echo "    git tag v1.0.0 && git push origin v1.0.0"
  echo "  또는 DEPLOY_VERSION 환경변수로 직접 지정:"
  echo "    DEPLOY_VERSION=v1.0.0 bash scripts/ci-build.sh"
  exit 1
fi

echo "▶ Git tag: $GIT_TAG"

# ── 2. 환경변수 검증 ─────────────────────────────────────────────────────────
: "${REGISTRY_URL:?REGISTRY_URL 환경변수가 필요합니다 (예: registry.example.com)}"
: "${IMAGE_NAME:?IMAGE_NAME 환경변수가 필요합니다 (예: stella-chatbot)}"

FULL_IMAGE="${REGISTRY_URL}/${IMAGE_NAME}"
echo "▶ 이미지: ${FULL_IMAGE}:${GIT_TAG}"

# ── 3. Registry 로그인 ───────────────────────────────────────────────────────
if [ -n "${REGISTRY_USER:-}" ] && [ -n "${REGISTRY_PASS:-}" ]; then
  echo "▶ Registry 로그인: $REGISTRY_URL"
  echo "$REGISTRY_PASS" | docker login "$REGISTRY_URL" -u "$REGISTRY_USER" --password-stdin
else
  echo "WARN: REGISTRY_USER / REGISTRY_PASS 미설정 — 이미 로그인된 상태로 가정합니다"
fi

# ── 4. Docker 이미지 빌드 ────────────────────────────────────────────────────
echo "▶ 빌드 시작 (플랫폼: linux/amd64)"
docker build \
  --platform linux/amd64 \
  --build-arg BUILD_TAG="$GIT_TAG" \
  -t "${FULL_IMAGE}:${GIT_TAG}" \
  -t "${FULL_IMAGE}:latest" \
  -f Dockerfile \
  .

# ── 5. Registry 푸시 ─────────────────────────────────────────────────────────
echo "▶ 푸시: ${FULL_IMAGE}:${GIT_TAG}"
docker push "${FULL_IMAGE}:${GIT_TAG}"

echo "▶ 푸시: ${FULL_IMAGE}:latest"
docker push "${FULL_IMAGE}:latest"

echo ""
echo "✓ 완료: ${FULL_IMAGE}:${GIT_TAG} → Registry 등록 성공"
