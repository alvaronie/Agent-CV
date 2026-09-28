# Bitácora del proyecto — Agent CV

> Documento vivo. Registra el **plan**, las **decisiones** (con su porqué) y **en qué fase
> estamos**. Objetivo: si se pierde la conversación, aquí queda todo claro para retomar.

Última actualización: 2026-09-28

---

## 1. Objetivo del proyecto

Agente de voz con IA que atiende un número de teléfono con la información de mi CV.
Las empresas del sector tecnológico pueden llamar, hacer preguntas sobre mí o sobre el
propio agente, pedir que se transfiera la llamada a mi móvil, o dejar sus datos de
contacto. Tras cada llamada, recibo un email con un resumen de lo hablado.

---

## 2. Decisiones tomadas (con justificación)

| # | Decisión | Justificación | Fecha |
|---|----------|---------------|-------|
| D1 | **Camino B (DIY)**: Twilio + OpenAI Realtime + backend Node.js, en lugar de plataforma gestionada (Vapi/Retell). | Más control, más barato por minuto y demuestra músculo técnico real para el portfolio. | 2026-08-11 |
| D2 | **Desarrollo en local primero**, despliegue a la nube al final. | Iterar gratis y rápido; depurar es más fácil en local. En producción sí irá a la nube. | 2026-08-11 |
| D3 | **Stack Node.js** (ESM), servidor + WebSocket. | Idiomático para Twilio Media Streams y OpenAI Realtime; mucho ejemplo disponible. | 2026-08-11 |
| D4 | **Aislamiento con gestor de versiones de Node (fnm)** en vez de Docker. | Las dependencias ya se aíslan por proyecto vía `node_modules`; fnm mantiene Node por-usuario sin tocar el sistema. Docker añadía fricción con audio/red sin compensar en desarrollo. | 2026-08-11 |
| D5 | Instalar fnm por **binario directo** en `~/.local/bin` en vez de vía Homebrew. | El script oficial de fnm en macOS exige Homebrew (no instalado). Descargar el binario evita instalar Homebrew (más intrusivo) y es igual de limpio/reversible. | 2026-08-11 |
| D6 | **Node LTS v24.19.0**, fijada con `.nvmrc`. | Versión LTS estable; `.nvmrc` + fnm `--use-on-cd` activan la versión correcta al entrar en la carpeta, reproducible en cualquier máquina. | 2026-08-11 |
| D7 | **Desarrollo con número de EE. UU.**; el número español será **geográfico/Local**, no móvil. | El bundle español creado era de tipo **Mobile**, pero Twilio no tiene inventario de móviles +34 y la ley española (2025) prohíbe usar móviles para llamadas de atención/negocio. Hay que crear un bundle **Local (geográfico)** con dirección en la zona del prefijo. Mientras se aprueba, se desarrolla con el número de EE. UU. ya comprado. Descartado Luxemburgo: para quien llama desde España es una llamada internacional (roaming ≠ llamar a número extranjero), no equivale a una nacional. | 2026-08-12 |
| D8 | **Twilio NO tiene inventario de números españoles** (comprobado por API: `ES/Local` devuelve 404, mientras `US/Local` sí lista números). El bundle Local está aprobado, pero no hay stock que comprar. | Verificado con credenciales válidas (HTTP 200 en la cuenta). No es problema de configuración ni del bundle. Opciones: (a) abrir ticket a soporte Twilio pidiendo número geográfico ES; (b) obtener el número español de otro proveedor con inventario (Telnyx/Vonage/Plivo) en el despliegue; (c) seguir desarrollando con el número EE. UU. La arquitectura (Media Streams) es portable a otro proveedor si hiciera falta. | 2026-08-13 |
| D9 | **Elegida Opción 3**: desarrollar con el número EE. UU.; más adelante, posiblemente crear cuenta en otro proveedor para conseguir el número español. | No bloquearse por el inventario. El grueso del trabajo (Fases 1-6) es independiente del país del número. El número español se resolverá en el despliegue (Fase 7). | 2026-08-13 |
| D10 | **Idioma del agente: inglés por defecto, con adaptación automática al idioma del llamante.** El CV se guarda en su inglés original como fuente de verdad. | El modelo speech-to-speech de OpenAI Realtime es multilingüe de forma nativa: adaptar el idioma es solo una instrucción en el system prompt (unas decenas de tokens de texto, una vez por sesión), **sin latencia por turno ni coste apreciable** ni componentes extra. Encaja con perfil bilingüe (inglés C1, Luxemburgo) y con llamadas tanto nacionales como internacionales. | 2026-08-23 |
| D11 | **Se guarda SOLO el resumen de la llamada, nunca la transcripción.** La transcripción vive en memoria durante la llamada, se usa para generar el resumen y se descarta al colgar. | La transcripción es información personal de terceros (quien llama) y acumularla en disco añade riesgo sin aportar valor: el resumen ya contiene lo accionable. El resumen se persiste en `data/calls.jsonl` y se envía por email. **Única excepción:** si la generación del resumen falla, el email de aviso incluye la transcripción en bruto para no perder la llamada — pero en disco el resumen queda a `null` y la transcripción no se escribe. | 2026-09-23 |
| D12 | **El servidor escucha solo en `127.0.0.1` por defecto** (variable `HOST`), y el puerto local pasa a **3001**. | Se desarrolla en un equipo corporativo: escuchar en `0.0.0.0` dejaba el servidor accesible desde la red de la oficina sin necesidad alguna. Con `127.0.0.1` solo es alcanzable desde la propia máquina; en el despliegue (Fase 7) se pondrá `HOST=0.0.0.0`, donde sí hace falta. El puerto 3000 estaba ocupado por Visual Studio Code, lo que hacía que las pruebas locales hablaran con el programa equivocado. | 2026-09-23 |
| D13 | **Se mantiene Twilio y se usa un número geográfico LOCAL de Luxemburgo (+352)**, en lugar del +34 español vía Telnyx. | Telnyx exige llegar a nivel **Verified** + DNI/NIE + domicilio en España + **estar físicamente en España** al comprar, y además obligaría a **migrar el código de Twilio a Telnyx**. Comprobado por API que **Twilio SÍ tiene inventario LU/Local con voz** (`LU/Local`=200; `LU/Mobile` y `LU/National`=404; España sigue 404 en todo). El requisito de **dirección local** del número LU se cumple con el **domicilio real del usuario en Luxemburgo**. Ventajas: desbloquea la compra **ya**, **cero migración** (el proyecto ya es Twilio), y para las pruebas del usuario (SIM española en roaming en LU) llamar al +352 sale a **tarifa nacional** (RLAH). **Contra aceptado:** para quien llame desde España es una **llamada intracomunitaria** (limitada por la UE a ~0,19 €/min, no nacional). El +34 español queda como posible mejora futura si el público objetivo lo justifica. | 2026-09-28 |
| D14 | **Plataforma de despliegue: Render + GitHub**, plan `starter` (siempre despierto). | Render despliega Node de forma nativa (sin Docker), soporta **WebSockets** (los necesita `/media-stream`), da **HTTPS/WSS** automático, usa `/health` como health check y **redepliega en cada push**. El plan **`free` se duerme tras 15 min** y tarda ~1 min en despertar, lo que haría **fallar las llamadas entrantes**; por eso se usará **`starter`** (~7 $/mes) para la instancia siempre activa. Alternativa Fly.io (desde CLI, sin GitHub, pero con Docker) descartada por mayor fricción. Los secretos se ponen en el panel de Render (`sync:false`), nunca en el repo. | 2026-09-28 |

