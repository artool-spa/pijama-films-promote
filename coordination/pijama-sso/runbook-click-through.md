# Runbook — la prueba del SSO, paso a paso

_Escrito por T0 para JP · 2026-08-26 · **actualizado 2026-08-28**: verificado sobre `3a8f42d`,
557/557. Los pasos marcados CORREGIDO se reescribieron porque la versión original estaba
equivocada; se deja dicho cuál era el error en vez de borrarlo._

---

## Qué responde esta prueba

Dos preguntas independientes, y conviene no mezclarlas:

| | Pregunta | Dónde se responde | Necesita deploy |
|---|---|---|---|
| **A** | ¿Atlas acepta el JWT y devuelve las películas del partner? (**Contrato C**) | **En local**, con el simulador | **No** |
| **B** | ¿Console realmente postea el `ATLAS_AUTH` a nuestra ventana? (**Contrato B**) | Solo en producción | **Sí** |

**Haz la A primero.** Es la que tiene el riesgo real —ya medimos dos contradicciones entre lo
que Crazy Cake documentó y lo que su servidor entrega— y no cuesta un deploy. Si la A falla,
la B no sirve de nada todavía.

---

## Parte A · Contrato C, en local

### A1. Levantar el entorno

```bash
cd /Users/jpudev2/Proyectos/pijama-films-promote
git checkout feat/atlas-sso && git pull --ff-only
npx yarn@1.22.22 dev
```

