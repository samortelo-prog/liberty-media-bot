#!/bin/bash
set -e
cd ~/Desktop/liberty-media-bot

if [ ! -f "auth_info/creds.json" ]; then
  echo "No encuentro auth_info/creds.json. Asegúrate de que el bot esté vinculado y corriendo en esta Mac."
  exit 1
fi

tar -czf /tmp/auth_info.tar.gz -C . auth_info
base64 -i /tmp/auth_info.tar.gz | tr -d '\n' | pbcopy

echo "Listo. El valor ya está copiado en tu portapapeles (Cmd+V para pegarlo)."
echo "Ve a Railway -> tu servicio -> Variables -> New Variable"
echo "Nombre:  AUTH_INFO_B64"
echo "Valor:   pega con Cmd+V"
