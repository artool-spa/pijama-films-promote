# STATUS — SSO Atlas Console → promote.pijamafilms.com

_Última actualización: 2026-08-26 · Actualizado por: T0_

## Estado actual

Paso 2 completo: **integración verificada por T0**. Ambos dominios entregados y mergeados
sin conflicto; 443/443 tests; smoke por el ensamblador real contra Atlas, sin fakes.
Falta solo el click-through de JP con su token, que es lo único que cierra el Contrato C.

_Historia previa:_ Paso 1. **T1 nunca se cayó** — corrección importante, ver el log de hitos.
Sigue siendo el dueño del dominio servidor y ya entregó código + 912 líneas de tests
(`9b56405`, 50 casos, pusheado). **T1b pasa de relevo a auditor puro**, en worktree
propio y sin escribir en la rama de T1. **T2 en vuelo** con `793a88f`.

**Burndown:** 0/2 dominios entregados · 0/3 contratos validados · Contrato C es el riesgo.

---

## Equipo

| Agente | Dominio | Estado | Tarea actual | Bloqueado por |
|--------|---------|--------|--------------|---------------|
| T1 | Servidor Atlas | ✅ Cerrado | `cd37eab` + **114 líneas sin commitear**. F1 ✅ `no_partner` ✅ `disabled` ✅. Falta F2 (test middleware), F3, rate limit, commit | — |
| T1b | Auditor + guard/rate-limit | ✅ Cerrado | Auditoría del servidor ✅ (3 hallazgos, 41→16/18 mutantes). Ahora audita el dominio de T2 | — |
| T2 | Página `/auth` + simulador | 🟡 Un ítem | `793a88f` entregado; escribiendo tests | — |

_Estados: ⚪ Pendiente · 🟡 En progreso · 🔴 Bloqueado · ✅ Listo_

Sin dependencias bloqueantes entre ellos: T0 fijó el Contrato A por adelantado y los
archivos son disjuntos.

---

## Contratos

| Contrato | Productor | Consumidor | Estado |
|----------|-----------|------------|--------|
| A — `POST /api/auth/atlas/session` | T1 | T2 | ✅ **Validado por T0 con medición end-to-end**. 8 stages |
| B — envelope `postMessage` | Crazy Cake | T2 | 🟡 Documentado, no observado. Origen objetivo: **producción** |
| C — `GET /movies/by-partner` | Crazy Cake | T1 | 🔴 **No verificado — dos contradicciones medidas** |
| D — simulador inaccesible en producción | T1 (capa 1) + T2 (capa 2) | — | ✅ Dos capas, ambas con test |

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

- [x] DoD de T1 completo
- [ ] DoD de T2 completo
- [ ] Suite verde con reporte de mutación (nacidos-verdes vs vistos-fallar)
- [x] Build propio de T0 en el HEAD real: `tsc` + `lint` + `test` — **443/443**
- [x] Smoke sin fakes en las fronteras del `contracts.md` — 7 pruebas medidas
- [x] `/auth` deja de responder 404 — **200 medido**
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

_Nuevas de esta ronda (todas de T0, dentro de su mandato de dueño de contratos):_

| # | Decisión | Razón |
|---|---|---|
| 8 | `stage:'no_partner'` agregado al Contrato A | "Autentica pero no es partner" no es contrato roto. Caso más probable en la primera prueba: la cuenta es admin |
| 9 | `PUBLIC_ROUTES` recibe el path exacto `/dev/atlas-simulator`, **no** el prefijo `/dev/` | Mínimo privilegio. El prefijo publicaría cualquier ruta futura bajo `/dev/` |
| 10 | El simulador se queda en `/dev/atlas-simulator` | Mover a `/auth/simulator` ensucia el segmento que Crazy Cake tiene configurado |
| 11 | `/auth` en modo `login` rechazado ⇒ corre el probe **automáticamente** | JP prueba una sola vez; el diagnóstico no puede quedar detrás de un click opcional |
| 12 | La concesión de origen en dev debe anunciarse **visiblemente** en el panel | Un verde que llega por allowlist ensanchada no prueba la allowlist real |


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
- 2026-08-26: llegó una notificación del sistema diciendo que T1 había caído
  ("failed / Connection lost mid-response"). **T0 la tomó como hecho sin verificarla
  contra el proceso** y relevó a T1 con un agente fresco en su mismo worktree.
- 2026-08-26: **T1b escaló el error en vez de trabajar encima.** Evidencia medida: PID
  18756 vivo con 12% de CPU, y un archivo de test aparecido *después* de que T1b
  arrancara. T0 verificó y lo confirmó: T1 nunca murió, solo se cortó una respuesta.
  Orden de stand down revertida; T1 recuperado como dueño del dominio; T1b reasignado a
  auditor puro con worktree propio. **Sin pérdida de trabajo y sin colisión.**
- 2026-08-26: T0 verificó por grep cinco invariantes del código heredado (doble chequeo
  fail-closed, 7 `stage`, token solo como largo+prefijo, `probe` con retorno temprano
  antes de la cookie, prefijo en `PUBLIC_ROUTES`). **Verificación parcial, no
  exhaustiva** — T1b tiene orden de confirmarla y de desmentirla si corresponde.

---

## Lecciones / gotchas (materia prima del cierre compound)