Ya no hace falta mergear las ramas de T1 y T2: están en `feat/atlas-sso`, junto con el fix del
largometraje (#47) y los dos fixes del 2026-08-28. **El merge de #47 no es opcional**: el dev
local apunta a `FIREBASE_PROJECT_ID=pijama-promote-firebase`, o sea la Firestore de producción,
y una rama sin ese fix vuelve a escribir los documentos `Video Principal` que se purgaron.

Necesitas en tu `.env` (todas son configuración pública, ningún secreto nuevo):

```
ATLAS_API_BASE_URL="https://dashboard.pijamafilms.com"
NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS="https://dashboard.pijamafilms.com,https://dashboard-lab.pijamafilms.com"
ATLAS_LOGIN_ENABLED="false"
ATLAS_LOGIN_ALLOWED_PARTNER_IDS=""
```

Las dos últimas déjalas así: el login arranca cerrado a propósito.

### A2. Conseguir el token — CORREGIDO 2026-08-28

**La versión anterior de este paso era imposible y el error fue de T0.** Decía "busca el JWT en
el storage de la pestaña". No hay JWT que buscar: se midieron los cuatro almacenamientos del
cliente en `dashboard.pijamafilms.com` con sesión activa y **ninguno contiene un token**.
`localStorage` tiene una clave (`theme`), `sessionStorage` está vacío, IndexedDB está vacío, y
las once cookies legibles por JS son todas de analítica. La sesión vive en
`console-production`, una cookie `httpOnly` de `express-session` — `s:<sessionID>.<HMAC>`, un
identificador opaco, no un token portador.

**De dónde sale el token de verdad.** El bundle desplegado de Console
(`/resources/entry.js?v=…`, público) muestra que lo emite su servidor en el momento del
handoff:

```js
const t = await this.$aid.request("/partners/external-token");   // → { status:'ok', token }
```

Ese endpoint se autentica por cookie, así que se puede llamar desde la Console del navegador
con la sesión abierta. En la pestaña de `dashboard.pijamafilms.com`:

```js
const r = await (await fetch('/partners/external-token',
  { headers: { 'X-Requested-With': 'XMLHttpRequest' } })).json();
const i = document.createElement('input');
i.type = 'password';
i.style.cssText = 'position:fixed;top:12px;left:12px;z-index:99999;width:420px;font-size:16px';
i.value = r.token;
document.body.appendChild(i);
i.focus(); i.select();
console.log(r.status, `len=${r.token.length} pref=${r.token.slice(0,10)}…`);
```

El token queda en un campo **enmascarado** y nunca se dibuja como texto. Después `Cmd+C`
**sobre la página** — no en DevTools — y de ahí al simulador. Limpiar con `i.remove()`.

**Dos gotchas, los dos observados:**

- `navigator.clipboard.writeText` falla con `NotAllowedError: Document is not focused` cuando
  se corre desde DevTools: el foco está en DevTools, no en la página. El `i.focus()` de arriba
  lo resuelve. La utilidad `copy()` de DevTools tampoco sirve acá: el `await` de nivel superior
  hace que el snippet se envuelva en una función async y `copy` queda fuera de scope.
- **Copiar el snippet y pegarlo sin haber copiado el token deja el código en el portapapeles.**
  Pasó. El panel lo delata: mostró `446 chars · starts with "const …"`. Si el largo no es del
  orden de 200–900 y el prefijo no es `eyJ`, se colo el snippet.

Trátalo como credencial de producción, porque lo es. No lo pegues en un chat ni en un archivo.

### A3. Correr el probe

Abre `http://localhost:3000/dev/atlas-simulator`, pega el token en el campo (va a estar
enmascarado, tipo contraseña) y dispara el flujo en modo **probe**.

El simulador abre `/auth` en una ventana nueva y postea el token igual que lo haría Console,
así que se ejercita el camino completo: `postMessage` → listener → endpoint → servidor →
Atlas. Sin atajos ni piezas falsas en ninguna frontera.

### A4. Leer el resultado

El panel te va a mostrar `atlasStatus`, `contractMatched` y `partner`. Esa combinación es la
respuesta:

| `atlasStatus` | `contractMatched` | `partner` | Qué significa y qué sigue |
|---|---|---|---|
| 200 | `true` | `{...}` | **El SSO funciona.** Siguiente paso: poblar la allowlist con ese `partnerId` y probar el modo `login`. |
| 200 | `true` | `null` | **El SSO funciona, pero tu cuenta es admin y no tiene partner.** No es un fallo. Hace falta una cuenta de productor en el dashboard. |
| 200 | `false` | — | Atlas respondió otra cosa. `responseShapeKeys` es el hallazgo que va a Crazy Cake. |
| 302 | `false` | — | **La puerta de sesión de Console**, no un token rechazado. Ver la corrección debajo. |
| 0 | `false` | — | No se llegó a Atlas: DNS, timeout, o la variable sin configurar. |


**CORRECCIÓN 2026-08-28 · la fila del 302 estaba mal leída.** Decía "token rechazado, o la base
URL no es esa". Es otra cosa, y se midió: `/movies/by-partner` **existe** y con sesión responde
`{"status":"error","error":"MISSING_TOKEN","message":"Authorization header with Bearer token is
required"}`. O sea el path, el base URL y el mecanismo `Bearer` del Contrato C son correctos.
Pero hay una **puerta de sesión por cookie delante de la ruta**: desde nuestro servidor las seis
combinaciones de cabeceras dan 302 a `/auth/auth/logout`, con o sin `Bearer`. Un token rechazado
por esa ruta produce JSON; **el 302 es la puerta, no la ruta.**

**El más probable es el segundo**, porque tu cuenta administra todas las películas de la
plataforma y el endpoint es por partner. Que el panel diga "el SSO funciona" en ese caso es
deliberado: es la conclusión correcta, no un error.

**Referencia medida por T0 el 2026-08-26**, con un token inválido a propósito:

```json
{"ok":true,"diagnostics":{
  "atlasUrlTried":"https://dashboard.pijamafilms.com/movies/by-partner",
  "atlasStatus":302,"contractMatched":false,"partner":null,"responseShapeKeys":[]}}
```

Ese 302 **no** significaba token rechazado: es la puerta de sesión respondiendo antes de que la
ruta corra. Con un token real el resultado puede ser distinto, y si vuelve a salir 302 lo que
queda demostrado es que la puerta no acepta `Bearer` desde fuera del navegador — un bloqueo de
Crazy Cake, no nuestro.

### A5. Los otros cuatro casos del simulador

Si quieres confirmar que el panel distingue bien los estados (vale la pena: es lo que evita
que un SSO que funciona se vea roto), el `readme-T2.md` tiene el guion completo. El caso que
más importa es el de **mensaje perdido**: debe decir *"Nothing was posted to this window at
all"*, que es un estado distinto de "llegó y falló".

En todos, un `Ctrl+F` en la página debe **no** encontrar tu token completo.

---

## Parte B · Contrato B — CORREGIDO 2026-08-28: bloqueada, y no por nosotros

**Ya no depende de un deploy nuestro.** Se leyó el bundle desplegado de Console y el emisor
existe, pero tiene un defecto que impide que el handoff funcione en cualquier circunstancia:

```js
setTimeout(() => {
  win.postMessage({ type: "ATLAS_AUTH", token }, window.location.origin);
}, 1000);
```

El segundo argumento de `postMessage` es el **`targetOrigin`**: el origen al que el navegador
tiene permitido entregar el mensaje. Console pasa `window.location.origin`, que es **su propio
origen**. La ventana destino está en `promote.pijamafilms.com`, así que los orígenes no
coinciden y **el navegador descarta el mensaje en silencio**. Nunca sale del emisor.

Es una línea. Debería ser el origen derivado de `marketingUrl`.

**Consecuencia práctica:** desplegar nuestra mitad no hace que la Parte B pase. Mientras esa
línea no se corrija del lado de Crazy Cake, el panel de `/auth` en producción va a decir
—correctamente— que no llegó ningún `postMessage`. Eso no es un fallo nuestro y el panel lo
distingue: *"Nothing was posted to this window at all"* es un estado distinto de "llegó y falló".

**Dos hallazgos más del mismo código, que conviene mandar juntos:**

1. El payload es `{ type, token }` — **sin `partner`**, que su documentación sí describe. Eso ya
   lo absorbimos nosotros (`fc4b7e1`): `partner` pasó a opcional, porque además es dato no
   confiable y la identidad autoritativa viene de la respuesta del servidor de Atlas.
2. El `setTimeout` de 1000 ms es **disparo único, sin reintento ni handshake**. Nosotros
   posteamos `PROMOTE_READY` al `opener`, pero Console no lo escucha. Nuestro listener se
   registra antes del primer paint y bufferea, así que aguanta; pero si su ventana llegara a
   postear antes de que carguemos, se pierde y no hay segunda oportunidad.

### Cuando ellos corrijan, lo que arrastra nuestro deploy

Sigue vigente y sigue siendo decisión tuya:

1. **`NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS` se hornea en build.** Mergear no la activa: hace falta
   que App Hosting reconstruya. El síntoma es legible ("none configured" en el panel).
2. **Auto-rollout está activo** (`Traffic.rolloutPolicy.codebaseBranch: master`, medido el
   2026-08-28). O sea **mergear a `master` despliega de inmediato**, sin gate intermedio: el
   merge y el deploy son el mismo acto. La versión anterior de este runbook decía lo contrario.
3. **`/auth` cambia de comportamiento en producción**: hoy responde 404, después una página.

## Qué no cierra esta prueba

**El alcance por partner.** `getFilms()` sigue sin filtrar, así que cualquier sesión ve el
catálogo completo y las estadísticas de toda la plataforma. Por eso el login arranca cerrado
y detrás de allowlist. Es el otro bloqueante del Go Live y es un proyecto aparte.
