#!/bin/sh
set -e

HOST="${POSTGRES_HOST:-postgres}"
PORT="${POSTGRES_PORT:-5432}"

echo "Waiting for PostgreSQL at $HOST:$PORT..."
# Wait for PostgreSQL to be available
until pg_isready -h "$HOST" -p "$PORT"; do
  echo "PostgreSQL is unavailable - sleeping"
  sleep 2
done
sleep 2
echo "PostgreSQL is up - starting application"

exec "$@"
