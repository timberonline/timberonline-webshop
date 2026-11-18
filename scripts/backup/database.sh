#!/usr/bin/env bash
# Logische back-up en herstel van de Timber Online-database (schema public + migratiehistorie).
#   DATABASE_URL=... scripts/backup/database.sh backup  <map>
#   DATABASE_URL=... scripts/backup/database.sh restore <bestand.sql>
# Gebruikt de Supabase CLI (npx supabase) voor een dump die compatibel is met Supabase-rollen.
# Bevat klantgegevens: versleuteld en afgeschermd bewaren, nooit in Git.
set -euo pipefail
mode="${1:-}"; arg="${2:-}"
: "${DATABASE_URL:?DATABASE_URL ontbreekt (Supabase: Project Settings → Database → connection string)}"
case "$mode" in
  backup)
    mkdir -p "$arg"; ts=$(date +%Y%m%d-%H%M%S)
    npx --yes supabase@latest db dump --db-url "$DATABASE_URL" -f "$arg/schema-$ts.sql"
    npx --yes supabase@latest db dump --db-url "$DATABASE_URL" --data-only --use-copy -f "$arg/data-$ts.sql"
    echo "Back-up geschreven naar $arg (schema-$ts.sql, data-$ts.sql)";;
  restore)
    echo "Herstel naar een LEGE database (bv. nieuw Supabase-project): eerst schema, dan data."
    psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f "$arg";;
  *) echo "Gebruik: database.sh backup <map> | restore <bestand.sql>"; exit 1;;
esac
