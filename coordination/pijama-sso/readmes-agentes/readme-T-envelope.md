# readme-T-envelope — Contract B: `partner` opcional en el envelope de Atlas

_Última actualización: 2026-08-28 · Proyecto: pijama-films-promote_

---

## Identidad

- **Agente:** FX-envelope (domain agent, reporta a T0)
- **Dominio:** el esquema Zod del envelope `ATLAS_AUTH` y cómo el panel de diagnóstico lo muestra.
- **Scope:** `src/app/auth/atlas-bridge.ts`, `src/app/auth/client.tsx` y sus dos test files.
- **Scope ampliado (2026-08-28, por T0, en dos rondas):** `src/app/dev/atlas-simulator/client.tsx`,
  `__tests__/client.test.ts` y `__tests__/real-token.test.tsx`. Ver "El simulador" y
  "La fidelidad del run con token real".
- **No cubre:** `src/lib/atlas/**` y `src/app/api/auth/atlas/session/route.ts` — territorio de
  **FX-stage**, agente activo. No los toqué y no los necesité: el `partner` del envelope nunca
  cruza al servidor, así que los dos fixes no se solapan. Verificado, no afirmado:
  `git diff --name-only 5e3a6a3..HEAD -- src/lib/atlas src/app/api/auth/atlas/session/route.ts`
  sale vacío.

---

## Estado Actual

- **Repo:** `artool-spa/pijama-films-promote` · Branch: `fix/atlas-envelope-partner-optional`
  (base `feat/atlas-sso` @ `5e3a6a3`) · Commits: `a96fd84`, `33d06c2`, `0637979`, `ea38e7d`,
  `e2eda15`, pusheados.
- **Deploy activo:** no aplica — este fix se cierra con tests, sin dev server. El worktree no tiene `.env`.
- **Suite de tests:** **517 tests / 40 archivos · 517 verdes, 40/40 archivos.**
  Base antes de tocar nada: 507 tests / 40 archivos. Neto +10.
- **`npx tsc --noEmit`:** limpio.

---

## El hallazgo, y por qué el fix es este

T0 desminificó el bundle desplegado de Atlas Console
(`dashboard.pijamafilms.com/resources/entry.js?v=d4c06ad`, público). `openMarketingPortal`
pide `/partners/external-token` y hace:

```js
win.postMessage({ type: "ATLAS_AUTH", token }, window.location.origin);
```

**Console manda `{ type, token }` y nada más. Nunca manda `partner`.** Nuestro
`atlasAuthEnvelopeSchema` lo exigía como objeto requerido, así que un handoff **correcto**
de producción era rechazado por validación y el panel lo reportaba como "Envelope does not
match Contract B" — o sea, un SSO que funciona leído como roto. Ese falso negativo es
exactamente lo que esta página existe para evitar.

### Verificación de seguridad (lo primero que revisé)

El `partner` del envelope llega por `postMessage` desde el cliente: es **dato no confiable**.
Confirmé que no alimenta ninguna decisión de autorización, y por eso el fix es seguro:

- `client.tsx:178` manda al servidor `body: JSON.stringify({ token, mode: requestedMode })`.
  El `partner` del envelope **nunca sale de la página**.
- Su único destino es `PanelEvent.partner`, que llena una fila del panel de diagnóstico.
- La identidad autoritativa del partner la sigue entregando el servidor, en la respuesta de
  `/movies/by-partner` que lee `POST /api/auth/atlas/session`, y se muestra por separado
  como `AtlasDiagnostics.partner` (`client.tsx:656`, fila "Atlas partner").

Son dos campos distintos con dos niveles de confianza distintos, y quedaron documentados como
tales en el comentario de contrato.

---

## Qué cambié

### `src/app/auth/atlas-bridge.ts`

1. **El comentario de contrato (línea 8)** decía `partner: { name, email }` requerido — afirmaba
   algo falso sobre Console. Ahora dice `partner?:` y anota la medición del bundle con fecha y
   versión, más la regla de que nada en el camino de autorización puede leer la copia del envelope.
