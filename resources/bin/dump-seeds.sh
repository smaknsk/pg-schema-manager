#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PGSCHEMA_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PLAN_FILE="$PGSCHEMA_DIR/src/seeds/plan.sql"

# Parse .env if it exists
if [ -f "$PGSCHEMA_DIR/.env" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ ! "$line" =~ ^# ]] && [[ "$line" =~ = ]]; then
      key=$(echo "$line" | cut -d'=' -f1 | tr -d ' ')
      val=$(echo "$line" | cut -d'=' -f2- | sed -e "s/^[[:space:]]*['\"]//" -e "s/['\"][[:space:]]*$//")
      export "$key"="$val"
    fi
  done < "$PGSCHEMA_DIR/.env"
fi

DB_USER="${POSTGRES_USER:-postgres}"
DB_PASS="${POSTGRES_PASSWORD:-postgres}"
DB_HOST="${POSTGRES_HOST:-localhost}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_NAME="${POSTGRES_DB:-postgres}"

# Helper function to run psql queries
run_psql() {
  local sql="$1"
  if [ "$USE_DOCKER" = "true" ] || [ "$DB_HOST" = "postgres" ]; then
    local compose_file="${COMPOSE_FILE:-compose.yaml}"
    docker compose -f "$PGSCHEMA_DIR/$compose_file" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -tAc "$sql" 2>/dev/null
  else
    PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "$sql" 2>/dev/null
  fi
}

# Helper function to run pg_dump
run_pg_dump() {
  local schema="$1"
  local table="$2"
  local target_file="$3"
  if [ "$USE_DOCKER" = "true" ] || [ "$DB_HOST" = "postgres" ]; then
    local compose_file="${COMPOSE_FILE:-compose.yaml}"
    docker compose -f "$PGSCHEMA_DIR/$compose_file" exec -T postgres pg_dump -U "$DB_USER" -d "$DB_NAME" --no-acl --no-owner --column-inserts --inserts --rows-per-insert=10000 -t "$schema.$table" --data-only > "$target_file"
  else
    PGPASSWORD="$DB_PASS" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" --no-acl --no-owner --column-inserts --inserts --rows-per-insert=10000 -t "$schema.$table" --data-only > "$target_file"
  fi
}

if [ ! -f "$PLAN_FILE" ]; then
  echo "Error: plan.sql not found at $PLAN_FILE"
  exit 1
fi

echo "Starting seeds dumping process based on plan.sql..."

# We read plan.sql line by line
while IFS= read -r line || [ -n "$line" ]; do
  # Trim whitespace
  line=$(echo "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
  
  if [ -z "$line" ] || [[ "$line" =~ ^-- ]]; then
    continue
  fi
  
  case "$line" in
    \\ir*)
      # Extract relative path (remove \ir and trim)
      REL_PATH="${line#\\ir}"
      REL_PATH=$(echo "$REL_PATH" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
      
      # Extract first segment as schema
      SCHEMA=$(echo "$REL_PATH" | cut -d'/' -f1)
      
      # Extract filename without extension as table
      FILENAME=$(basename "$REL_PATH")
      TABLE="${FILENAME%.sql}"
      
      if [ -z "$SCHEMA" ] || [ -z "$TABLE" ]; then
        continue
      fi
      
      # Check if table exists in database
      TABLE_EXISTS=$(run_psql "
        SELECT EXISTS (
          SELECT 1 
          FROM information_schema.tables 
          WHERE table_schema = '$SCHEMA' 
            AND table_name = '$TABLE'
        );
      " | tr -d '\r\n')
      
      if [ "$TABLE_EXISTS" = "t" ] || [ "$TABLE_EXISTS" = "true" ] || [ "$TABLE_EXISTS" = "1" ]; then
        TARGET_FILE="$PGSCHEMA_DIR/src/seeds/$REL_PATH"
        TARGET_DIR="$(dirname "$TARGET_FILE")"
        
        # Ensure directory exists
        mkdir -p "$TARGET_DIR"
        
        echo "Dumping table: $SCHEMA.$TABLE -> src/seeds/$REL_PATH"
        run_pg_dump "$SCHEMA" "$TABLE" "$TARGET_FILE"
      else
        echo "Skipping non-table seed path: src/seeds/$REL_PATH (table $SCHEMA.$TABLE does not exist)"
      fi
      ;;
  esac
done < "$PLAN_FILE"

echo "Seeds dump complete!"
