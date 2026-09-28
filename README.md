# Agent CV

Agente de voz con IA que responde llamadas telefónicas con información sobre mi CV.
Las empresas pueden llamar, hacer preguntas, pedir que se transfiera la llamada a mi
móvil o dejar sus datos de contacto. Al colgar, recibo un email con el resumen.

## Arquitectura (Camino B — DIY)

```
Llamada entrante
      │
      ▼
  Twilio (número + Media Streams)
      │  audio en streaming (WebSocket)
      ▼
  Backend Node.js  ◄──►  OpenAI Realtime API (STT + LLM + TTS)
      │
      ├─ tool: transferir_llamada  → Twilio <Dial> a mi móvil
      ├─ tool: guardar_contacto    → storage (DB / Sheets)
      └─ al colgar: resumen (LLM) → email (SES / SendGrid / Resend)
```

## Estructura del proyecto

```
Agent CV/
├── README.md
├── .gitignore
├── .env.example              # plantilla de variables de entorno
├── package.json
├── src/
│   ├── index.js              # servidor HTTP + WebSocket (punto de entrada)
│   ├── config/
│   │   └── index.js          # carga y valida variables de entorno
│   ├── telephony/
│   │   ├── twilioWebhook.js  # webhook de llamada entrante (devuelve TwiML)
│   │   └── mediaStream.js    # maneja el WebSocket de Media Streams
│   ├── realtime/
│   │   └── openaiRealtime.js # conexión con OpenAI Realtime API
│   ├── agent/
│   │   ├── prompt.js         # construye el system prompt con el CV
│   │   └── tools/
│   │       ├── transferCall.js
│   │       ├── saveContact.js
│   │       └── endCall.js
│   ├── services/
│   │   ├── summary.js        # genera el resumen de la llamada con el LLM
│   │   ├── email.js          # envía el email resumen (Resend)
│   │   ├── callReport.js     # orquesta resumen + email + registro al colgar
│   │   └── storage.js        # guarda contactos y registros de llamada
│   └── utils/
│       └── logger.js
├── data/
│   └── cv/
│       └── cv.md             # AQUÍ va el contenido de mi CV
├── scripts/                  # scripts auxiliares (setup, pruebas locales)
└── tests/                    # tests
```

## Puesta en marcha (resumen — se detallará paso a paso)

1. `npm install`
2. Copiar `.env.example` a `.env` y rellenar las claves.
3. Poner el CV en `data/cv/cv.md`.
4. `npm run dev` para levantar el backend en local.
5. Exponer el puerto con un túnel (ngrok) y apuntar el webhook de Twilio a esa URL.

## Estado

Fases 1-5 implementadas (servidor, puente de audio en tiempo real, CV y personalidad,
acciones del agente, y resumen por email al colgar). En curso: Fase 6 (robustez y
guardarraíles). La prueba con llamada real queda pendiente del despliegue (Fase 7).

Detalle completo del plan, las decisiones y el estado en [`docs/BITACORA.md`](docs/BITACORA.md).
