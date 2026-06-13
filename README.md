# 🚀 Liberty Media — Bot WhatsApp

Bot de WhatsApp inteligente para ventas de páginas web, construido con **Baileys** + **GPT-4o-mini**.

---

## ⚙️ Stack Tecnológico

| Tecnología | Uso |
|---|---|
| Node.js 18+ | Runtime |
| @whiskeysockets/baileys | Conexión WhatsApp |
| OpenAI GPT-4o-mini | IA conversacional |
| Railway | Hosting en la nube |

---

## 🛠️ Instalación Local

### 1. Clonar y entrar al proyecto
```bash
git clone <tu-repo>
cd liberty-media-bot
```

### 2. Instalar dependencias
```bash
npm install
```

### 3. Configurar variables de entorno
```bash
cp .env.example .env
```
Edita `.env` con tus valores reales:
```
OPENAI_API_KEY=sk-proj-...
AGENT_PHONE=51987654321
```

### 4. Ejecutar el bot
```bash
npm start
```

### 5. Escanear QR
Aparecerá un QR en la terminal. Ábrelo con WhatsApp → Dispositivos vinculados → Vincular dispositivo.

---

## 🚂 Deploy en Railway

### Opción A — GitHub (recomendado)
1. Sube el código a GitHub
2. En [railway.app](https://railway.app) → New Project → Deploy from GitHub Repo
3. Selecciona el repositorio
4. Agrega las variables de entorno en **Variables**:
   - `OPENAI_API_KEY`
   - `AGENT_PHONE`
5. Haz deploy y revisa los **Logs** para escanear el QR

### Opción B — Railway CLI
```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

### ⚠️ Nota sobre el QR en Railway
El QR aparece en los logs de Railway. Una vez escaneado, la sesión se guarda en `auth_info/` dentro del volumen. Para que la sesión persista entre reinicios:
- En Railway → tu servicio → **Volumes** → Add Volume → Mount Path: `/app/auth_info`

---

## 📁 Estructura del Proyecto

```
liberty-media-bot/
├── src/
│   ├── index.js          # Entrada principal, conexión WhatsApp
│   ├── messageHandler.js # Lógica de procesamiento de mensajes
│   ├── ai.js             # Integración con OpenAI
│   ├── sessions.js       # Gestión de sesiones por usuario
│   ├── messenger.js      # Funciones de envío de mensajes
│   └── config.js         # ⚡ CONFIGURACIÓN DEL NEGOCIO (editar aquí)
├── .env.example
├── .gitignore
├── railway.toml
└── package.json
```

---

## 💬 Flujo del Bot

```
Usuario escribe → ¿Primer mensaje? → Bienvenida + Menú
                 → ¿Número de menú? → Respuesta IA contextual
                 → ¿"agente"?      → Transferencia a humano
                 → Otro texto      → Conversación libre con IA
```

---

## ✏️ Personalización

Edita `src/config.js` para cambiar:
- **Paquetes y precios** → `SYSTEM_PROMPT`
- **Opciones del menú** → `MENU_OPTIONS` y `MAIN_MENU`
- **Palabras para transferir** → `TRANSFER_KEYWORDS`

---

## 🔒 Seguridad

- La carpeta `auth_info/` contiene tu sesión de WhatsApp. **Nunca la subas a GitHub** (ya está en `.gitignore`)
- Tu `OPENAI_API_KEY` va **solo** en variables de entorno, nunca en el código

---

## 📞 Soporte

¿Necesitas ayuda? Contacta al equipo de Liberty Media.
