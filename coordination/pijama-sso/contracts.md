# Contratos — SSO Atlas Console

_Mantenido por T0. Un agente que necesite cambiar un contrato **para y reporta**; no lo
cambia por su cuenta._

---

## Contrato A — `POST /api/auth/atlas/session`

**Productor:** T1 · **Consumidor:** T2 · **Estado:** definido por T0, pendiente de validación

### Request

```ts
{ token: string, mode: 'probe' | 'login' }
```

Validado con Zod. `token` no vacío. `mode` es enum estricto.

### Response 200 — `mode: 'probe'`

```ts
{
  ok: true,
  diagnostics: {
    atlasUrlTried:      string,           // la URL exacta que se llamó
    atlasStatus:        number,           // HTTP que devolvió Atlas
    contractMatched:    boolean,          // ¿la forma calzó con el Contrato C?
    partner:            { name: string, email: string,
                          muviUuid: string, partnerId: string } | null,
    movieCount:         number,
    movieSample:        Array<{ title: string, muviUuid: string }>,  // máx 3
    responseShapeKeys:  string[]          // keys de nivel superior de lo que llegó
  }
}
```

`responseShapeKeys` es lo que permite diagnosticar sin ver datos: si llega
`['status','data']` el contrato calza; si llega `['error']` o el body no es JSON, no.

### Response 200 — `mode: 'login'`

```ts
{ ok: true, redirectTo: '/films' }
```

Más `Set-Cookie: pijama-session` (httpOnly, secure en producción, sameSite lax, 7 días),
emitida con `createSessionToken` + `setSessionCookie` de `src/lib/auth/session.ts`.

### Response de error — 4xx / 5xx

```ts
{
  ok: false,
  stage: 'input' | 'atlas_call' | 'contract' | 'no_partner' | 'disabled' | 'allowlist' | 'session',
  message: string,
  diagnostics?: { ... }    // el mismo objeto de arriba, parcial, cuando aplique
}
```

`stage` es **obligatorio**. Es lo que permite responder *dónde* se rompió en vez de
"falló". Sin `stage` el endpoint no cumple el contrato.

| `stage` | Significa |
|---|---|
| `input` | El body no pasó Zod |
| `atlas_call` | No se pudo llegar a Atlas (red, DNS, timeout) o devolvió no-2xx |
| `contract` | Atlas respondió 2xx pero la forma no calza con el Contrato C |
| `no_partner` | Atlas respondió 2xx **con la forma correcta**, pero `data.partner` es `null` o sin `partnerId`. La cuenta autentica y no es un partner |
| `disabled` | `ATLAS_LOGIN_ENABLED` está apagado. Un kill switch de ambiente no es una allowlist |
| `allowlist` | El `partnerId` no está en la allowlist, o la allowlist está vacía/ausente |
| `session` | Falló emitir la cookie o el upsert del partner |

### Política de HTTP status en modo `probe` — corregida 2026-08-26

Defecto de T0, encontrado por la auditoría de T1b (D1) y verificado: la implementación
cumplía la tabla original al pie de la letra, y la tabla estaba mal.

| Situación | HTTP | `stage` |
|---|---|---|
| Atlas produjo **cualquier** respuesta HTTP (200, 302, 401, 500…) | **200** | — · `ok:true`, `atlasStatus` real |
| Body de request inválido | 400 | `input` |
| Atlas **no** produjo respuesta HTTP (DNS, timeout, conexión rechazada) | 502 | `atlas_call` |

En `probe`, `atlas_call` significa únicamente **inalcanzable**. En `login` no cambia: un
no-2xx sigue siendo `atlas_call` con 502, porque ahí sí hay que juzgar.

**Por qué importa:** el único comportamiento medido contra Atlas real es `302`. Con la
tabla vieja, la prueba real habría respondido `502` + `ok:false` con los diagnostics
—lo único que se le pide a la sonda— enterrados dentro del error. Un panel que renderiza
diagnostics solo en `ok:true` no habría mostrado nada, y "no muestra nada" se lee como
roto. Era el falso negativo que el proyecto existe para evitar, entrando por una puerta
que nadie había mirado.

Incoherencia de origen: T0 escribió que una sonda "reporta, no juzga" y aplicó el
principio al shape mismatch pero no al status.

### Interpretaciones resueltas por T0 (2026-08-26)

- **`probe` con shape mismatch ⇒ 200**, con `contractMatched: false` y `responseShapeKeys`
  reales. Una sonda **reporta, no juzga**.
