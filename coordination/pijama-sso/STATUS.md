# STATUS — SSO Atlas Console → promote.pijamafilms.com

_Última actualización: 2026-08-26 · Actualizado por: T0_

## Estado actual

**Proyecto cerrado en contenido.** Los dos dominios entregados, integrados y verificados por
T0 con build autoritativo. Falta únicamente el click-through humano, que cierra el Contrato C.

```
rama feat/atlas-sso · commit 41438cf · next 16.3.1
tsc --noEmit   exit 0
eslint         0 errores (4 warnings preexistentes)
vitest         504/504 · 39 archivos   (el repo tenía 263)
yarn build     ✓ compiled · 37/37 páginas
               ƒ /auth · ƒ /dev/atlas-simulator · ƒ /api/auth/atlas/session
```

30 archivos, 6.903 inserciones sobre `master`. Contrato D con sus dos capas presentes.
`ATLAS_LOGIN_ENABLED="false"` y allowlist vacía commiteados: producción arranca cerrada.

Mutación acumulada del proyecto: **T1** 64 propios + 6 externos · **T2** 109 con 107 muertos
· **T1b** 23 + 6 · los supervivientes, todos identificados como equivalentes.

---

## Equipo

| Agente | Dominio | Estado | Tarea actual | Bloqueado por |
|--------|---------|--------|--------------|---------------|
| T1 | Servidor Atlas | ✅ Cerrado | `cd37eab` + **114 líneas sin commitear**. F1 ✅ `no_partner` ✅ `disabled` ✅. Falta F2 (test middleware), F3, rate limit, commit | — |
| T1b | Auditor + guard/rate-limit | ✅ Cerrado | Auditoría del servidor ✅ (3 hallazgos, 41→16/18 mutantes). Ahora audita el dominio de T2 | — |
| T2 | Página `/auth` + simulador | ✅ Cerrado | 7 ítems de auditoría; los 4 mutantes vivos están en los dos `page.tsx` | — | `793a88f` entregado; escribiendo tests | — |

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

- **Un mutante que MATA también es una pregunta, si cambió más de una cosa.** Es el caso
  simétrico de "un mutante que sobrevive es una pregunta", y el que efectivamente mordió.
  T2 archivó un mutante como agujero real; descompuesto resultó que **las dos mitades son
  equivalentes por separado** —mover el `scrub` una línea antes: 0 rojos; leer el token de
  `message.payload` en vez de la copia de Zod: 0 rojos— y solo la conjunción produce el
  fallo. Verificado por T0 con las dos mitades aisladas: 504/504 en ambas. Le atribuyó la
  muerte a la mitad equivocada y escribió ese modelo causal falso en un comentario.
  **La disciplina que faltaba es barata: un mutante, un cambio.** Si el parche toca dos
  cosas, correr las mitades por separado **antes** de escribir el porqué.
  Agravante que vale registrar: T2 formuló la regla de los mutantes compuestos dos secciones
  más arriba del mismo documento en que violó su caso simétrico. **Escribir la regla no
  protege de su punto ciego.**
  _(candidato: cuerpo de skill de domain-agent — alta prioridad)_
- **T0 confundió a dos auditores con nombres parecidos y atribuyó mal cuatro hallazgos.**
  Tercer error de atribución del proyecto. La auditoría del dominio de la página —los cuatro
  mutantes vivos en los dos `page.tsx` sin cobertura, y la contradicción entre el copy del
  simulador y el flujo documentado— fue de **T1b**, no de T2b. El propio T2b la rechazó:
  *"acabo de pasar la sesión insistiendo en la procedencia; aceptar en silencio dos hallazgos
  ajenos volvería falso justo el registro que estuve cuidando."* **Atribuir contra el
  artefacto (el mensaje, el commit), no contra la memoria de quién estaba asignado a qué.**
  _(candidato: cuerpo de skill de T0)_

