#!/bin/bash
set -e

# If POSTGRES_URL is not set, build it from environment variables
if [ -z "$POSTGRES_URL" ]; then
  if [ -n "$POSTGRES_PASSWORD_FILE" ] && [ -f "$POSTGRES_PASSWORD_FILE" ]; then
    DB_PASS=$(cat "$POSTGRES_PASSWORD_FILE")
  else
    DB_PASS="${POSTGRES_PASSWORD:-postgres}"
  fi
  
  DB_USER="${POSTGRES_USER:-postgres}"
  DB_HOST="${POSTGRES_HOST:-localhost}"
  DB_PORT="${POSTGRES_PORT:-5432}"
  DB_NAME="${POSTGRES_DB:-postgres}"
  
  export POSTGRES_URL="postgresql://$DB_USER:$DB_PASS@$DB_HOST:$DB_PORT/$DB_NAME"
fi

if [ -z "$POSTGRES_URL" ]; then
  echo "Error: POSTGRES_URL is not set and could not be determined."
  exit 1
fi

BASE_DIR="$(dirname "$(realpath "$0")")/../src"

# Create migration tracking table if not exists
psql "$POSTGRES_URL" -c "CREATE TABLE IF NOT EXISTS public.schema_migrations (name text NOT NULL PRIMARY KEY, applied_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL);"

# Apply all new migrations sorted chronologically
MIGRATIONS_EXIST=0
if [ -d "$BASE_DIR/migrations" ]; then
  # Check if there are sql files
  FILES=$(ls "$BASE_DIR"/migrations/*.sql 2>/dev/null | sort)
  if [ -n "$FILES" ]; then
    MIGRATIONS_EXIST=1
    for file in $FILES; do
      filename=$(basename "$file")

      EXISTS=$(psql "$POSTGRES_URL" -tAc "SELECT 1 FROM public.schema_migrations WHERE name = '$filename';")

      if [[ "$EXISTS" != "1" ]]; then
        echo ">> Applying migration: $filename"
        psql "$POSTGRES_URL" -v ON_ERROR_STOP=1 -f "$file"
        psql "$POSTGRES_URL" -c "INSERT INTO public.schema_migrations (name) VALUES ('$filename');"
      else
        echo "-- Already applied: $filename"
      fi
    done
  fi
fi

if [ "$MIGRATIONS_EXIST" -eq 0 ]; then
  echo "No migrations found under src/migrations/."
fi
