#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "{BASH_SOURCE[0]}")/.." && pwd)"
LOG="$SCRIPT_DIR/logs"
PORT=3099
ENTRY="dist\bin\cli.js"
BUILD_CMD="npm run build"
NAME="Workflow"

echo "[CLEANUP] Port $PORT..."
if command -v lsof &>/dev/null; then
    PID=$(lsof -ti:$PORT 2>/dev/null || true)
    if [ -n "$PID" ]; then
        echo "  Port $PORT  PID $PID killed"
        kill -9 $PID 2>/dev/null || true
    fi
elif command -v netstat &>/dev/null; then
    PID=$(netstat -ano 2>/dev/null | grep ":$PORT" | grep LISTENING | awk '{print $NF}' | head -1 || true)
    if [ -n "$PID" ]; then
        echo "  Port $PORT  PID $PID killed"
        kill -9 $PID 2>/dev/null || true
    fi
fi
echo ""

echo "[BUILD] $NAME..."
mkdir -p "$LOG"
cd "$SCRIPT_DIR"
$BUILD_CMD > "$LOG/build.log" 2>&1
if [ $? -ne 0 ]; then
    if [ -d "dist" ]; then
        echo "  [WARN] build failed, using existing dist"
    else
        echo "  [FAIL] no dist found"
        exit 1
    fi
fi
echo "  [OK] build done"
echo ""

echo "[LAUNCH] $NAME on port $PORT..."
node --max-old-space-size=256 --no-warnings --env-file=.env "$ENTRY" --transport httpStream --port $PORT > "$LOG/$NAME.log" 2>&1 &
echo "  [SPAWN] $NAME"
echo ""
echo "[DONE] $NAME launched. Logs: $LOG/$NAME.log"
