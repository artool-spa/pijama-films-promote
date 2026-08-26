# readme-T1 — Dominio Servidor Atlas

_Última actualización: 2026-08-26 · Proyecto: SSO Atlas Console → promote.pijamafilms.com_

---

## Identidad

- **Agente:** T1
- **Dominio:** Servidor Atlas — cliente HTTP hacia Atlas Console y endpoint de intercambio de sesión.
- **Scope:** `src/lib/atlas/**` (config, client, types, index + tests) y
  `POST /api/auth/atlas/session` (Contrato A). Más una línea en `src/middleware.ts` y las
  env vars nuevas en `apphosting.yaml` / `.env.example`.
- **No cubre:** `src/app/auth/**` ni el simulador (T2). `src/lib/pijama/**` es zona
  prohibida (andamiaje muerto que apunta a `api.pijamafilms.com`, NXDOMAIN; su retiro es
  follow-up). El filtrado de películas por partner en `getFilms()` está fuera de alcance
  del proyecto completo.

---

## Estado Actual

- **Repo:** `artool-spa/pijama-films-promote` · Branch: `feat/atlas-sso-server`
  (ramificada de `feat/atlas-sso`) · Worktree: `/Users/jpudev2/Proyectos/pijama-t1`
- **Deploy activo:** ninguno. Nada desplegado; App Hosting despliega desde la rama
  conectada y esta rama no lo es.
- **Suite de tests:** 75 tests propios en `src/lib/atlas/__tests__/` ✅ verdes.
  Suite completa del repo: 338 ✅. `npx tsc --noEmit` limpio, `lint` sin errores
  (4 warnings preexistentes de React hooks, ninguno en mis archivos).
- **Recursos de datos activos:** ninguno propio. El login hace upsert en `partners` vía
  `getOrCreatePartner`; el modo `probe` no escribe nada.
- **Jobs/cron activos:** no aplica.

---

## Contratos Que Me Afectan

| Contrato | Rol | Estado |
|----------|-----|--------|
| A — `POST /api/auth/atlas/session` | Productor | ✅ Implementado, ambos modos, con `stage` obligatorio en todo error |
| C — `GET {ATLAS_API_BASE_URL}/movies/by-partner` | Consumidor | 🔴 **No verificado.** Consumido a la defensiva: se reporta la forma cruda, nunca se asume la documentada |

### Interpretaciones del Contrato A que tomé (T0 las conoce)

1. **`probe` con 2xx y forma que no calza ⇒ `200 { ok:true, contractMatched:false }`**, no
   error. Es la única lectura que hace útil el campo `contractMatched` del contrato: probe
   reporta, no juzga. En `login` la misma situación es `stage:'contract'`.
2. **Non-2xx (incluido el 302 medido) ⇒ error `stage:'atlas_call'`** en ambos modos, con
   `diagnostics` adjuntos. Es lo que dice la tabla de stages del contrato.
3. **`ATLAS_LOGIN_ENABLED != 'true'` ⇒ `stage:'allowlist'`.** El enum de stages no tiene
   uno para "login apagado"; `allowlist` es la compuerta de autorización, y el `message`
   nombra la variable exacta.
4. **Atlas 2xx en forma correcta pero sin `partner` ⇒ `login` rechaza con
   `stage:'contract'`**, mensaje explícito de "cuenta admin sin partnerId". El `probe`
   del mismo caso devuelve `ok:true, contractMatched:true, partner:null` para que los
   tres resultados queden distinguibles.

### Códigos HTTP elegidos (el contrato solo fija 4xx/5xx)

| stage | HTTP |
|---|---|
| `input` | 400 |
| `allowlist` | 403 |
| `atlas_call` | 502 |
| `contract` | 502 |
| `session` | 500 |

---

## Dependencias

- **Necesito de:** nada de otro dominio para funcionar. Un **JWT real de Atlas** (lo tiene
  JP en su browser) es lo único que cierra el Contrato C, y llega por el simulador de T2.
