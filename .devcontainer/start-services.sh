#!/usr/bin/env sh
# Starts the fake provider and its webhook receiver (roadmap 13.11) on :4010
# every time the container starts. Detached with setsid + nohup: a plain `&`
# dies with the lifecycle shell that ran postStartCommand.
# Log: /tmp/fake-provider.log. Stop: pkill -f tools/fake-provider.mjs
set -e
cd "$(dirname "$0")/.."
if pgrep -f tools/fake-provider.mjs >/dev/null; then
  exit 0
fi
setsid nohup node tools/fake-provider.mjs >/tmp/fake-provider.log 2>&1 </dev/null &
