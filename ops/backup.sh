#!/usr/bin/env bash
# Logical backup of the whole database (custom format, compressed). Run from cron / a scheduled job.
#   DATABASE_URL=... ./ops/backup.sh [output_dir]
# Restore:  pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" backups/mavrix-YYYYMMDD-HHMMSS.dump
# On managed Postgres (Supabase/Neon/RDS) ALSO enable the provider's automatic daily backups / point-in-time recovery.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
out="${1:-backups}"; mkdir -p "$out"
file="$out/mavrix-$(date -u +%Y%m%d-%H%M%S).dump"
pg_dump --format=custom --no-owner --compress=9 --file="$file" "$DATABASE_URL"
echo "backup written: $file ($(du -h "$file" | cut -f1))"
# Keep the 14 most recent local dumps.
ls -1t "$out"/mavrix-*.dump | tail -n +15 | xargs -r rm --