2. **El esquema:** `partner` pasa a `.optional()`. Tres decisiones deliberadas, cada una anotada
   en el código:
   - **Opcional**, porque Console omite la clave entera.
   - **Estrictamente tipado cuando está presente** — no `z.any()`, no `.passthrough()`. Un
     `partner: "texto"` o `{ name: 123 }` es una violación real de contrato que vale reportar;
     dejarla pasar pondría `123 <undefined>` en el panel, una identidad inventada.
   - **No `.nullable()`.** `undefined` y `null` son afirmaciones distintas del productor: "no
     mandé esto" vs. "miré y no hay". El panel las muestra distinto, así que el esquema las
     mantiene separadas en vez de aplanarlas en un mismo blanco mudo.

### `src/app/auth/client.tsx`

El tipo obligó el cambio (`tsc` falló en `:312` con `undefined` no asignable a `| null`), y
resolverlo con un `?? null` habría cumplido el compilador incumpliendo el DoD 5: `null` ya
significaba "no llegó a validarse" en las tres filas de rechazo, y un `null` mudo compartido es
justo lo que confunde un handoff correcto con uno roto. Así que `PanelEvent.partner` pasó de
`{name,email} | null` a un union de tres estados explícito:

| estado | cuándo | qué dice el panel |
|---|---|---|
| `sent` | el envelope trajo partner bien formado | `Nombre <email>` |
| `not-sent` | el envelope validó y no trajo partner | `not sent — Atlas Console does not send one, and the envelope is valid without it. The account identity comes from Atlas itself, below.` |
| `not-read` | el envelope se rechazó antes de validar su contenido | `not read — the envelope was rejected before its contents were validated.` |

Los tres sitios de rechazo (`:257`, `:275`, `:295`) pasaron a `not-read`, que es honesto: nunca
validamos el envelope, no sabemos. Antes decían "not provided", que suena a defecto.

También corregí el texto del contrato que la UI muestra al usuario en el alert de envelope
malformado: decía `{ type, token, partner }` y ahora dice `{ type, token }` con `partner`
opcional.

---

## Disciplina de tests: procedencia de cada número

Base: **507 tests / 40 archivos**. Ahora: **517 tests**. Neto +10 (+8 en `src/app/auth/`,
+2 en el simulador).

### Vistos fallar antes del fix (4) — estos son los que prueban algo

Corrí cada uno contra el código viejo y confirmé el rojo. Para los dos de `client.test.tsx`
tuve que revertir temporalmente el esquema con `git stash` para medirlos honestamente, porque
el fix del esquema ya estaba aplicado cuando los escribí:

| test | archivo | rojo observado |
|---|---|---|
| `accepts the envelope Atlas Console really sends, with no partner at all` | `atlas-bridge.test.ts` | `expected false to be true` |
| `reads an absent partner as undefined rather than inventing one` | `atlas-bridge.test.ts` | `expected false to be true` |
| `accepts it and exchanges the token even though no partner came with it` | `client.test.tsx` | `Unable to find an element with the text: Accepted` |
| `says the partner was not sent, and does not dress it up as a fault` | `client.test.tsx` | `Unable to find an element with the text: /not sent/` |

### Nacidos verdes (5) — guardas de regresión, no evidencia

Pasaban contra el código viejo por construcción: describen invariantes que el fix **no** debía
romper. Su valor lo demuestran las mutaciones, no su color inicial.

- `rejects a partner that is present but malformed` (bridge) — 8 formas: `"texto"`, `123`, `[]`,
  `true`, `{name:123}`, `{email:456}`, y las dos con un campo faltante.
- `still rejects a null partner: absent and explicitly empty are not the same claim` (bridge)
- `rejects a missing token, an empty token and a wrong type` (bridge) — ampliado con
  `{ type }` solo y `{ token }` solo: sin partner del que apoyarse, el chequeo de tipo y token
  es todo lo que nos separa de un mensaje cross-origin arbitrario.
- `still shows the identity when a partner does come with the envelope` (client)
- `rejects a partner that is present but malformed, instead of rendering nonsense` (client)

### Cambió de polaridad — 1 (no cuenta como "visto fallar")

`buildSimulatorEnvelope` · `produces the shape Console really sends, and the page accepts it`
(antes `missing-partner` dentro del bucle de rechazados). Falló con el código viejo, pero eso
**no** es evidencia: fallar era su comportamiento correcto antes del fix. Lo que lo valida es la
corrida en las dos direcciones, documentada en "El simulador" más abajo.

