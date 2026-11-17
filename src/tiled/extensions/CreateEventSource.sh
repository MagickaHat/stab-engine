#!/bin/sh
# Adds an empty event script to content/events and refreshes the Tiled project.
# Called by CreateEvent.js; can also be run by hand:
#   src/tiled/extensions/CreateEventSource.sh <script id> [event file]
cd "$(dirname "$0")/../../.." || exit 1
exec node tools/events/new-script.ts "$@"
