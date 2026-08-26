# STATUS — SSO Atlas Console → promote.pijamafilms.com

_Última actualización: 2026-08-26 · Actualizado por: T0_

## Estado actual

Paso 1 en curso. **T1 entregó el código del dominio servidor y se cayó por error de
conexión** antes de tests y readme; su trabajo quedó commiteado y pusheado (`7577b85`,
árbol limpio, nada perdido — verificado contra el árbol, no contra su mensaje).
Relevado por **T1b**, agente fresco, con orden de auditar lo heredado como borrador
ajeno antes de continuarlo. **T2 sigue en vuelo.**

**Burndown:** 0/2 dominios entregados · 0/3 contratos validados · Contrato C es el riesgo.

---

## Equipo

| Agente | Dominio | Estado | Tarea actual | Bloqueado por |
|--------|---------|--------|--------------|---------------|
| T1 | Servidor Atlas | ⚫ Caído (conexión) | Entregó 809 líneas en `7577b85`; sin tests ni readme | — |
| T1b | Servidor Atlas (relevo) | 🟡 En progreso | Auditoría de lo heredado + tests + readme | — |
| T2 | Página de aterrizaje `/auth` + simulador | 🟡 En progreso | Página `/auth` + simulador local | — |

_Estados: ⚪ Pendiente · 🟡 En progreso · 🔴 Bloqueado · ✅ Listo_

Sin dependencias bloqueantes entre ellos: T0 fijó el Contrato A por adelantado y los
archivos son disjuntos.

---

## Contratos

| Contrato | Productor | Consumidor | Estado |
|----------|-----------|------------|--------|
| A — `POST /api/auth/atlas/session` | T1b | T2 | 🟡 Implementado, **sin tests que lo prueben** |
| B — envelope `postMessage` | Crazy Cake | T2 | 🟡 Documentado, no observado. Origen objetivo: **producción** |
| C — `GET /movies/by-partner` | Crazy Cake | T1 | 🔴 **No verificado — dos contradicciones medidas** |

---

## Mapa de archivos

| Archivo | Dueño |
|---|---|
| `src/lib/atlas/**` | T1 |
| `src/app/api/auth/atlas/session/route.ts` | T1 |
| `src/middleware.ts` | T1 |
| `apphosting.yaml` · `.env.example` | T1 |
| `src/app/auth/page.tsx` · `client.tsx` | T2 |
| `src/app/auth/route.ts` (borrar) | T2 |
| `src/app/dev/atlas-simulator/**` | T2 |

Sin solapamientos. `src/lib/pijama/**` es zona prohibida para ambos.

---

## DoD Global

- [ ] DoD de T1 completo
- [ ] DoD de T2 completo
- [ ] Suite verde con reporte de mutación (nacidos-verdes vs vistos-fallar)
- [ ] Build propio de T0 en el HEAD real: `tsc` + `lint` + `test`
- [ ] Smoke sin fakes en las fronteras del `contracts.md`
- [ ] `/auth` deja de responder 404 en el ambiente probado
- [ ] Click-through de JP con la cuenta del lab
- [ ] Contrato C resuelto con evidencia (aunque la evidencia sea que no calza)
- [ ] Working tree limpio
- [ ] OK de JP

---

## Próximas Asignaciones

1. Al primer reporte de cada agente: verificar **contra el árbol**, no contra el mensaje
   (pedir SHA, revisar en worktree propio).
2. Build autoritativo de T0 en el HEAD real cuando ambos entreguen: `tsc` + `lint` + `test`.
   No declarar verde por suma de reportes.
3. Coordinar el click-through de JP con la cuenta del lab.

---

## Decisiones Pendientes (para JP)

| # | Descripción | Opciones | Urgencia |
|---|-------------|----------|----------|
| 6 | La prueba del `postMessage` desde Console requiere el código en **producción** (la URL de destino la fijó Crazy Cake en enero y no acepta `localhost`). Un deploy además arrastra `STRIPE_SECRET_KEY` v3 y `META_PIXEL_ID` v2. | (a) resolver Contrato C en local y deployar solo cuando eso esté verde, (b) deployar antes para probar las dos mitades juntas | Media — no bloquea a los agentes |
| 7 | La cuenta disponible es admin, no productor. Puede no tener `partnerId`. | (a) conseguir una cuenta de productor en el dashboard, (b) aceptar que la prueba valide el mecanismo y no el scoping | Media |

---

## Decisiones Resueltas

