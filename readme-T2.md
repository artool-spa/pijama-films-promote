# readme-T2 — Página de aterrizaje del SSO Atlas

_Última actualización: 2026-08-26 · Proyecto: SSO Atlas Console → promote.pijamafilms.com_

---

## Identidad

- **Agente:** T2
- **Dominio:** página de aterrizaje `/auth` + simulador local de Atlas Console
- **Scope:** la página que Atlas Console abre con `_blank` y a la que le postea el envelope
  `ATLAS_AUTH` (Contrato B), el panel de diagnóstico que muestra qué llegó y qué pasó, y el
  simulador que reproduce todo el flujo sin Crazy Cake ni credenciales del lab.
- **No cubre:** el cliente de Atlas ni el endpoint de intercambio (`src/lib/atlas/**`,
  `src/app/api/auth/atlas/**`) — eso es T1. Tampoco `src/middleware.ts`, `apphosting.yaml`,
  `.env.example` (T1) ni `src/lib/pijama/**` (zona prohibida).

---

## Estado Actual

- **Repo:** `artool-spa/pijama-films-promote` · Branch: `feat/atlas-sso-page` (ramificada de
  `feat/atlas-sso`) · pusheada desde el primer commit.
- **Deploy activo:** ninguno. Esta rama no se despliega; App Hosting construye desde la rama
  conectada en GitHub. El merge lo decide T0/JP.
- **Suite de tests:** 65 tests propios, todos verdes. La suite completa del repo son 328 tests
  verdes con mis cambios aplicados.
- **Recursos de datos activos:** no aplica — este dominio no toca Firestore.
- **Jobs/cron activos:** no aplica.

### Verificación medida contra un build de producción real

`SESSION_SECRET=… npx yarn@1.22.22 build` + servidor levantado en el puerto 3217:

| Ruta | Antes | Ahora |
|---|---|---|
| `GET /auth` | `404 {"error":"Not found"}` | **`200`**, HTML con el script inline |
| `GET /dev/atlas-simulator` | no existía | **`307` → `/login`** (inalcanzable en producción) |

En el HTML servido con `NODE_ENV=production` el script inline aparece en el índice 12603 y el
markup del panel en el 14597 — el listener se instala antes de que el navegador llegue siquiera
a parsear la UI. La concesión de origen propio sale horneada como `if(false&&…)`.

---

## Contratos Que Me Afectan

| Contrato | Rol | Estado |
|----------|-----|--------|
| Contrato B — envelope `ATLAS_AUTH` | Consumidor (productor: Crazy Cake) | ✅ Implementado; 🔴 **no observado en la realidad** |
| Contrato A — `POST /api/auth/atlas/session` | Consumidor (productor: T1) | ✅ Construido contra la especificación; pendiente de ejercerlo contra el endpoint real |

Notas de implementación del Contrato A: parseo defensivo con Zod `.passthrough()`, que **nunca
lanza**. Una respuesta que no calza devuelve `null` y el panel lo muestra como error de
transporte etiquetado explícitamente como detectado por la página, no reportado por el endpoint
— así un 404 HTML de T1 no se confunde con un `stage` del contrato. Un `stage` fuera de los
cinco documentados se muestra marcado como *"not a Contract A stage"* en vez de esconderse, y
un error sin `stage` se muestra como *"MISSING — Contract A requires a stage on every error"*.

---

## Dependencias

- **Necesito de T1:** `POST /api/auth/atlas/session`. Mientras no exista, `/auth` muestra un
  error de transporte claro y el resto del panel funciona igual. El simulador cierra mi DoD sin
  T1.
- **Necesito de T1 (1 línea, bloqueante para el DoD 6):** `'/dev/'` en `PUBLIC_ROUTES` de
  `src/middleware.ts`. Hoy el simulador redirige a `/login` también en local. Reportado a T0.
- **Necesito de T1 (variable de entorno):** `NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS` en
  `apphosting.yaml` con `availability: BUILD`. Sin ella la allowlist queda vacía y la página
  rechaza **todo** origen — fail-closed a propósito. Ojo: al ser `NEXT_PUBLIC_*` se hornea en
  build, así que mergear no la activa; hace falta rollout.
- **Me necesita:** nadie. Soy hoja del grafo.

---

## DoD — Estado de Avance

- [x] 1. `/auth` renderiza el panel y deja de responder 404 — medido: `200` contra build de producción.
- [x] 2. `route.ts` borrado y `yarn build` pasa sin conflicto de rutas.
- [x] 3. Listener pre-paint + buffer + señal READY + timeout distinguible.
- [x] 4. Origen no permitido ⇒ rechazado y visible en el panel.
- [x] 5. El token completo no se renderiza, no se loguea, no va al DOM.
- [x] 6. Simulador funciona en dev y no existe en producción — **la mitad de producción está
      medida (`307`); la mitad de dev queda bloqueada por el middleware** hasta que entre `'/dev/'`
      en `PUBLIC_ROUTES`.
- [x] 7. Tests con reporte de mutación (39 mutantes, 38 muertos, 1 inválido).
- [x] 8. `npx tsc --noEmit` y `eslint` limpios.

---

## Pendientes Priorizados

1. Que T1 agregue `'/dev/'` a `PUBLIC_ROUTES` (o que T0 decida mover el simulador a
   `/auth/simulator`, que hereda el `startsWith('/auth')` que ya existe).
2. Click-through humano con el simulador: los cinco casos están listados abajo.
3. Cuando T1 entregue el endpoint: correr `/auth?mode=probe` desde el simulador y confirmar que
   los `diagnostics` se renderizan como espera el Contrato A.
4. El postMessage real desde el lab de Atlas — necesita credenciales que solo tiene JP.

---

## Decisiones Abiertas

