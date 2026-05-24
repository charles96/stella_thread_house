#!/bin/sh
set -e

trap 'echo "[start] received signal, shutting down"; kill 0 2>/dev/null; wait; exit 0' INT TERM

cd /app/backend && PORT=4100 node dist/main.js &
BE_PID=$!

cd /app/frontend && PORT=3100 HOSTNAME=0.0.0.0 node server.js &
FE_PID=$!

# 둘 중 하나라도 종료되면 다른 하나도 종료시키고 그 exit code 로 컨테이너 종료.
wait -n "$BE_PID" "$FE_PID"
EXIT=$?
echo "[start] one process exited with $EXIT — terminating siblings"
kill 0 2>/dev/null || true
wait
exit "$EXIT"
