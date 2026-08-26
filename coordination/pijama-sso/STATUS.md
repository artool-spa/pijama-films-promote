# STATUS — SSO Atlas Console → promote.pijamafilms.com

_Última actualización: 2026-08-26 · Actualizado por: T0_

## Estado actual

Paso 0 completo: rama base `feat/atlas-sso` creada y pusheada, worktree de coordinación
propio, spec y contratos escritos. Perfil de stack en curso. Equipo por lanzar.

**Burndown:** 0/2 dominios entregados · 0/3 contratos validados · Contrato C es el riesgo.

---

## Equipo

| Agente | Dominio | Estado | Tarea actual | Bloqueado por |
|--------|---------|--------|--------------|---------------|
| T1 | Servidor Atlas (cliente + endpoint de intercambio) | ⚪ Pendiente | Por lanzar | — |
| T2 | Página de aterrizaje `/auth` + simulador | ⚪ Pendiente | Por lanzar | — |

_Estados: ⚪ Pendiente · 🟡 En progreso · 🔴 Bloqueado · ✅ Listo_

Sin dependencias bloqueantes entre ellos: T0 fijó el Contrato A por adelantado y los
archivos son disjuntos.

---

## Contratos

| Contrato | Productor | Consumidor | Estado |
|----------|-----------|------------|--------|
| A — `POST /api/auth/atlas/session` | T1 | T2 | 🟡 Definido por T0, sin validar |
| B — envelope `postMessage` | Crazy Cake | T2 | 🟡 Documentado, no observado |
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

1. Lanzar T1 y T2 en paralelo, cada uno en su worktree desde `feat/atlas-sso`.
2. Al primer reporte, verificar contra el árbol y no contra el mensaje.

---

## Decisiones Pendientes (para JP)

| # | Descripción | Opciones | Urgencia |
|---|-------------|----------|----------|
| — | ninguna abierta | | |

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

---

## Lecciones / gotchas (materia prima del cierre compound)

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
