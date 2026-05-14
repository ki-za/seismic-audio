#!/usr/bin/env bash
set -euo pipefail

printf '== repository cleanup summary ==\n'
printf '\n-- root markdown --\n'
find . -maxdepth 1 -type f -name '*.md' -printf '%f\n' | sort

printf '\n-- app scripts --\n'
find scripts -maxdepth 1 -type f -printf '%f\n' | sort

printf '\n-- agent context files --\n'
find AGENT_CONTEXT -maxdepth 2 -type f | sort

printf '\n-- agent diagnostics files --\n'
find AGENT_DIAGNOSTICS -maxdepth 3 -type f | sort

printf '\n-- package diagnostics --\n'
bun run diagnose:domain
bun run diagnose:query-controls
bun run diagnose:stations
