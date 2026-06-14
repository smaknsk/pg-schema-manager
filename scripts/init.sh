#!/bin/bash
set -e

TARGET_DIR=$1

if [ -z "$TARGET_DIR" ]; then
  echo "Error: target directory is required."
  echo "Usage: $0 <target_directory>"
  exit 1
fi

# Resolve absolute path of TARGET_DIR and create it
mkdir -p "$TARGET_DIR"
TARGET_DIR=$(cd "$TARGET_DIR" && pwd)

echo "Initializing declarative database schema structure at $TARGET_DIR..."

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESOURCES_DIR="$(cd "$SCRIPT_DIR/../resources" && pwd)"

if [ ! -d "$RESOURCES_DIR" ]; then
  echo "Error: Resources directory not found at $RESOURCES_DIR"
  exit 1
fi

# Create directory tree
mkdir -p "$TARGET_DIR/bin"
mkdir -p "$TARGET_DIR/src/migrations"
mkdir -p "$TARGET_DIR/src/schemas/public"
mkdir -p "$TARGET_DIR/src/seeds"

# Copy top-level template files
cp "$RESOURCES_DIR/Dockerfile" "$TARGET_DIR/"
cp "$RESOURCES_DIR/compose.yaml" "$TARGET_DIR/"
cp "$RESOURCES_DIR/Makefile" "$TARGET_DIR/"
cp "$RESOURCES_DIR/env.dist" "$TARGET_DIR/"
if [ ! -f "$TARGET_DIR/.env" ]; then
  cp "$RESOURCES_DIR/env.dist" "$TARGET_DIR/.env"
fi

# Copy bin scripts
cp -r "$RESOURCES_DIR/bin/" "$TARGET_DIR/bin/"
chmod +x "$TARGET_DIR/bin/"*.sh

# Copy src plan files
cp "$RESOURCES_DIR/src/schemas/plan.sql" "$TARGET_DIR/src/schemas/"
cp "$RESOURCES_DIR/src/schemas/public/schema.sql" "$TARGET_DIR/src/schemas/public/"
cp "$RESOURCES_DIR/src/seeds/plan.sql" "$TARGET_DIR/src/seeds/"

# Customize compose name based on target directory base name
PROJECT_NAME=$(basename "$TARGET_DIR" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]//g')
if [ -n "$PROJECT_NAME" ]; then
  # Try BSD sed (macOS), fall back to GNU sed
  sed -i '' "s/name: db-schema-project/name: $PROJECT_NAME-db/g" "$TARGET_DIR/compose.yaml" 2>/dev/null || \
  sed -i "s/name: db-schema-project/name: $PROJECT_NAME-db/g" "$TARGET_DIR/compose.yaml" 2>/dev/null || true
fi

echo ""
echo "================================================================"
echo "🎉 Initialization complete at: $TARGET_DIR"
echo "================================================================"
echo "Next steps:"
echo "  1. Go to target directory:"
echo "     cd $TARGET_DIR"
echo "  2. Review and configure .env if necessary"
echo "  3. Spin up PostgreSQL database container:"
echo "     make up"
echo "  4. Define schemas and tables under src/schemas/"
echo "  5. Apply the initial schema plan:"
echo "     make plan"
echo "================================================================"
echo ""