---

## 3. Plan por fases

- **Fase 0 — Preparación del entorno**
- **Fase 1 — Servidor base que responde llamadas**
- **Fase 2 — Puente de audio en tiempo real con la IA**
- **Fase 3 — Personalidad y conocimiento (el CV)**
- **Fase 4 — Acciones (tools: transferir, guardar contacto, finalizar)**
- **Fase 5 — Resumen por email tras la llamada**
- **Fase 6 — Robustez y guardarraíles** ✅ completada
- **Fase 7 — Despliegue a la nube** ← *estamos aquí*

### Detalle de cada fase

**Fase 0 — Preparación del entorno**
1. Instalar gestor de versiones de Node (fnm) por-usuario.
2. Instalar Node.js LTS con fnm y fijar la versión del proyecto (`.nvmrc`).
3. Verificar `node` y `npm`.
4. Crear cuenta Twilio + comprar número.
5. Crear API key de OpenAI (con acceso a Realtime).
6. Elegir proveedor de email (Resend) + API key.
7. Preparar ngrok (túnel) para las pruebas.
8. Rellenar `.env` a partir de `.env.example`.

**Fase 1 — Servidor base**
1. `npm install` de dependencias base.
2. Servidor HTTP en `src/index.js`.
3. Webhook de llamada entrante (`twilioWebhook.js`) con TwiML simple.
4. ngrok + configurar el webhook en Twilio.
5. Prueba: llamar y oír un mensaje.