### Nacidos verdes en el simulador — 2

`still produces the documented shape, and the page still accepts it` y
`reproduces a present-but-malformed partner, which the page must reject`. Guardas de regresión;
su valor lo demuestran M5, M7 y la polaridad dirección B.

### Una aserción eliminada

`atlas-bridge.test.ts` tenía `safeParse({ ...valid, partner: undefined }).success === false`.
No la "arreglé": afirmaba precisamente lo falso que este fix corrige. Es la razón por la que
el neto es +8 y no +9.

---

## Reporte de mutación

Las dos que pidió T0, más dos propias. **Las cuatro murieron.**

| # | mutación | resultado | mata |
|---|---|---|---|
| 1 | `partner` requerido otra vez | ☠️ **muerta** | 4 tests: los dos de DoD 1 en bridge + los dos de client |
| 2 | `partner: z.any()` | ☠️ **muerta** | 3 tests: `malformed` y `null partner` en bridge + `renders nonsense` en client |
| 3 | colapsar `not-sent`/`not-read` en un `'not provided'` mudo *(propia)* | ☠️ **muerta** | 1 test: `says the partner was not sent` |
| 4 | agregar `.nullable()` junto al `.optional()` *(propia)* | ☠️ **muerta** | 1 test: `still rejects a null partner` |
| 5 | devolver `console-shape` al grupo de rechazados *(pedida por T0)* | ☠️ **muerta** | 1 test: `produces envelopes the page rejects` |
| 6 | sacar `malformed-partner` del bucle de rechazados *(propia)* | 🟡 **SOBREVIVIÓ** | ninguno — ver abajo |
| 7 | hacer que `malformed-partner` emita un partner bien formado *(propia)* | ☠️ **muerta** | 2 tests, incl. el dedicado |
| 8 | volver `handleRealTokenLaunch` a `documented-shape` *(obligatoria de T0)* | ☠️ **muerta** | 1 test: el de fidelidad |
| 9 | postear `{ type, token, partner: undefined }` *(propia)* | ☠️ **muerta** | 1 test, y **solo** por la aserción de `Object.keys` |

**M6 sobrevivió, y lo reporto en vez de taparlo.** Sacar `'malformed-partner'` del bucle de
rechazados no pone rojo nada: los 6 tests siguen verdes. La causa **no** es un hueco de
cobertura, y lo verifiqué en vez de asumirlo — corrí M6 y M7 **juntas** (entrada del bucle
eliminada *y* la forma vuelta bien formada) y el test dedicado
`reproduces a present-but-malformed partner, which the page must reject` se puso rojo igual. O
sea la invariante está cubierta por ese test dedicado, y la entrada en el bucle es **redundante**
con él. M7 prueba que el test dedicado es el que carga el peso.

Conclusión honesta: M6 sobrevive porque es una aserción duplicada, no porque la invariante esté
sin proteger. Dejé las dos igual — la del bucle documenta la intención al lado de sus hermanas,
y el costo de una aserción redundante es cero.

Las mutaciones 3, 4, 6 y 7 las agregué yo: las de T0 cubrían el esquema y el rename, y quería
verificar que el DoD 5 (el panel distingue en pantalla) esté realmente protegido y no sea solo
texto que escribí, que la distinción `undefined` vs `null` sea invariante testeada y no
accidente, y que la forma malformada del simulador siga siendo realmente malformada.

---

## DoD — estado

- [x] 1. Envelope sin `partner` se acepta.
- [x] 2. Envelope con `partner` bien formado sigue aceptándose y el panel lo muestra igual.
- [x] 3. `partner` presente pero malformado se rechaza (8 formas cubiertas).
- [x] 4. Sigue rechazándose `type` distinto, `token` ausente y `token` vacío.
- [x] 5. El panel distingue "no enviado" de "enviado" — y además de "no leído".
- [x] 6. `tsc --noEmit` limpio y suite **verde entera: 517/517 en 40/40 archivos** (base 507, +10).
- [x] 7. Comentario de contrato en `atlas-bridge.ts:9` corregido.
- [x] 8. Este archivo.

---

## El simulador — segunda ronda (scope ampliado por T0)

