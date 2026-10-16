# STATUS — SSO dashboard PijamaFilms → promote.pijamafilms.com

_Última actualización: **2026-10-16** · Actualizado por: T0 · Tope: 8 KB._
_Historial completo hasta el 2026-10-01: `historico/STATUS-hasta-2026-10-01.md` (no editar)._
_"Atlas" es el nombre viejo: sobrevive en variables y rutas; no usarlo con Crazy Cake ni Pijama._

## 1. Estado actual + burndown (2026-10-16)

```
producción  pijama-promote-firebase · rama master (aa67989) · mergear DESPLIEGA
desarrollo  pijama-promote-dev      · rama dev (dev ⊇ master) · 843 tests
```

- En producción: SSO, Stripe propio, DNS directo y el hotfix del middleware (PR #76). Rollout verificado.
- En dev (no promovido): catálogo por partner (PR #71, a31eddc) y fixes de propiedad (#72-#75).
- Dev entero contra lab (SSO + catálogo), con allowlist de un solo partner (6984824e…).
- Bloqueante del Go Live: promover el scoping a producción. Falta la API de producción de Console.

## 2. Ciclo cerrado (2026-10-15/16): catálogo por partner + propiedad

- **#71 → dev:** sesión Atlas (uid `atlas:`) usa `/external/partner-movies` con el partnerId de la sesión;
  usuarios internos ven el catálogo global de MUVI. Campañas bloqueadas para películas que MUVI informa
  no disponibles (región 400 / gone 1317): fail-closed, con 503 distinto si MUVI está caído. Secreto
  `ATLAS_SERVER_API_KEY` solo en `pijama-promote-dev`.
- **#72, #73, #74 → dev:** IDOR en creación de campañas Meta; verificación de propiedad (404 idéntico) en
  campañas por id, sync/edit, aprobación de anuncios e insights.
- **#75 → dev:** el bypass admin `pijamafilms` exige sesión `internal` (header `x-pijama-session-origin`
  fijado por el middleware). Atlas rechaza el partnerId reservado.
- **#76 → MASTER (hotfix de seguridad):** el middleware dejaba pasar sin sesión cualquier path con '.'
  (p. ej. /api/x.y) sin borrar los headers internos. Confirmado con test (15 fallas en master).
  Exposición: solo un id real con punto (no se encontró ninguno). Producción verificada:
  /api/meta/campaigns/abc.def → 401, 0 errores, env sin cambios.
- **#70 (doc MUVI) → master y #77 master → dev.**

## 3. Pendientes

- **JP:** enviar el borrador del correo a Mathias (en Gmail). Pide: `marketingUrl` de lab →
  https://pijama-films-promote--pijama-promote-dev.us-central1.hosted.app/auth; una cuenta de productor
  en lab; el registro correcto de Ema (…0076 geobloqueado vs …5e07); URL y fecha de la API de
  producción; asignar Neruda y Ema en producción; `marketingUrl` de producción → `/auth`; si los
  assets `short` son promo o película.
- Click-through SSO en dev: depende de Crazy Cake.
- Promover dev → master (catálogo por partner + propiedad): requiere OK de JP. Ojo: el secreto y la API
  de producción de Console aún no existen.
- Rotar el bearer de la API externa cuando todo funcione (decisión de JP: no antes).
- Carrera de `getOrCreatePartner` sin transacción en el primer login SSO concurrente: anotada, sin tocar.
- Fuera de ciclo: eventos de analytics para Jorge León; fases 3-4 (audiencias, corte); rotar las 15
  credenciales del transcript del 10-01; evento de prueba de Stripe; sacar `dashboard-lab` de los
  orígenes de producción; restringir claves de Firebase Web (públicas por diseño).

## 4. Decisiones abiertas de JP

| # | Tema | Recomendación de T0 |
|---|---|---|
| a | Rutas `/api/partners` (GET lista, POST, [id] GET/PATCH/DELETE): ninguna pantalla las usa | Borrarlas |
| b | Assets por película (images/videos/archive/revalidate/upload) sin verificación de propiedad | Verificar con el `getFilmById` filtrado de #71 → 404 |
| c | Usuarios Firebase con partnerId ≠ pijamafilms ven el catálogo global (`TODO(T0)` en film.ts) | Decidir alcance |
| d | Cambio suelto sin commitear en la copia de JP: `apphosting.yaml` + `ATLAS_SERVER_API_KEY` (rompería el build de producción) | Descartarlo |
| e | Orden y fecha de las fases 3-4 | Pendiente |

## 5. Contratos

| Contrato | Estado real |
|---|---|
| A — `POST /api/auth/atlas/session` | Validado, 8 stages |
| B — envelope `postMessage` | Canje verificado en producción (09-17). El botón de Marketing NUNCA funcionó: `marketingUrl` apunta a la raíz y no a `/auth`. Pendiente de Crazy Cake |
| C — `GET /movies/by-partner` | Reemplazado por C2 para el catálogo |
| C2 — API externa (`/external/partner-movies`, `/external/partners`) | Integrado y verificado en dev contra lab; sin API de producción |
| D — simulador inaccesible en producción | Validado, dos capas con test |

## 6. Lecciones / gotchas vigentes

- Un subagente con "no edites el repo" dejó un cambio sin commitear en la copia principal del usuario
  (apphosting.yaml + secreto inexistente en producción) que habría tumbado el build. Revisar `git status`
  de esa copia al cerrar cada ciclo.
- Los mensajes T0↔agente se cruzan: el agente reporta un mundo viejo. Verificar contra la rama (git log o
  diff) antes de repetir un reporte.
- `git checkout -- <archivo>` para revertir una mutación borró trabajo sin commitear dos veces: commitear
  antes de mutar.
- La verificación independiente de un PR de endurecimiento halló un bypass preexistente más grave (path con
  '.'). Siempre preguntar "¿qué caminos NO pasan por el chequeo?".
- Un subagente se negó a explotar por red contra dev sin autorización. Funcionó un test contra el
  middleware real, sin red.
- `apphosting:rollouts:list` no existe en esta versión de firebase-tools: usar la REST API v1beta.
- Verificar el mecanismo no es verificar el camino del usuario (el botón de Marketing falló seis semanas).
- La fusión de `apphosting.yaml` solo se ve en el servicio desplegado (`gcloud run services describe`);
  omitir un override hereda el valor de producción.
- Secretos de App Hosting: dos identidades (ejecución y build), `apphosting:secrets:grantaccess`. Uno
  faltante tumba el build. Rotar un secreto no despliega: `apphosting:rollouts:create`.
- MUVI está atado a IP y una película puede estar dos veces; cruzar por título o assets no sirve.
- El contrato de Crazy Cake cambió sin aviso (09-23); `AtlasMovieSchema` es `passthrough`. Mirar los
  datos antes de escribir un correo.
- Un borrador de Gmail actualizado pierde el hilo: rehacerlo. Nunca `git add -A` con agentes en paralelo.

## 7. Cómo retomar

1. Leer este archivo y `HANDOFF-2026-10-02.md`; el histórico solo para consultar.
2. Revisar `git status` de la copia de JP y la decisión (d).
3. Confirmar si JP envió el correo a Mathias y qué respondió; esperar la API de producción antes de promover.
4. Verificar contra la rama y un build propio (`tsc`, `lint`, `test`), no contra reportes.
5. Nunca poner el Bearer en archivos, commits ni argumentos; solo en Secret Manager de dev.
