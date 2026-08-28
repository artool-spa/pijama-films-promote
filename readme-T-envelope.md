# readme-T-envelope — Contract B: `partner` opcional en el envelope de Atlas

_Última actualización: 2026-08-28 · Proyecto: pijama-films-promote_

---

## Identidad

- **Agente:** FX-envelope (domain agent, reporta a T0)
- **Dominio:** el esquema Zod del envelope `ATLAS_AUTH` y cómo el panel de diagnóstico lo muestra.
- **Scope:** `src/app/auth/atlas-bridge.ts`, `src/app/auth/client.tsx` y sus dos test files.
- **Scope ampliado (2026-08-28, por T0):** `src/app/dev/atlas-simulator/client.tsx` y su
  `__tests__/client.test.ts`. Ver "El simulador" más abajo.
- **No cubre:** `src/lib/atlas/**` y `src/app/api/auth/atlas/session/route.ts` — el servidor no
  depende del `partner` del envelope y no se tocó. Tampoco
  `src/app/dev/atlas-simulator/__tests__/real-token.test.tsx` — ver "Recomendación abierta".

---

## Estado Actual

- **Repo:** `artool-spa/pijama-films-promote` · Branch: `fix/atlas-envelope-partner-optional`
  (base `feat/atlas-sso` @ `5e3a6a3`) · Commits: `a96fd84`, `33d06c2`, `0637979`, pusheados.
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
Moraleja concreta: commitear antes de mutar no es prolijidad, es lo que hace que el reporte de
mutación sea medible.

---

## Recomendación abierta (no la ejecuté)

`handleRealTokenLaunch` (el único run que puede zanjar Contract C, con un token real pegado a
mano) postea `documented-shape`, o sea **no** reproduce la forma que Console manda. Cambiarlo a
`console-shape` sería más fiel, y el test que lo cubre se llama literalmente *"delivers the token
through postMessage, the same path Console uses"* — su nombre ya afirma la fidelidad que el
payload no tiene.

**No lo cambié.** Era un extra mío, no parte del brief, y su aserción vive en un tercer archivo
(`__tests__/real-token.test.tsx`) fuera del scope que T0 amplió. Lo dejé anotado en el código y
escalado, en vez de ampliarme el scope solo. Es inofensivo hoy: `partner` es display-only y las
dos formas validan, así que no afecta el resultado de Contract C — solo la fidelidad del ensayo.

---

## Para quien tome mi lugar

- El worktree es `/Users/jpudev2/Proyectos/pijama-fx-envelope`, sin `.env` y sin necesitarlo.
- `npx yarn@1.22.22 test --run` y `npx tsc --noEmit` son toda la verificación que este fix admite.
- Si vuelves a tocar el esquema, corre las 4 mutaciones de la tabla de arriba antes de reportar
  verde. Están descritas de forma que se reproducen a mano en un minuto.
- La regla que no se puede relajar: el `partner` del envelope es dato de cliente y es
  **display-only**. Si algún día alguien lo lee para decidir un acceso, eso es un bug de
  seguridad, no una optimización.