`src/app/dev/atlas-simulator/` tenía una forma llamada `'missing-partner'` que posteaba
`{ type, token }` y vivía en el grupo de **rechazados**, con un test afirmando
`success === false`. Eso es el envelope que Console manda de verdad: **el único tool
construido para reproducir el handoff real clasificaba el handoff real como modo de falla**, y
su test preservaba esa creencia falsa dentro de la suite. T0 lo resolvió así (opción 1) y me
amplió el scope a esos dos archivos.

### Nombres: qué es, no qué le falta

| forma | payload | etiqueta en la UI |
|---|---|---|
| `console-shape` **(default)** | `{ type, token }` | "what Console sends in production (measured 2026-08-28)" |
| `documented-shape` | `{ type, token, partner }` | "as Crazy Cake documented it — valid, but never observed in production" |
| `missing-token` | `{ type, partner }` | rechazado |
| `malformed-partner` **(nueva)** | `{ type, token, partner: '<string pelado>' }` | "expect it to be rejected: optional is not anything goes" |
| `wrong-type` | `{ type: 'ATLAS_AUTH_V2', … }` | rechazado |

Tres decisiones que vale explicar:

1. **`console-shape`, no `no-partner`** (criterio de T0): `no-partner` describe lo que le falta;
   `console-shape` dice lo que es. Importa porque ahora conviven dos formas válidas y hay que
   poder elegir entre ellas a propósito.
2. **`'valid'` pasó a `'documented-shape'`.** Esto no me lo pidieron; lo hice aplicando el mismo
   criterio y lo marco para que T0 lo pueda vetar barato. Razón: ahora hay **dos** formas
   válidas, así que el nombre `valid` reclamaba una exclusividad que no tiene — y esa
   exclusividad implícita es justo lo que hizo que la forma documentada pareciera *la* esperada.
   Es el error que acabamos de pagar.
3. **`malformed-partner` es nueva, y es requisito de T0.** Al sacar `missing-partner` del grupo
   de rechazados, ese grupo quedaba sin **ningún** caso de partner — o sea la invariante
   "opcional no es cualquier cosa" dejaba de ser reproducible justo en la página donde alguien
   va a mirar el manejo de partner. Usa un string pelado en vez del objeto: el error que un
   productor haría de verdad, y el que un esquema laxo renderizaría como identidad inventada.

Las etiquetas dicen "measured" y "never observed" a propósito, no por cosmética: es lo que evita
que en tres meses alguien vuelva a tratar la forma documentada como la esperada.

### Polaridad, corrida en las dos direcciones

El test renombrado **cambia de signo**, así que no cuenta como "visto fallar" por haber fallado
con el código viejo — fallar era su comportamiento correcto antes. Lo corrí en ambas direcciones,
como pidió T0:

- **Dirección A** — devolver `console-shape` al grupo de rechazados (mutación M5 de T0):
  ☠️ rojo en `produces envelopes the page rejects, one per failure mode`.
- **Dirección B** — hacer que el builder emita para `console-shape` la forma vieja con `partner`:
  ☠️ rojo en `produces the shape Console really sends, and the page accepts it`.

O sea la afirmación nueva está clavada por los dos lados: no basta con que el nombre cambie, el
payload tiene que ser realmente `{ type, token }` y el esquema tiene que realmente aceptarlo.

Y sigue habiendo rechazo con partner malformado, verificado aparte (M7 abajo).

### Un accidente de proceso que vale registrar

Durante la primera pasada de mutación usé `git checkout -- <test>` para restaurar, con los
cambios del simulador **sin commitear**. Eso me borró las ediciones del test y las dos
mutaciones siguientes corrieron contra el archivo viejo — se notó porque el output mostraba
nombres de test que ya no existían y un conteo de 4 en vez de 6. Rehice el archivo, commiteé
**antes** de mutar, y volví a correr todo. Las cifras de abajo son las de la corrida válida.
**Regla, dicha como regla:** *commitea antes de mutar; una corrida de mutación sobre un árbol
sucio no mide el código que crees.* Y la señal por la que se detecta, que es lo que el próximo va
a tener delante: **nombres de test que ya no existen en el output, y un conteo que no cuadra**
(esperaba 6, salieron 4). En las rondas siguientes commiteé antes de cada tanda de mutación.

---

## La fidelidad del run con token real (tercera ronda, aprobada por T0)

