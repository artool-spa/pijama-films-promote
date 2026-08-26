# readme-T1 — Dominio Servidor Atlas

_Última actualización: 2026-08-26 (rev. 3: + rate limit, guard de producción del simulador, no_partner 422) · Proyecto: SSO Atlas Console → promote.pijamafilms.com_

---

## Identidad

- **Agente:** T1
- **Dominio:** Servidor Atlas — cliente HTTP hacia Atlas Console y endpoint de intercambio de sesión.
- **Scope:** `src/lib/atlas/**` (config, client, types, index + tests) y
  `POST /api/auth/atlas/session` (Contrato A). Más dos cambios en `src/middleware.ts` y las
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
- **Suite de tests:** 115 tests propios en `src/lib/atlas/__tests__/` ✅ verdes.
  Suite completa del repo: 378 ✅. `npx tsc --noEmit` limpio, `lint` sin errores
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

### Taxonomía de `stage` (7 stages, fijada por T0)

```
'input' | 'rate_limited' | 'atlas_call' | 'contract' | 'no_partner' | 'disabled' | 'allowlist' | 'session'
```

Los tres stages de autorización están separados a propósito, porque tienen **tres
siguientes-pasos distintos**:

| stage | HTTP | Significa | Qué hace el que lo lee |
|---|---|---|---|
| `input` | 400 | El body no pasó Zod | Arreglar al caller |
| `rate_limited` | 429 | El caller pasó su presupuesto por ventana | Esperar el `Retry-After` |
| `atlas_call` | 502 | Atlas inalcanzable (probe) · Atlas no respondió 2xx (login) | Revisar `ATLAS_API_BASE_URL`, red, DNS |
| `contract` | 502 | Atlas respondió 2xx pero la forma no calza | **Hallazgo para Crazy Cake** |
| `no_partner` | 422 | Atlas autenticó bien, pero la cuenta no tiene partner asociado | **Pedirle a JP una cuenta de productor**, no es contrato roto |
| `disabled` | 403 | `ATLAS_LOGIN_ENABLED` no es `'true'` | Encender la env var |
| `allowlist` | 403 | El `partnerId` no está en la lista | Agregar el id a la lista |
| `session` | 500 | Falló el upsert del partner o la cookie | Mirar Firestore / logs |

### Política de status en modo `probe` — "una sonda reporta, no juzga"

| Situación | HTTP | Respuesta |
|---|---|---|
| Atlas produjo **cualquier** respuesta HTTP (200, 302, 401, 500…) | **200** | `ok:true` con `atlasStatus` real |
| Body de request inválido | 400 | `stage:'input'` |
| Atlas **no** produjo respuesta HTTP (DNS, timeout, sin base URL) | 502 | `stage:'atlas_call'` |

O sea: en `probe`, `atlas_call` significa únicamente **inalcanzable**. El 302 —el único
comportamiento jamás medido contra el Atlas real— es un resultado perfectamente
reportable. Si el probe lo respondiera con 502, la primera prueba con el token de JP
se leería como "falló" cuando en realidad midió algo, y los diagnostics quedarían
enterrados dentro de un envelope de error. Ese es exactamente el falso negativo que este
proyecto existe para evitar.

**El modo `login` no cambia**: ahí un non-2xx sigue siendo `stage:'atlas_call'` con 502,
porque login sí tiene que juzgar. Y `contractMatched` solo puede ser `true` si Atlas
respondió 2xx: un body con forma documentada colgando de un 302 no es una respuesta
usable.

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
- [x] 7. Tests con reporte de mutación (64 mutaciones propias, 0 sobrevivientes).
- [x] 8. `tsc --noEmit` y lint limpios.
- [x] 9. F1 — el token no escapa por `redirectedTo` (corte en `?` **y** `#`, más redacción
      de lo que siga con forma de JWT).
- [x] 10. F2 — test de `middleware.ts`: sacar `/api/auth/atlas/` dejaba la suite verde
      con el SSO muerto en 401.
- [x] 11. F3 — un caso por campo faltante del partner; el caso único anterior pasaba por
      la razón equivocada.
- [x] 12. `stage:'no_partner'`, `stage:'disabled'`, y `/dev/atlas-simulator` en el
      matcher exacto de `PUBLIC_ROUTES`.
- [x] 13. Rate limit del endpoint (`stage:'rate_limited'`, 429 + `Retry-After`), patrón de
      la casa de `src/lib/meta/preview-cache.ts`.
