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
  stage: 'input' | 'rate_limited' | 'atlas_call' | 'contract' | 'no_partner' | 'disabled' | 'allowlist' | 'session',
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
| `rate_limited` | Más de 20 requests por minuto desde la misma IP. HTTP **429**. Agregado por T1b y **ratificado por T0**: el endpoint es anónimo y necesitaba limiter, y la regla dura del envelope exige que todo error lleve `stage` — devolver la forma de la casa habría roto el parseo de T2 |
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

### Medición de integración por T0 — 2026-08-26

Merge de las dos ramas de dominio en worktree propio, sin conflicto, **cero archivos en
común entre dominios**. `tsc` exit 0 · `eslint` 0 errores · **443/443 tests, 36 archivos**.

Smoke por el ensamblador real, servidor corriendo, sin fakes en ninguna frontera:

| Prueba | Resultado |
|---|---|
| `GET /auth` | **200** (era 404 en producción esa mañana) |
| `GET /dev/atlas-simulator` en dev | 200 |
| `GET /dev/atlas-simulator-internal` | 307 → `/login` (el match exacto hace lo que dice) |
| `GET /api/partners` sin cookie | 401 |
| `login` con `ATLAS_LOGIN_ENABLED=false` | 403 `stage:'disabled'`, **0 `set-cookie`** |
| 25 requests seguidos al probe | 20×200, luego 429 `stage:'rate_limited'` |
| Token en logs del server | **0 ocurrencias** del payload; solo `tokenPrefix: "eyJhbG"` |

**Probe contra Atlas real, token inválido:**

```json
{"ok":true,"diagnostics":{
  "atlasUrlTried":"https://dashboard.pijamafilms.com/movies/by-partner",
  "atlasStatus":302,"contractMatched":false,
  "partner":null,"movieCount":0,"movieSample":[],"responseShapeKeys":[]}}
HTTP 200
```

Esto valida la corrección de la política de status **por medición**: el caso que sabíamos
que iba a ocurrir llega como éxito con diagnóstico visible. Con la tabla original habría
sido un 502 con los diagnostics enterrados.

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

---

## Contrato B — hallazgo del 2026-08-28: el token no es alcanzable desde JS

Medido en `dashboard.pijamafilms.com` con sesión activa de JP, enumerando los cuatro
almacenamientos del cliente:

| Almacenamiento | Contenido |
|---|---|
| `localStorage` | una clave: `theme` |
| `sessionStorage` | **vacío** |
| `IndexedDB` | **vacío** (`indexedDB.databases()` → `[]`) |
| cookies legibles por JS | once, **todas de analítica**: `_ga`, `_ga_186C2B5YVT`, `_ga_HTN668K0KR`, `_gcl_au`, `_fbp`, `_tt_enable_cookie`, `_ttp`, `ttcsid`, `ttcsid_D83M6M3C77U6NFPBOD0G`, `__stripe_mid`, `__stripe_sid` |

**Ninguna con prefijo `eyJ`.** La sesión de Console no vive en un lugar que JavaScript pueda
leer — lo esperable es una cookie `httpOnly`, pendiente de confirmar en el panel de cookies.

### Consecuencias, y son dos distintas

**1 · El paso A2 del runbook es imposible como está escrito.** Decía "saca el JWT del storage
de la pestaña". No hay JWT que sacar. Ese paso se escribió sobre un supuesto que nunca se
midió — el error es de T0, no del runbook de Crazy Cake.

**2 · El Contrato B, tal como está documentado, no puede ejecutarse desde el cliente.** Si el
JS de Console no puede leer el token, no puede postear `{ type:'ATLAS_AUTH', token, partner }`.
Quedan dos posibilidades y son muy diferentes entre sí:

- **(a)** Console pide el token a un endpoint propio al momento de abrir la ventana (diseño
  sano: token de corta vida y propósito único). Entonces el contrato funciona y lo que falta
  es saber cómo se emite.
- **(b)** El emisor nunca se implementó del lado de Console, y el documento describe una
  intención. Entonces no hay integración que probar todavía.

**No se puede elegir entre (a) y (b) desde afuera.** Se resuelve buscando `ATLAS_AUTH` en el
bundle de Console, que JP tiene cargado en su navegador. Sin sesión, `dashboard.pijamafilms.com`
devuelve 302 a todo, incluidos los assets, así que no es medible desde el servidor.

### Nota

Esto **no invalida el Contrato C ni nuestra mitad.** El endpoint `/api/auth/atlas/session`
quedó verificado en local contra el host real de Atlas (302 con token falso, `stage` correcto
en los tres estados, token ausente de los logs). Lo que falta es un token real, y el camino
para obtenerlo cambió.