**Fase 2 — Puente de audio en tiempo real**
1. TwiML con `<Connect><Stream>`.
2. WebSocket de Media Streams (`mediaStream.js`).
3. Conexión a OpenAI Realtime (`openaiRealtime.js`).
4. Puente de audio bidireccional (mulaw 8kHz).
5. Prueba: conversación básica con la IA.

**Fase 3 — Personalidad y CV**
1. Pegar el CV en `data/cv/cv.md`.
2. `prompt.js`: system prompt con el CV y reglas.
3. Ajustar voz e idioma.
4. Prueba: preguntas sobre el perfil.

**Fase 4 — Acciones (tools)**
1. `transferCall.js` (transferir al móvil).
2. `saveContact.js` (guardar contacto → `storage.js`).
3. `endCall.js` (cierre y colgar).
4. Registrar tools en la sesión Realtime.
5. Prueba: transferencia y captura de contacto.

**Fase 5 — Resumen por email**
1. Capturar transcripción (solo en memoria; ver D11).
2. `summary.js` (resumen con LLM).
3. `email.js` (envío del resumen).
4. `callReport.js` (orquesta resumen + email + registro) y disparo al terminar la llamada.
5. Prueba: recibir el email → **hecha (2026-09-27)**: cuenta de Resend creada y envío real verificado de punta a punta.

**Fase 6 — Robustez y guardarraíles**

Guardrails ya presentes (no esperar a Fase 6):
- **De conducta (prompt, Fase 3):** anti-invención (solo datos del CV), honestidad ante lo desconocido + oferta de tomar contacto, negativa a hablar mal de nadie o revelar datos confidenciales del empleador, control de idioma.
- **De coste (Fase 2):** límite de duración de llamada (`MAX_CALL_SECONDS`).
- **De red (D12, adelantado):** el servidor escucha solo en `127.0.0.1` salvo que se indique `HOST`.
- **De privacidad (D11, Fase 5):** la transcripción no se persiste; los turnos no se vuelcan en los logs.

Pendientes en esta fase (prioridad recomendada de arriba a abajo):
1. ✅ **HECHO (2026-09-28)** — **Validar firma de Twilio** (`X-Twilio-Signature`) en `/incoming-call`: rechaza 403 si no viene firmado. Módulo `src/security/twilioSignature.js`. *(seguridad, prioridad alta)*
2. ✅ **HECHO (2026-09-28)** — **Autenticar el WebSocket `/media-stream`**: token HMAC-SHA256 con caducidad incrustado en la URL del `<Stream>`, verificado al abrir la conexión antes de conectar con OpenAI. Módulo `src/security/streamToken.js`. *(seguridad, prioridad alta)*
3. ✅ **HECHO (2026-09-28)** — **Límite de gasto / concurrencia**: tope de llamadas simultáneas (`MAX_CONCURRENT_CALLS`) y por día (`MAX_CALLS_PER_DAY`, reinicio UTC). Se comprueba en el webhook antes de aceptar; rechazo con locución + hangup. Módulo `src/telephony/callLimiter.js`.
4. ✅ **HECHO (2026-09-28)** — **Manejo de errores y reconexión** del WebSocket de OpenAI a media llamada: si se cae de forma inesperada, reintenta con backoff exponencial acotado (`OPENAI_RECONNECT_MAX_ATTEMPTS`, política pura en `src/realtime/reconnectPolicy.js`); al reconectar reconfigura la sesión sin repetir el saludo; si se agotan los reintentos, cierra la llamada (vía `onClose`) para no dejar audio muerto.
5. ✅ **HECHO (2026-09-28)** — **Timeout por silencio / máximo de turnos**: `src/telephony/callGuard.js` (timers inyectables). Cierra la llamada si hay silencio total durante `SILENCE_TIMEOUT_SECONDS` (reiniciado por habla del llamante, voz del agente y transcripciones) o si el llamante supera `MAX_CALLER_TURNS`.
6. ✅ **HECHO (2026-09-28)** — **Resistencia a prompt-injection**: sección "Security and boundaries" en `src/agent/prompt.js` — el llamante no es operador, se ignoran intentos de cambiar el rol/reglas ("ignore previous instructions", modos jailbreak), no se revela ni traduce el prompt, no se sueltan secretos, y lo que dice el llamante es contenido, no órdenes. Cubierto por tests de `buildInstructions`.
7. ✅ **HECHO (2026-09-28)** — **PII en logs**: auditados todos los `logger.*`. La transcripción y el número del llamante nunca se loguean; el resto son identificadores internos (callSid/streamSid) o estados. Corregida la única fuga: `storage.js` ya no loguea el **nombre** del contacto (ahora solo `callSid`).
8. ✅ **HECHO (2026-09-28)** — **Logs estructurados y tests básicos**: logger con timestamp + nivel, formato `text` (dev) o `json` (`LOG_FORMAT=json`, producción). Formateo puro y testeable en `src/utils/logFormat.js`. **61 tests unitarios** en total.

