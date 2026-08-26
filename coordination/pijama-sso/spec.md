# Spec — SSO Atlas Console → promote.pijamafilms.com

_Consolidado por T0 · 2026-08-26 · fuentes: cadena de correos "Pruebas de integración de
marketing" (29 mensajes, dic 2025 – feb 2026), adjunto `Sesion dashboard pijama.md` del
8 de enero, y sondas contra producción hechas por T0 el 2026-08-26._

---

## 1. Objetivo

Responder **con evidencia** si el SSO con Atlas Console está operativo, y dejar el login
funcionando para partners de una allowlist.

**Fuera de alcance** (no lo toque ningún agente): el filtrado de películas por partner.
`getFilms()` (`src/models/film.ts:491`) no recibe partner y `getAggregateStats()`
(`src/models/film.ts:572`) agrega toda la plataforma. Es el otro bloqueante del Go Live
y se trata en un proyecto aparte.

---

## 2. Cómo funciona la integración (según Crazy Cake)

Mathias Beckhaus (CTO de Crazy Cake), correo del 8 de enero de 2026:

> La idea es que ustedes nos pasen la url con la que están trabajando y nosotros vamos a
> redirigir al cliente a su url con un `_blank` y luego les mandamos un postMessage de
> este tipo:
> ```js
> { type: 'ATLAS_AUTH', token: data.token, partner: data.partner // { name, email } }
> ```
> Este JWT lo pueden ocupar como Bearer para el endpoint (…) que devuelve la información
> del usuario y sus películas.

URLs de Atlas por ambiente:
- Testing: `https://dashboard-lab.pijamafilms.com`
- Producción: `https://dashboard.pijamafilms.com`

La URL nuestra que Pablo Parga les comprometió el 13 de enero:
**`https://promote.pijamafilms.com/auth`**

Crazy Cake declaró su lado terminado el **21 de enero de 2026**: _"El A record ya está
listo y testing ya tiene todo para funcionar con ustedes."_

El JWT: firmado HS256, expira en 24 h, **debe tratarse como opaco** (no decodificarlo
para autorizar).

---

## 3. Estado real del código (verificado)

`src/app/auth/route.ts` existe: 27 líneas que loguean el request y devuelven
`{"error":"Not found"}` con status 404, en GET y en POST. Es una sonda que alguien dejó
para capturar qué manda Crazy Cake. Confirmado contra producción el 2026-08-26:

```
GET  https://promote.pijamafilms.com/auth?token=... → 404
POST https://promote.pijamafilms.com/auth           → 404
```

No existe ningún listener de `postMessage` en `src/` ni en `functions/`.

`src/lib/pijama/` (702 líneas) es un cliente OAuth2 `client_credentials` que apunta por
default a `https://api.pijamafilms.com` — host que **no resuelve** (NXDOMAIN). Es
andamiaje muerto del primer commit. **Ningún agente lo toca**; su retiro es follow-up.

---

## 4. Hallazgos de T0 que cambian el diseño

**Atlas no envía cabeceras CORS.** El preflight `OPTIONS` a `/movies/by-partner` con
`Origin: https://promote.pijamafilms.com` responde `302` sin `Access-Control-Allow-Origin`.
**Consecuencia: el `fetch` desde el navegador que documenta Crazy Cake no puede funcionar
desde nuestro origen.** La llamada a Atlas va del servidor, obligatoriamente.

**La forma real de la respuesta es indescubrible sin token.** Toda ruta no autenticada en
el lab responde `302` a `/auth/auth/logout`, con y sin `Authorization`. Cuatro rutas
candidatas probadas (`/movies/by-partner`, `/api/movies/by-partner`,
`/api/v1/movies/by-partner`, y `api.pijamafilms.com`) dan lo mismo o no resuelven. El
documento promete `401 MISSING_TOKEN` / `403 TOKEN_EXPIRED` en JSON: **no es lo que
está implementado.**

**Atlas es una SPA con routing por hash** (`dashboard-lab.pijamafilms.com/#/`). El emisor
del `postMessage` es JS de cliente.

**`page.tsx` y `route.ts` no pueden coexistir** en el mismo segmento de ruta (ver
`node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md:159`). Para
poner una página en `/auth` hay que **borrar** `src/app/auth/route.ts`.

---

## 5. Sección T1 — dominio servidor Atlas

Construir el cliente de Atlas y el endpoint de intercambio.

**Archivos tuyos:**
```
src/lib/atlas/{config,client,types,index}.ts     nuevo
src/lib/atlas/__tests__/**                       nuevo
src/app/api/auth/atlas/session/route.ts          nuevo
src/middleware.ts                                1 línea: agregar a PUBLIC_ROUTES
apphosting.yaml · .env.example                   env vars nuevas
```