- **El cruce de mensajes va en las DOS direcciones, y la que sobreestima es la conocida.**
  Ya habíamos visto un reporte que sonaba a cierre sobre trabajo viejo. Esta vez pasó lo
  inverso: T1 declaró "DoD cerrado, working tree limpio" y el árbol tenía **más** que el
  reporte — los cinco arreglos aplicados y 114 líneas sin commitear. Un informe que
  **subestima** el avance es igual de peligroso: lleva a re-despachar trabajo ya hecho, y
  deja sin cubrir lo que de verdad falta. La única lectura confiable del avance es el
  árbol; el informe solo dice qué creía el agente cuando lo escribió.
  _(candidato: cuerpo de skill de T0)_
- **Un agente puede irse a idle con trabajo sin commitear, y el idle se lee como "terminó".**
  T1 aplicó 114 líneas de arreglos y se declaró disponible sin commitear. La instrucción
  "commitea apenas la feature esté lista" no basta por sí sola: hay que **verificar
  `git status` en cada reporte de cierre**, porque "hecho sin commitear" y "a medias" son
  el mismo estado visto desde afuera.
  _(candidato: cuerpo de skill de T0)_
- **Tres veces el mismo patrón en un solo proyecto: la protección existe, funciona, y
  ningún test se entera si desaparece.** (1) Quitar `/api/auth/atlas/` de `PUBLIC_ROUTES`
  deja la suite verde y mata todo el SSO con un 401 que no menciona al middleware.
  (2) Volver `partnerId` opcional deja la suite verde. (3) Vaciar `PUBLIC_EXACT_ROUTES`
  deja la suite verde, y con ella la única garantía de que el simulador no sea alcanzable
  en producción. En los tres casos el mecanismo defensivo estaba bien construido; lo que
  faltaba era la prueba de que alguna vez atrapa algo. **Al revisar un dominio, la pregunta
  no es "¿existe la protección?" sino "¿qué se pone rojo si la borro?".**
  _(candidato: cuerpo de skill de T0 — alta prioridad)_
- **Un contrato entre dominios puede nacer de un cambio que ninguno de los dos agentes ve
  completo.** T1 publicó en el middleware una ruta cuya página vive en la rama de T2, y no
  existe en su worktree. T1 no violó su scope —`middleware.ts` es su archivo— pero el
  efecto cruzó, y solo T0 tenía las dos mitades a la vista. Cuando un cambio dentro de un
  scope produce efecto en otro dominio, **formalizarlo como contrato con dos dueños** es lo
  que impide que alguien retire una capa creyendo que la otra la cubre.
  _(candidato: cuerpo de skill de T0)_
- **Una instrucción de T0 puede ser semánticamente incoherente y el agente puede corregirla
  bien.** Pedí "agrega el path exacto a `PUBLIC_ROUTES`" sobre una lista matcheada con
  `startsWith`: la instrucción, aplicada literal, no habría hecho lo que decía. T1 creó una
  lista separada con match exacto y documentó por qué. Es la cláusula de "reportar la
  frontera es preferible a cruzarla" funcionando en su variante silenciosa: no escaló, hizo
  lo correcto y lo explicó en el código. Vale registrarlo como evidencia de que la cláusula
  se paga sola.
  _(candidato: cuerpo de skill de domain-agent)_

- **Un agente que se cae por error de conexión no corrompe el árbol, pero la instrucción
  de "pushea desde el primer commit" es lo que hace que eso sea verdad.** T1 murió a mitad
  de respuesta y no se perdió una línea porque tenía orden de commitear apenas cada pieza
  estuviera lista. El costo de la instrucción es cero; el de omitirla es todo el trabajo.
  _(candidato: ya está en el cuerpo de la skill, confirma su valor)_
- **Una notificación de "agente caído" NO es evidencia de que el agente murió, y T0 la
  trató como tal.** El aviso decía "failed · Connection lost mid-response": eso describe
  una **respuesta** cortada, no un **proceso** terminado. El agente siguió corriendo,
  escribiendo archivos y commiteando durante los 15 minutos en que T0 lo daba por muerto.
  El costo estuvo a punto de ser doble: dos agentes escribiendo los mismos archivos en el
  mismo worktree, y un `kill` sobre un proceso productivo con 32 KB sin commitear.
  **Un `ps -p <pid>` cuesta un segundo y responde la pregunta de verdad.** Es la misma
  regla que T0 ya aplica al código —verifica el árbol, no el mensaje— y que aquí aplicó al
  revés porque el mensaje venía del sistema y no de un agente.
  _(candidato: cuerpo de skill de T0 — alta prioridad)_
- **"Working tree limpio" caduca.** T0 lo midió y fue verdad; después repitió la
  afirmación como si describiera el presente, cuando el agente ya había escrito 32 KB sin
  commitear. Una medición de estado mutable lleva timestamp implícito: al repetirla, hay
  que re-medirla o fecharla.
  _(candidato: cuerpo de skill de T0)_
- **El escalamiento de un subagente vale más cuando contradice al coordinador.** T1b tenía
  instrucción explícita de que "reportar la frontera es preferible a cruzarla" y de que una
  premisa equivocada de T0 es información valiosa. La usó, con evidencia medida y tres
  opciones. Sin esa cláusula en el spawn prompt, el resultado por defecto habría sido
  obedecer y colisionar. **La cláusula se paga sola.**
  _(candidato: cuerpo de skill de T0 y de domain-agent)_
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
