# readme-T-envelope — Contract B: `partner` opcional en el envelope de Atlas

_Última actualización: 2026-08-28 · Proyecto: pijama-films-promote_

---

## Identidad

- **Agente:** FX-envelope (domain agent, reporta a T0)
- **Dominio:** el esquema Zod del envelope `ATLAS_AUTH` y cómo el panel de diagnóstico lo muestra.
- **Scope:** `src/app/auth/atlas-bridge.ts`, `src/app/auth/client.tsx` y sus dos test files.
- **No cubre:** `src/lib/atlas/**` y `src/app/api/auth/atlas/session/route.ts` — el servidor no
  depende del `partner` del envelope y no se tocó. Tampoco `src/app/dev/atlas-simulator/**`
  (ver "Decisiones abiertas": el fix lo rompe y está en manos de T0).

---

## Estado Actual

- **Repo:** `artool-spa/pijama-films-promote` · Branch: `fix/atlas-envelope-partner-optional`
  (base `feat/atlas-sso` @ `5e3a6a3`) · Commit: `a96fd84`, pusheado.
- **Deploy activo:** no aplica — este fix se cierra con tests, sin dev server. El worktree no tiene `.env`.
- **Suite de tests:** 515 tests / 40 archivos · 514 verdes, **1 rojo esperado y adjudicado**
  (`src/app/dev/atlas-simulator/__tests__/client.test.ts`, fuera de mi scope — ver abajo).
  Base antes de tocar nada: 507 tests / 40 archivos.
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

Base: **507 tests / 40 archivos**. Ahora: **515 tests**. Neto +8.

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
| 3 | colapsar `not-sent`/`not-read` en un `'not provided'` mudo | ☠️ **muerta** | 1 test: `says the partner was not sent` |
| 4 | agregar `.nullable()` junto al `.optional()` | ☠️ **muerta** | 1 test: `still rejects a null partner` |

Ninguna mutación quedó sin matar, así que no hay invariante declarada sin test que la proteja.
Las mutaciones 3 y 4 las agregué porque las dos de T0 solo cubren el esquema: 3 verifica que el
DoD 5 (el panel distingue en pantalla) esté realmente protegido y no sea solo texto que escribí,
y 4 verifica que la distinción `undefined` vs `null` sea una invariante testeada y no un
accidente de cómo escribí el esquema.

---

## DoD — estado

- [x] 1. Envelope sin `partner` se acepta.
- [x] 2. Envelope con `partner` bien formado sigue aceptándose y el panel lo muestra igual.
- [x] 3. `partner` presente pero malformado se rechaza (8 formas cubiertas).
- [x] 4. Sigue rechazándose `type` distinto, `token` ausente y `token` vacío.
- [x] 5. El panel distingue "no enviado" de "enviado" — y además de "no leído".
- [x] 6. `tsc --noEmit` limpio. Suite en 514/515: **falta el 1 rojo del simulador**, que es una
      decisión de T0, no un pendiente mío. Ver abajo.
- [x] 7. Comentario de contrato en `atlas-bridge.ts:9` corregido.
- [x] 8. Este archivo.

---

## Decisiones abiertas — lo único que bloquea el verde completo

**`src/app/dev/atlas-simulator/` clasifica como "roto" el envelope que Console manda de verdad.**

```
client.tsx:80-81           case 'missing-partner': return { type: ATLAS_MESSAGE_TYPE, token };
__tests__/client.test.ts:26-30
    for (const shape of ['missing-token', 'wrong-type', 'missing-partner'] as const) {
      expect(atlasAuthEnvelopeSchema.safeParse(...).success).toBe(false);
```

Ese `{ type, token }` es la forma **real** de producción, no un modo de falla. El test ahora
falla (`expected true to be false`) y **tiene razón en fallar**: describe la creencia vieja.
Los dos archivos están fuera de mi lista asignada, así que no los toqué y escalé a T0.

Propuesta enviada a T0 (mínima, sin inventar features):

1. Renombrar la forma `'missing-partner'` → `'console-shape'`, moverla al grupo de formas
   **válidas**, y etiquetarla en la UI del simulador como "lo que Console manda de verdad".
2. Ajustar su test: sale del bucle de rechazados, entra como caso aceptado.

Costo de dejarlo como está: el simulador queda incapaz de reproducir el handoff de producción,
que es su razón de existir, y quien lo use vería "rechazado" para la forma correcta.

---

## Para quien tome mi lugar

- El worktree es `/Users/jpudev2/Proyectos/pijama-fx-envelope`, sin `.env` y sin necesitarlo.
- `npx yarn@1.22.22 test --run` y `npx tsc --noEmit` son toda la verificación que este fix admite.
- Si vuelves a tocar el esquema, corre las 4 mutaciones de la tabla de arriba antes de reportar
  verde. Están descritas de forma que se reproducen a mano en un minuto.
- La regla que no se puede relajar: el `partner` del envelope es dato de cliente y es
  **display-only**. Si algún día alguien lo lee para decidir un acceso, eso es un bug de
  seguridad, no una optimización.