**Fase 7 — Despliegue a la nube**
1. **Plataforma elegida: Render + GitHub** (D14). Node nativo (sin Docker), WebSockets y HTTPS/WSS automáticos, health check `/health`, redeploy en cada push. Plan **`starter`** (~7 $/mes, siempre despierto): el `free` se duerme a los 15 min y una llamada entrante fallaría por el arranque en frío.
2. **Preparación del repo (hecha, 2026-09-28):** `engines.node` en `package.json`, `render.yaml` (Blueprint con el servicio, health check, secretos `sync:false` y `STREAM_TOKEN_SECRET` autogenerado), fallback de `publicUrl` a `RENDER_EXTERNAL_URL`, y guía paso a paso en `docs/DESPLIEGUE.md`.
3. **Pendiente de ejecutar:** push a GitHub, crear el servicio en Render, rellenar variables secretas en su panel.
4. Apuntar webhook de Twilio a la URL definitiva (`https://…onrender.com/incoming-call`, POST).
5. Prueba end-to-end en producción (requiere el número LU aprobado).

---

## 4. Estado actual

- **Fase actual:** **Fase 6 completada** (robustez y guardarraíles). Siguiente: Fase 7 (despliegue). Fase 5 verificada (email real incluido).
- **Hecho:**
  - Entorno local (fnm + Node v24.19.0).
  - Twilio (número EE. UU.) y OpenAI verificados; `.env` con credenciales.
  - **Fase 1 (código):** servidor Fastify con `/health` y `/incoming-call`. Verificado en local.
  - **Fase 2 (código):** puente de audio en tiempo real Twilio Media Streams ↔ OpenAI Realtime (API GA).
    - `src/realtime/openaiRealtime.js`: conexión GA (`wss://api.openai.com/v1/realtime`, Bearer, sin cabecera beta), `session.update` con audio `audio/pcmu` (= μ-law de Twilio, sin reconvertir) + `server_vad`, saludo inicial, eventos `response.output_audio.delta` y `input_audio_buffer.speech_started`.
    - `src/telephony/mediaStream.js`: puente bidireccional + barge-in (evento `clear`) + límite `MAX_CALL_SECONDS`.
    - `src/telephony/twilioWebhook.js`: TwiML `<Connect><Stream>`.
    - Dependencias añadidas: `ws`.
    - **Verificado sin llamada real:** `node --check` OK en 6 archivos; servidor arranca; `/health` OK; webhook devuelve TwiML `<Connect><Stream>`; `/media-stream` responde **101 Switching Protocols** al handshake WebSocket.
  - **Fase 3 (código + contenido):** personalidad, idioma y CV real.
    - `data/cv/cv.md`: CV real de Álvaro Nieto Balmori integrado (inglés, fuente de verdad).
    - `src/agent/prompt.js`: system prompt enriquecido — idioma **inglés por defecto con adaptación al llamante** (D10), tono conversacional/telefónico, reglas anti-invención, y descripción de conductas (cuándo transferir, cuándo pedir contacto, cómo cerrar) para dar coherencia antes de cablear las tools en Fase 4.
    - `src/telephony/mediaStream.js`: saludo inicial (`GREETING`) pasado a inglés por defecto.
    - **Verificado:** `node --check` OK; `buildInstructions()` carga el CV (contiene "DRAM" y "Álvaro Nieto Balmori") y aplica la regla de idioma; prompt resultante ~6.3 KB.
  - **Fase 4 (código):** tools del agente cableadas en la sesión Realtime.
    - `src/agent/tools/transferCall.js` (`transfer_call`): redirige la llamada viva al móvil vía Twilio REST (`calls(callSid).update({ twiml: <Dial> })`).
    - `src/agent/tools/saveContact.js` (`save_contact`): guarda nombre/empresa/teléfono/email/motivo vía `storage.js`.
    - `src/agent/tools/endCall.js` (`end_call`): cierre ordenado (`triggerResponse:false`, sin más locución); delega en el puente.
    - `src/agent/tools/index.js`: registro (`toolDefinitions`) + `dispatchToolCall(event, ctx)`.
    - `src/services/storage.js`: persistencia JSONL (`data/contacts.jsonl`, `data/calls.jsonl`).
    - `src/telephony/twilioClient.js`: cliente REST Twilio compartido (null si faltan credenciales).
    - `src/telephony/mediaStream.js`: captura `callSid`, pasa `toolDefinitions`, `onFunctionCall`→dispatch, y `endCall()` que cuelga en Twilio (`status:'completed'`) tras 2s de margen.
    - `src/realtime/openaiRealtime.js`: `sendFunctionResult(callId, output, {triggerResponse})`.
    - `.gitignore`: añadidos `data/contacts.jsonl` y `data/calls.jsonl` (PII).
    - **Verificado sin llamada real:** `node --check` OK en 8 archivos; test del dispatcher (las 3 tools + tool desconocida) OK; `save_contact` persiste correctamente; `end_call` dispara cierre con `triggerResponse:false`; `transfer_call` sin `callSid` degrada con mensaje; servidor arranca y `/health` + `/incoming-call` responden.
  - **Fase 5 (código):** resumen de la llamada por email al colgar.
    - `src/realtime/openaiRealtime.js`: transcripción activada (`audio.input.transcription`, modelo `OPENAI_TRANSCRIBE_MODEL`) y nuevo handler `onTranscript(role, text)`. Se aceptan los dos nombres de evento del lado del agente (`response.output_audio_transcript.done` de la GA y `response.audio_transcript.done` de la beta).
    - `src/services/summary.js`: `generateSummary(turns, meta)` contra Chat Completions con `fetch` (sin SDK), `response_format: json_object`, devuelve `{subject, body}` en español. `formatTranscript()` etiqueta los turnos y recorta a 20 KB quedándose con el final.
    - `src/services/email.js`: `sendSummaryEmail({subject, body})` vía API REST de Resend con `fetch`. Nunca lanza: si falta configuración o falla el envío, avisa y devuelve `false`.
    - `src/services/callReport.js`: **nuevo**. Orquesta resumen → email → registro. Las tres dependencias son inyectables, que es lo que permite probar el flujo completo sin llamada real.
    - `src/telephony/mediaStream.js`: acumula los turnos en memoria y `finalizeCall()` (idempotente) delega en `reportCall()` al cerrarse el WebSocket, sea por despedida del agente, cuelgue del llamante o `MAX_CALL_SECONDS`.
    - `src/telephony/twilioWebhook.js`: el TwiML pasa el número del llamante al stream con `<Parameter name="from">` (el evento `start` de Media Streams no lo incluye).
    - `src/config/index.js` + `.env.example`: `OPENAI_TRANSCRIBE_MODEL` (por defecto `whisper-1`), `OPENAI_SUMMARY_MODEL` (por defecto `gpt-4o-mini`) y `HOST` (ver D12).
    - Sin dependencias nuevas: tanto OpenAI como Resend se llaman con el `fetch` nativo.
    - Comportamiento sin conversación (escaneo, silencio, cuelgue inmediato): se registra la llamada pero **no** se envía email, para no llenar la bandeja.
    - **Verificado sin llamada real:** `node --check` OK en 19 archivos; **19 tests unitarios pasando** (`npm test`) en `tests/summary.test.js`, `tests/email.test.js` y `tests/callReport.test.js`, con `fetch` sustituido por dobles (cero peticiones a OpenAI y a Resend); un test comprueba explícitamente que el registro persistido **no** contiene la transcripción (D11). Servidor arranca en `127.0.0.1:3001`, `/health` responde y `/incoming-call` devuelve el TwiML con `<Parameter name="from" value="+15550001111"/>`; comprobado por `lsof` que solo escucha en loopback y sin conexiones salientes.
