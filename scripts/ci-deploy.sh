#!/bin/bash
# 레지스트리에서 최신 이미지를 pull 하고 docker compose로 전체 재시작한다.
# GoCD deploy stage에서 실행됨.
set -euo pipefail
export DOCKER_API_VERSION=1.43
export DOCKER_CONFIG=$(mktemp -d)

# DEPLOY_VERSION 이 비어 있으면 (SCM auto-trigger 등 GitHub Actions 경유 아닐 때)
# HEAD 의 git tag 를 읽어 fallback — ci-build.sh 와 동일한 로직.
if [ -z "${DEPLOY_VERSION:-}" ]; then
  git fetch --tags --force 2>/dev/null || true
fi
GIT_TAG="${DEPLOY_VERSION:-$(git describe --tags --exact-match HEAD 2>/dev/null || echo "")}"

if [ -z "$GIT_TAG" ]; then
  echo "ERROR: DEPLOY_VERSION 미설정 + HEAD 에 git tag 없음."
  echo "  현재 HEAD: $(git rev-parse HEAD)"
  echo "  근처 태그: $(git describe --tags 2>/dev/null || echo '없음')"
  exit 1
fi

IMAGE_TAG="${GIT_TAG#v}"
export APP_IMAGE="${REGISTRY_URL}/${IMAGE_NAME}:${IMAGE_TAG}"

DEPLOY_ENV="/volume1/docker/stella/.env"
COMPOSE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "▶ 배포 이미지: $APP_IMAGE"

# 레지스트리 로그인
if [ -n "${REGISTRY_USER:-}" ] && [ -n "${REGISTRY_PASS:-}" ]; then
  echo "$REGISTRY_PASS" | docker login "$REGISTRY_URL" -u "$REGISTRY_USER" --password-stdin
fi

# 이미지 pull
docker pull "$APP_IMAGE"

# 전체 서비스 재시작 (docker-compose v1 / v2 모두 지원)
if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose)
else
  echo "ERROR: docker compose (v2 plugin) 또는 docker-compose (v1) 가 설치되어 있지 않습니다."
  echo "  설치 예) apt-get install -y docker-compose-plugin"
  exit 1
fi
echo "▶ ${COMPOSE_CMD[*]} up -d (전체)"
"${COMPOSE_CMD[@]}" \
  -f "$COMPOSE_DIR/docker-compose.yml" \
  -f "$COMPOSE_DIR/docker-compose.prod.yml" \
  --env-file "$DEPLOY_ENV" \
  up -d --no-build

echo ""
echo "✓ 배포 완료: $APP_IMAGE"
