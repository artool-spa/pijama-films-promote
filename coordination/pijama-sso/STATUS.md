# STATUS — SSO dashboard PijamaFilms → promote.pijamafilms.com

_Última actualización: **2026-10-16 (cierre del turno)** · Actualizado por: T0 · Tope: 8 KB._
_Historial completo hasta el 2026-10-01: `historico/STATUS-hasta-2026-10-01.md` (no editar)._
_"Atlas" es el nombre viejo: sobrevive en variables y rutas; no usarlo con Crazy Cake ni Pijama._

## 1. Estado actual (2026-10-16)

```
producción  pijama-promote-firebase · master (aa67989) · mergear DESPLIEGA
desarrollo  pijama-promote-dev      · dev (f1b5318)    · 1040 tests
```

- En producción: SSO, Stripe propio, DNS directo y el hotfix del middleware (#76).
- En dev, sin promover: catálogo por partner (#71), propiedad de rutas (#72-#75, #78-#81). Dev corre contra lab.
- **BLOQUEANTE: promover dev → master queda detenido** por el guard de región (ver §2) y por la falta de la
  API de producción de Console.

## 2. DECISIÓN DE JP (2026-10-16): el guard de región es incorrecto

"No puede haber errores de promoción en países con bloqueo por IP, ni bloqueo donde sí se puede."
El guard de #71 (`src/lib/muvi/availability.ts`, `assertFilmPromotable` en createCampaign) pregunta a MUVI
desde la IP de NUESTRO servidor: su veredicto refleja el país de esa IP, no los países de la campaña. Falla
en ambas direcciones. Es incorrecto por diseño y NO debe llegar a producción tal cual.
**Reemplazo:** países de la campaña ⊆ países donde está disponible el `muviContentUuid`, con datos por país
que deben venir de Crazy Cake (pedidos en el correo). **No implementar hasta tener el formato de esos datos.**

## 3. Ciclo cerrado (2026-10-15/16)

- **#71-#76 (resumen):** catálogo por partner para sesiones Atlas; IDOR en campañas Meta; propiedad con 404
  idéntico; bypass `pijamafilms` solo con sesión `internal`; #76 hotfix del middleware (paths con '.') a master.
- **#78 → dev:** se borraron las rutas `/api/partners`. Sin uso en `src/models/partner.ts`: `getAllPartners`,
  `createPartner`, `updatePartner`, `deletePartner` (limpieza no urgente).
- **#79 → dev:** propiedad de assets por película (imágenes, videos, archive, upload, revalidate, crop) con
  `assertFilmAccessible`: 404 si es ajeno, 503 si no se puede verificar. Internos sin chequeo (catálogo global).
- **#80 → dev:** propiedad de la película en createCampaign, saveDraftCampaign, draft de create-and-sync y
  copies/generate. Corrige IDOR en campaigns/draft update (draftId ajeno).
- **#81 → dev:** draft update solo acepta DRAFT (409); medios de un anuncio de la misma película; meta/ads y
  google/ads POST, y google create-and-sync con campaignId verifican propiedad (este permitía sincronizar
  campañas ajenas a Google Ads).
- Todas verificadas por un agente independiente, con mutación.

## 4. Pendientes

- **Correo a Mathias: ENVIADO por JP el 2026-10-16.** Pide: `marketingUrl` de lab →
  https://pijama-films-promote--pijama-promote-dev.us-central1.hosted.app/auth; registro correcto de Ema
  (…0076 vs …5e07) y lo mismo para Fuga y Tony Manero; disponibilidad POR PAÍS o región de cada
  `muviContentUuid`; URL y fecha de la API de producción (falta el visto bueno de Juan); si los assets
  `short` son promo o película. JP QUITÓ A PROPÓSITO: cuenta de productor en lab, asignar Neruda y Ema en
  producción y `marketingUrl` de producción. No volver a pedirlos sin que él lo diga.
- Click-through SSO en dev: depende de Crazy Cake.
- Rotar el bearer de la API externa cuando todo funcione (decisión de JP: no antes).
- Carrera de `getOrCreatePartner` sin transacción en el primer login SSO concurrente: anotada.
- Fuera de ciclo: analytics para Jorge León; rotar las 15 credenciales del transcript del 10-01; evento de
  prueba de Stripe; sacar `dashboard-lab` de los orígenes de producción; restringir claves Firebase Web.

## 5. Decisiones abiertas de JP

| # | Tema |
|---|---|
| a | create-and-sync con draftId no exige DRAFT (así funciona el reintento tras un sync fallido): ¿se deja? |
| b | Usuarios Firebase con partnerId ≠ pijamafilms ven el catálogo global (`TODO(T0)` en film.ts) |
| c | Cambio suelto sin commitear en la copia de JP: `apphosting.yaml` + `ATLAS_SERVER_API_KEY`; rompería el build de producción si llega a master. Descartar con `git checkout -- apphosting.yaml`. La copia sigue en 21e2560: `git pull`; el diff de docs/atlas-sso-integration.md lo absorbe #70 |
| d | Orden y fecha de las fases 3-4 (audiencias, corte), si sigue abierto |

## 6. Contratos

| Contrato | Estado real |
|---|---|
| A — `POST /api/auth/atlas/session` | Validado, 8 stages |
| B — envelope `postMessage` | Canje verificado en producción. El botón Marketing nunca funcionó: `marketingUrl` apunta a la raíz y no a `/auth`. Pendiente de Crazy Cake |
| C2 — API externa (`/external/partner-movies`, `/external/partners`) | Verificado en dev contra lab; sin API de producción |
| D — simulador inaccesible en producción | Validado, dos capas con test |

## 7. Lecciones / gotchas vigentes

- Un chequeo de disponibilidad hecho desde la IP del servidor mide al servidor, no al usuario ni al país
  objetivo. Lo detectó JP al redactar el correo, no la verificación. Preguntar: ¿desde dónde se mide, y es el
  mismo sujeto que importa?
- Cada PR de propiedad halló otro hueco al lado: #72 → 14 rutas, #75 → middleware, #80 → draft update,
  #81 → google sync. Antes del Go Live, auditoría completa de rutas, no parches.
- Un subagente con "no edites el repo" dejó un cambio sin commitear en la copia de JP. Revisar `git status`
  de esa copia al cerrar cada ciclo.
- Los reportes T0↔agente se cruzan: verificar contra la rama antes de repetirlos. Nunca `git add -A` con
  agentes en paralelo; commitear antes de mutar (`git checkout --` borró trabajo dos veces).
- Verificar el mecanismo no es verificar el camino del usuario. Preguntar "¿qué caminos NO pasan por el chequeo?".
- `apphosting:rollouts:list` no existe: usar REST v1beta. La fusión de `apphosting.yaml` solo se ve en el
  servicio desplegado; omitir un override hereda el valor de producción.
- Secretos de App Hosting: dos identidades (ejecución y build), `apphosting:secrets:grantaccess`. Rotar no
  despliega: `apphosting:rollouts:create`.
- MUVI está atado a IP y una película puede estar dos veces; cruzar por título o assets no sirve.
- El contrato de Crazy Cake cambió sin aviso (09-23): mirar los datos antes de escribir un correo.

## 8. Cómo retomar

1. Leer la respuesta de Mathias.
2. Diseñar el chequeo por país con sus datos (no antes de tener el formato).
3. Promover dev → master con OK de JP (y API de producción de Console).
Antes: leer `HANDOFF-2026-10-02.md`, revisar `git status` de la copia de JP (decisión c) y verificar contra la
rama con build propio (`tsc`, `lint`, `test`). Nunca poner el Bearer en archivos, commits ni argumentos.