- **`ATLAS_LOGIN_ENABLED=false` ⇒ `stage:'disabled'`** (corregido: antes decía
  `'allowlist'` con mensaje distinguido; un stage propio es mejor que un mensaje que hay
  que leer).
- **El consumidor lee `diagnostics` sin mirar `ok` ni el status HTTP.** Defensa en
  profundidad contra otro error de T0 en la política de status.
- **`partner: null` en `login` ⇒ `stage:'no_partner'`, NO `'contract'`.** Colapsar los dos
  destruye la distinción que el proyecto necesita, y es el caso más probable en la primera
  prueba real porque la cuenta disponible es de administrador.

### Reglas duras

- El token **nunca** se devuelve ni se loguea. Solo largo y prefijo.
- El modo `probe` **nunca** emite cookie ni crea partners.
- Fail-closed: allowlist vacía o ausente ⇒ `stage:'allowlist'`. Nunca "vacío = todos".
- El JWT es **opaco**: no se decodifica para autorizar. La autoridad es Atlas.

---

## Contrato B — envelope del `postMessage`

**Productor:** Crazy Cake (externo) · **Consumidor:** T2 · **Estado:** documentado, no observado

```js
{ type: 'ATLAS_AUTH', token: string, partner: { name: string, email: string } }
```

Fuente: correo de Mathias Beckhaus del 8 de enero de 2026. El campo `partner` aparece en
el correo pero **no** en el markdown adjunto — el correo es la fuente más completa.

Orígenes permitidos (vía `NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS`), **producción primero**:

| Ambiente | Origen | Rol |
|---|---|---|
| **Producción** | `https://dashboard.pijamafilms.com` | **ambiente objetivo de la prueba** |
| Testing | `https://dashboard-lab.pijamafilms.com` | secundario |

Corrección de JP (2026-08-26): el dashboard productivo de Crazy Cake es
`dashboard.pijamafilms.com`, y ahí tiene un usuario con acceso a películas. La prueba
real corre contra producción, no contra el lab.

**Trampa conocida:** el ejemplo de código de Crazy Cake valida contra el origen del lab
en literal. Copiarlo tal cual **rompe producción**. La validación es por ambiente.

Mecánica: Console abre nuestra URL con `_blank` (ventana nueva, no iframe) y postea al
`window` resultante. Por eso `X-Frame-Options: SAMEORIGIN` en `next.config.mjs` no
estorba, y por eso hay race de timing (ver requisito de listener pre-paint en el spec).

---

## Contrato C — endpoint de películas de Atlas

**Productor:** Crazy Cake (externo) · **Consumidor:** T1 · **Estado:** 🔴 **NO VERIFICADO — riesgo del proyecto**

### Lo documentado

```
GET {ATLAS_API_BASE_URL}/movies/by-partner
Authorization: Bearer <jwt>

200 → { status: 'ok',
        data: { partner: { name, email, muviUuid, partnerId },
                movies: [ { _id, title, description, genre[], duration,
                            releaseYear, muviUuid, status, assets[], createdAt } ] } }
401 → MISSING_TOKEN     403 → TOKEN_EXPIRED / PARTNER_DISABLED
```

### Lo medido por T0 el 2026-08-26

| Sonda | Resultado | Contradice el documento |
|---|---|---|
| `OPTIONS` con `Origin` nuestro | `302`, sin `Access-Control-Allow-Origin` | Sí — el `fetch` de navegador que documentan es imposible |
| `GET` sin token | `302 → /auth/auth/logout` | Sí — promete `401` JSON |
| `GET` con token inválido | `302 → /auth/auth/logout`, idéntico | Sí — promete `403` JSON, y no distingue de "sin token" |
| `api.pijamafilms.com` | NXDOMAIN | El default de `src/lib/pijama/index.ts:12` apunta a la nada |

### Cómo se cierra este contrato

No se cierra por diseño: se cierra **midiendo con un token real**. Por eso:

- `ATLAS_API_BASE_URL` es env var, para reapuntar sin redeploy de código.
- T1 reporta `responseShapeKeys` y `atlasStatus` crudos, sin asumir la forma documentada.
- Si el resultado difiere de lo documentado, **es un hallazgo para JP**, no un fix nuestro.

**Caso ambiguo previsto:** si `movies` viene vacío, la forma decide.
`{status:'ok', data:{partner:{...}, movies:[]}}` prueba que el contrato funciona sin
datos. Un `302`, o un body con otras keys, prueba que no.