- **Importante:** la **prueba con llamada real está pendiente de despliegue** (no hay túnel en este equipo de trabajo; ver D9/limitaciones). Se validará end-to-end en la Fase 7.
- **Pendiente:** Fase 7 (despliegue). **Fase 6 completada** (8/8 guardarraíles). **Fase 7 en preparación:** repo listo para Render (ver más abajo); falta el push a GitHub, crear el servicio, aprobación del número LU y la prueba real.
- **Email (Resend) — hecho y verificado (2026-09-27):** cuenta de Resend creada; `EMAIL_API_KEY`,
  `EMAIL_FROM=onboarding@resend.dev` (remitente de pruebas, sin dominio propio) y
  `EMAIL_TO=alvaronieto97@gmail.com` puestos en `.env`. Envío **real** probado de punta a punta
  con la propia `sendSummaryEmail()` del proyecto: Resend devolvió OK y el email llegó. Nota del
  plan gratuito: con el remitente `onboarding@resend.dev` solo se puede enviar a la dirección con
  la que se registró la cuenta; para otros destinatarios haría falta verificar un dominio propio.
- **Nota de configuración:** las variables ya presentes en el entorno **tienen prioridad** sobre el `.env` (comportamiento de `process.loadEnvFile`, igual que `--env-file`). Si `PORT` está exportada en la shell, el valor del `.env` se ignora.