- [x] 14. El simulador queda fuera de producción por el guard de `NODE_ENV` en el
      middleware — la primera de las dos capas del contrato de dos dueños.

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

- **Resuelto por T0:** el endpoint público lleva rate limit (20 req/min por IP) en vez de
  quedar gateado tras otra env var — tiene que estar vivo en producción para la prueba de
  JP. Queda una pregunta abierta: el límite es **por instancia**, y App Hosting puede
  correr hasta 2 contenedores (`maxInstances: 2`), así que el techo real es 40/min. Para
  un amortiguador de ruido alcanza; si alguna vez tiene que ser una garantía, hace falta
  un contador compartido.
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
├── src/lib/atlas/rate-limit.ts                  ← ventana fija por IP; amortiguador de ruido, NO control de acceso
├── src/lib/atlas/client.ts                      ← fetch a Atlas: redirect manual, timeout, redacción del token
├── src/lib/atlas/types.ts                       ← schemas Zod del Contrato C + tipos del Contrato A
├── src/lib/atlas/index.ts                       ← superficie pública del módulo
├── src/lib/atlas/__tests__/config.test.ts       ← 21 tests
├── src/lib/atlas/__tests__/client.test.ts       ← 15 tests (stub en la red, no en el módulo)
├── src/lib/atlas/__tests__/session-route.test.ts← 51 tests del endpoint
├── src/lib/atlas/__tests__/middleware-public-routes.test.ts ← 11 tests: rutas abiertas + el simulador fuera de producción
├── src/lib/atlas/__tests__/rate-limit.test.ts   ← 8 tests
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
3. **`sanitizeLocation` corta en `?` y en `#`, no solo en `?`.** Atlas es una SPA con
   routing por hash, así que el fragmento es justo donde viven los parámetros de sesión.
   Un `Location: /#/auth#token=eyJ...` con corte solo en `?` metía un JWT vivo en Cloud
   Logging y en el mensaje que ve el caller. La redacción de lo que tenga forma de JWT es
   la segunda línea de defensa; el corte es la primera.
4. **`PUBLIC_EXACT_ROUTES` existe aparte de `PUBLIC_ROUTES`.** La segunda se matchea con
   `startsWith`; poner `'/dev/'` ahí publicaría toda ruta futura bajo `/dev/`. Si T2
   agrega un sub-path al simulador, necesita su propia entrada — a propósito.
5. **"El simulador es inalcanzable en producción" tiene dos capas y dos dueños.** La mía
   es el guard de `NODE_ENV` en `isPublicExactRoute`; la de T2 es el `notFound()` en
   `src/app/dev/atlas-simulator/page.tsx`. **Ninguna se saca asumiendo que la otra
   aguanta.** Hay test de las dos direcciones: público en dev, no público en producción.
6. **El rate limit es un amortiguador de ruido, no una frontera de seguridad.** La
   contención real del login es la allowlist fail-closed. `x-forwarded-for` es
   trivialmente falsificable por el cliente: por eso se usa para limitar y **nunca** para
   autorizar. Las requests no atribuibles comparten un solo bucket a propósito — si cada
   una tuviera el suyo, omitir la cabecera sería la forma de saltarse el límite.

---

## Cómo Levantar Este Dominio Localmente

```bash
cd /Users/jpudev2/Proyectos/pijama-t1

# node_modules es un symlink al del repo principal (mismo lockfile, y está gitignoreado).
# Si no existe: ln -s /Users/jpudev2/Proyectos/pijama-films-promote/node_modules node_modules

npx vitest run src/lib/atlas/__tests__/    # 115 tests del dominio
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
| 302 | `false` | `null` | Token rechazado o base URL equivocado. En `probe` esto llega como **200 `ok:true`**, no como error. |
| 0 | `false` | `null` | No se llegó a Atlas: DNS, timeout, o `ATLAS_API_BASE_URL` sin configurar. Único caso de `502 stage:'atlas_call'` en probe. |

---

## Cómo Invocarme o Reemplazarme

Lee este archivo completo + los últimos 2-3 commits del branch `feat/atlas-sso-server`.
Luego invócame con un objetivo concreto:
_"Eres T1, domain agent del servidor Atlas. Tu próxima tarea es [X]. Lee readme-T1.md y
contracts.md antes de empezar."_