**Reutiliza, no reimplementes:**
- `getOrCreatePartner(partnerId, name)` — `src/models/partner.ts:306`
- `createSessionToken(payload)` y `setSessionCookie(token)` — `src/lib/auth/session.ts`
  (`SessionPayload` = `{ uid, email, name, partnerId }`; para SSO el `uid` sintético
  `atlas:<partnerId>` es correcto — el middleware solo lee la cookie firmada, no Firebase)
- `logger` — `src/lib/logger.ts`
- Zod para **todo** input (regla del proyecto, `CLAUDE.md`)

**Env vars a introducir:**
```
ATLAS_API_BASE_URL                  base configurable; el contrato C no está verificado
ATLAS_LOGIN_ENABLED                 gate del modo login
ATLAS_LOGIN_ALLOWED_PARTNER_IDS     allowlist, coma-separada
NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS   orígenes permitidos (los lee T2 en el cliente)
```

`NEXT_PUBLIC_*` se hornea en build: al agregarla a `apphosting.yaml` con
`availability: BUILD`, mergear **no** la activa — hace falta rollout. Dilo en el PR.

**DoD:**
1. `POST /api/auth/atlas/session` cumple el Contrato A exactamente, ambos modos.
2. Modo `probe` no emite cookie ni crea partners, nunca.
3. Modo `login` **fail-closed**: allowlist vacía o ausente ⇒ rechaza con
   `stage:'allowlist'`. Nunca "vacío = todos".
4. El token no aparece en logs ni en respuestas. Solo largo y prefijo.
5. El JWT se trata como opaco: no se decodifica para autorizar. La autoridad es la
   respuesta de Atlas.
6. Reportas la **forma cruda** que devolvió Atlas (`responseShapeKeys`), no la asumida.
   Si difiere del Contrato C, es un hallazgo para T0, no un fix tuyo: **para y reporta.**
7. Tests con reporte de mutación. Separa explícitamente los que nacieron verdes de los
   que viste fallar. Incluye el test de allowlist vacía.
8. `npx tsc --noEmit` y `yarn lint` limpios en tus archivos.

---

## 6. Sección T2 — dominio página de aterrizaje

Construir la página que recibe el `postMessage` y el simulador que permite probar sin
Crazy Cake.

**Archivos tuyos:**
```
src/app/auth/page.tsx · src/app/auth/client.tsx   nuevo (patrón MVC del repo)
src/app/auth/route.ts                             BORRAR (conflicto con page)
src/app/dev/atlas-simulator/**                    nuevo, solo NODE_ENV≠production
tests de componente                               nuevo
```

**Patrón obligatorio del repo** (`CLAUDE.md`): `page.tsx` es el controlador server,
`client.tsx` es la vista `'use client'`. UI con MUI. Código y UI en inglés.
Ver `src/app/login/{page,client}.tsx` como referencia del patrón.

**Dos requisitos que evitan un falso negativo.** Si los omites, un SSO que sí funciona
se va a ver como roto:

1. **El listener se registra antes del primer paint** y bufferea lo que llegue. Console
   abre la ventana y postea; si montamos después, el mensaje se pierde. La propia tabla
   de debugging de Crazy Cake lo advierte: _"No recibe postMessage → Listener no activo →
   Verificar que el listener esté antes de que Console envíe"_.
2. **Señal `PROMOTE_READY` al `window.opener`**, posteada contra cada origen permitido,
   para que Console pueda esperarnos. Más un **timeout visible**: "no llegó ningún
   postMessage en N segundos" es un resultado distinto de "llegó y falló", y hay que
   poder distinguirlos en pantalla.

**Validación de origen:** contra la lista de `NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS`. Sin
comodines. Nunca reflejes `event.origin`. Un origen no permitido se rechaza y **se
muestra en el panel** (es información diagnóstica valiosa).

**El panel muestra:** origen recibido · tipo de evento · token presente sí/no con largo
y prefijo (**nunca el token completo**) · partner `{name, email}` · el resultado de
llamar al Contrato A · y el stage si falló.

**El simulador** (`/dev/atlas-simulator`) abre `/auth` en ventana nueva y postea un
`ATLAS_AUTH` sintético. Es lo que te permite cerrar tu DoD sin depender de Crazy Cake ni
de que T1 haya terminado. Debe estar inaccesible en producción.

**DoD:**
1. `/auth` renderiza el panel y deja de responder 404.
2. `route.ts` borrado; no hay conflicto de rutas (`yarn build` pasa).
3. Listener pre-paint + buffer + señal READY + timeout distinguible.
4. Origen no permitido ⇒ rechazado y visible.
5. El token completo no se renderiza, no se loguea en consola, no va a ningún atributo
   del DOM.
6. Simulador funciona en dev y no existe en producción.
7. Tests con reporte de mutación, separando nacidos-verdes de vistos-fallar.
8. `npx tsc --noEmit` y `yarn lint` limpios en tus archivos.

---

## 7. Idioma

Código, comentarios, UI y logs en **inglés** (regla del repo, `CLAUDE.md`).
Los reportes a T0, en español neutro.