### Cómo arrancar el servidor en local
```
cd "$HOME/Documents/personal/Agent CV"
npm run dev      # (fnm activa Node v24.19.0 automáticamente por el .nvmrc)
npm test         # tests unitarios (no hacen ninguna petición de red)
```
Escucha en `http://127.0.0.1:3001` (ver D12). Si la shell tiene `PORT` exportada, esa gana
sobre el `.env`: arrancar entonces con `PORT=3001 npm run dev`.

### Registro de progreso
| Fecha | Qué se hizo |
|-------|-------------|
| 2026-08-11 | Estructura del proyecto y bitácora creadas. Decidido stack y método de aislamiento. Inicio Fase 0. |
| 2026-08-11 | Instalado fnm (binario) + Node LTS v24.19.0; configurado `~/.zshrc` y `.nvmrc`. Entorno de desarrollo local listo. Faltan cuentas/claves externas. |
| 2026-08-12 | Cuenta Twilio + número EE. UU. comprado. Detectado que el bundle español "Mobile" no permite comprar número (sin inventario + prohibición legal para atención/negocio). Decisión D7: usar número EE. UU. en desarrollo y tramitar bundle **Local/geográfico** para el +34. Creado `.env` a partir de la plantilla. |
| 2026-08-13 | Credenciales Twilio puestas en `.env` y **verificadas** (HTTP 200). Comprobado por API que **Twilio no tiene inventario de números ES** (`ES/Local`=404, `US/Local`=5 disponibles). Bundle Local aprobado pero sin stock. Ver D8. Elegida **Opción 3** (D9): desarrollar con número EE. UU. Número Twilio verificado como propio y con voz; `MY_PERSONAL_NUMBER` añadido. **Parte Twilio de la Fase 0 cerrada.** Siguiente: API key de OpenAI. |
| 2026-08-13 | Confirmado uso de **OpenAI Realtime** (voz incluida; ElevenLabs sería alternativa, no complemento). API key de OpenAI creada, puesta en `.env` y **verificada** (HTTP 200, acceso a Realtime, `gpt-realtime-mini` disponible). Faltan solo Resend (Fase 5) y ngrok (al probar Fase 1). **Listos para empezar a programar la Fase 1.** |
| 2026-08-13 | **Fase 1 (código) hecha y verificada en local.** Instaladas dependencias base (versiones fijadas). Implementados `src/config/index.js`, `src/index.js` (Fastify: `/health` + `/incoming-call`) y `src/telephony/twilioWebhook.js` (TwiML de saludo es-ES). Pruebas locales OK. |
| 2026-08-13 | Intento de instalar **ngrok** bloqueado por la red de Amazon (equipo de trabajo). Decidido **no usar túnel** en este equipo por seguridad corporativa. Plan: seguir programando (Fases 2-5) sin probar en local y **desplegar en la nube** para las pruebas (sin túnel). App Runner descartado (AWS lo retira a nuevos clientes desde 30/04/2026); opciones: Render vía GitHub (recomendado) o AWS Fargate+ALB. |
| 2026-08-13 | **Fase 2 (código) hecha y verificada sin llamada real.** Puente Twilio Media Streams ↔ OpenAI Realtime (GA). `node --check` OK; boot OK; webhook devuelve `<Connect><Stream>`; `/media-stream` → 101 Switching Protocols. Prueba real aplazada al despliegue. |
| 2026-08-23 | **Fase 3 (código + contenido) hecha y verificada.** Integrado el CV real (Álvaro Nieto Balmori, versión Revolut) en `data/cv/cv.md` en inglés como fuente de verdad. Enriquecido `src/agent/prompt.js`: idioma inglés por defecto con adaptación al llamante (D10), tono telefónico, reglas anti-invención y descripción de conductas para Fase 4. `GREETING` pasado a inglés. Verificado: `node --check` OK y `buildInstructions()` carga el CV + regla de idioma. Siguiente: **Fase 4 (tools)**. |
| 2026-08-23 | **Fase 4 (código) hecha y verificada sin llamada real.** Implementadas las 3 tools (`transfer_call` vía Twilio REST, `save_contact` vía storage JSONL, `end_call` con cierre ordenado), registro/dispatcher (`tools/index.js`), cliente Twilio REST y persistencia. Cableadas en el puente (`callSid`, `onFunctionCall`→dispatch, `endCall` cuelga en Twilio) y `sendFunctionResult` con `triggerResponse`. Verificado: `node --check` (8 archivos), test del dispatcher OK, boot + `/health` + `/incoming-call` OK. También: guardrails de Fase 6 detallados en el plan; `.gitignore` protege PII. Siguiente: **Fase 5 (resumen por email)** — requiere cuenta Resend. |
| 2026-09-23 | **Fase 5 (código) hecha y verificada sin llamada real.** Transcripción activada en la sesión Realtime (solo en memoria), `generateSummary()` contra Chat Completions, `sendSummaryEmail()` contra Resend, y `callReport.js` nuevo para orquestar resumen → email → registro con dependencias inyectables. Disparo automático al cerrarse el WebSocket, sea cual sea la causa del cierre. Decidido **D11**: se guarda solo el resumen, la transcripción se descarta. Sin dependencias nuevas (todo con `fetch` nativo). Verificado: 19 tests pasando sin tocar la red, incluido uno que comprueba que el registro en disco no contiene la transcripción; boot + `/health` + TwiML con `<Parameter name="from">` OK. |
| 2026-09-23 | **Incidente y arreglos de entorno.** Una prueba del WebSocket se quedó colgada y dejó un proceso Node huérfano escuchando en el puerto 3000; comprobado en el log y con `lsof` que **no llegó a conectarse a OpenAI** (cero conexiones salientes, ningún token gastado) y limpiado el proceso. Causa real del cuelgue: **Visual Studio Code ya ocupaba el puerto 3000**, así que la prueba hablaba con VS Code en lugar de con nuestro servidor. Arreglado con **D12**: puerto local a 3001 y escucha limitada a `127.0.0.1` vía nueva variable `HOST`. Corregida también la ruta de arranque de esta bitácora (`Documents/personal`, no `Desktop`). Siguiente: **Fase 6 (robustez y guardarraíles)**, empezando por validar la firma de Twilio. |
| 2026-09-27 | **Email (Resend) configurado y verificado.** Creada la cuenta de Resend; `EMAIL_API_KEY`, `EMAIL_FROM=onboarding@resend.dev` y `EMAIL_TO=alvaronieto97@gmail.com` rellenados en `.env` (protegido por `.gitignore`). Enviado un email de prueba **real** con la propia `sendSummaryEmail()`: Resend devolvió OK y el correo llegó a la bandeja. Con esto el email queda validado de punta a punta, ya no depende del despliegue. **Único pendiente antes de producción: Fases 6 y 7.** |
| 2026-09-28 | **Decidido D13: número luxemburgués en Twilio.** Reevaluada la opción del número: Telnyx exige nivel Verified + estar en España + docs para el +34, mientras que Twilio **sí** tiene inventario LU/Local con voz (comprobado por API). El requisito de dirección local se cumple con el domicilio real del usuario en Luxemburgo; compra de número LU iniciada en Twilio (bundle regulatorio: identidad española + justificante de domicilio LU) y **a la espera de aprobación**. Ventaja: cero migración de código. Verificado que el número está 100% controlado por config: al aprobarse, **solo cambia `TWILIO_PHONE_NUMBER` en `.env`**; el enganche del webhook queda para Fase 7 (necesita `PUBLIC_URL`). **Arrancada la Fase 6** (robustez/guardarraíles) enfocada a Twilio, empezando por la validación de firma de Twilio. |
| 2026-09-28 | **Fase 6, puntos 1-3 hechos, verificados y commiteados.** (1) Validación de firma `X-Twilio-Signature` en `/incoming-call` (`src/security/twilioSignature.js`, rechazo 403). (2) Auth del WebSocket `/media-stream` con token HMAC-SHA256 caducable en la URL del `<Stream>`, verificado antes de conectar con OpenAI (`src/security/streamToken.js`). (3) Límite de concurrencia y tope diario (`src/telephony/callLimiter.js`, vars `MAX_CONCURRENT_CALLS`/`MAX_CALLS_PER_DAY`; rechazo con locución + hangup en el webhook). Nueva config `security` y `limits` + helper `numEnv` (respeta el 0). **41 tests unitarios en verde, sin red ni WebSocket** (restricción del equipo corporativo). **Inicializado el repositorio Git local** (no existía): primer commit `8186e01` en rama `main`, `.env` excluido. Pendiente de Fase 6: puntos 4-8 (reconexión OpenAI, timeout por silencio, prompt-injection, PII en logs, logs estructurados). |
| 2026-09-28 | **Fase 6, punto 4 hecho, verificado y commiteado.** Reconexión del WebSocket de OpenAI a media llamada: política pura de backoff exponencial acotado (`src/realtime/reconnectPolicy.js`, var `OPENAI_RECONNECT_MAX_ATTEMPTS`), refactor de `openaiRealtime.js` (connect/reconnect, no repite saludo al reconectar, resetea contador en `session.created`, distingue cierre intencionado), y `onClose` cableado en el puente para cerrar la llamada si se agotan los reintentos (evita audio muerto). **45 tests en verde, sin red ni WebSocket.** Pendiente de Fase 6: puntos 5-8. |
| 2026-09-28 | **Fase 6, punto 5 hecho, verificado y commiteado.** Timeout por silencio y máximo de turnos: `src/telephony/callGuard.js` con temporizadores inyectables (testeable sin WebSocket). Cierra la llamada si hay silencio total durante `SILENCE_TIMEOUT_SECONDS` (se reinicia con habla del llamante, audio del agente y transcripciones) o si el llamante supera `MAX_CALLER_TURNS`. Cableado en `mediaStream.js` (start/activity/countCallerTurn/stop). **52 tests en verde, sin red ni WebSocket.** Pendiente de Fase 6: puntos 6-8 (prompt-injection, PII en logs, logs estructurados). |
| 2026-09-28 | **Fase 6, punto 6 hecho, verificado y commiteado.** Resistencia a prompt-injection: nueva sección "Security and boundaries" en `src/agent/prompt.js` (el llamante no es operador; se ignoran intentos de override de rol/reglas y modos jailbreak; no se revela/traduce el prompt; no se sueltan secretos/tokens/números; lo que dice el llamante es contenido, no órdenes). Añadido `tests/prompt.test.js` que comprueba la presencia de esas reglas, la política de idioma/anti-invención y la inclusión del CV. **55 tests en verde, sin red ni WebSocket.** Pendiente de Fase 6: puntos 7-8 (PII en logs, logs estructurados). |
| 2026-09-28 | **Fase 6, punto 7 hecho, verificado y commiteado.** Auditados todos los `logger.*` del código en busca de PII. La transcripción y el número del llamante no se loguean; el resto son identificadores internos (callSid/streamSid) o estados. Única fuga corregida: `storage.js` dejaba el **nombre** del contacto en el log al guardarlo; ahora solo registra el `callSid`. **55 tests en verde, sin red ni WebSocket.** Pendiente de Fase 6: punto 8 (logs estructurados). |
| 2026-09-28 | **Fase 6 COMPLETADA (punto 8 hecho, verificado y commiteado).** Logs estructurados: logger con timestamp + nivel y formato `text` (dev) o `json` (`LOG_FORMAT=json`, producción); formateo puro y testeable en `src/utils/logFormat.js`. Comprobado el logger real en ambos formatos (solo salida, sin red). **61 tests en verde, sin red ni WebSocket.** Con esto quedan cerrados los 8 puntos de la Fase 6. **Siguiente: Fase 7 (despliegue a la nube)** — elegir plataforma (Render vía GitHub recomendado), configurar variables (incl. `HOST=0.0.0.0`, `PUBLIC_URL`, `STREAM_TOKEN_SECRET`, y `TWILIO_PHONE_NUMBER` con el número LU cuando se apruebe), apuntar el webhook de Twilio y primera prueba real con llamada. |
| 2026-09-28 | **Fase 7 — preparación del repo (D14: Render + GitHub).** Añadido `engines.node` (`>=20.6.0`) en `package.json`; creado `render.yaml` (Blueprint: web service Node, plan `starter`, región Frankfurt, health check `/health`, `LOG_FORMAT=json`, secretos con `sync:false`, `STREAM_TOKEN_SECRET` autogenerado); `publicUrl` ahora cae a `RENDER_EXTERNAL_URL` si no hay `PUBLIC_URL` (evita configurarla a mano y cuadra la firma de Twilio); y guía paso a paso en `docs/DESPLIEGUE.md` (GitHub → Render → variables → webhook Twilio → prueba). **61 tests en verde.** Pendiente de ejecutar: push a GitHub, crear el servicio en Render, rellenar secretos, número LU aprobado y prueba real. |
