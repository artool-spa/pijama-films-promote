# STATUS — SSO dashboard PijamaFilms → promote.pijamafilms.com

_Última actualización: **2026-10-20 (cierre del turno)** · Actualizado por: T0 · Tope: 8 KB._
_Historial completo hasta el 2026-10-01: `historico/STATUS-hasta-2026-10-01.md` (no editar)._
_"Atlas" es el nombre viejo: sobrevive en variables y rutas; no usarlo con Crazy Cake ni Pijama._

## 1. Estado actual (2026-10-20)

```
producción  pijama-promote-firebase · master (aa67989) · mergear DESPLIEGA
desarrollo  pijama-promote-dev      · dev (f1b5318)    · 1040 tests
```

- En producción: SSO, Stripe propio, DNS directo y el hotfix del middleware (#76).
- En dev, sin promover: catálogo por partner (#71), propiedad de rutas (#72-#75, #78-#81). Dev corre contra lab.
- **BLOQUEANTE: promover dev → master queda detenido** por el guard de región (ver §2) y por la falta de la
  API de producción de Console. Al 2026-10-20 Mathias no ha respondido (correo y búsqueda fuera del hilo).

## 2. DECISIÓN DE JP (2026-10-16): el guard de región es incorrecto

"No puede haber errores de promoción en países con bloqueo por IP, ni bloqueo donde sí se puede."
El guard de #71 (`src/lib/muvi/availability.ts`, `assertFilmPromotable` en createCampaign) pregunta a MUVI
desde la IP de NUESTRO servidor: su veredicto refleja el país de esa IP, no los países de la campaña. Falla
en ambas direcciones. Es incorrecto por diseño y NO debe llegar a producción tal cual.
**Reemplazo:** países de la campaña ⊆ países donde está disponible el `muviContentUuid`, con datos por país
que deben venir de Crazy Cake (pedidos en el correo). **No implementar hasta tener el formato de esos datos.**

## 2b. BURNLIST — próximos tres turnos (decidido por JP el 2026-10-20)

| Turno | Frente | Issue | Notas |
|---|---|---|---|
| 1 | Endurecer `create-and-sync` (409 fuera de DRAFT/ERROR/PENDING_ASSETS con ids de plataforma nulos) + idempotencia del cargo por `campaignId` | #82 | Duplica campañas gastando y cobros. Verificar antes el rollback de fallo parcial (`sync.ts:361`, `:550`). Mutación obligatoria. |
| 1 (si no comparte archivos con #82) | Usuarios Firebase de otro partner dejan de ver el catálogo global | #83 | JP dijo SÍ a la decisión (b). Resuelve el `TODO(T0)` en `film.ts`. |
| 2 | Fase 3: recrear audiencias en cuentas nuevas de Meta y Google; rotar las 15 credenciales | #84 | Va DESPUÉS de #82 (orden de JP). Crear audiencias exige accesos de JP: T0 solo prepara la lista. |
| 3 | Auditoría completa de rutas antes del Go Live: matriz ruta × sesión/propiedad/Zod/tests; primero reportar, luego corregir | #85 | Preguntar "¿qué caminos NO pasan por el chequeo?". Verificador distinto del autor. |
| después | Fase 4 renombrada "migración de cuentas publicitarias" (no confundir con el DNS, ya cortado) | #84 | Depende de la 3 y de dev promovido. Orden no negociable en HANDOFF:59-75. |

Fuera del burnlist (JP lo ve con otro agente): alerta de presupuesto GCP, ver §4.

## 3. Ciclo cerrado (2026-10-15/16)

- **#71-#76:** catálogo por partner (SSO), IDOR en campañas Meta, 404 idéntico, bypass `pijamafilms` solo con sesión
  `internal`, hotfix de middleware a master (#76).
- **#78-#81 → dev:** sin `/api/partners` (quedan sin uso `getAllPartners`, `createPartner`, `updatePartner`,
  `deletePartner` en `src/models/partner.ts`: limpieza no urgente); propiedad de assets, de película en campañas y
  drafts, draft solo en DRAFT (409), medios de la misma película, google sync con campaignId verificado.
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
- **Alerta de presupuesto GCP** (JP la ve con otro agente): 100% de US$50 el 2026-10-14 en la cuenta Artool SPA
  (016970-330514-356989, ~50 proyectos). Verificado: Promote no la explica a simple vista (Cloud Run minScale=0,
  4 funciones, 2 jobs de Scheduler). No verificado: costo por proyecto; no hay export a BigQuery y la API de
  presupuestos no está habilitada en artool-hiroshima. Vía rápida: Billing > Reports, agrupar por Project y
  Service. Hipótesis: otro proyecto con Gemini API.
- Fuera de ciclo: analytics para Jorge León; rotar las 15 credenciales del transcript del 10-01; evento de
  prueba de Stripe; sacar `dashboard-lab` de los orígenes de producción; restringir claves Firebase Web.

## 5. Decisiones de JP (2026-10-20)

| # | Tema | Resolución |
|---|---|---|
| a | `create-and-sync` con draftId sin exigir DRAFT | Issue #82, primer frente del turno siguiente |
| b | Usuarios Firebase de otro partner ven el catálogo global | SÍ, se restringe: issue #83 |
| c | Cambio suelto en `apphosting.yaml` de la copia de JP | Cerrada: la copia está limpia en master (verificado 10-19) |
| d | Orden de las fases 3-4 | Fase 3 después de #82; la 4 se renombra y va tras la 3 (#84) |

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
- Cada PR de propiedad halló otro hueco al lado (#72, #75, #80, #81): auditoría completa de rutas (#85), no parches.
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

1. Leer la respuesta de Mathias, si llegó (buscar también fuera del hilo "Pruebas de integración de marketing").
2. Ejecutar el turno 1 del burnlist (§2b): #82, y #83 si no comparte archivos. Agente fresco por issue, con
   mutación y verificación independiente contra la rama.
3. Diseñar el chequeo por país solo cuando lleguen los datos; promover dev → master con OK de JP y API de producción.
Antes: leer `HANDOFF-2026-10-02.md`, revisar `git status` de la copia de JP y verificar contra la rama con build
propio (`tsc`, `lint`, `test`). Nunca poner el Bearer en archivos, commits ni argumentos.