## Contrato C — el endpoint existe, y hay una puerta delante

**2026-08-28.** JP abrió `https://dashboard.pijamafilms.com/movies/by-partner` en la barra de
direcciones, con su sesión activa:

```json
{"status":"error","error":"MISSING_TOKEN",
 "message":"Authorization header with Bearer token is required"}
```

**Confirmado, y es la primera confirmación real del Contrato C:** el path es correcto, el base
URL es correcto, responde la *aplicación* de Atlas en su propio formato, y el mecanismo
documentado (`Authorization: Bearer`) es el que el endpoint declara querer.

**Pero desde nuestro servidor, las seis combinaciones dan 302 a `/auth/auth/logout`:**

| Petición desde el servidor | Resultado |
|---|---|
| sin cabeceras | 302 |
| `Accept: application/json` | 302 |
| `Accept: text/html` | 302 |
| `Authorization: Bearer <falso>` | 302 |
| `Bearer <falso>` + `Accept: json` | 302 |
| User-Agent de Chrome | 302 |

La única variable que separa el JSON del 302 es la cookie de sesión **`console-production`**,
que es `httpOnly` (confirmado: no aparece entre las once cookies que lee `document.cookie`,
sí aparece en Cookie-Editor, que tiene permiso de extensión).

### El nudo, dicho con precisión

Hay una puerta de sesión por cookie **delante** de la ruta, y la ruta pide `Bearer` **detrás**.
Nuestro servidor no tiene ni puede tener esa cookie. Así que la llamada server-to-server que
la propia documentación de Crazy Cake prescribe **es 302 antes de que la ruta corra**.

**Lo que todavía no está medido**, y es la bisagra: si la puerta *rechaza* un Bearer falso con
302, o si *ignora* el Bearer por completo. Un token válido distingue los dos casos, y hasta
ahora no tenemos uno.

**El 302 de nuestro probe nunca significó "token rechazado".** Así lo leía la tabla del
runbook, y estaba mal: un token rechazado por esta ruta produce JSON, no un redirect. El
redirect es la puerta, no la ruta. Corregido.

### La cookie no es un JWT: es una sesión de servidor

`console-production` mide 82 caracteres y empieza con `s%3A3sq-v1h…` — o sea `s:` tras
decodificar, la marca de cookie firmada de **`express-session`** (`s:<sessionID>.<HMAC>`).
Es un identificador **opaco**, no un token portador.

**Esto cierra la pregunta de dónde está el JWT: no existe en el cliente.** Console mantiene la
sesión en el servidor y el navegador solo carga el puntero firmado. No hay nada en el cliente
que se pueda leer y postear como `token`.

**Consecuencia sobre el Contrato B, ahora sin ambigüedad:** el `postMessage` documentado
—`{ type:'ATLAS_AUTH', token, partner }`— **no puede armarse desde el JS de Console leyendo
storage**, porque no hay token que leer. Para que el contrato funcione, Console tiene que
**emitir** un JWT desde su servidor en el momento del handoff. O ese emisor existe y no está
documentado, o no se construyó.

**Test descartado.** Se había propuesto probar `Authorization: Bearer <valor de la cookie>` en
incógnito. Es inútil: una sesión de express no es un JWT y `/movies/by-partner` valida JWTs, así
que fallaría por una razón que no enseña nada. No se corrió.

**Queda una sola medición nuestra antes de escalar:** buscar `ATLAS_AUTH` en el bundle de
Console. Separa "falta configurar" de "falta que lo escriban", y decide de quién es el próximo
paso.

### El emisor del token rechaza a una cuenta admin — medido 2026-08-28

JP corrió, con sesión viva en `dashboard.pijamafilms.com` (la página de usuarios renderizando,
693 registrados):

```js
const res = await fetch('/partners/external-token', { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
// HTTP 200 | url final: https://dashboard.pijamafilms.com/partners/external-token
// claves: ['status','error'] | status: error | error: UNAUTHORIZED
```

**HTTP 200 y sin redirect**, o sea pasó la puerta de sesión: el rechazo viene de **dentro** de la
ruta. Es una decisión de **autorización**, no de autenticación. Distinguirlo importa porque
apuntan a arreglos distintos y a personas distintas.

**Lectura, coherente con el nombre del endpoint y con dónde vive el botón.** En el bundle,
`openMarketingPortal` es un método del componente de edición de película (convive con
`this.movie`, `reloadAssets`, `isDraft`, `isAdmin`), y `/partners/external-token` no toma
parámetros: emite un token **para el partner del usuario logueado**. La cuenta de JP administra
toda la plataforma en vez de pertenecer a una productora, así que no hay partner del cual
emitir. El rechazo es correcto, no un bug.

