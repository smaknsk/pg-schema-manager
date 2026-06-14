#!/bin/bash
set -e

SCHEMA=$1

if [ -z "$SCHEMA" ]; then
  echo "Usage: $0 <schema_name>"
  exit 1
fi

BASE_DIR="$(dirname "$(realpath "$0")")/../src/schemas/$SCHEMA"
TABLES_DIR="$BASE_DIR/tables"
OUTPUT_DIR="$BASE_DIR/trigger"
OUTPUT_FILE="$OUTPUT_DIR/update_updated_at.sql"

if [ ! -d "$TABLES_DIR" ]; then
  echo "Error: Tables directory not found: $TABLES_DIR"
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

echo "-- Универсальная функция для обновления поля updated_at в схеме $SCHEMA" > "$OUTPUT_FILE"
echo "CREATE OR REPLACE FUNCTION $SCHEMA.update_updated_at()" >> "$OUTPUT_FILE"
echo "RETURNS TRIGGER AS \$\$" >> "$OUTPUT_FILE"
echo "BEGIN" >> "$OUTPUT_FILE"
echo "  NEW.updated_at = CURRENT_TIMESTAMP;" >> "$OUTPUT_FILE"
echo "  RETURN NEW;" >> "$OUTPUT_FILE"
echo "END;" >> "$OUTPUT_FILE"
echo "\$\$ LANGUAGE plpgsql;" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "-- Применяем триггер ко всем таблицам в схеме $SCHEMA, которые имеют поле updated_at" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# Sort files to ensure deterministic output
if [ -d "$TABLES_DIR" ]; then
  FILES=$(ls "$TABLES_DIR"/*.sql 2>/dev/null | sort)
  if [ -n "$FILES" ]; then
    for file in $FILES; do
      if grep -q "updated_at" "$file"; then
        TABLE_NAME=$(basename "$file" .sql)
        TRIGGER_NAME="trigger_update_${TABLE_NAME}_updated_at"
        
        echo "-- Триггер для $SCHEMA.$TABLE_NAME" >> "$OUTPUT_FILE"
        echo "CREATE OR REPLACE TRIGGER $TRIGGER_NAME" >> "$OUTPUT_FILE"
        echo "  BEFORE UPDATE ON $SCHEMA.$TABLE_NAME" >> "$OUTPUT_FILE"
        echo "  FOR EACH ROW" >> "$OUTPUT_FILE"
        echo "  EXECUTE FUNCTION $SCHEMA.update_updated_at();" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"
      fi
    done
  fi
fi

echo "Generated $OUTPUT_FILE"