- **El MISMO test puede ponerse rojo por la propiedad con un mutante y por setup roto con
  otro — y la tabla mutante→test los muestra idénticos.** Hallazgo de T1b/T2b, y es el
  avance metodológico del proyecto. El test *"no queda token en el global"* aparecía rojo
  bajo tres mutantes: con el compuesto M6+M7 moría **por la propiedad** (`expected … not to
  contain 'SECRET-PAYLOAD'`), y con M1/M3 moría por `Unable to find an element with the text
  'Probe succeeded'` — o sea el token se destruía antes, Zod rechazaba el envelope, la sonda
  nunca corría y el `await` reventaba antes de llegar a la aserción. **Contar esos rojos
  como cobertura infla el número sin mentir en ninguna cifra.** Ya sabíamos que "un rojo por
  la razón equivocada es peor que ningún test"; lo nuevo es que un test legítimo puede
  producir las dos clases de rojo, así que el reporte de mutación **tiene que leer el mensaje
  de fallo**, no solo el conteo.
  _(candidato: cuerpo de skill de domain-agent — alta prioridad)_
- **Un mutante suelto que sobrevive no es un veredicto, es una pregunta.** Formulación de
  T2. Puede ser un hueco, un mutante equivalente, o redundancia deliberada, y las tres se
  ven idénticas en la tabla. La segunda pasada es barata: si sospechas redundancia, muta las
  dos compuertas juntas; si sigue verde, ahí sí es hueco. En un solo dominio los tres casos
  aparecieron y resultaron cosas distintas: un mutante inválido, código doblemente protegido
  por accidente, y un agujero real.
  _(candidato: cuerpo de skill de domain-agent — alta prioridad)_
- **Una justificación falsa en un commit o un comentario sobrevive al código que describe.**
  Un commit afirmaba que mover el scrub una línea antes habría dejado un botón posteando un
  token vacío. T2b lo refutó y T0 lo verificó: el mutante es **equivalente** (504/504 verdes)
  porque el consumidor lee la copia de Zod, no el payload — y el propio código lo explicaba
  tres líneas antes. El test ganado era válido; el **porqué** escrito era falso. El mensaje
  del commit ya no se arregla sin reescribir historia; el comentario sí. **La cobertura y su
  explicación se verifican por separado.**
  _(candidato: cuerpo de skill de domain-agent)_
- **Un auditor que declara qué NO verificó vale más que uno que entrega un total.** T2b
  reportó explícitamente que los `104 mutantes / 102 muertos` de T2 no los revisó uno por
  uno, y verificó solo los 10 que cubrían lo listado como el corazón de la tarea. Sin esa
  declaración, T0 habría tratado el total ajeno como verificado de forma independiente
  cuando no lo estaba.
  _(candidato: cuerpo de skill de T0)_

- **Una orden no prueba obediencia, igual que una notificación no prueba muerte.** T0
  mandó un stand down y trató el mensaje como si hubiera detenido el proceso; lanzó un
  relevo en el mismo worktree y estuvo a un `git add -A` de que una mutación temporal en el
  dominio de otro agente entrara pusheada dentro de un commit ajeno con mensaje impecable.
  Es la **versión inversa** del error que T0 ya había diagnosticado en esta misma sesión
  (tomar un "failed" como prueba de muerte). Las dos veces la respuesta era `ps -p <pid>`.
  _(candidato: cuerpo de skill de T0 — alta prioridad)_