**Corolario que conviene mandarle a Crazy Cake:** con una cuenta admin, el botón de portal de
marketing **también falla dentro de su propia UI**. `$aid.request` devuelve el envelope de error
y `openMarketingPortal` lanza `"No se pudo obtener el token de autenticación"`, que termina en su
alert de `MARKETING_PORTAL_ERROR`. O sea el handoff nunca fue ejercitado desde una cuenta admin,
y probablemente tampoco desde una de productora — porque si lo hubiera sido, el bug del
`targetOrigin` habría aparecido de inmediato.

### Consecuencia para la Parte A

**No se puede correr con la cuenta de JP.** Hace falta una cuenta de **productora** (partner) en
el dashboard. Eso es un pedido concreto, con evidencia, en vez de "no nos funciona".

**Pista fuerte antes de pedirlo:** el correo de enero decía *"testing ya tiene todo para
funcionar con ustedes"*, y el entorno de testing es **`dashboard-lab.pijamafilms.com`**, donde JP
ya tenía sesión. Si ahí existe una cuenta de productora de prueba, la Parte A se corre sin
esperar a nadie. Para eso hay que apuntar `ATLAS_API_BASE_URL` al lab: el origen del lab ya está
en la allowlist de `NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS`, pero el base URL del servidor apunta a
producción.

## Contrato C — CONFIRMADO 2026-08-28, y el bloqueo queda aislado

Con una cuenta de **productora** (`jpundurraga`, distinta de la admin de `pparga`), token real
emitido por `/partners/external-token` (`status: ok`, con `token`, `expiresIn` y `partner`):

**Desde el navegador, cookie + Bearer juntos → `200`:**

```json
{"status":"ok","data":{"partner":{
   "name":"José Pedro Undurraga","email":"jpundurraga@artool.cl",
   "muviUuid":"b006…","partnerId":"6984…"},
  "movies":[]}}
```

**La forma documentada, exacta.** Los cuatro campos del partner. `movies` vacío porque esa
productora no tiene catálogo — propiedad de la cuenta, no del contrato.

**Desde nuestro servidor, mismo token válido, solo Bearer → `atlasStatus: 302`.**

### El bloqueo, aislado sin ambigüedad

Las dos mediciones difieren en **una sola variable**: la cookie de sesión. Con ella la ruta
corre y cumple el contrato; sin ella hay 302 a `/auth/auth/logout` antes de que la ruta se
ejecute. Y ya sabíamos que el 302 no depende del token: seis combinaciones de cabeceras con
token falso daban lo mismo.

**Conclusión: la puerta de sesión ignora el `Authorization` por completo.** Un token válido
recibe el mismo trato que uno inválido. La llamada server-to-server que la propia documentación
de Crazy Cake prescribe es imposible tal como está desplegado — y el mensaje de error de la
ruta (`MISSING_TOKEN: Authorization header with Bearer token is required`) describe un mecanismo
que su propia puerta vuelve inalcanzable.

Queda descartado que el token sea el problema: es el mismo token en las dos pruebas.

### Dos arreglos posibles, y el segundo es mejor para los dos

**(a)** Que Crazy Cake exceptúe `/movies/by-partner` de la puerta de sesión, para que el
`Bearer` sirva desde fuera del navegador.

**(b)** Que nos den la clave de verificación del JWT (o un endpoint JWKS). Entonces validamos
el token nosotros y **no necesitamos ese endpoint en absoluto**: el `partner` que devuelve
—incluido `muviUuid`, que es la llave hacia el catálogo— probablemente ya viaja en los claims
del propio token. Menos ida y vuelta, ninguna dependencia server-to-server, y es como funciona
un SSO normalmente.

**Pendiente para elegir entre las dos:** ver si los claims del JWT traen `partnerId` y
`muviUuid`. Si los traen, (b) es estrictamente mejor y convierte el pedido en algo más simple
de conceder que un cambio en su capa de autenticación.

### Los claims del JWT, y por qué NO hay que pedir la clave — 2026-08-28

```
header:  { alg: "HS256", typ: "JWT" }
claims:  { partnerId, muviUuid, email, name, role: "partner", iat, exp }
```

`exp - iat` = **86.400 s = 24 horas**.

**El token trae todo lo que la integración necesita** — `partnerId` es el ancla de autorización
que ya usa nuestro código, y `muviUuid` es la llave hacia el catálogo de MUVI, que es de donde
leemos las películas. `movies` de `/movies/by-partner` es, para nuestro caso, prescindible.

