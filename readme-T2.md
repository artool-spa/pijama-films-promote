# readme-T2 — Página de aterrizaje del SSO Atlas

_Última actualización: 2026-08-26 (rev. 5, sobre la base integrada) · Proyecto: SSO Atlas Console → promote.pijamafilms.com_

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
- **Suite de tests:** 126 tests propios, todos verdes. La suite completa del repo son 504 tests
  verdes (mi rama ya trae la base integrada con el dominio de T1).
- **Recursos de datos activos:** no aplica — este dominio no toca Firestore.
- **Jobs/cron activos:** no aplica.

### Verificación medida contra un build de producción real

`SESSION_SECRET=… npx yarn@1.22.22 build` + servidor levantado en el puerto 3217:

| Ruta | Antes | Ahora |
|---|---|---|
| `GET /auth` | `404 {"error":"Not found"}` | **`200`**, HTML con el script inline |
| `GET /dev/atlas-simulator` | no existía | **`307` → `/login`** (inalcanzable en producción) |

Con `NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS` seteada, el HTML de producción trae la lista horneada
**con producción primero**:

```
var ALLOWED=["https://dashboard.pijamafilms.com","https://dashboard-lab.pijamafilms.com"]
if(false&&ALLOWED.indexOf(location.origin)===-1)
```

En el HTML servido con `NODE_ENV=production` el script inline aparece en el índice 12603 y el
markup del panel en el 14597 — el listener se instala antes de que el navegador llegue siquiera
a parsear la UI. La concesión de origen propio sale horneada como `if(false&&…)`.

---

## Contratos Que Me Afectan

| Contrato | Rol | Estado |
|----------|-----|--------|
| Contrato B — envelope `ATLAS_AUTH` | Consumidor (productor: Crazy Cake) | ✅ Implementado; 🔴 **no observado en la realidad** |
| Contrato A — `POST /api/auth/atlas/session` | Consumidor (productor: T1) | ✅ Construido contra la especificación; pendiente de ejercerlo contra el endpoint real |
| Contrato C — endpoint de películas de Atlas | Indirecto: el simulador es lo que permite cerrarlo hoy | 🔴 no verificado |
| Contrato D — el simulador es inaccesible en producción | **Productor (capa 2)** | ✅ `notFound()` + test que se pone rojo si desaparece |

**Contrato D, capa 2 — no borrar.** `src/app/dev/atlas-simulator/page.tsx` llama `notFound()`
cuando `NODE_ENV === 'production'`. La capa 1 (`PUBLIC_EXACT_ROUTES` en `src/middleware.ts`) es de
T1. Ninguna de las dos se saca sin la otra, y hay un test
(`src/app/dev/atlas-simulator/__tests__/page.test.ts`) que se pone rojo si el guard desaparece —
antes no lo había, y una defensa cuyo modo de falla es el silencio es indistinguible de no tener
defensa.

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
- **Necesito de T1 (resuelto por T1, no tocar):** T1 agregó `PUBLIC_EXACT_ROUTES` en
  `src/middleware.ts` con match exacto para `/dev/atlas-simulator`. **No agregues tu propia
  entrada de middleware**: colisiona al mergear.
- **Necesito de T1 (variable de entorno):** `NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS` en
  `apphosting.yaml` con `availability: BUILD`, con **producción primero**:
  `https://dashboard.pijamafilms.com,https://dashboard-lab.pijamafilms.com`. Si falta, la página
  cae a `DEFAULT_ATLAS_ALLOWED_ORIGINS` (los mismos dos, mismo orden) y **lo dice en pantalla**.
  Ojo: al ser `NEXT_PUBLIC_*` se hornea en build, así que mergear no la activa; hace falta
  rollout.
- **Me necesita:** nadie. Soy hoja del grafo.

---

## DoD — Estado de Avance

- [x] 1. `/auth` renderiza el panel y deja de responder 404 — medido: `200` contra build de producción.
- [x] 2. `route.ts` borrado y `yarn build` pasa sin conflicto de rutas.
- [x] 3. Listener pre-paint + buffer + señal READY + timeout distinguible.
- [x] 4. Origen no permitido ⇒ rechazado y visible en el panel.
- [x] 5. El token completo no se renderiza, no se loguea, no va al DOM.
- [x] 6. Simulador funciona en dev y no existe en producción — producción medida (`307`); dev
      desbloqueado por `PUBLIC_EXACT_ROUTES` de T1.
