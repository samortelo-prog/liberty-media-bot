#!/bin/bash
set -e

cd ~/Desktop/liberty-media-bot

# 0. Por si quedó un lock de git colgado
rm -f .git/index.lock

# 1. auth_info nunca debe vivir en git (son credenciales de sesión de WhatsApp).
#    En Railway persiste solo, vía el volumen /app/auth_info.
git rm -r --cached auth_info --quiet 2>/dev/null || true

# 2. Agregar todos los cambios (fixes de sqlite path, import de baileys, prompt de llamadas, .gitignore)
git add -A

# 3. Commit
git commit -m "fix: ruta sqlite en local, import de baileys, hora de llamada agendada, quitar auth_info de git"

# 4. Subir a GitHub (si Railway está conectado al repo, esto ya dispara el deploy automático)
git push origin main

echo ""
echo "Listo. Si Railway está conectado a este repo de GitHub, el deploy arrancará solo."
echo "Si prefieres deployar manual con la CLI de Railway, corre además:"
echo "  npm i -g @railway/cli   (si no la tienes instalada)"
echo "  railway login"
echo "  railway link            (selecciona tu proyecto)"
echo "  railway up"
echo ""
echo "IMPORTANTE: revisa en el dashboard de Railway (Variables) que estén seteadas:"
echo "  OPENAI_API_KEY, AGENT_PHONE, OWNER_PHONE=51944120858, BUSINESS_NAME, NODE_ENV=production"
