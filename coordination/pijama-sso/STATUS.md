# STATUS — SSO Atlas Console → promote.pijamafilms.com

_Última actualización: **2026-08-28** · Actualizado por: T0_

> **Cómo leer este archivo.** Esta cabecera es el estado actual y es lo único que hay que leer
> para saber dónde está el proyecto. Todo lo de abajo es **log histórico**: describe mundos que
> ya se movieron y sus filas no son el estado de hoy. Si una fila de más abajo contradice esta
> cabecera, la cabecera gana.

## Estado actual

**Nuestra mitad está completa. El proyecto está bloqueado, y el bloqueo es de Crazy Cake.**

```
rama feat/atlas-sso · commit ad97dd6 · next 16.3.1
tsc --noEmit   exit 0
vitest         584/584 · 40 archivos
```

Verificado por T0 en worktree propio sobre la integración, no por suma de reportes de agentes.
Cada fix además ejercitado **por HTTP contra un servidor corriendo**, porque los unit tests
mockean `fetch` justo en la frontera que protegen.

`ATLAS_LOGIN_ENABLED="false"` y allowlist vacía: producción arranca cerrada. **Nada desplegado.**

### Por qué está bloqueado

| # | Hecho medido | Dueño |
|---|---|---|
| 1 | `openMarketingPortal` postea con `targetOrigin = window.location.origin` — el origen **propio** de Console, no el del portal destino. El navegador descarta el mensaje. **El handoff no puede funcionar.** | Crazy Cake |
| 2 | `/partners/external-token` responde `{status:'error', error:'UNAUTHORIZED'}` a una cuenta admin. Hace falta una cuenta de **productora** para probar. | Crazy Cake / JP |
| 3 | `/movies/by-partner` está detrás de una puerta de sesión por cookie: toda llamada server-to-server recibe 302, con y sin `Bearer`. | Crazy Cake |

El punto 1 es la respuesta a la pregunta del proyecto, y es una línea de código. Explica por qué
en enero pudieron decir de buena fe que *"testing ya tiene todo para funcionar"*: el código está
escrito completo y no se probó de punta a punta ni una vez.

### Siguiente acción, y de quién

- **JP** — reconocimiento en el dashboard: ¿existe sección de partners/productoras y se puede
  crear o asignar una desde el rol admin? Eso decide autoservicio vs. correo. Y el intento
  simple: entrar con su propia cuenta y correr el snippet de `/partners/external-token`.
- **T0** — armar el correo a Mathias con los tres puntos de arriba, **cuando JP lo pida**.
- **Fuera de este alcance, sigue bloqueando el Go Live:** `getFilms()` no filtra por partner.
  La allowlist es la única contención.

## Equipo

Todos cerrados. Ninguno bloqueado. Las filas históricas del log de abajo describen estados
intermedios y no hay que leerlas como pendientes.

| Agente | Dominio | Estado |
|---|---|---|
| T1 · T1b · T2 | servidor Atlas, auditoría, página `/auth` + simulador | ✅ cerrados, mergeados |
| FX-envelope | `partner` opcional, simulador, fidelidad del ensayo | ✅ cerrado, `fc4b7e1` |
| FX-stage | `stage: input` por header-safety, `stage: config` | ✅ cerrado, `3a8f42d` + `3ff2ba2` |
| FX-envelope (rondas 4–5) | banner falso verde, y los dos overclaims de `describeAtlasOutcome` | ✅ cerrado, `ad97dd6` |

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

---

## 2026-08-28 · Cierre de la investigación del SSO: la respuesta está, y el bloqueo es de ellos

### Estado actual

`feat/atlas-sso` en **`3a8f42d`**, verificado por T0 en worktree propio sobre la integración de
las dos ramas: `tsc --noEmit` limpio, **557/557 en 40/40**. Dev server corriendo en el checkout
principal, servido desde esa rama. Nada desplegado.

### La pregunta del proyecto, respondida

**El SSO no está operativo, y el defecto que lo impide es de Crazy Cake.** Cinco hechos medidos,
cada uno reproducible:

1. `/movies/by-partner` **existe** y responde `MISSING_TOKEN` pidiendo `Bearer`. El Contrato C es
   correcto en path, base URL y mecanismo — primera confirmación real desde enero.
2. Está detrás de una **puerta de sesión por cookie**: seis combinaciones de cabeceras desde
   nuestro servidor dan 302 a `/auth/auth/logout`, con y sin `Bearer`.
3. La sesión del cliente es `console-production`, cookie `httpOnly` de `express-session`
   (`s:<sessionID>.<HMAC>`) — **no un JWT**. No hay token en el cliente que se pueda leer.
4. El token lo **emite el servidor** de Console en el handoff:
   `GET /partners/external-token` → `{ status:'ok', token }`. El emisor existe.
5. **El defecto:** `postMessage({...}, window.location.origin)`. El `targetOrigin` es el origen
   *propio* de Console, no el del portal destino, así que el navegador descarta el mensaje. Una
   línea, y explica por qué en enero pudieron decir de buena fe que "testing ya tiene todo para
   funcionar": el código está escrito completo y no se probó de punta a punta ni una vez.

Nuestra mitad quedó verificada contra el host real, sin fakes en ninguna frontera declarada.

### Lo que se arregló de nuestro lado hoy

| commit | qué |
|---|---|
| `fc4b7e1` | `partner` opcional en el Contrato B (Console no lo manda); el simulador ya no clasifica la forma real como modo de falla; el run con token real postea la forma real |
| `3a8f42d` | un token que no puede viajar en una cabecera se rechaza en `stage: 'input'`, con el valor enmascarado |