`handleRealTokenLaunch` posteaba `documented-shape` — `{ type, token, partner }` — mientras el
test que lo cubre se llama *"delivers the token through postMessage, **the same path Console
uses**"*. Console postea `{ type, token }` y nada más. O sea el **único run que carga una
credencial de producción real**, y cuyo resultado se lee como la respuesta a "¿funciona el SSO?",
ensayaba un envelope que producción no produce — mientras su propio nombre prometía lo contrario.

**No fallaba nada por eso**: `partner` es display-only y las dos formas validan, así que Contract
C salía igual. Por eso sobrevivió — una mentira sin síntoma. El defecto no estaba en el código,
estaba en el nombre, que es la misma clase de trampa que este repo pagó tres veces en un día
(el `CLAUDE.md` afirmando un auto-rollout no verificado; el simulador declarando modo de falla la
única forma real; el `stage` culpando a Atlas por un error nuestro de input).

### Visto fallar, y el rojo *es* la evidencia del gap

Cambié el código **primero** y corrí el test viejo contra el código corregido, a propósito. El
diff del rojo es la prueba de que el gap existía:

```
× the pasted-token run > delivers the token through postMessage, the same path Console uses
  → expected { type: 'ATLAS_AUTH', …(1) } to deeply equal { type: 'ATLAS_AUTH', …(2) }
  - Expected
  + Received
  -   "partner": Object {
  -     "email": "partner@example.test",
  -     "name": "Simulated Partner",
  -   },
```

El test *exigía* un `partner` que el Console real nunca manda. Recién después actualicé la
aserción para clavar el payload campo por campo.

### Por qué hay una aserción extra sobre `Object.keys`

```ts
expect(posted[0].data).toEqual({ type: 'ATLAS_AUTH', token: REAL_TOKEN });
expect(Object.keys(posted[0].data as object).sort()).toEqual(['token', 'type']);
```

La segunda línea no es redundante, y lo verifiqué en vez de suponerlo: **`toEqual` de vitest
ignora las propiedades `undefined`**. Corrí la mutación M9 (`{ type, token, partner: undefined }`)
con la línea de `Object.keys` borrada y el test **pasó verde**. O sea sin ella, un payload con la
clave `partner` presente-pero-vacía se cuela, y eso no es lo que Console manda. La clave tiene
que estar **ausente**, no vacía — la misma distinción `undefined` vs `null` que el esquema
sostiene, aplicada al ensayo.

---

## Para quien tome mi lugar

- El worktree es `/Users/jpudev2/Proyectos/pijama-fx-envelope`, sin `.env` y sin necesitarlo.
- `npx yarn@1.22.22 test --run` y `npx tsc --noEmit` son toda la verificación que este fix admite.
- Si vuelves a tocar el esquema, corre las 4 mutaciones de la tabla de arriba antes de reportar
  verde. Están descritas de forma que se reproducen a mano en un minuto.
- La regla que no se puede relajar: el `partner` del envelope es dato de cliente y es
  **display-only**. Si algún día alguien lo lee para decidir un acceso, eso es un bug de
  seguridad, no una optimización.

---

# Ronda 4 — el banner verde afirmaba un contrato que no se cumplió

_2026-08-28 · rama `fix/atlas-banner-contract-matched`, base `feat/atlas-sso` @ `3ff2ba2`_

## Identidad de esta ronda

- **Scope:** `src/app/auth/client.tsx` y `src/app/auth/__tests__/client.test.tsx`. Nada más.
- **Vedado:** `src/lib/atlas/**` y `route.ts` (territorio de FX-stage). No los toqué; verificado
  con `git diff --name-only 3ff2ba2..HEAD -- src/lib/atlas src/app/api/auth/atlas/session/route.ts`
  → vacío. **No cambié Contract D1 ni el `ok`.**
- **Suite:** base **567/567 en 40 archivos** → ahora **575/575 en 40 archivos**. Neto +8.

## El defecto

JP corrió el probe con un token real de producción. La pantalla decía dos cosas incompatibles:

```
Banner:  ✅ verde · "Probe succeeded"
         "Atlas answered and the contract was exercised end to end."
Fila:    "Contract C matched: no"
Log:     atlasStatus: 302
```