- [x] 7. Tests con reporte de mutación: 104 mutantes, 102 muertos, 2 supervivientes y ambos
      equivalentes (uno era un mutante no-op mío; el otro lo neutraliza un closure obsoleto en el
      propio código, y sus dos variantes no neutralizadas mueren). De los 126 tests, **109 los vi
      ponerse rojos** y 17 nacieron verdes.
- [x] 8. `npx tsc --noEmit` y `eslint` limpios.
- [x] 9. **El simulador resuelve el Contrato C localmente** ejercitando el camino real
      (`postMessage` → listener pre-paint → Contrato A → servidor → Atlas), sin fake en ninguna
      frontera declarada en `contracts.md`.

---

## Pendientes Priorizados

1. Que T1 agregue `'/dev/'` a `PUBLIC_ROUTES` (o que T0 decida mover el simulador a
   `/auth/simulator`, que hereda el `startsWith('/auth')` que ya existe).
2. Click-through humano con el simulador: los cinco casos están listados abajo.
3. Cuando T1 entregue el endpoint: correr `/auth?mode=probe` desde el simulador y confirmar que
   los `diagnostics` se renderizan como espera el Contrato A.
4. El postMessage real desde el lab de Atlas — necesita credenciales que solo tiene JP.

---

## El fallback de orígenes se angosta en producción (decidido por T0)

`defaultAllowedOrigins(nodeEnv)` solo entra en juego si `NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS` no trae
ningún origen válido:

| Ambiente | Default |
|---|---|
| `production` | **solo** `https://dashboard.pijamafilms.com` |
| cualquier otro | los dos, producción primero |

La asimetría es el punto. Una variable ausente no debe hacer que un SSO que funciona se vea roto
—por eso no es fail-closed total— pero tampoco debe admitir el ambiente de **testing de un tercero**
en nuestro login de producción, donde no aporta nada. Fuera de producción no se pierde nada
aceptando ambos.

`nodeEnv` es parámetro y no una lectura de `process.env` adentro, para que la función sea pura: un
test que cambia el ambiente después del import la ejercita de verdad en vez de pasar porque el valor
quedó capturado en la carga del módulo.

**Medido** contra un build de producción sin la env var, servido en el puerto 3219:

```
var ALLOWED=["https://dashboard.pijamafilms.com"]
grep -c "dashboard-lab" → 0     (el origen del lab no aparece en NINGUNA parte del HTML)
```

## La taxonomía de stages se deriva del tipo del servidor (deuda saldada)

`AtlasErrorStage` **es** `AtlasSessionStage`, importado de `@/lib/atlas/types` — el módulo de
tipos, no el barrel `@/lib/atlas`, que reexporta `client.ts` (código de servidor).

```ts
import type { AtlasSessionStage } from '@/lib/atlas/types';
export type AtlasErrorStage = AtlasSessionStage;
export const ATLAS_ERROR_STAGES: readonly AtlasErrorStage[] = [ … ];
```

Antes era una copia a mano y quedó atrás **tres veces en un día**. El modo de falla nunca fue un
crash: un stage legítimo se renderizaba como si el servidor violara el contrato, que es justo el
falso negativo que este proyecto existe para evitar.

Ahora `STAGE_CONCLUSION` está tipado con el tipo importado, así que agregar un stage en el dominio
del servidor **rompe este build** hasta que alguien escriba qué significa. Verificado agregando un
noveno stage a `src/lib/atlas/types.ts`:

```
src/app/auth/atlas-bridge.ts(237,14): error TS2741:
Property 'quota_exceeded' is missing … but required in type 'Record<AtlasSessionStage, string>'.
```

**Tres capas, porque el tipo solo cubre una dirección:**

| Capa | Qué atrapa |
|---|---|
| El tipo importado | un stage nuevo en el servidor sin conclusión acá ⇒ falla el build |
| Dos tests de guardia | el array de runtime quedándose **corto** (un subconjunto tipa bien) |
| `describeStage()` | un servidor desplegado más nuevo que el bundle del navegador |

El array de runtime sigue existiendo porque un tipo no puede validar un string que llega por la red.