- **Un árbol sucio no es evidencia de nada por sí solo.** Formulación del propio agente:
  *"un agente que está trabajando tiene el árbol sucio por definición; eso no distingue
  'trabajando' de 'abandonado'."* T0 concluyó tres veces "no cierra el loop" a partir de
  instantáneas tomadas **durante** el turno del agente; la reconstrucción por timestamps
  mostró commits cada 2–5 minutos y cada estado sucio commiteado en los 2 minutos
  siguientes. **Lo que distingue es comparar dos lecturas separadas en el tiempo, o
  preguntarle al agente — cuesta un tool call.** El diagnóstico previo de T0 ("faltó el
  SHA") era incompleto: el SHA ayuda, pero el problema de fondo es que la señal no
  discrimina.
  _(candidato: cuerpo de skill de T0 — alta prioridad)_
- **Atribuir una disciplina que no existe deja el riesgo sin mitigar.** T0 felicitó a un
  agente por stagear rutas explícitas; el agente corrigió que usaba `git add -A` y que el
  commit salió limpio solo porque su arnés de mutación restauraba el archivo de inmediato.
  Su razón para insistir es la lección: *si el coordinador cree que la disciplina ya
  existía, la regla nueva queda como formalización de algo presente en vez de un cambio de
  comportamiento.* Verificar el mecanismo antes de dar crédito por él.
  _(candidato: cuerpo de skill de T0)_
- **Un mutante suelto que sobrevive puede significar redundancia deliberada, no un hueco —
  y la mutación compuesta es lo que los distingue.** Apareció dos veces: los cuatro casos
  de allowlist del servidor no morían con una sola compuerta mutada porque la otra los
  atrapaba, y la propiedad "no queda token en el global" necesitaba romper el scrub **y**
  el vaciado del buffer a la vez. Formulación del agente: *"un test que solo muere con un
  mutante compuesto es un test que estaba defendiendo una conjunción sin que yo lo hubiera
  notado."* Quien mida "un mutante, un test" lee redundancia y hueco como el mismo
  resultado.
  _(candidato: cuerpo de skill de domain-agent — alta prioridad)_
- **Nunca `git add -A` ni `git commit -a` en un repo con agentes en paralelo.** Rutas
  explícitas siempre. El modo de falla es silencioso: un archivo de otro dominio viajando
  dentro de un commit cuyo mensaje habla de otra cosa.
  _(candidato: cuerpo de skill de domain-agent)_

- **Una medición de estado móvil caduca entre razonarla y despacharla, y T0 la trató como
  válida indefinidamente — dos veces.** Primero con "working tree limpio", después con el
  SHA de la rama: leí `593b8c1` como HEAD (correcto en ese instante) y despaché sobre esa
  lectura minutos más tarde, cuando la rama ya iba dos commits adelante. Los dos agentes
  receptores lo atraparon con un `git log --oneline -3` antes de escribir.
  **Regla:** el `git log` va inmediatamente antes de redactar el mensaje, no antes de
  razonarlo; y si el mensaje cita un commit, lleva SHA y hora de lectura, de modo que la
  instrucción **se invalide sola** cuando el receptor esté más adelante. Que el agente
  receptor tenga que atraparlo es descargarle un trabajo del coordinador.
  _(candidato: cuerpo de skill de T0 — alta prioridad)_
- **T0 atribuyó a un agente el trabajo de otro, y el error nació de su propio despacho.**
  Asigné el guard a T1b; lo entregó T1 en `d0f1a2c`; vi el commit, leí la implementación, la
  elogié — y se la atribuí a T1b porque venía de mi orden. El crédito prestado corrompe el
  registro y también el juicio: por un rato creí que T1 había ignorado una instrucción que
  en realidad había ejecutado mejor de lo pedido. **Verificar autoría contra el commit, no
  contra el despacho.**
  _(candidato: cuerpo de skill de T0)_
- **Los controladores server se quedan sin tests y ahí viven las defensas de producción.**
  En el dominio de la página, los 4 mutantes sobrevivientes estaban **todos** en los dos
  `page.tsx`, y ningún test importaba ninguno de los dos. El agente cubrió a fondo sus
  módulos puros y su componente cliente — lo testeable sin fricción — y dejó descubierto
  justo donde estaban los dos guards de `NODE_ENV` y el cableado del script pre-paint.
  **Al auditar un dominio de Next, preguntar explícitamente qué tests importan los
  `page.tsx`.**
  _(candidato: perfil de stack `artool-pijama-promote`)_
- **El copy de una pantalla puede documentar el procedimiento equivocado y nadie lo nota
  porque no es código.** El simulador rotulaba su campo como *"Token (synthetic)"* bajo un
  banner que decía que el intercambio *debe* fallar contra el Atlas real — y ese campo es
  exactamente donde el humano pega un JWT de producción, según el flujo escrito en
  `contracts.md`. Ningún test podía atraparlo: el defecto era la contradicción entre dos
  documentos. Lo encontró un auditor leyendo la pantalla y el contrato juntos.
  _(candidato: cuerpo de skill de domain-agent)_

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

---

## 2026-08-28 · Preparación de la Parte A + hallazgo de auto-deploy

**Rama lista.** `feat/atlas-sso` en `5e3a6a3`: merge de `origin/master` para traer el fix #47.
Verificado con build propio en ese HEAD (no por suma de reportes): `tsc --noEmit` limpio,
**507/507 tests** en 40 archivos. Pusheada.

**Por qué el merge no era opcional.** El dev local apunta a `FIREBASE_PROJECT_ID=pijama-promote-firebase`
— o sea la **Firestore de producción**. Correr la prueba en una rama sin `f839ac5` y tocar
cualquier ruta de películas dejaba a `syncMuviAssets` re-escribiendo los documentos
`Video Principal` que se purgaron esta mañana. La rama sin el fix era un riesgo activo, no
una deuda.

**Hazard encontrado y cerrado:** había un `next dev` levantado hacía **3 días 18 horas** (PID
85728) en el checkout principal, con `master` local en `bca7174` — atrasado respecto del fix.
Detenido. Verificado antes de tocar nada que la purga aguanta: consulta de collection group
por `name == 'Video Principal'` devuelve **0 documentos**.

**Lección para el registro:** un dev server viejo es un despliegue silencioso de código viejo
contra datos reales. El árbol dice `master`; el proceso sirve lo que cargó hace tres días.
Al terminar un incidente hay que preguntarse qué procesos quedaron corriendo con el código de
antes, no solo qué ramas quedaron atrasadas.

**`.env` local:** agregadas las cuatro variables de Atlas (todas configuración pública). Los
nombres se verificaron contra `grep process.env.*ATLAS` en el código, no contra el runbook.

### Auto-deploy de App Hosting — la consola miente

El campo "Rama activa (para lanzamientos)" muestra `master`; `v1`, `v1beta` y `v1alpha`
coinciden en que `codebase` **no tiene campo `branch`**, y `gcloud builds triggers list` está
vacío. La consola pre-rellena el default branch como sugerencia. Registrado en el issue #52
con el comando que falta. **El PATCH quedó bloqueado por el clasificador de auto mode**: se
escaló a JP en vez de buscarle la vuelta.

Consecuencia escalada, no resuelta: con auto-rollout activo, mergear a `master` despliega. Eso
cambia la naturaleza de tres merges pendientes (SSO, #45, #46).

### CORRECCIÓN — el auto-deploy sí estaba configurado

Lo escrito arriba está mal. JP objetó con la pestaña "Lanzamientos" y la medición le dio razón:

```
GET .../backends/pijama-promote/traffic
"rolloutPolicy": { "codebaseBranch": "master" }      creado 2026-08-17, sin `disabled`
```

Mis dos evidencias eran no-hallazgos. El schema `Codebase` **no tiene** campo `branch` en
ninguna versión de la API —su ausencia no significaba nada— y App Hosting no usa triggers de
Cloud Build, así que la lista vacía era lo normal. Consulté el único recurso donde mi hipótesis
podía parecer confirmada y leí un schema incompleto como configuración faltante.

El historial lo prueba: nueve builds `AUTOMATICO (git push) rama=master`. El merge del #47 se
desplegó solo a las 14:54; el rollout manual de las 15:20 fue redundante. El `CLAUDE.md`
estaba correcto. Issue #52 cerrado como inválido.

**El gap real, que mi diagnóstico falso tapaba** (issue #53): auto-rollout responde a pushes,
no a Secret Manager, y Cloud Run fija la versión del secreto en build time. La clave live de
Stripe (v3, creada 08-24 22:14) quedó inerte 3 días 16 horas porque nadie mergeó nada. Se
activó de rebote con el merge del #47.

**Lección, y es la que importa:** una explicación falsa que cierra el caso es peor que ninguna,
porque detiene la búsqueda. "No había auto-rollout" explicaba Stripe de forma satisfactoria y
por eso dejé de preguntar. La objeción del usuario contra la pantalla fue lo que lo destapó —
cuando el usuario contradice una medición mía, la consulta correcta es al sistema, no a mi
razonamiento.
