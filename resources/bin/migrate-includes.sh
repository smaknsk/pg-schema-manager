#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/../src/migrations"

LAST_FILE=$(ls -1 "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort -V | tail -1)
if [ -z "$LAST_FILE" ]; then
    echo "No migration files found in $MIGRATIONS_DIR."
    exit 1
fi

SQL_FILE="$LAST_FILE"
SQL_DIR="$(dirname "$(realpath "$SQL_FILE")")"
TEMP_FILE=$(mktemp)

HEAD_CONTENT=""
TAIL_CONTENT=""
INCLUDE_LINES=()
STATE="HEAD"

while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" =~ ^[[:space:]]*--[[:space:]]*include:[[:space:]]*file://(.*)$ ]]; then
        INCLUDE_LINES+=("$line")
        STATE="INCLUDES"
    elif [[ "$line" =~ ^[[:space:]]*--[[:space:]]*tail:[[:space:]]*$ ]]; then
        STATE="TAIL"
    else
        if [ "$STATE" = "HEAD" ]; then
            HEAD_CONTENT+="$line"$'\n'
        elif [ "$STATE" = "TAIL" ]; then
            TAIL_CONTENT+="$line"$'\n'
        fi
    fi
done < "$SQL_FILE"

# Trim empty lines
HEAD_CONTENT=$(echo "$HEAD_CONTENT" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}')
TAIL_CONTENT=$(echo "$TAIL_CONTENT" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}')

{
    if [ -n "$HEAD_CONTENT" ]; then
        echo "$HEAD_CONTENT"
    fi
    
    for include_line in "${INCLUDE_LINES[@]}"; do
        echo "$include_line"
    done
    
    echo "" # Spacing
    
    for include_line in "${INCLUDE_LINES[@]}"; do
        [[ "$include_line" =~ file://(.*)$ ]]
        PATH_PART="${BASH_REMATCH[1]}"
        PATH_PART="${PATH_PART#./}"
        echo "-- file://./$PATH_PART"
        cat "$SQL_DIR/$PATH_PART" 2>/dev/null || echo "-- ERROR: File not found"
        echo ""
    done
    
    echo "-- tail:"
    if [ -n "$TAIL_CONTENT" ]; then
        echo "$TAIL_CONTENT"
    fi
} > "$TEMP_FILE"

mv "$TEMP_FILE" "$SQL_FILE"
echo "Updated includes in migration: $SQL_FILE"
