#!/bin/bash
# 레지스트리에서 최신 이미지를 pull 하고 docker compose로 전체 재시작한다.
# GoCD deploy stage에서 실행됨.
set -euo pipefail
export DOCKER_API_VERSION=1.43
export DOCKER_CONFIG=$(mktemp -d)

IMAGE_TAG="${DEPLOY_VERSION#v}"
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
echo "▶ docker compose up -d (전체)"
if docker compose version &>/dev/null 2>&1; then
  docker compose \
    -f "$COMPOSE_DIR/docker-compose.yml" \
    -f "$COMPOSE_DIR/docker-compose.prod.yml" \
    --env-file "$DEPLOY_ENV" \
    up -d --no-build
else
  docker-compose \
    -f "$COMPOSE_DIR/docker-compose.yml" \
    -f "$COMPOSE_DIR/docker-compose.prod.yml" \
    --env-file "$DEPLOY_ENV" \
    up -d --no-build
fi

echo ""
echo "✓ 배포 완료: $APP_IMAGE"
