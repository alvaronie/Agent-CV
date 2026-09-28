# Guía de despliegue — Agent CV en Render (vía GitHub)

Esta guía deja el agente funcionando en la nube con una URL pública, para poder
apuntar el webhook de Twilio y hacer la primera prueba real con llamada (Fase 7).

> **Resumen del flujo de secretos:** el código va a GitHub **sin** claves (el `.env`
> está en `.gitignore`). Las claves se introducen **en el panel de Render**, que las
> guarda cifradas y las inyecta como variables de entorno. El mismo código funciona en
> local (lee `.env`) y en la nube (usa las variables inyectadas).

---

## Requisitos previos

- Cuenta de **GitHub** (gratis).
- Cuenta de **Render** (https://render.com).
- Las claves que ya usas en local: `OPENAI_API_KEY`, `TWILIO_ACCOUNT_SID`,
  `TWILIO_AUTH_TOKEN`, `EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_TO`, `MY_PERSONAL_NUMBER`.
- El **número de teléfono** de Twilio (el luxemburgués, cuando esté aprobado).

---

## Paso 1 — Subir el código a GitHub

1. Crea un repositorio **nuevo y vacío** en GitHub (privado recomendado), sin README.
2. En la carpeta del proyecto, conecta el remoto y sube la rama `main`:
   ```bash
   git remote add origin https://github.com/<tu-usuario>/agent-cv.git
   git push -u origin main
   ```
3. Comprueba en GitHub que **NO** aparece el archivo `.env` (debe estar ausente: lo
   protege `.gitignore`). Sí deben verse `src/`, `render.yaml`, `package.json`, etc.

---

## Paso 2 — Crear el servicio en Render (Blueprint)

El repo incluye `render.yaml`, así que Render configura el servicio casi solo.

1. En Render: **New +** → **Blueprint**.
2. Conecta tu cuenta de GitHub y selecciona el repositorio `agent-cv`.
3. Render leerá `render.yaml` y te mostrará el servicio `agent-cv` (Node, plan
   `starter`, región Frankfurt, health check `/health`). Acepta para crearlo.

> El plan `starter` (~7 $/mes) mantiene la instancia **siempre despierta**. Es necesario:
> el plan `free` se duerme a los 15 min y una llamada entrante fallaría por el arranque
> en frío (~1 min).

---

## Paso 3 — Rellenar las variables secretas

En el Blueprint, las variables marcadas como "sync: false" quedan **vacías a propósito**.
Ve a tu servicio → **Environment** y rellena:

| Variable | Valor |
|---|---|
| `OPENAI_API_KEY` | tu clave de OpenAI |
| `TWILIO_ACCOUNT_SID` | tu SID de Twilio |
| `TWILIO_AUTH_TOKEN` | tu Auth Token de Twilio |
| `TWILIO_PHONE_NUMBER` | tu número Twilio (el +352 cuando esté aprobado) |
| `MY_PERSONAL_NUMBER` | tu móvil (+34…) para las transferencias |
| `EMAIL_API_KEY` | tu clave de Resend |
| `EMAIL_FROM` | `onboarding@resend.dev` (o tu dominio verificado) |
| `EMAIL_TO` | tu email para recibir los resúmenes |

Ya vienen puestas automáticamente (no tocar): `HOST=0.0.0.0`, `LOG_FORMAT=json`,
`VALIDATE_TWILIO_SIGNATURE=true`, los modelos de OpenAI, `EMAIL_PROVIDER=resend` y
`STREAM_TOKEN_SECRET` (generado por Render). **`PUBLIC_URL` no hace falta**: el código usa
`RENDER_EXTERNAL_URL` automáticamente.

Guarda los cambios (Render redepliega al guardar).

---

## Paso 4 — Desplegar y obtener la URL

- Render construye (`npm ci`) y arranca (`npm start`) el servicio.
- Cuando el estado sea **Live**, copia la URL pública: `https://agent-cv-XXXX.onrender.com`.
- Comprueba la salud en el navegador: `https://agent-cv-XXXX.onrender.com/health`
  debe responder `{"status":"ok","service":"agent-cv"}`.

---

## Paso 5 — Apuntar el webhook de Twilio

1. En la consola de Twilio: **Phone Numbers → Manage → Active numbers** → tu número.
2. En **Voice Configuration** → "A call comes in":
   - Tipo: **Webhook**
   - URL: `https://agent-cv-XXXX.onrender.com/incoming-call`
   - Método: **HTTP POST**
3. Guarda.

> La validación de firma (`VALIDATE_TWILIO_SIGNATURE=true`) exige que la URL del webhook
> coincida exactamente con la URL pública. Como el código usa `RENDER_EXTERNAL_URL`, debe
> cuadrar. Si dieras `403` en las llamadas, revisa que la URL del webhook sea la misma
> `https://…onrender.com` (sin barra final ni diferencias).

---

## Paso 6 — Prueba real end-to-end

1. Llama al número de Twilio.
2. El agente debería saludar en inglés y adaptarse a tu idioma.
3. Prueba: pregunta por el perfil, pide **transferir** (suena tu móvil), y **deja tus
   datos** de contacto.
4. Cuelga y revisa tu email: debe llegar el **resumen** de la llamada.

---

## Operación y mantenimiento

- **Actualizar**: haz `git push` a `main` → Render redepliega automáticamente.
- **Logs**: pestaña **Logs** del servicio (en JSON, por `LOG_FORMAT=json`).
- **Guardarraíles activos** (Fase 6): firma de Twilio, token del WebSocket, límite de
  concurrencia/día (`MAX_CONCURRENT_CALLS`, `MAX_CALLS_PER_DAY`), timeout por silencio,
  máximo de turnos, reconexión de OpenAI. Se pueden ajustar añadiendo esas variables en
  **Environment** (ver `.env.example`).
- **Coste**: instancia `starter` (~7 $/mes) + consumo de OpenAI (por minuto de llamada),
  Twilio (número + minutos) y Resend (gratis en el volumen esperado).

---

## Checklist rápida

- [ ] Repo en GitHub sin `.env`
- [ ] Servicio creado desde `render.yaml` (plan `starter`)
- [ ] Variables secretas rellenadas en Environment
- [ ] Estado **Live** y `/health` responde
- [ ] Webhook de Twilio apuntando a `/incoming-call` (POST)
- [ ] Número de Twilio (+352) aprobado y puesto en `TWILIO_PHONE_NUMBER`
- [ ] Llamada de prueba OK + email de resumen recibido