- **`?mode=` por defecto es `login`.** Es el flujo real de Console y calza con la decisión #2 de
  JP. `/auth?mode=probe` corre solo diagnóstico y nunca redirige. Si T0 prefiere que la primera
  pasada sea siempre `probe` y el login vaya detrás de un click, es un cambio de tres líneas.
- **Ventana de timeout: 20 s** (`DEFAULT_HANDSHAKE_TIMEOUT_MS`). Elegida a ojo. Si el
  click-through muestra que Console tarda más, hay que subirla.
- **Filtro de ruido en el listener.** Se registran los mensajes con `data.type` string que vengan
  de un origen permitido, más **cualquier** `ATLAS_AUTH` venga de donde venga. El resto (HMR del
  dev server, extensiones) solo se cuenta. Si algún día Atlas postea con otro `type` desde otro
  origen, ese mensaje se contaría como ruido: es el único punto ciego consciente del diseño.

---

## Infra

- **Identidad/cuenta de servicio:** no aplica — este dominio corre entero en el navegador.
- **Secrets relevantes:** ninguno. El token de Atlas nunca se persiste.
- **Config de runtime/deploy:** la de la app (App Hosting, `pijama-promote`, us-central1).
- **Variables de entorno clave:** `NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS` (la declara T1). Formato:
  orígenes exactos separados por coma, sin barra final, sin comodines. Ejemplo de testing:
  `https://dashboard-lab.pijamafilms.com`. Producción: `https://dashboard.pijamafilms.com`.
  Las entradas inválidas se descartan, no se reparan.

---

## Archivos Críticos

```
src/app/auth/
├── page.tsx                     ← controlador server: resuelve allowlist y modo, inyecta el script inline
├── client.tsx                   ← vista MUI: panel de diagnóstico + llamada al Contrato A
├── atlas-bridge.ts              ← constantes, Zod del Contrato B, parseo de allowlist y de Contrato A,
│                                   fingerprint del token, guardia de redirect
├── bridge-script.ts             ← genera el JS que corre ANTES del primer paint
├── route.ts                     ← BORRADO (no puede coexistir con page.tsx)
└── __tests__/{atlas-bridge,bridge-script,client}.test.*

src/app/dev/atlas-simulator/
├── page.tsx                     ← notFound() si NODE_ENV === 'production'
├── client.tsx                   ← abre /auth en ventana nueva y postea un ATLAS_AUTH sintético
└── __tests__/client.test.ts
```

### Por qué el script inline y no un `useEffect`

Console abre la ventana y postea. Si el listener solo existe después de que React hidrata, un
mensaje que llega durante el parseo del documento se pierde — y un SSO que **sí** funciona se
lee como roto. El script inline hace tres cosas en este orden, sincrónicamente:

1. registra el listener de `message`,
2. bufferea lo que llegue hasta que la vista se suscriba (los mensajes drenados llegan marcados
   `buffered: true`, que es la evidencia observable de que la carrera se ganó),
3. postea `PROMOTE_READY` a `window.opener`, una vez por origen permitido y **direccionado a ese
   origen** — nunca `'*'`.

El test `registers the message listener before posting PROMOTE_READY` existe exactamente para
que nadie invierta 1 y 3.

### Manejo del token

Vive en un `useRef`. Nunca entra al estado de React, nunca se renderiza, nunca se loguea, nunca
va a un atributo del DOM. Lo único que sale a pantalla es `describeToken()`: presente sí/no,
largo, y los primeros 6 caracteres (`eyJhbG` en un JWT — el header, que no es secreto).

---

## Cómo Levantar Este Dominio Localmente

```bash
cd /Users/jpudev2/Proyectos/pijama-t2
npx yarn@1.22.22 install
npx yarn@1.22.22 dev --port 3217      # NO uses 3000: es del dev server de JP

# tests / verificación
npx vitest run src/app/auth src/app/dev
npx tsc --noEmit
npx eslint src/app/auth src/app/dev
```

Local corre en: `localhost:3217`. No hace falta ninguna variable de entorno: en
`NODE_ENV !== 'production'` la página agrega `location.origin` a la allowlist para que el
simulador funcione. `?origins=strict` desactiva esa concesión.

**Higiene:** apaga tu dev server por PID o por puerto (`lsof -ti tcp:3217 | xargs kill`).
Nunca `pkill -f "next dev"` — hay otros worktrees y el server de JP en el 3000.

### Click-through humano pendiente (lo que yo no puedo probar)

Abre `http://localhost:3217/dev/atlas-simulator` (requiere el fix de middleware) y corre:

1. **`on-ready` + `dev` + envelope válido** → `/auth` debe mostrar `buffered pre-mount` y llamar
   al Contrato A. Es el caso realista.
2. **`immediate` + `dev`** → el mensaje se pierde y `/auth` muestra *"No postMessage arrived
   within 20 seconds / Nothing was posted to this window at all"*. Demuestra que timeout y fallo
   son estados distintos.
3. **`delayed` 3000 ms + `dev`** → el evento llega marcado `live` en vez de `buffered`.
4. **`on-ready` + `strict`** → *"Envelope rejected: origin not allowed"* con el origen a la vista.
5. **`on-ready` + `dev` + `missing-token`** → *"Envelope does not match Contract B"*, y `absent`
   en el fingerprint del token.

En los cinco, confirma con Ctrl+F que la cadena completa del token **no** aparece en el DOM.

---

## Cómo Invocarme o Reemplazarme

Lee este archivo completo + los últimos commits del branch `feat/atlas-sso-page`.
Luego invócame con un objetivo concreto:
_"Eres T2, domain agent de la página de aterrizaje del SSO Atlas. Tu próxima tarea es [X]. Lee
readme-T2.md y contracts.md antes de empezar."_