- **Me necesitan:** T2 consume el Contrato A desde `/auth`, y `NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS`
  (que declaro en `apphosting.yaml` / `.env.example`) es lo que valida su listener.
  `getAtlasAllowedOrigins()` está exportado por si prefiere un solo parser.

---

## DoD — Estado de Avance

- [x] 1. `POST /api/auth/atlas/session` cumple el Contrato A en ambos modos.
- [x] 2. `probe` nunca emite cookie ni crea partners (test con mutación que lo prueba).
- [x] 3. `login` fail-closed: allowlist vacía o ausente ⇒ `stage:'allowlist'`. Doble
      compuerta — pre-flight antes de llamar a Atlas, y chequeo de identidad después.
- [x] 4. El token no aparece en logs, respuestas ni mensajes de error. Solo largo y prefijo.
- [x] 5. El JWT se trata como opaco: no se decodifica en ninguna parte del código.
- [x] 6. Se reporta la forma cruda (`atlasStatus`, `responseShapeKeys`, `bodyKind`).
- [x] 7. Tests con reporte de mutación (41 mutaciones, 0 sobrevivientes).
- [x] 8. `tsc --noEmit` y lint limpios.

---

## Pendientes Priorizados

1. **Correr un `probe` con un JWT real** (vía el simulador de T2, en local). Es lo único
   que cierra el Contrato C. Los tres resultados posibles ya están instrumentados.
2. **Poblar `ATLAS_LOGIN_ALLOWED_PARTNER_IDS`** con los partnerId que decida JP. Mientras
   esté vacía, `login` rechaza a todos — que es el estado correcto por defecto.
3. **Confirmar el base URL real.** `https://dashboard.pijamafilms.com` es el default, pero
   Atlas es una SPA con routing por hash y ninguna ruta candidata respondió. Si el probe
   devuelve 302, el siguiente paso es reapuntar la env var, no tocar código.

---

## Decisiones Abiertas

- **`probe` es un endpoint público sin rate limit.** Cualquiera puede pedirle que haga una
  llamada saliente a un host fijo (no hay SSRF: la URL viene de env, no del request). El
  riesgo es abuso/ruido, no filtración. Si molesta, la contención barata es gatearlo tras
  una env var como `login`, pero eso cambia el Contrato A → decide T0.
- **`movies` y `status:'ok'` son requeridos por el schema.** Un 2xx sin la key `movies`
  cuenta como mismatch y bloquea el login. Es deliberado y fail-closed: una divergencia se
  reporta, no se absorbe. Si el Atlas real omite `movies`, es hallazgo para JP.
- **`middleware.ts` sigue deprecado en Next 16** (→ `proxy.js`). Mi cambio ahí es una línea;
  la migración es follow-up aparte y no la hice.

---

## Infra

- **Identidad/cuenta de servicio:** ninguna nueva. El endpoint no usa credenciales de
  Google; llama a Atlas con el JWT que le pasa el caller.
- **Secrets relevantes:** **ninguno nuevo en Secret Manager.** Las cuatro variables son
  configuración pública (dos URLs, un booleano, una lista de partnerId). Nada que rotar.
- **Config de runtime/deploy:** App Hosting, backend `pijama-promote` (us-central1). Sin
  cambios en `runConfig`.
- **Variables de entorno clave:**

| Variable | Default committeado | Availability | Nota |
|---|---|---|---|
| `ATLAS_API_BASE_URL` | `https://dashboard.pijamafilms.com` | RUNTIME | El path `/movies/by-partner` lo concatena el código |
| `ATLAS_LOGIN_ENABLED` | `"false"` | RUNTIME | Solo el string exacto `true` habilita |
| `ATLAS_LOGIN_ALLOWED_PARTNER_IDS` | `""` | RUNTIME | Vacío = nadie. Nunca "vacío = todos" |
| `NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS` | prod, luego lab | BUILD + RUNTIME | **Se hornea en build: mergear no la activa, hace falta rollout** |

---

## Archivos Críticos