`client.tsx:824` condicionaba el verde a `primary?.response?.ok`. **`ok: true` es correcto y no se
tocó:** es Contract D1, que hace responder 200 siempre que Atlas produzca alguna respuesta HTTP
para no enterrar los diagnósticos dentro de un error. El bug era de presentación: `ok` significa
*"Atlas contestó"*, el banner lo leía como *"el contrato se cumplió"*, y la frase "exercised end
to end" afirma la segunda. **El criterio del verde pasa a ser `contractMatched`.**

Un verde acá se reporta hacia afuera como "el SSO funciona". Tiene que significar eso.

### El tercer desenlace, que antes no existía

| condición | severidad | qué afirma |
|---|---|---|
| `ok` **y** `contractMatched === true` | success | Atlas contestó con el contrato. Sigue diciendo "end to end". |
| `ok` **y** `contractMatched === false` | **warning** | Atlas contestó, no con el contrato. Lleva el `atlasStatus` en el banner mismo. |
| `ok` y `contractMatched === undefined` | success | No hay veredicto que juzgar — ver abajo. |
| no `ok` | error | sin cambios |
| `no_partner` | info | gana sobre todo lo anterior, sin cambios |

Gateado en `=== false`, **nunca en falsy**. `undefined` significa que el servidor no mandó
veredicto (los stages que fallan antes de llamar a Atlas no traen diagnostics), y ausencia de
evidencia no puede renderizarse como evidencia de incumplimiento: eso sería cambiar un banner
falso por otro. La mutación M3 confirma que el test lo protege.

## El sub-hallazgo: mi propio texto sobreafirmaba, en la dirección opuesta

Mi primer borrador del texto del 302 decía *"the token was never evaluated"* y *"neither was
examined"*. **Eso es un overclaim y lo corregí.**

Un 302 de Atlas establece algo estrecho: no se produjo un body de Contract C, o sea la llamada no
llegó al endpoint que lo responde. **No establece por qué.** Su middleware podría leer el Bearer,
rechazarlo y redirigir; o podría redirigir cualquier request sin cookie de sesión mucho antes de
mirar el token. Desde nuestro lado son indistinguibles.

Así que el texto final no dice ninguna de las dos:

- *"the token was rejected"* mandaría a alguien a depurar una credencial que quizá nunca se usó —
  y podría hacernos escribirle a Crazy Cake que su token está malo apoyados en un request que no
  llegó.
- *"the token was never evaluated"* es el mismo overclaim espejado: una afirmación sobre las
  internas de Atlas que no vemos.

**Afirmar un desconocido como hecho es exactamente el defecto que este banner se reescribió para
frenar, y no se salva por caer del lado tranquilizador.** El test clava las dos direcciones
(M7 y M8 lo prueban).

## Procedencia de los tests

Base 567 → 575. Neto +8.

### Vistos fallar — 5

Cuatro nuevos, corridos contra el banner sin arreglar. El rojo es literalmente el defecto:
`expected 'success' to be 'warning'`.

| test | rojo observado |
|---|---|
| `warns instead of congratulating when Atlas answered but the contract did not hold` | `expected 'success' to be 'warning'` |
| `puts the Atlas status in the banner itself, not only in the table below` | idem |
| `says a 302 never reached the endpoint, and blames neither the token nor the account` | idem |
| `describes a non-redirect mismatch without claiming a redirect happened` | idem |

Y el quinto es **un test que ya existía y afirmaba lo falso**:
`renders probe diagnostics including the raw Atlas response keys` (`:328`). Su fixture es
*exactamente* la corrida de producción de JP —`ok: true`, `atlasStatus: 302`,
`contractMatched: false`— y aseveraba `'Probe succeeded'`. **La suite tenía el verde falso
clavado.** Se puso rojo al aplicar el fix, y ese rojo es la prueba de que el defecto existía.
Sus aserciones de diagnostics siempre fueron correctas y quedaron; solo el veredicto estaba mal.

### Nacidos verdes — 4

Guardas de regresión: `still says end to end when the contract really did hold` (DoD 1),
`does not fall into the warning when there are no diagnostics to judge` y
`...when diagnostics arrive without a verdict` (DoD 5), y
`keeps no_partner winning even when the contract flag says no` (DoD 4). Su valor lo demuestran
M1, M3 y M6.

## Reporte de mutación: 8 corridas, 8 muertas

