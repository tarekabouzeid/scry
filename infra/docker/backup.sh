#!/bin/sh
# Back up Scry's database from the Compose stack into ./backups/.
#   infra/docker/backup.sh                     # uses docker-compose.prod.yml
#   COMPOSE="-f a.yml -f b.yml" infra/docker/backup.sh
#
# Restore steps are in docs/pilot.md.
set -eu
cd "$(dirname "$0")/../.."
COMPOSE=${COMPOSE:--f infra/docker/docker-compose.prod.yml}
DB=${POSTGRES_DB:-scry}
USER=${POSTGRES_USER:-scry}
mkdir -p backups
out="backups/scry-$(date +%Y%m%d-%H%M%S).dump"
# shellcheck disable=SC2086
docker compose $COMPOSE exec -T postgres \
  pg_dump -U "$USER" -d "$DB" -Fc >"$out"
echo "Backed up to $out ($(du -h "$out" | cut -f1))"