```
pijama-films-promote/
├── src/lib/atlas/config.ts                      ← env vars, allowlist fail-closed, base URL
├── src/lib/atlas/client.ts                      ← fetch a Atlas: redirect manual, timeout, redacción del token
├── src/lib/atlas/types.ts                       ← schemas Zod del Contrato C + tipos del Contrato A
├── src/lib/atlas/index.ts                       ← superficie pública del módulo
├── src/lib/atlas/__tests__/config.test.ts       ← 21 tests
├── src/lib/atlas/__tests__/client.test.ts       ← 15 tests (stub en la red, no en el módulo)
├── src/lib/atlas/__tests__/session-route.test.ts← 39 tests del endpoint
├── src/app/api/auth/atlas/session/route.ts      ← Contrato A: probe y login
├── src/middleware.ts                            ← 1 línea: '/api/auth/atlas/' en PUBLIC_ROUTES
├── apphosting.yaml                              ← 4 env vars nuevas
└── .env.example                                 ← las mismas, documentadas
```

**Dos trampas que cuestan una tarde si no se saben:**

1. **`PUBLIC_ROUTES` en `src/middleware.ts`.** El middleware gatea todo `/api/*` con la
   cookie de sesión. Sacar `/api/auth/atlas/` de esa lista hace que el endpoint responda
   401 **antes** de que corra el handler, y el 401 no menciona al middleware por ningún
   lado. `/auth` (la página de T2) ya estaba en la lista; `startsWith('/auth')` **no**
   cubre `/api/auth/...`, por eso hace falta la entrada propia.
2. **`redirect: 'manual'` en el client.** Toda ruta no autenticada de Atlas responde
   `302 → /auth/auth/logout`. Si se sigue el redirect, la respuesta llega como `200` con
   una página HTML de login: un rechazo se lee como éxito.

---

## Cómo Levantar Este Dominio Localmente

```bash
cd /Users/jpudev2/Proyectos/pijama-t1

# node_modules es un symlink al del repo principal (mismo lockfile, y está gitignoreado).
# Si no existe: ln -s /Users/jpudev2/Proyectos/pijama-films-promote/node_modules node_modules

npx vitest run src/lib/atlas/__tests__/    # 75 tests del dominio
npx tsc --noEmit
npx yarn@1.22.22 lint                      # yarn/corepack pueden no estar en el PATH

# Probe manual contra el endpoint (necesita el dev server y un JWT real):
#   ATLAS_API_BASE_URL=https://dashboard.pijamafilms.com npx yarn@1.22.22 dev
#   curl -s localhost:3000/api/auth/atlas/session \
#     -H 'content-type: application/json' \
#     -d '{"token":"<JWT>","mode":"probe"}' | jq
```

Local corre en: `localhost:3000`

### Cómo leer el resultado de un probe

| `atlasStatus` | `contractMatched` | `partner` | Significa |
|---|---|---|---|
| 200 | `true` | `{...}` | El Contrato C funciona. Siguiente paso: poblar la allowlist y probar `login`. |
| 200 | `true` | `null` | El contrato funciona pero **esta cuenta no es un partner** (cuenta admin sin `partnerId`). Hay que pedirle a JP una cuenta de productor. |
| 200 | `false` | `null` | Atlas respondió otra cosa. Mirar `responseShapeKeys` — es el hallazgo que va a Crazy Cake. |
| 302 | `false` | `null` | Token rechazado o base URL equivocado. `message` trae el destino del redirect. |
| 0 | `false` | `null` | No se llegó a Atlas: DNS, timeout, o `ATLAS_API_BASE_URL` sin configurar. |

---

## Cómo Invocarme o Reemplazarme

Lee este archivo completo + los últimos 2-3 commits del branch `feat/atlas-sso-server`.
Luego invócame con un objetivo concreto:
_"Eres T1, domain agent del servidor Atlas. Tu próxima tarea es [X]. Lee readme-T1.md y
contracts.md antes de empezar."_
