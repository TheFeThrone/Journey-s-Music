#!/bin/bash
cd "$(dirname "$0")" || exit 1

# Load environment variables if .env exists
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# Ensure HEALTHCHECK_URL is set
if [ -z "$HEALTHCHECK_URL" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: HEALTHCHECK_URL not set in .env" >> bot.log
  exit 1
fi

# Dependency check
INSTALL=false

if [ ! -d node_modules ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] node_modules missing — will install"
  INSTALL=true
elif [ -f package-lock.json ]; then
  NEW_SUM=$(sha256sum package-lock.json | awk '{print $1}')
  OLD_SUM=$(cat .lockhash 2>/dev/null)

  if [ "$NEW_SUM" != "$OLD_SUM" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] package-lock.json changed — will reinstall"
    INSTALL=true
  fi
fi

if [ "$INSTALL" = true ]; then
  if [ -f package-lock.json ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Installing dependencies with npm ci"
    npm ci --omit=dev
    sha256sum package-lock.json | awk '{print $1}' > .lockhash
  else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Installing dependencies with npm install"
    npm install --omit=dev
  fi
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Dependencies unchanged — skipping install"
fi

# Run app with auto-restart + timestamps
while true; do
  # Create a temporary file to capture output
  TMP_LOG=$(mktemp)

  # Stream output to both bot.log and temporary file
  node --trace-warnings index.js 2>&1 | tee >(ts '[%Y-%m-%d %H:%M:%S]' >> bot.log) > "$TMP_LOG"
  EXIT_CODE=${PIPESTATUS[0]}

  if [ $EXIT_CODE -ne 0 ]; then
    # On crash, send Healthchecks failure ping with output
    curl -fsS --retry 3 --data-raw "@$TMP_LOG" "$HEALTHCHECK_URL/$EXIT_CODE" > /dev/null
    echo "App crashed with exit code $EXIT_CODE — restarting..." \
      | ts '[%Y-%m-%d %H:%M:%S]' >> bot.log
  fi

  # Clean up temp file
  rm "$TMP_LOG"

  sleep 2
done