| # | Descripción | Decisión | Fecha |
|---|-------------|----------|-------|
| 1 | Perfil de stack para este repo | Crear `artool-pijama-promote-stack` y usarlo desde el arranque | 2026-08-26 |
| 2 | Gate del login en producción | Habilitado, restringido por allowlist de `partnerId`, fail-closed | 2026-08-26 |
| 3 | Ambigüedad "lab sin películas" | El agente determina y reporta la evidencia cruda | 2026-08-26 |
| 4 | Alcance por partner en `getFilms()` | Fuera de alcance, proyecto aparte | 2026-08-26 |
| 5 | PRs #45 / #46 | Fuera de este proyecto | 2026-08-26 |

---

## Log de Hitos

- 2026-08-26: T0 sondeó producción y Atlas. Cinco hallazgos que fijan el diseño
  (sin CORS · `/auth` 404 · 302 en vez de 401 JSON · `api.pijamafilms.com` NXDOMAIN ·
  conflicto `page`/`route`).
- 2026-08-26: JP resolvió las tres decisiones de arranque. Plan aprobado.
- 2026-08-26: rama `feat/atlas-sso` creada desde `master` y pusheada.
- 2026-08-26: worktree de coordinación en `/Users/jpudev2/Proyectos/pijama-t0`.
- 2026-08-26: perfil `artool-pijama-promote` entregado como PR #13 a `artool-spa/artool-devs`.
- 2026-08-26: T1 y T2 lanzados en paralelo. Contrato A fijado por T0 e inyectado idéntico
  en ambos spawn prompts, así que ninguno espera al otro.
- 2026-08-26: **corrección de JP** — el ambiente objetivo es producción
  (`dashboard.pijamafilms.com`), no el lab, y tiene un usuario con acceso a películas.
  Despachada a T1 (default de `ATLAS_API_BASE_URL` y orden de los orígenes) y a T2
  (allowlist y prominencia del origen en el panel).
- 2026-08-26: T0 detectó que la cuenta disponible es de **administrador**, no de
  productor, y que el endpoint es scoped por partner. Agregado el tercer resultado
  posible a los diagnostics.
- 2026-08-26: despachado a T2 el atajo que resuelve el Contrato C **sin deployar**:
  el simulador acepta un token real pegado y ejercita el camino completo en local.
- 2026-08-26: T1 cayó por error de conexión. Verificación contra el árbol: commit
  `7577b85` pusheado, working tree limpio, 809 líneas en 8 archivos, la corrección a
  producción aplicada. Faltan tests y readme. Relevado por T1b (agente fresco, no
  reanimación).
- 2026-08-26: T0 verificó por grep cinco invariantes del código heredado (doble chequeo
  fail-closed, 7 `stage`, token solo como largo+prefijo, `probe` con retorno temprano
  antes de la cookie, prefijo en `PUBLIC_ROUTES`). **Verificación parcial, no
  exhaustiva** — T1b tiene orden de confirmarla y de desmentirla si corresponde.

---

## Lecciones / gotchas (materia prima del cierre compound)

- **Un agente que se cae por error de conexión no corrompe el árbol, pero la instrucción
  de "pushea desde el primer commit" es lo que hace que eso sea verdad.** T1 murió a mitad
  de respuesta y no se perdió una línea porque tenía orden de commitear apenas cada pieza
  estuviera lista. El costo de la instrucción es cero; el de omitirla es todo el trabajo.
  _(candidato: ya está en el cuerpo de la skill, confirma su valor)_
- **Un cuelgue deja el DoD parcial de forma asimétrica: entrega el código y se come los
  tests.** Los tests van al final, así que son lo primero que se pierde. Al relevar, el
  estado "código sin tests" se ve idéntico a "código listo" en un `git log`. Verificar el
  DoD por artefacto (¿existe `__tests__/`? ¿existe el readme?) y no por el commit.
  _(candidato: cuerpo de skill de T0)_

- **Un stub que devuelve 404 se ve igual que una ruta inexistente.** `src/app/auth/route.ts`
  logueaba y devolvía 404; desde afuera —y desde una auditoría de rutas que busca
  `page.tsx`— parecía que no existía nada. Buscar solo `page.tsx` al inventariar rutas de
  App Router omite los route handlers. _(candidato: cuerpo de skill o perfil)_
- **Un endpoint documentado con contrato JSON puede estar servido por una SPA que redirige.**
  Las sondas sin credenciales no distinguen "no existe" de "no autenticado" cuando el
  catch-all responde 302. Antes de concluir que un endpoint no existe, hay que probar con
  credencial válida. _(candidato: cuerpo de skill)_
- **Ausencia de CORS invalida un diseño cliente completo, y no se ve leyendo la documentación.**
  El documento de integración traía código de `fetch` desde el navegador que no puede
  funcionar. Un preflight con `curl` cuesta segundos y descarta media arquitectura.
  _(candidato: cuerpo de skill)_