| # | mutación | resultado | mata |
|---|---|---|---|
| 1 | volver la condición del verde a `ok` solo *(pedida por T0)* | ☠️ muerta | 5 tests |
| 2 | hacer que el warning también diga "exercised end to end" *(T0)* | ☠️ muerta | 1 |
| 3 | tratar `contractMatched: undefined` como `false` *(T0)* | ☠️ muerta | 8 tests |
| 4 | quitar el `atlasStatus` del texto del banner *(propia, DoD 2)* | ☠️ muerta | 1 |
| 5 | mandar los 3xx por la rama genérica *(propia, DoD 3)* | ☠️ muerta | 1 |
| 6 | dejar que el warning gane sobre `no_partner` *(propia, DoD 4)* | ☠️ muerta | 2 |
| 7 | restaurar el overclaim exculpatorio *(propia)* | ☠️ muerta | 1 |
| 8 | restaurar el overclaim acusatorio *(propia)* | ☠️ muerta | 1 |

Ningún sobreviviente. Cada punto del DoD tiene una mutación que prueba que su test carga peso.

## Hallazgo fuera de scope — reportado, no tocado

`describeAtlasOutcome` en `atlas-bridge.ts:355` (fuera de mi scope esta ronda) devuelve para un
3xx:

> "Atlas redirected instead of answering. That is exactly what an unauthenticated request looks
> like there, so **either the token was rejected** or ATLAS_API_BASE_URL points at the wrong host."

Eso se renderiza en la fila "What Atlas did" (`client.tsx:671`) en la **misma pantalla** que mi
banner nuevo, que dice que no se puede concluir nada sobre el token. **Los dos textos se
contradicen a cuatro filas de distancia** — la misma clase de defecto que motivó esta ronda, una
fila más abajo. Verificado ejecutando el helper, no inferido.

No lo toqué: `atlas-bridge.ts` no está en el scope que T0 me dio esta ronda. Queda para T0.

---

# Ronda 5 — la fila del diagnóstico acusaba al token

_2026-08-28 · misma rama `fix/atlas-banner-contract-matched` · scope ampliado por T0 a
`src/app/auth/atlas-bridge.ts` + `__tests__/atlas-bridge.test.ts`_

Cierre del hallazgo que reporté al final de la ronda 4 y que T0 aprobó atacar de inmediato.

**Suite:** 575 → **584/584 en 40 archivos.** Neto +9. `tsc --noEmit` limpio.

## El defecto

`describeAtlasOutcome` devolvía, para cualquier 3xx:

> "Atlas redirected instead of answering. That is exactly what an unauthenticated request looks
> like there, so **either the token was rejected** or ATLAS_API_BASE_URL points at the wrong host."

Eso se renderiza en la fila "What Atlas did" (`client.tsx:671`), **cuatro filas debajo** del banner
nuevo que dice que no se puede concluir nada sobre el token. Una pantalla, dos afirmaciones
incompatibles.

Y la urgencia no era estética: **esa pantalla se screenshotea y se le manda a Crazy Cake.** Una
frase ahí es una afirmación que le hacemos a la contraparte sobre su propio sistema.

### El mismo defecto, espejado, en otra rama de la misma función

Auditando el resto encontré que la rama de `contractMatched === false` (que solo corre para 2xx)
abría con:

> "Atlas answered normally, **so the token was accepted**, but the body does not match Contract C."

Un 200 que trae un body de error no establece eso. Es el mismo overclaim apuntando al lado
cómodo — el error que yo mismo había cometido en la ronda 4 y que T0 confirmó. **Una exoneración
infundada no es mejor que una acusación infundada: es el mismo error con cara más simpática.**

Las dos ramas ahora reportan qué volvió (el status, que no se produjo body de Contract C, qué
revisar) y no asignan causa.

## Por qué sobrevivió: cero cobertura

`describeAtlasOutcome` **no tenía ni un test directo**. `grep` en todo `src/` daba solo el import y
los dos usos de render. Por eso una acusación falsa vivió ahí sin que nadie la viera. Ahora tiene
tests unitarios sobre todas sus ramas.

