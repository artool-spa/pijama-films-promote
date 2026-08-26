# Runbook — la prueba del SSO, paso a paso

_Escrito por T0 para JP · 2026-08-26 · **en firme**: verificado sobre `41438cf`, 504/504.

---

## Qué responde esta prueba

Dos preguntas independientes, y conviene no mezclarlas:

| | Pregunta | Dónde se responde | Necesita deploy |
|---|---|---|---|
| **A** | ¿Atlas acepta el JWT y devuelve las películas del partner? (**Contrato C**) | **En local**, con el simulador | **No** |
| **B** | ¿Console realmente postea el `ATLAS_AUTH` a nuestra ventana? (**Contrato B**) | Solo en producción | **Sí** |

**Haz la A primero.** Es la que tiene el riesgo real —ya medimos dos contradicciones entre lo
que Crazy Cake documentó y lo que su servidor entrega— y no cuesta un deploy. Si la A falla,
la B no sirve de nada todavía.

---

## Parte A · Contrato C, en local

### A1. Levantar el entorno

```bash
cd /Users/jpudev2/Proyectos/pijama-films-promote
git checkout feat/atlas-sso
git merge origin/feat/atlas-sso-server origin/feat/atlas-sso-page
npx yarn@1.22.22 dev
```

Necesitas en tu `.env` (todas son configuración pública, ningún secreto nuevo):

```
ATLAS_API_BASE_URL="https://dashboard.pijamafilms.com"
NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS="https://dashboard.pijamafilms.com,https://dashboard-lab.pijamafilms.com"
ATLAS_LOGIN_ENABLED="false"
ATLAS_LOGIN_ALLOWED_PARTNER_IDS=""
```

Las dos últimas déjalas así: el login arranca cerrado a propósito.

### A2. Sacar el token de tu sesión de Atlas

Con tu sesión abierta en `https://dashboard.pijamafilms.com`, abre las DevTools del navegador
y busca el JWT en el storage de esa pestaña (Application → Local Storage / Session Storage).
Es un string que empieza con `eyJ`.

**Tratalo como una credencial de producción, porque lo es.** Vive 24 horas. No lo pegues en
un chat, ni en un archivo, ni me lo mandes a mí — no lo necesito y no debo verlo.

### A3. Correr el probe

Abre `http://localhost:3000/dev/atlas-simulator`, pega el token en el campo (va a estar
enmascarado, tipo contraseña) y dispara el flujo en modo **probe**.

El simulador abre `/auth` en una ventana nueva y postea el token igual que lo haría Console,
así que se ejercita el camino completo: `postMessage` → listener → endpoint → servidor →
Atlas. Sin atajos ni piezas falsas en ninguna frontera.

### A4. Leer el resultado

El panel te va a mostrar `atlasStatus`, `contractMatched` y `partner`. Esa combinación es la
respuesta:

| `atlasStatus` | `contractMatched` | `partner` | Qué significa y qué sigue |
|---|---|---|---|
| 200 | `true` | `{...}` | **El SSO funciona.** Siguiente paso: poblar la allowlist con ese `partnerId` y probar el modo `login`. |
| 200 | `true` | `null` | **El SSO funciona, pero tu cuenta es admin y no tiene partner.** No es un fallo. Hace falta una cuenta de productor en el dashboard. |
| 200 | `false` | — | Atlas respondió otra cosa. `responseShapeKeys` es el hallazgo que va a Crazy Cake. |
| 302 | `false` | — | Token rechazado, o la base URL no es esa. El mensaje trae el destino del redirect. |
| 0 | `false` | — | No se llegó a Atlas: DNS, timeout, o la variable sin configurar. |

**El más probable es el segundo**, porque tu cuenta administra todas las películas de la
plataforma y el endpoint es por partner. Que el panel diga "el SSO funciona" en ese caso es
deliberado: es la conclusión correcta, no un error.

**Referencia medida por T0 el 2026-08-26**, con un token inválido a propósito:

```json
{"ok":true,"diagnostics":{
  "atlasUrlTried":"https://dashboard.pijamafilms.com/movies/by-partner",
  "atlasStatus":302,"contractMatched":false,"partner":null,"responseShapeKeys":[]}}
```

Si con tu token real sale exactamente eso, el token no está siendo aceptado o el base URL
está equivocado — no es que el código falle.

### A5. Los otros cuatro casos del simulador

Si quieres confirmar que el panel distingue bien los estados (vale la pena: es lo que evita
que un SSO que funciona se vea roto), el `readme-T2.md` tiene el guion completo. El caso que
más importa es el de **mensaje perdido**: debe decir *"Nothing was posted to this window at
all"*, que es un estado distinto de "llegó y falló".

En todos, un `Ctrl+F` en la página debe **no** encontrar tu token completo.

---

## Parte B · Contrato B, en producción

Requiere merge a la rama que despliega, así que **es una decisión tuya y no la tomo yo.**

Antes de decidir, tres cosas que ese deploy arrastra además del SSO:

1. **`STRIPE_SECRET_KEY` v3** — la clave live rotada. Producción está en modo test desde el
   viernes 21, así que esto es deseable, pero es un cambio de comportamiento real en cobros.
2. **`META_PIXEL_ID` v2** — el valor real en vez del placeholder.
3. **`NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS` se hornea en build.** Mergear no la activa: hace
   falta que App Hosting reconstruya. Si se mergea sin rollout, `/auth` rechaza a Console en
   silencio — aunque el panel lo va a decir en pantalla ("none configured"), así que el
   síntoma es legible.

Y el PR #45 del webhook de Stripe sigue necesitando el `whsec_` que falta de Pablo.

**Cuando decidas hacerlo**, la prueba es: entrar a `dashboard.pijamafilms.com`, abrir la
herramienta de promoción, y mirar el panel de `/auth`. Ahí se responde si el `postMessage`
llega y de qué origen.

---

## Qué no cierra esta prueba

**El alcance por partner.** `getFilms()` sigue sin filtrar, así que cualquier sesión ve el
catálogo completo y las estadísticas de toda la plataforma. Por eso el login arranca cerrado
y detrás de allowlist. Es el otro bloqueante del Go Live y es un proyecto aparte.