## El token no se queda en el buffer

El bridge bufferea una **copia superficial**, no `event.data`. Dos razones: `event.data` es del
navegador y mutarlo sería tocar algo que no es nuestro —cualquier otro listener de la página lo
vería—, y guardar la referencia mantiene vivo el payload entero mientras viva el buffer.

`bridge.scrub(message)` borra el token, y **la vista lo llama después de tenerlo en la mano**, nunca
al pasar. Destruirlo en la lectura convertiría cualquier fallo entre leer y usar en un login roto
intermitente, que es peor que la ventana que cierra. `scrub` toca **solo** el mensaje que recibe:
los sobres que nadie leyó todavía sobreviven.

Alcance honesto: la ventana real ya estaba acotada porque `subscribe()` vacía el buffer al drenar
(ahora hay un test que lo fija). Lo que agrega esto es no retener `event.data` y no dejar el token
en la copia una vez consumido. **Lo que no cubre:** si la vista nunca monta, el buffer conserva el
sobre. No le puse un auto-borrado por tiempo porque rompería la garantía del buffer pre-paint, que
es la razón de ser de todo esto.

## Decisiones Abiertas

- **`?mode=` por defecto es `login`**, y **un login rechazado escala solo a un `probe`**. La razón
  es operativa: la prueba real ocurre una vez, en una ventana que abre Console, desde una cuenta de
  administrador — el rechazo es el resultado más probable, y un diagnóstico detrás de un botón que
  nadie aprieta es un diagnóstico que no obtenemos. El botón "Re-run as diagnostic probe" queda
  como red para reintentos.
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
└── __tests__/{atlas-bridge,bridge-script,client,page}.test.*

src/app/dev/atlas-simulator/
├── page.tsx                     ← notFound() si NODE_ENV === 'production' (Contrato D, capa 2)
├── client.tsx                   ← abre /auth en ventana nueva y postea ATLAS_AUTH (sintético o real)
└── __tests__/{client,page,real-token}.test.*
```

### El campo de token real

`src/app/dev/atlas-simulator/client.tsx` acepta un JWT de producción pegado a mano. Es lo que
permite cerrar el Contrato C hoy, en local, sin deployar: JP tiene sesión abierta en
`dashboard.pijamafilms.com` y ese JWT sirve como Bearer para la llamada server-side a Atlas.

El token se postea por **`postMessage`, el mismo camino que usa Console** — nunca se inyecta
directo en el estado de la página. Un atajo que saltara nuestro propio listener validaría la
frontera con un fake, que es justo lo que no queremos.

Manejo, todo aserido en `__tests__/real-token.test.tsx`:

- campo `type="password"`, `autoComplete="off"`;
- **no controlado** (`inputRef`): React nunca sostiene el valor, así que no puede terminar renderizado;
- nunca a `localStorage`/`sessionStorage`, nunca a la URL, nunca a un query param;
- nunca al log ni a la consola — solo el fingerprint;
- el campo se limpia en cuanto el token se entregó;
- siempre `mode: 'probe'`, aunque el formulario sintético diga `login`. Es el único modo que no
  emite sesión.

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
6. **`on-ready` + `dev` + `wrong-type`** → *"Ignored: unrelated message type"*, y al vencer el
   timeout el texto debe decir *"Messages did arrive, but none of them was an ATLAS_AUTH
   envelope"* — distinto de "no llegó nada".
7. **Token real pegado** → pega el JWT de la sesión de `dashboard.pijamafilms.com`, aprieta
   *"Open /auth in probe mode and post the real token"*. Esto es lo que cierra el Contrato C.
   Lee `Atlas HTTP status` y `Atlas response keys` en el panel: son la evidencia cruda. Si el
   `stage` es `no_partner`, el resultado es **el SSO funciona** y la cuenta es de administrador.

En los siete, confirma con Ctrl+F que la cadena completa del token **no** aparece en el DOM.

---

## Cómo Invocarme o Reemplazarme

Lee este archivo completo + los últimos commits del branch `feat/atlas-sso-page`.
Luego invócame con un objetivo concreto:
_"Eres T2, domain agent de la página de aterrizaje del SSO Atlas. Tu próxima tarea es [X]. Lee
readme-T2.md y contracts.md antes de empezar."_