**La cuenta que tenemos es de administrador, no de productor.** En la captura de JP del
dashboard productivo el encabezado dice *"Administra todas las películas de la plataforma
y revisa el contenido enviado por los socios"*, y hay controles de moderación (aprobar /
revisar / rechazar) sobre una película en "Aprobación pend.". El catálogo muestra cinco
películas con estados Borrador / Publicada / Aprobación pendiente.

El endpoint es `/movies/by-partner` — **scoped por partner**. Una cuenta admin puede no
tener `partnerId` asociado. Tercer resultado posible, además de "funciona" y "roto":
`atlasStatus: 200` + `responseShapeKeys: ['status','data']` + `partner: null` significa
**"el contrato funciona pero esta cuenta no es un partner"**. Los diagnostics de T1 deben
dejar los tres casos distinguibles sin adivinar.

**Cómo se resuelve este contrato sin deployar:** el JWT vive en el browser de JP, que
tiene sesión abierta. El simulador de T2 acepta un token pegado a mano y lo postea por
`postMessage` a `/auth` tal como lo haría Console, así que el camino real
(`postMessage` → listener → Contrato A → servidor → Atlas) se ejercita **completo y en
local**, sin fakes en ninguna frontera. La mitad del `postMessage` desde Console sigue
requiriendo producción, porque la URL de destino la configuró Crazy Cake en enero.

---

## Contrato D — el simulador es inaccesible en producción

**Dueños:** T1 (capa 1) y T2 (capa 2) · **Estado:** 🟡 capa 2 verificada, capa 1 en arreglo

Contrato **emergente**: no existía al inicio del proyecto. Lo destapó la auditoría de T1b
al notar que T1 publicaba en el middleware una ruta cuya página vive en la rama de T2 —
un efecto que cruza dominios y que ninguno de los dos agentes podía ver desde su lado.

| Capa | Mecanismo | Archivo | Dueño |
|---|---|---|---|
| 1 | `PUBLIC_EXACT_ROUTES` vacío cuando `NODE_ENV === 'production'` | `src/middleware.ts` | T1 |
| 2 | `notFound()` en la página cuando `NODE_ENV === 'production'` | `src/app/dev/atlas-simulator/page.tsx:19` | T2 |

**Ninguna de las dos capas se saca sin la otra, y cada una lleva su test.**

Estado medido el 2026-08-26: la capa 2 existe y está bien puesta (evaluada en el server
component). La capa 1 **no tenía guard** — el único `NODE_ENV` de `middleware.ts` está en
la línea 153 y es para el formato de logging. No hubo exposición real porque la capa 2
aguantaba, pero el spec §6 pide *"inaccesible en producción"* y una sola capa, alojada en
otro dominio del que publica la ruta, no sostiene eso.

Origen del defecto: T0 pidió la entrada de middleware sin especificar el guard de ambiente.

**Ambas capas eran invisibles para la suite.** Vaciar `PUBLIC_EXACT_ROUTES` dejaba los 92
tests verdes. Es el tercer caso en este proyecto del mismo patrón: la protección existe,
funciona, y ningún test se entera si desaparece.

---

## Divergencias de stack declaradas

Perfil base: `artool-pijama-promote-stack` (nuevo, creado en este proyecto).
Hereda de `artool-utils` los gotchas de App Hosting, secrets y verificación de deploy.

Diverge de `artool-utils` en:

| Dimensión | `artool-utils` | este repo |
|---|---|---|
| UI | Tailwind + shadcn/ui | **MUI 7.3** |
| Functions | Python (`functions/main.py`) | **TypeScript** |
| Auth | Google OAuth `@artool.cl` | **Firebase email/password** + cookie propia |
| Analítica | BigQuery | ninguna |
| Idioma de UI | español | **inglés** |

---

## Decisiones de JP registradas

| # | Decisión | Fecha |
|---|---|---|
| 1 | Crear el perfil de stack nuevo ahora y usarlo desde el arranque | 2026-08-26 |
| 2 | Login habilitado en producción, restringido por allowlist de `partnerId` | 2026-08-26 |
| 3 | El caso "lab sin películas" lo determina el agente y reporta la evidencia | 2026-08-26 |
| 4 | Fuera de alcance: filtrado de películas por partner en `getFilms()` | 2026-08-26 |
| 5 | PRs #45 y #46 quedan fuera de este proyecto | 2026-08-26 |
