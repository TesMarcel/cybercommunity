#!/usr/bin/env bash
# Sauvegarde complète : base PostgreSQL + fichiers téléversés
# Usage : npm run backup            (depuis le dossier backend)
# Résultat : backups/cybercom-AAAA-MM-JJ_HHMMSS.dump et .uploads.tar.gz
set -euo pipefail

cd "$(dirname "$0")/.."

# DATABASE_URL et UPLOAD_DIR depuis .env (sans afficher leur contenu)
if [ -f .env ]; then
  DATABASE_URL="${DATABASE_URL:-$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- || true)}"
  UPLOAD_DIR="${UPLOAD_DIR:-$(grep -E '^UPLOAD_DIR=' .env | cut -d= -f2- || true)}"
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "❌ DATABASE_URL introuvable (fichier .env)" >&2
  exit 1
fi

UPLOAD_DIR="${UPLOAD_DIR:-uploads}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
NAME="$BACKUP_DIR/cybercom-$STAMP"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# Format « custom » : compressé, restaurable avec pg_restore
pg_dump --format=custom --no-owner --file="$NAME.dump" "$DATABASE_URL"
echo "✅ Base sauvegardée : $NAME.dump"

if [ -d "$UPLOAD_DIR" ]; then
  tar -czf "$NAME.uploads.tar.gz" -C "$UPLOAD_DIR" .
  echo "✅ Fichiers sauvegardés : $NAME.uploads.tar.gz"
else
  echo "ℹ️  Aucun dossier $UPLOAD_DIR : pas de fichiers à sauvegarder"
fi

# Conserve les 14 dernières sauvegardes
ls -1t "$BACKUP_DIR"/cybercom-*.dump 2>/dev/null | tail -n +15 | while read -r old; do
  rm -f "$old" "${old%.dump}.uploads.tar.gz"
done