Verificado además **por HTTP contra el servidor corriendo**, no solo con unit tests —que mockean
`fetch` justo en la frontera que el fix protege: saltos de línea, TAB y `é` dan
`400 stage:"input"` nombrando el ofensor y su índice; un token opaco de una línea sigue llegando
a Atlas con `atlasStatus: 302`.

### Lecciones / gotchas

**El nombre miente antes que el código.** Cuatro veces en el mismo día, en el mismo repo: el
`CLAUDE.md` afirmando un auto-rollout que yo no verifiqué; el simulador declarando "modo de
falla" la única forma que producción manda; el `stage` culpando a Atlas por un error nuestro de
input; y un test llamado *"the same path Console uses"* cuyo payload no era el de Console. Las
cuatro veces el código hacía algo consistente — mentía la etiqueta. **Un artefacto que se
autodescribe hay que medirlo contra lo que hace, no leerlo.**

**Una explicación falsa que cierra el caso es peor que ninguna.** Concluí que no había
auto-rollout y con eso el episodio de Stripe quedaba explicado, así que dejé de buscar. La
objeción de JP contra la pantalla de la consola lo destapó, y el gap real —rotar un secreto no
despliega; Cloud Run fija la versión en build time— resultó ser otro (issue #53).

**`fetch` no es un validador.** Medido en node 26.7/undici: LF, CR y NUL hacen throw *citando el
valor completo*; TAB, espacio, DEL, VT y U+0080–U+00FF se **aceptan y se envían upstream tal
cual**. Un defecto que parecía de diagnóstico tenía dos mitades: una filtraba el token, la otra
contrabandeaba bytes a un tercero en silencio.

**`toEqual` de vitest ignora las propiedades `undefined`.** Una aserción que se ve completa deja
entrar un payload con la clave presente-pero-vacía. Se demuestra borrando la línea de
`Object.keys` y viendo el test pasar. `toStrictEqual` lo atrapa nativamente.

**Commitea antes de mutar.** Una corrida de mutación sobre un árbol sucio no mide el código que
crees. Señal de que pasó: **nombres de test que ya no existen en el output**, y **un conteo que
no cuadra**. (`git checkout -- <test>` sobre cambios sin commitear borra las ediciones.)

**Un dev server viejo es un despliegue silencioso de código viejo contra datos reales.** Había
uno de 3 días 18 horas apuntando a la Firestore de producción, en una rama sin el fix del
largometraje. Al cerrar un incidente hay que preguntarse qué **procesos** quedaron corriendo,
no solo qué ramas quedaron atrasadas.

**El estado autoritativo entre coordinador y agente es el repositorio, nunca el último
mensaje.** Tres cruces con el mismo agente en una hora, en las dos direcciones: yo midiendo un
commit que ya no era la punta, y él pidiéndome un fetch que ya había hecho. Ninguno produjo una
decisión equivocada, solo rondas gastadas, y solo porque cada afirmación se verificó contra el
árbol antes de escribirla.

**Un mutante vivo reportado es lo que hace creíble el reporte.** M6 sobrevivió; el agente
diagnosticó la causa corriéndola junto con otra mutación para aislar quién carga el peso, y
demostró que era redundancia y no hueco. Un reporte sin sobrevivientes es sospechoso.

### Pendiente

- **De Crazy Cake:** el `targetOrigin`. Sin eso la Parte B no puede pasar, se despliegue lo que
  se despliegue.
- **De JP:** correr la Parte A con el token real (`/partners/external-token` desde su Console).
  Bloqueado momentáneamente porque su sesión de Console caducó.
- **Posible:** que su cuenta admin no tenga partner del cual emitir token. Entonces hace falta
  una cuenta de productor en el dashboard — un pedido concreto, no genérico.
- **Fuera de este alcance, sigue siendo bloqueante del Go Live:** `getFilms()` no filtra por
  partner. La allowlist es la única contención.

---

## 2026-08-28 · Rondas 4 y 5: seis defectos de la misma familia, y dos lecciones nuevas

`feat/atlas-sso` en **`ad97dd6`**, **584/584**. El día cerró con seis correcciones y todas eran
la misma cosa: **una etiqueta afirmando algo que el sistema no hace.**

1. `CLAUDE.md` afirmaba un auto-rollout que T0 no verificó (y que sí existía — ver #52/#53).
2. El simulador declaraba "modo de falla" la única forma de envelope que producción manda.
3. El `stage` culpaba a Atlas por un token que no podía viajar en una cabecera.
4. Un base URL ausente se reportaba como "no se pudo contactar a Atlas".
5. Un test llamado *"the same path Console uses"* posteaba un payload que Console no usa.
6. El banner verde decía *"the contract was exercised end to end"* con `atlasStatus: 302`.

El 6 se midió con el token real de producción de JP, y estaba **clavado en un test existente**
cuyo fixture era literalmente esa corrida. El defecto no solo existía: estaba protegido.

### Lección nueva 1 — una afirmación infundada no se vuelve aceptable por ser tranquilizadora

Los cinco primeros exageraban hacia el éxito o hacia culpar al tercero, así que se sentían como
errores. El sexto arrastró uno mío: dicté que el banner dijera *"the token was never evaluated"*
ante un 302. **FX-envelope lo rechazó y tenía razón.** Un 302 establece que no hubo body de
Contract C; no establece por qué. Su middleware podría leer el Bearer y rechazarlo, o redirigir
cualquier request sin cookie antes de mirarlo — desde afuera son indistinguibles.

Mi redacción caía del lado cómodo, y eso no la salva. El chequeo que la atrapó no fue de tono
sino de epistemología: **¿esto es observable desde acá?** Las mutaciones del test clavan las dos
direcciones del overclaim, la acusatoria y la exculpatoria.

Auditando la misma función apareció el espejo ya presente en el repo: ante un 2xx que no calza,
decía *"so the token was accepted"*. `describeAtlasOutcome` **no tenía ningún test directo**, y
eso explica por qué sobrevivió: nadie lo miraba.

### Lección nueva 2 — particionar por archivo crea costuras, y los defectos viven ahí

FX-envelope reportó que FX-stage había "esquivado" esa función. Verifiqué la línea antes de
repetirlo, y la atribución había que corregirla: **el que la rodeó fui yo.** Le prohibí a
FX-stage tocar `src/app/auth/**` porque el otro agente estaba editando esos archivos. FX-stage
hizo lo correcto para un scope acotado —contuvo el defecto en su territorio y dejó constancia
señalizada en el mensaje de una aserción (`session-route.test.ts:1012`)— y esa constancia fue
justamente el rastro que el otro agente siguió dos rondas después.

**El residuo fue mi mapa de archivos, no reticencia de nadie.** Repartir bien los archivos evita
choques de merge y a cambio crea costuras: el agente que encuentra un defecto al otro lado no
tiene permiso para arreglarlo. **Barrer las costuras es trabajo del coordinador**, y no sale
gratis por haber particionado bien.

### Lección de método — los tests por string dejan pasar contradicciones entre strings

El banner nuevo decía que no se puede concluir nada sobre el token, y cuatro filas más abajo el
helper decía *"either the token was rejected"*. Cada string tenía su test; la contradicción no
la tenía nadie. El test que la cierra afirma una propiedad de **pantalla completa**:

> Para una misma corrida, ninguna parte de la página renderizada le asigna una causa al token
> ni a la cuenta.

Table-driven sobre `[301, 302, 307, 200]`, contra seis patrones causales en las dos direcciones,
y exigiendo que el status **sí** aparezca — para que "no afirma nada" no degenere en "no muestra
nada". Si una pantalla completa afirma algo, hay que testear la pantalla completa.

### Hallazgo lateral — el A record sigue apuntando a la VM heredada

`promote.pijamafilms.com` resuelve a `64.176.6.210` (Vultr), la IP que Pablo entregó el 19 de
enero. El tráfico entra por un **nginx/1.31.3** y se reenvía a App Hosting (`envoy`). Medido:
**450 ms por el proxy contra 77 ms directo**, casi 6×. El `CLAUDE.md` dice que el deployment es
App Hosting y no menciona esa VM. Es un punto único de falla sin monitoreo en el camino de todos
los usuarios, y probablemente determina qué IP ve MUVI —que valida por IP— así que conviene
saberlo antes de que alguien la apague. **No tocado; escalado a JP.**

### Decisión resuelta · 2026-08-28 — se mantiene el `postMessage`, no se propone el redirect

JP preguntó si el `postMessage` sigue siendo válido en caso de que el acceso a
`promote.pijamafilms.com` fuera un link dentro de Console. **Respuesta: solo funciona con
`window.open()` conservando la referencia** —que es lo que su código hace hoy—. Con un link
plano el handoff no se degrada, desaparece: Console se queda sin handle al que postear, y desde
Chrome 88 / Firefox 79 `target="_blank"` implica `rel="noopener"`, así que la ventana nueva
tendría `window.opener === null`.

Se evaluó proponerles el flujo estándar por redirect (`/auth?code=…` de un solo uso, canjeado
server-to-server). Elimina la clase entera del bug del `targetOrigin`, la carrera del
`setTimeout` de 1 s y la dependencia del popup. **Descartado por ahora, decisión de JP.**

Razones registradas para cuando esto se vuelva a discutir:

- El fix del `targetOrigin` es **una línea** del lado de ellos y desbloquea el mismo día;
  abrir el rediseño ahora nos deja esperando otra vez, y ya van siete meses.
- El redirect exige que el valor en la URL sea **de un solo uso y vida corta**. El token de hoy
  vive 24 h y es reutilizable, así que ponerlo en una URL sería *peor* que el diseño actual
  —historial, `Referer`, logs de acceso, analítica—. O sea el redirect arrastra un cambio en su
  emisor de tokens, no es solo mover el transporte.
- Tampoco nos desbloquea solo: seguiríamos necesitando un endpoint sin cookie para canjear
  (la opción B del correo).
- De nuestro lado: `src/app/auth/page.tsx` hoy solo lee `mode` y `origins`. Aceptar un código
  sería trabajo nuevo, y el listener pre-paint, el buffer y la validación de orígenes dejarían
  de tener sentido — aunque fueron lo que reveló los dos bugs, así que no fue trabajo perdido.

El correo a Mathias queda **sin** el párrafo sobre el redirect y **sin** el punto del token de
24 horas, ambos por decisión de JP.

---

## 2026-08-29 · Cierre de la sesión

- **Correo a Crazy Cake programado** para el lunes 2026-08-31 temprano, enviado por JP desde
  su Gmail. Copia archivada en `correo-mathias-2026-08-31.html`. Pide: el fix del
  `targetOrigin`, una de las tres opciones para validar el token desde el servidor, y los
  registros de DNS de la transición (etapas 1 y 2).
- **Documentación en el repo:** `docs/atlas-sso-integration.md` + corrección del `CLAUDE.md`
  (merge a master despliega de inmediato; rotar un secreto no despliega; el proxy de Vultr
  existe y no hay que apagar esa VM antes del cutover). Commit `ed522bd` en `feat/atlas-sso`.
- **Compound al plugin:** PR #15 en `artool-spa/artool-devs` — 13 deltas, con la destilación
  de `verificacion.md` (1464→897) y `tests.md` (1146→900) que sus presupuestos exigían.
- **Pendientes al retomar:** respuesta de Mathias · decisión de merge de `feat/atlas-sso`
  (recordar: mergear = desplegar) · PRs #45/#46 y el `whsec_` de Pablo · scoping por partner
  en `getFilms()` (bloqueante del Go Live, proyecto aparte) · aplicar etapas 1 y 2 del DNS
  cuando Crazy Cake confirme.

---

## 2026-09-01 · Crazy Cake entregó, y el Contrato C se cumplió por primera vez

Mathias respondió el 2026-08-31 23:38, catorce horas después del correo. Las tres cosas que
pedimos: hechas, con una salvedez de ambiente. **Verificado por T0, no tomado del mensaje.**

| Lo que dijo | Verificación independiente | Testing | Producción |
|---|---|---|---|
| "Ya arreglamos todo" (fix del `targetOrigin`) | Lectura del bundle desplegado | ✅ `new URL(i, window.location.origin).origin` → postea contra el origen del portal | ❌ sigue `window.location.origin` |
| "Dejamos abierto el endpoint verificando el bearer" (opción A) | `curl` con Bearer falso, sin cookie | ✅ `401 INVALID_TOKEN` en JSON | ❌ sigue `302 → /auth/auth/logout` |
| "Ya ejecutamos la etapa 1" del DNS | `dig` | ✅ TXT `fah-claim=002-02-198b7569-…` y CNAME del ACME resuelven con los valores exactos; el `A` sigue en `64.176.6.210`, o sea la etapa 2 no se tocó | — |

Eligieron la **opción A** y avisan que igual van a trabajar en la **C** (RS256 + JWKS), que era
la que recomendamos a largo plazo. Piden nuestro visto bueno para pasar a producción.

### La prueba local contra testing — resultado

`ATLAS_API_BASE_URL` apuntado a `dashboard-lab`, token real emitido por
`/partners/external-token` de una cuenta de productor, simulador en modo `probe`:

```
atlasStatus 200 · contractMatched yes · responseShapeKeys status, data
partner: jpundurraga@artool.cl · partnerId 6984824e65c8a085b5d5a632
movieCount 0
```

**El 401 previo con token falso fue tan informativo como el 200.** Antes de la corrección,
cualquier llamada sin cookie moría en el 302 sin que la ruta mirara el `Authorization`; ahora
la ruta evalúa el token y responde sobre él. Eso es exactamente lo que la opción A prometía.

De paso quedó ejercitada nuestra cadena interna completa: listener registrado antes del primer
paint con buffer (`buffered pre-mount` en el panel), envelope aceptado **sin** campo `partner`,
canje del token en el servidor.

### Qué NO prueba esta corrida — y conviene no confundirlo

- **El Contrato B sigue sin ejercitarse de verdad.** El `postMessage` lo emitió *nuestro*
  simulador, no Console. Que su fix funcione lo sabemos por lectura del bundle, no porque un
  navegador lo haya ejecutado contra nuestra página. Es justo la trampa del smoke que inyecta
  una pieza falsa en la frontera que quiere validar: acá la pieza falsa es el emisor, y la
  frontera que sí se validó de verdad es servidor↔Atlas. Para cerrar B hace falta `/auth` vivo
  en `promote.pijamafilms.com` (hoy 404) y abrir el portal desde Console del lab.
- **`movieCount 0`.** La forma del contrato queda probada igual —`data.movies` vino como
  arreglo vacío, que es respuesta válida—, pero **nuestro código que lee las entradas de
  `movies[]` nunca corrió contra datos reales**. Ese camino sigue sin ejercitar.

### Pendientes, en orden

1. **Confirmar el certificado en App Hosting antes de dar luz verde a la etapa 2 del DNS.** Los
   registros propagaron, pero que el dominio quede verificado y el cert emitido lo dice Google,
   no el `dig`. Requiere reautenticar `gcloud`.
2. **Responder a Mathias**: visto bueno para producción + luz verde de la etapa 2.
3. **Merge de `feat/atlas-sso`** para cerrar el Contrato B. Recordar: mergear despliega de
   inmediato, y antes hay que resolver el conflicto trivial de `src/middleware.ts` con el
   `master` nuevo (PR #45 agregó `/api/webhooks/` a la misma lista `PUBLIC_ROUTES`).
   El deploy es de bajo riesgo: en `apphosting.yaml`, `ATLAS_LOGIN_ENABLED=false` y la
   allowlist vacía, así que `/auth` queda como página de diagnóstico y no puede emitir sesión.
4. **Scoping por partner en `getFilms()`** — sigue siendo el bloqueante del Go Live, aparte.
5. El `whsec_` de Pablo, sin relación con esto.

El `partnerId` a poner en la allowlist cuando se habilite el login es
`6984824e65c8a085b5d5a632`.

### Respuesta enviada · 2026-09-01 18:42 UTC

Visto bueno para producción + luz verde para la etapa 2 del DNS. Copia de lo enviado en
`correo-mathias-2026-09-01.html` (message id `1a05e47f60a50526`).

Antes de dar la luz verde se confirmó el estado del dominio en App Hosting, que es lo que el
`dig` no puede decir: `ownershipState OWNERSHIP_ACTIVE` · `certState CERT_ACTIVE` ·
`hostState HOST_WRONG_SHARD`. **El certificado ya está emitido y activo antes del cambio de
tráfico**, así que la etapa 2 no abre ninguna ventana de error de TLS. El `HOST_WRONG_SHARD` no
es un defecto: es la descripción de que falta la etapa 2, y desaparece al aplicarla.

Queda pendiente de Crazy Cake: el deploy a producción y la etapa 2. **El proxy de Vultr no se
baja al recibir el aviso** — primero se verifica que el tráfico entre directo (`server: envoy`,
no `nginx`), y JP dejó dicho en el correo que esperaremos uno o dos días. Mientras el proxy siga
en pie, el rollback es volver a poner el `A` anterior.

---

## 2026-09-01 20:07 UTC · `feat/atlas-sso` mergeada a `master` — deploy a producción

PR **#54**, merge commit `e860fe6`. 31 archivos, +7748/−30. Autorizado explícitamente por JP.

Antes del merge se resolvió el conflicto de `src/middleware.ts` (commit `46b5b7e`): era solo
entre los dos párrafos de comentario, y se conservaron las dos entradas de `PUBLIC_ROUTES`.

**Dos cosas se hicieron antes del merge a propósito, para no gastar un segundo rollout:**

1. **Se agregó el guard que le faltaba al PR #45.** Mutación: quitar `/api/webhooks/` de
   `PUBLIC_ROUTES` dejaba los 584 tests **verdes**, o sea el fix de Stripe se podía borrar y
   nadie se enteraba — exactamente el modo de falla del incidente original (401 antes del
   handler, y el 401 nunca dice "middleware"). Nuevo archivo
   `src/app/api/webhooks/__tests__/middleware-public-route.test.ts`, en su propio archivo y no
   en el de Atlas, que está acotado a ese dominio. Verificado con tres mutaciones; cada uno de
   los cuatro casos muere en al menos una, ninguno es peso muerto. La tercera mutación —quitar
   la barra final de la entrada— mata solo el caso de rutas hermanas, que es justo la propiedad
   que ese caso existe para proteger.
2. **Los cuatro `readme-T*.md` de los agentes salieron de la raíz de master** (commit
   `e268589`), archivados acá en `readmes-agentes/`. Decisión de JP entre tres opciones.

**Baseline del ANTES, tomado antes de mergear** (sin foto previa, cualquier valor posterior es
compatible con "ya estaba así"):

| Ruta | Antes |
|---|---|
| `/auth` | **404** ← la señal inequívoca que debe cambiar |
| `/dev/atlas-simulator` | 307 (cerrado) — debe **seguir** cerrado |
| `POST /api/webhooks/stripe` | 400 — debe **seguir** en 400, no volver a 401 |

Verificación del árbol desplegado: `tsc` limpio, lint sin errores, **588/588 en 41 archivos**, y
`git diff` vacío entre el commit probado y el desplegado.

**Lo que cambia visiblemente:** `/auth` pasa de 404 a servir una página. Nada más queda
expuesto: `ATLAS_LOGIN_ENABLED=false` y allowlist vacía la dejan como página de diagnóstico sin
poder emitir sesión. En producción el canje va a dar `302` hasta que Crazy Cake despliegue allá
—ya tienen nuestro visto bueno—, y el panel reporta ese caso sin culpar al token.

### El deploy falló primero, y por el `apphosting.yaml` — no por el código

`build-2026-09-01-001`, el auto-rollout del merge de #54, murió con *"Your apphosting.yaml file
at path '/workspace/apphosting.yaml' is not formatted properly"*. El mensaje **nombra el archivo,
no la línea**. De las 34 entradas de `env`, la única inválida era nuestra:
`ATLAS_LOGIN_ALLOWED_PARTNER_IDS` con `value: ""` — **App Hosting rechaza un valor vacío**.

Producción nunca se vio afectada: el build falla antes de crear revisión, así que las tres
señales del baseline seguían idénticas cuando se diagnosticó. Falló cerrado.

Arreglo en **PR #55**: la variable queda **deliberadamente ausente** en vez de vacía. No debilita
el fail-closed, y no es suposición: `getAtlasAllowedPartnerIds()` lee ausente y vacío igual, y el
test *"rejects everyone when the allowlist is absent"* ya cubría ese camino **antes** de este
cambio. Donde estaba la entrada quedó un comentario diciendo por qué no hay que reponerla vacía,
porque el error del build no apunta a la causa.

**La lección, que es la de siempre en este proyecto:** `tsc`, lint y los 588 tests no miran el
`apphosting.yaml`. Es una rama que solo se ejecuta en el entorno real, y por eso ningún entorno
anterior podía verla. Pendiente propuesto: validar el `apphosting.yaml` en la suite —al menos
"ninguna entrada de `env` con `value` vacío o nulo, y todas con `variable` más `value` o
`secret`"—, que es barato y habría atajado esto.

### Deploy confirmado · `build-2026-09-01-002` READY, commit `eaff7fe`

Verificado contra la foto del ANTES, no por supuesto:

| Ruta | Antes | Ahora | Lectura |
|---|---|---|---|
| `/auth` | 404 | **200** | la señal inequívoca: el código nuevo está vivo |
| `/dev/atlas-simulator` | 307 | 307 | **sigue cerrado**, las dos capas aguantan |
| `POST /api/webhooks/stripe` | 400 | 400 | sin regresión: la firma se sigue verificando, no volvió el 401 |

Dos verificaciones de fondo más:

- **`NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS` se horneó bien**: la página sirve los dos orígenes y no
  dice "none configured", que era el síntoma del gotcha de las variables de BUILD.
- **El canje está cableado en producción**: con token inválido responde
  `atlasStatus 302 · contractMatched false`, o sea llega a Atlas de producción y se topa con la
  puerta de sesión que Crazy Cake todavía no ha desplegado allá. Es el resultado esperado, y el
  panel lo reporta sin culpar al token.

Con esto el **Contrato B ya se puede cerrar de verdad**: falta abrir el portal desde Console del
lab —que sí tiene el fix— contra este `/auth` de producción. Es la única frontera que hasta ahora
se había ejercitado con una pieza simulada.

### 2026-09-01 · Primer intento real del Contrato B: NO se ejercitó, y apareció un tercer bloqueo

JP creó una película de prueba en Console del lab y apretó el botón de marketing. Se abrió un
popup en `promote.pijamafilms.com/films`, **con sesión abierta y el catálogo completo a la vista**.
La lectura intuitiva —"el SSO funcionó, y además filtra mal"— es falsa en las dos mitades.

**Qué pasó de verdad, con evidencia:**

| Hecho medido | Cómo se midió |
|---|---|
| El modo `login` está cerrado en producción: `HTTP 403`, `stage:'disabled'`, **sin `Set-Cookie`** | `POST /api/auth/atlas/session` con `mode:'login'` |
| Sin cookie, `/films` y `/` redirigen a `/login` (307) | `curl` a las tres rutas |
| `/` con sesión válida redirige a `/films` | `src/app/page.tsx` |
| Nuestra `/auth` **nunca** redirige salvo en modo `login` con respuesta ok — imposible acá | `src/app/auth/client.tsx:230` |

De ahí se sigue, sin margen: **el SSO no creó esa sesión** (no puede), y **el popup no abrió
`/auth`** (si lo hubiera hecho, seguiría en `/auth`, que responde 200 con o sin cookie). El popup
abrió la raíz, y la **sesión preexistente de JP en ese navegador** —de las pruebas anteriores, la
del partner interno `pijamafilms`: 28 campañas, $858— lo llevó a `/films`.

**Tercer bloqueo, de Crazy Cake:** `marketingUrl` sale de `$store.state.marketingUrl`, o sea de la
configuración de su backend, y **no apunta a `/auth`** — a pesar de que Pablo les dio esa ruta
exacta el 2026-01-13. Es un cambio de configuración de una línea de su lado. Mientras siga
apuntando a la raíz, el `postMessage` llega a una ventana donde nuestro listener no existe.

**El catálogo completo NO es un hallazgo nuevo ni una fuga del SSO:** es el bloqueante conocido de
`getFilms()`, que no filtra por partner, visto acá en su forma más concreta con la sesión del
partner interno. Es exactamente la razón por la que el login arranca cerrado y detrás de allowlist.

**Lo bueno:** el bundle del lab se redesplegó (2,4 MB minificado → 6,8 MB sin minificar) y ahora el
fix se lee en el fuente con su comentario: *"targetOrigin must be the portal's origin, not
Console's, or the browser drops the message"*.

**El experimento limpio que falta, y es barato:** repetir el click en una ventana de incógnito, sin
sesión de promote. Ahí las dos hipótesis se separan sin ambigüedad —si el popup cae en `/login`,
`marketingUrl` es la raíz y hace falta el tercer fix; si cae en el panel de `/auth`, el Contrato B
por fin se ejercita—. Conviene hacerlo **antes** de pedirles el tercer cambio.

### Confirmado con la prueba en limpio, y pedido enviado · 2026-09-01 21:27 UTC

JP borró las cookies, volvió a entrar al lab y apretó el botón: el popup cayó en
`promote.pijamafilms.com/login`. Con las dos mediciones juntas —`/films` con sesión previa,
`/login` sin ella— la hipótesis queda cerrada: **ambas son lo que hace nuestro servidor al
recibir la raíz**, y si Console abriera `/auth` se quedaría ahí en los dos casos, porque esa ruta
responde 200 con o sin cookie. `marketingUrl` apunta a la raíz.

Correo enviado con los dos pedidos (copia en `correo-mathias-2026-09-01-marketingurl.html`,
message id `1a05eded7eeb8f05`):

1. `marketingUrl` → `https://promote.pijamafilms.com/auth`, en testing y producción. Sin
   parámetros: se verificó que el default de `mode` en `src/app/auth/page.tsx:50` es `login`, que
   es el flujo real de Console.
2. Pestaña en vez de popup: soltar el tercer argumento de `window.open`. **Con la advertencia
   explícita de que no puede llevar `noopener`**, que es el único modo en que ese cambio de UI
   rompería el handoff: devolvería `null` y se pierden las dos direcciones —su referencia para
   postear y nuestro `PROMOTE_READY` al `opener`—. Es un riesgo real porque `noopener` es
   normalmente la buena práctica al abrir pestañas.

Los dos pedidos tienen antecedente en lo que ellos mismos escribieron: la ruta `/auth` la dio
Pablo el 2026-01-13, y el `_blank` lo describió Mathias el 2026-01-08. No son requisitos nuevos.

**Qué va a mostrar el panel cuando corrijan la URL:** que el mensaje llegó —eso cierra el
Contrato B— y después que el login está deshabilitado, que es la respuesta correcta y no un error.
Ejercitar la cadena hasta emitir sesión exige poner el `partnerId` en la allowlist, paso aparte y
deliberado, y arrastra el tema de `getFilms()` sin scoping.

### 2026-09-01 22:23 UTC · Login habilitado con allowlist de un solo id (PR #57)

Decisión de JP: contener con allowlist mientras `getFilms()` no filtre. Al ejecutarla apareció
que **el pedido literal no era ejecutable**, y vale dejarlo escrito porque el próximo va a
tropezar igual:

**Los dos espacios de identidad no se cruzan.** La allowlist se compara contra el `partnerId` que
devuelve **Atlas** (un ObjectId de Console). Los **cinco** usuarios actuales de promote
—`producer1@`, `producer2@`, `admin@pijamafilms.com`, `josefina@fabula.cl`,
`testpijamatest@gmail.com`— comparten `partnerId=pijamafilms`, que Atlas **nunca** envía. Poner
`pijamafilms` en la lista no habilita a nadie **y parece configurado**: el peor resultado
posible, un fail-closed disfrazado de permiso.

Tampoco hay correspondencia de personas: `jpundurraga@artool.cl` **no tiene cuenta de promote**,
así que su acceso por SSO es acceso nuevo, no el de un usuario actual. Llevado al pie de la letra
el cambio habría sido un no-op.

Resuelto con una entrada: `6984824e65c8a085b5d5a632` (JP, medido con el panel en modo probe), más
`ATLAS_LOGIN_ENABLED=true`. El operador interno y nadie más, porque admitir a un productor real
le entregaría el catálogo completo.

**Verificado con la foto del antes, no por supuesto:**

| | `POST /api/auth/atlas/session` con `mode:'login'` |
|---|---|
| Antes | `403` · `stage:'disabled'` |
| Ahora | `502` · `stage:'atlas_call'` · `atlasStatus 302` |

Ese resultado prueba **dos** cosas: que el flag actuó, y que **la allowlist no está vacía** — el
chequeo de lista vacía corre *antes* de salir a la red, así que una lista vacía habría dado
`stage:'allowlist'` sin llamar a Atlas. Haber llegado al 302 significa que pasó los dos portones.

Efecto secundario del despacho: el comentario del `apphosting.yaml` que decía "DELIBERATELY
ABSENT" se reescribió en el mismo commit. Dejaba de ser verdad, y un comentario que describe el
estado anterior es el mismo defecto que pasamos la semana sacando de los diagnósticos.

### Hallazgo aparte, y ya materializado

**`josefina@fabula.cl` —productora externa, Fábula— ya tiene cuenta de promote y ya ve el catálogo
completo**, con último ingreso el 2026-08-31 09:51 de Chile. O sea la exposición de `getFilms()`
no es futura ni hipotética: hoy una tercera parte ve el catálogo y las métricas agregadas de toda
la plataforma. Eso mueve el scoping por partner de "bloqueante del Go Live" a "problema vivo".

De paso queda cerrado el reporte de que sus credenciales no funcionaban: entró bien 40 minutos
después de avisar.

### `STRIPE_WEBHOOK_SECRET`, medido con `gcloud` reautenticado

**Una sola versión, del 2026-08-17** — la copiada del proyecto viejo. Pablo nunca subió el
`whsec_` nuevo, y el deploy de hoy tomó esa misma versión. Como los secretos de firma de Stripe
son **por endpoint**, cada evento real se rechaza por firma inválida: los pagos de créditos no se
procesan. El 400 de nuestras pruebas es por otra causa —falta la cabecera— así que no lo delata.
Issue #53, y no depende de Crazy Cake.

### 2026-09-01 23:51 UTC · Mathias responde: los tres fixes en testing, y la etapa 2 del DNS

Dos horas después de nuestro correo. Contenido, verificado antes de responder, no tomado del
mensaje:

**Los tres cambios, confirmados en el bundle del lab:**
```
let n = window.open(i, "_blank");                    // pestaña, no popup
let r = new URL(i, window.location.origin).origin;   // targetOrigin del portal
n.postMessage({type:"ATLAS_AUTH", token:e}, r);
```
No se puede verificar por bundle que `marketingUrl` apunte a `/auth` — es una variable de
configuración, solo se ve al ejecutar el click real. Ese es el único paso que falta antes de
poder decir que los tres están.

**La etapa 2 del DNS ya se aplicó:**
```
A promote.pijamafilms.com -> 35.219.200.9   (antes: 64.176.6.210, el proxy de Vultr)
```
Confirmado sirviendo directo: `server: envoy`, sin pasar por nginx. `/auth` sigue en 200 tras el
cutover.

**Pendiente, antes de dar el visto bueno de producción:** repetir el click desde Console del lab
y confirmar que cae en `/auth`, no en la raíz.

**Pedido nuevo de Crazy Cake, sin relación con el SSO:** quieren que nosotros definamos la matriz
de tracking de GTM/GA (evento · entorno · trigger · payload) para que ellos la implementen. Es
trabajo nuevo de producto/marketing, no un bloqueo técnico. JP a cargo de decidir cuándo abordarlo.

---

## 2026-09-03 18:15 · EL SSO FUNCIONA PUNTA A PUNTA

Primera corrida completa de la cadena, con Atlas real y token real del lab. Evidencia por
eslabón, leída del log del servidor y de Firestore, no de la pantalla:

| Eslabón | Evidencia |
|---|---|
| Página y listener | `GET /auth?mode=login 200` |
| Envelope aceptado | token de 348 chars, prefijo `eyJhbG` |
| Atlas real | `atlasStatus 200 · contractMatched true` contra `dashboard-lab` |
| Allowlist | pasó: el `partnerId` coincidió con el configurado |
| Sesión | `Atlas login succeeded · partnerId 6984824e65c8a085b5d5a632` |
| Persistencia | `partners/cB3ztvnh5pwH0cgBe8tB`, creado 18:15:49.924Z |
| Destino | `GET /films 200`, renderizado con sesión real |

**Alcance honesto:** la única pieza simulada fue el **emisor** del `postMessage`. Ese emisor se
probó por separado el 2026-09-02 en producción, con Console del lab real (panel: `Accepted · live`,
origen `dashboard-lab`). Las dos mitades están verificadas; lo que **nunca** ocurrió es que ambas
corrieran en la **misma** ejecución. Eso llega cuando Crazy Cake despliegue producción.

### Cómo se llegó, y dos fricciones que valen para el próximo

1. **El desajuste de ambientes es el que hay que entender:** el ambiente que **emite** el token y
   el que lo **valida** tienen que ser el mismo. El intento de ayer en producción falló porque el
   token venía del lab y producción valida contra Atlas de producción. No era defecto de nadie.
2. **El camino del token real en el simulador está clavado en `probe`**, a propósito y con su
   comentario. JP pegó el token ahí —es el lugar obvio— y la corrida salió en probe: dos canjes
   `200 · contractMatched true`, buenos, pero sin ejercitar la sesión. El end-to-end en modo
   `login` se hace por la **mitad sintética**, pegando el token real en el campo
   `Token (synthetic by default)` y cambiando el radio a `login`. Es un filo de usabilidad: la
   protección del campo enmascarado se paga con que el único camino a `login` expone el token en
   pantalla.

### Pendientes que esto deja

- **El `partnerId` de la allowlist es del LAB.** `6984824e65c8a085b5d5a632` se midió con token del
  lab. Lab y producción son ambientes separados: el id de JP en producción probablemente sea otro,
  y entonces el login desde Console de producción va a fallar con `stage:'allowlist'`, que se lee
  igual que "no autorizado". **Hay que re-medirlo en cuanto Atlas de producción permita el probe.**
- **Banner falso en `atlas_call`:** `STAGE_CONCLUSION.atlas_call` afirma "Atlas could not be
  reached at all" para toda la etapa, y es falso cuando Atlas respondió un 302/401. La pantalla se
  autocontradice con la fila "What this means" de abajo, que sí distingue. El test de coherencia no
  lo atrapó porque su predicado solo cubre atribución de causa al token o a la cuenta, no
  afirmaciones sobre alcanzabilidad.
- **Sacar el lab de los orígenes permitidos de producción** cuando termine la prueba: hoy un
  Console de testing puede hacer handoff hacia producción; es inocuo porque el canje contra Atlas
  de producción falla, pero es una ampliación latente.
- Dar el visto bueno a Crazy Cake para producción.

### 2026-09-03 18:29 UTC · Enviado el ok para producción, con dos cambios de JP

Copia en `correo-mathias-2026-09-03.html` (message id `1a0688823f129793`).

**JP agregó un pedido que el borrador no tenía, y es el hueco correcto:** una cuenta de
**productor (no admin) con películas**, para verificar que la colección de películas del usuario
llega bien. `movieCount` vino **0** en todas las corridas —el partner del lab no tiene películas—
así que **el código que lee las entradas de `movies[]` nunca se ejecutó contra datos reales**. La
forma del contrato está probada (`data.movies` llegó como arreglo vacío, respuesta válida), pero
el parseo de cada entrada no. T0 lo tenía registrado el 2026-09-01 como limitación; JP lo convirtió
en petición concreta.

**JP quitó el aviso del `partnerId` por ambiente.** Consecuencia a vigilar: si el primer login en
producción falla con `stage:'allowlist'`, Crazy Cake no tiene el contexto para interpretarlo y
puede diagnosticarlo como problema suyo. Decisión suya, queda anotada para que al retomar se sepa
que ellos **no** están advertidos.

---

## Estado al cierre de sesión · 2026-09-03

**Nuestra mitad: completa, desplegada y probada punta a punta.** `master` en `6831ae6`. Login
habilitado con allowlist de un id. Producción: `/auth` 200, simulador cerrado, webhook 400, DNS
cortado directo a App Hosting.

**En cancha de Crazy Cake:** el deploy a producción (ya tienen el ok), y la cuenta de productor
con películas que JP pidió.

**Nuestro, sin depender de nadie, en orden de prioridad:**

1. **Scoping por partner en `getFilms()`** — el bloqueante real del Go Live, y **ya materializado**:
   Josefina (Fábula, externa) tiene cuenta de promote y ve el catálogo completo. Ahora que el SSO
   funciona, es lo único que separa esto de abrirlo a un productor real.
2. **El `whsec_` de Stripe** — `STRIPE_WEBHOOK_SECRET` sigue con la única versión del 2026-08-17,
   copiada del proyecto viejo. Los secretos de firma son por endpoint: cada evento real se rechaza
   y los pagos de créditos no se procesan. JP espera credenciales de Dominique Spiniak. Issue #53.
3. **Re-medir el `partnerId` de JP en producción** y actualizar la allowlist, en cuanto Atlas de
   producción permita el probe.
4. **El parseo de `movies[]` contra datos reales**, cuando llegue la cuenta con películas.
5. **Banner falso en `atlas_call`**: afirma "could not be reached at all" también cuando Atlas
   respondió 302/401, y contradice la fila "What this means" del mismo panel. Ampliar además el
   predicado del test de coherencia para cubrir afirmaciones sobre alcanzabilidad, no solo
   atribución de causa al token.
6. **Sacar `dashboard-lab` de los orígenes permitidos de producción** al cerrar las pruebas.
7. **Bajar el proxy de Vultr** (`64.176.6.210`) — el tráfico ya entra directo, verificado. JP dijo
   a Crazy Cake "en los próximos días".