**Pero `HS256` es simétrico, así que la opción (b) de arriba queda descartada tal como estaba
escrita.** No existe una "clave pública" que pedir: la clave que verifica es la misma que
firma. Quien la tenga puede **emitir** tokens para cualquier partner. Pedirla significaría
poder impersonar a cualquier productora, y una filtración de nuestro lado compromete la
autenticación completa de Crazy Cake. **No se pide.** Es exactamente el caso donde la opción
conveniente es la insegura.

**Y esto valida la decisión de diseño de tratar el token como opaco.** Con `HS256` y sin la
clave no podemos verificar la firma; si hubiéramos decodificado los claims para autorizar
—que es la lectura "obvia" ahora que sabemos que traen `partnerId`— cualquiera podría
fabricar un JWT con el `partnerId` que quisiera y entraríamos. **Sería un bypass de
autenticación completo.** La autoridad tiene que seguir siendo la respuesta de Atlas.

**Observación de seguridad para pasarles:** un token portador de **24 horas** es largo para un
handoff que se dispara al apretar un botón. Debería vivir minutos. Hoy, cualquiera que lo
capture tiene un día de acceso a la cuenta de esa productora.

### Los tres pedidos posibles, en orden de facilidad para ellos

1. **Exceptuar `/movies/by-partner` de la puerta de sesión.** Mínimo, no comparte ningún
   secreto: nosotros llamamos con `Bearer`, ellos validan con su propia clave. Desbloquea hoy.
2. **Un endpoint de verificación sin cookie**, del tipo `POST /partners/verify-token` →
   devuelve el partner. Más limpio que exponer una ruta de datos, y acotado a este propósito.
3. **Migrar el token del handoff a `RS256`/`ES256` con JWKS.** Lo mejor a largo plazo
   —verificamos local, sin ida y vuelta ni secreto compartido— y lo más trabajoso para ellos.

Cualquiera de los tres desbloquea. El 1 es el que se concede en una tarde.

## Re-auditoría del diagnóstico completo — 2026-08-29, a pedido de JP

Pregunta: *"¿no será un problema nuestro? Es muy costoso pedir ayuda que no necesito."*
Se re-midió todo contra el ambiente que Mathias entregó (**testing**, no producción), porque
todas las mediciones previas del endpoint habían sido contra producción.

### Hallazgo 1 (targetOrigin) — confirmado en LOS DOS ambientes, y no tiene workaround nuestro

El bundle del lab (no minificado) tiene el mismo código que producción:

```js
portalWindow.postMessage({ type: 'ATLAS_AUTH', token: jwt }, window.location.origin);
// comentario original: "Wait for portal to load and send JWT via postMessage"
```

¿Puede arreglarlo el receptor? **No, por diseño del navegador**: el `targetOrigin` lo declara
el emisor y se compara contra el origen de la ventana destino *al momento de la entrega*. El
receptor no puede "aceptar igual" un mensaje que el navegador nunca entrega. Detalle adicional:
si a los 1000 ms nuestro documento aún no cargó, la ventana está en `about:blank` —que hereda
el origen del opener— y el mensaje sí se entregaría… a una página sin listener. En ningún caso
llega a nuestra app.

### Hallazgo 2 (puerta de sesión) — confirmado también en el lab, sin salida unilateral

```
OPTIONS lab/movies/by-partner + Origin promote  → 302, cero access-control-*
GET     lab/movies/by-partner + Bearer falso    → 302 a /auth/auth/logout
```

Idéntico a producción. Alternativas nuestras evaluadas y descartadas:

- **Fetch desde el navegador con `credentials:'include'`**: exigiría `Access-Control-Allow-Origin`
  específico + `Allow-Credentials: true` (no envían ninguna) y la cookie es de otro sitio
  (SameSite la retiene). Doble bloqueo.
- **Usar los claims del JWT sin llamar a Atlas**: es HS256 y no tenemos (ni queremos) la clave;
  claims sin verificar = bypass de autenticación. Descartado antes, sigue descartado.
- **Nuestro servidor con la cookie del usuario**: es httpOnly y de otro dominio. Imposible.

### Lo que la re-auditoría SÍ cambió (errores nuestros, ya corregidos en el correo)

1. El reclamo del campo `partner`: la guía de enero nunca lo prometió — lo inventó nuestro
   Contrato B. El correo ya no lo reclama.
2. "La llamada server-to-server que describe la documentación": la guía describe un fetch de
   navegador. Corregido; el hallazgo de CORS se agregó como cuarto camino cerrado.

### Conclusión

**Los dos bloqueos son de Crazy Cake, verificados en el ambiente que ellos declararon listo.**
No existe combinación de cambios de nuestro lado que destrabe ninguno de los dos. El correo
está justificado y sus tres pedidos son necesarios.