Dato que corrobora que era un peligro conocido: **FX-stage tropezó con la misma función y la
esquivó en vez de arreglarla.** En `src/lib/atlas/__tests__/session-route.test.ts:1015` hay una
aserción cuyo mensaje dice que mandar `atlasStatus: 0` haría a `/auth` imprimir *"the request to
Atlas never completed"*, y lo llama **"the same false accusation coming back through
describeAtlasOutcome"**. O sea dos agentes distintos rodearon esta función; ninguno la había
corregido.

## El test de coherencia de pantalla (T0 lo pidió "si sale limpio" — salió)

Cada frase de la pantalla era defendible por separado mientras la pantalla entera se contradecía.
**Testear cada string es justo lo que permitió que eso sobreviviera:** las dos pasaban su propio
check. Así que el test nuevo afirma la propiedad que importa de verdad:

> Para una misma corrida, **ninguna parte de la página renderizada le asigna una causa al token
> ni a la cuenta.**

Es table-driven sobre `[301, 302, 307, 200]`, junta `container.textContent` completo y lo corre
contra seis patrones causales en **las dos direcciones** (acusatorios y exculpatorios). Además
verifica que el status **sí** esté en pantalla, para que "no afirma nada" nunca degenere en "no
muestra nada": el lector conserva el único hecho que se midió.

Se puede testear limpio y no hubo que forzar nada. Su valor quedó demostrado: M9 y M10 lo ponen
rojo **además** del test unitario, o sea captura la contradicción a nivel página independientemente
de qué string la causó.

## Procedencia

### Vistos fallar — 8

- **3 unitarios** del helper, contra el helper sin arreglar: el 3xx acusando (2 tests) y el 2xx
  exonerando (1). El rojo cita la frase textual.
- **4 de coherencia de pantalla**, uno por status. Los tres 3xx caen por `/token was rejected/i` y
  el 200 por `/token was accepted/i` — o sea el test detectó **solo** las dos ramas que estaban
  mal, sin falsos positivos.
- **1 test preexistente que clavaba la acusación falsa**:
  `says what Atlas did when it redirected instead of answering` (`:449`) aseveraba literalmente
  `/either the token was rejected or ATLAS_API_BASE_URL points at the wrong host/`. **Segunda vez
  en dos rondas que un test protegía el defecto.** Su propósito real —que la fila explique el
  redirect— sigue vigente; corregí solo la parte que nombraba una causa.

### Nacidos verdes — 2

`still says nothing can be concluded when the request never completed` y
`returns null when there is nothing measured to describe`. Guardas de las ramas que ya estaban
bien, para que la reescritura no las rompiera.

### Un detalle que salió del arreglo

La aserción de `ATLAS_API_BASE_URL` pasó a `getAllByText(...).length > 1`, y eso **es** el
resultado buscado: el banner y la fila ahora le dan al lector el mismo consejo en vez de dos
historias distintas. El plural en el test es la señal de que la pantalla quedó coherente.

## Reporte de mutación — rondas 4 y 5: 11 corridas, 11 muertas

Además de las 8 de la ronda 4:

| # | mutación | resultado | mata |
|---|---|---|---|
| 9 | restaurar "either the token was rejected" en el helper *(obligatoria de T0)* | ☠️ muerta | **6 tests**: 2 unitarios, 3 de coherencia, 1 preexistente |
| 10 | restaurar "so the token was accepted" en la rama 2xx *(propia)* | ☠️ muerta | 2: 1 unitario + 1 de coherencia |
| 11 | quitar el status de la frase del redirect *(propia)* | ☠️ muerta | 1 |

Ningún sobreviviente en las dos rondas. M9 y M10 mueren por **dos capas independientes** —el test
unitario del string y el test de pantalla completa—, que era exactamente el punto de agregar la
segunda.

## Lo que aprendí y sirve para el compound

**Una afirmación infundada no se vuelve aceptable por ser tranquilizadora.** Las cinco anteriores
exageraban hacia el éxito o hacia culpar al tercero, así que se sentían como errores. La mía de la
ronda 4 ("el token no fue evaluado") exageraba hacia "no se sabe nada malo", y por eso casi pasa
—incluso venía sugerida en la instrucción—. El chequeo que la atrapó no fue de tono sino de
epistemología: *¿esto es observable desde acá?* Si no lo es, no se afirma, ni a favor ni en contra.

**Y el corolario de método:** los tests por string dejan pasar contradicciones entre strings. Si
una pantalla completa afirma algo, hay que testear la pantalla completa.
