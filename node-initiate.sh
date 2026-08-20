#!/bin/bash
cd "$(dirname "$0")" || { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: Failed to cd to script directory" >> bot.log; exit 1; }
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Script starting. Working directory set to $(pwd)" >> bot.log

# Load environment variables if .env exists
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# restart command to call this file with to trigger a reload of the bot without rebooting the device 
if [ "$1" == "restart" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Terminating $APP_NAME Node process to trigger a reload..." >> bot.log
  pkill -f "index.js --name=$APP_NAME"
  return 0 2>/dev/null || exit 0
fi

# rebuild command to trigger a reload of the bot AND restart the background loop
if [ "$1" == "rebuild" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Rebuilding $APP_NAME and restarting loop..." >> bot.log

  pkill -f "index.js --name=$APP_NAME"
  # Kill the background loop (excluding this current terminal command's PID using $$)
  pgrep -f "$(pwd)/node-initiate.sh" | grep -v $$ | xargs -r kill

  sleep 1
  ./node-initiate.sh & disown
  return 0 2>/dev/null || exit 0
fi

# Prevent multiple instances from running at the same time
exec 200>"/tmp/${APP_NAME}.lock"
flock -n 200 || { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: Another instance is already running." >> bot.log; exit 1; }

# Ensure HEALTHCHECK_URL is set
if [ -z "$HEALTHCHECK_URL" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: HEALTHCHECK_URL not set in .env" >> bot.log
  return 1 2>/dev/null || exit 1
fi

# Dependency check
INSTALL=false

if [ ! -d node_modules ] || [ ! -f package-lock.json ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] node_modules or package-lock missing — will install"
  INSTALL=true
else
  # If both exist, check for changes
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
  else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Installing dependencies with npm install"
    npm install --omit=dev
  fi
  [ -f package-lock.json ] && sha256sum package-lock.json | awk '{print $1}' > .lockhash
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Dependencies unchanged — skipping install"
fi

# Run app with auto-restart + timestamps
while true; do
  until nc -z 192.168.2.56 5432; do
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Waiting for database to wake up..." >> bot.log
    sleep 2
  done
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Database is up! Starting Node..." >> bot.log

  # Stream output to both bot.log and temporary file
  node --dns-result-order=ipv4first --trace-warnings index.js --name="$APP_NAME" 2>&1 | ts '[%Y-%m-%d %H:%M:%S]' >> bot.log
  EXIT_CODE=${PIPESTATUS[0]}

  if [ $EXIT_CODE -ne 0 ]; then
    CRASH_LOG=$(tail -n 50 bot.log)
    # On crash, send Healthchecks failure ping with output
    curl -fsS --retry 3 --data-raw "$CRASH_LOG" "$HEALTHCHECK_URL/$EXIT_CODE" > /dev/null
    echo "App crashed with exit code $EXIT_CODE — restarting..." \
      | ts '[%Y-%m-%d %H:%M:%S]' >> bot.log
  fi

  sleep 2
done
