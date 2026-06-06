#!/bin/bash
# Docker 이미지를 git tag 기준으로 빌드하고 private registry에 푸시한다.
# GoCD build-and-push stage에서 실행됨.
set -euo pipefail
export DOCKER_API_VERSION=1.43
export DOCKER_CONFIG=$(mktemp -d)

# ── 1. Git tag 감지 ─────────────────────────────────────────────────────────
# DEPLOY_VERSION이 설정되어 있으면 (GitHub Actions webhook 경유) 그 값을 사용.
# 없으면 HEAD에 달린 태그를 직접 읽는다.
# GoCD git material 은 기본적으로 tag 를 fetch 하지 않을 수 있으므로 항상 명시적으로 fetch.
echo "▶ git fetch --tags"
if ! git fetch --tags --force; then
  echo "WARN: git fetch --tags 실패 (네트워크/SSH 설정 확인 필요)"
fi
echo "▶ git describe --tags --exact-match HEAD: $(git describe --tags --exact-match HEAD 2>/dev/null || echo '(없음)')"
echo "▶ 근처 tags: $(git tag --sort=-creatordate 2>/dev/null | head -5 | tr '\n' ' ')"

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
# Docker 이미지 태그에서 v 접두사 제거 (v1.7.15 → 1.7.15)
IMAGE_TAG="${GIT_TAG#v}"

# ── 1-1. 태그 커밋으로 작업트리 정렬 ─────────────────────────────────────────
# GoCD 가 체크아웃해 둔 커밋은 트리거 시점의 커밋(예: 태그 이동 전)일 수 있다.
# docker build 는 '현재 작업트리'를 컨텍스트로 쓰므로, 빌드 소스가 이미지 태그와
# 어긋나지 않도록 항상 해당 태그 커밋을 명시적으로 체크아웃한다.
echo "▶ 태그 커밋 체크아웃: $GIT_TAG ($(git rev-list -n1 "refs/tags/${GIT_TAG}" 2>/dev/null || echo '해석 실패'))"
if ! git checkout --force --detach "refs/tags/${GIT_TAG}"; then
  echo "ERROR: 태그 '${GIT_TAG}' 체크아웃 실패 — 태그가 원격에 푸시됐는지 확인하세요."
  exit 1
fi
echo "▶ 빌드 대상 커밋: $(git rev-parse HEAD)"

# ── 2. 환경변수 검증 ─────────────────────────────────────────────────────────
# Docker Hub      : REGISTRY_URL=docker.io,  IMAGE_NAME=<네임스페이스>/stella-th (예: charles1031/stella-th)
# 사설 레지스트리 : REGISTRY_URL=registry.example.com, IMAGE_NAME=stella-th
: "${REGISTRY_URL:?REGISTRY_URL 환경변수가 필요합니다 (Docker Hub 는 docker.io)}"
: "${IMAGE_NAME:?IMAGE_NAME 환경변수가 필요합니다 (예: charles1031/stella-th)}"

FULL_IMAGE="${REGISTRY_URL}/${IMAGE_NAME}"
echo "▶ 이미지: ${FULL_IMAGE}:${IMAGE_TAG}"

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
  --build-arg BUILD_TAG="$IMAGE_TAG" \
  -t "${FULL_IMAGE}:${IMAGE_TAG}" \
  -t "${FULL_IMAGE}:latest" \
  -f Dockerfile \
  .

# ── 5. Registry 푸시 ─────────────────────────────────────────────────────────
echo "▶ 푸시: ${FULL_IMAGE}:${IMAGE_TAG}"
docker push "${FULL_IMAGE}:${IMAGE_TAG}"

echo "▶ 푸시: ${FULL_IMAGE}:latest"
docker push "${FULL_IMAGE}:latest"

echo ""
echo "✓ 완료: ${FULL_IMAGE}:${IMAGE_TAG} → Registry 등록 성공"
