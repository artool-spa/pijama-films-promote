# STATUS — SSO dashboard PijamaFilms → promote.pijamafilms.com

_Última actualización: **2026-10-15** · Actualizado por: T0 · Tope: 8 KB._
_Historial completo hasta el 2026-10-01: `historico/STATUS-hasta-2026-10-01.md` (no editar)._
_"Atlas" es el nombre viejo: sobrevive en variables y rutas; no usarlo con Crazy Cake ni Pijama._

## 1. Estado actual + burndown (2026-10-15)

```
master 21e2560 · 649 tests
producción  pijama-promote-firebase · rama master (mergear DESPLIEGA)
desarrollo  pijama-promote-dev      · rama dev
```

- Ya en producción: SSO, Stripe propio, DNS directo a App Hosting.
- Separación de ambientes: fases 1-2 listas. Fases 3-4 pendientes (trabajo de consolas, ver
  `HANDOFF-2026-10-02.md`).
- Bloqueante del Go Live: el scoping por partner (`getFilms()` no filtra). El ciclo de abajo lo
  desbloquea.

## 2. Ciclo actual: fuente del catálogo = API externa de Crazy Cake

**DECISIÓN de JP (2026-10-15):** se adoptan `GET /external/partner-movies?partnerId=` y
`GET /external/partners` de Console como fuente del catálogo por partner (doc Postman
https://documenter.getpostman.com/view/110727/2sBYHPzhCC, base lab
https://dashboard-lab.pijamafilms.com). Reemplaza el catálogo global de MUVI. Cierra la decisión
"fuente del catálogo" y desbloquea el scoping.

**Bearer de testing:** llegó por correo en texto plano el 2026-10-07. JP decidió (2026-10-15)
usarlo tal cual en todas las pruebas y pedir la rotación cuando todo funcione. Se carga solo en
`pijama-promote-dev` como secreto `ATLAS_SERVER_API_KEY` (nombre provisorio).

| Paso | Estado |
|---|---|
| 1. Cargar el secreto y probar la API real | EN CURSO |
| 2. Domain agent de catálogo: cliente + Zod + `getFilms()` filtrado por partner + contrato C2; merge a `dev` | PENDIENTE de (1) |
| 3. Borrador de respuesta a Mathias, DESPUÉS de probar: preguntar URL y fecha de producción, el registro correcto de Ema, una clave por ambiente por canal seguro; insistir en asignar Neruda y Ema en producción y en el `marketingUrl` → `/auth` | PENDIENTE de (1) |

PR #70 abierto (`docs/atlas-sso-integration.md`, mediciones MUVI del 10-02), esperando OK de JP.

## 3. Fuera de este ciclo

- Documento de eventos de analytics para Jorge León (prometido 09-22). JP: va por separado.
- Fase 3 (audiencias) y fase 4 (corte).
- Rotar las 15 credenciales del transcript del 10-01.
- Evento de prueba de Stripe (esperado `400 "Missing session metadata"` = firma verificada).
- Sacar `dashboard-lab` de los orígenes permitidos en producción.
- Restringir las claves de Firebase Web (diferido; son públicas por diseño).
- `.env.backup-20261001-165623`: ya no existe (verificado 2026-10-15). Cerrado.

## 4. Decisiones abiertas de JP

| # | Tema | Estado |
|---|---|---|
| 1 | Rotación del Bearer de testing | Tras el éxito de las pruebas (ver 2) |
| 2 | OK para mergear el PR #70 | Pendiente |
| 3 | Orden y fecha de las fases 3-4 | Pendiente |

Obsoletas: #6 (deploy para probar `postMessage`) y #7 (cuenta admin sin `partnerId`) de agosto;
el SSO ya está probado en producción (09-17).

## 5. Contratos

| Contrato | Estado real |
|---|---|
| A — `POST /api/auth/atlas/session` | Validado, 8 stages |
| B — envelope `postMessage` | Canje de token verificado en producción (09-17). El botón de Marketing NUNCA funcionó: `marketingUrl` apunta a la raíz y no a `/auth`. Pendiente de Crazy Cake |
| C — `GET /movies/by-partner` | Acceso server-to-server funciona y la forma calza desde 09-23. Será reemplazado por C2 para el catálogo |
| C2 — API externa (`/external/partner-movies`, `/external/partners`) | En prueba |
| D — simulador inaccesible en producción | Validado, dos capas con test |

## 6. Lecciones / gotchas vigentes

- Verificar el mecanismo no es verificar el camino del usuario: el botón de Marketing falló seis
  semanas porque solo se validó el canje del token.
- El resultado de la fusión de `apphosting.yaml` solo se ve en el servicio desplegado
  (`gcloud run services describe`); omitir un override hereda el valor de producción.
- Los secretos de App Hosting necesitan dos identidades (ejecución y build); usar
  `apphosting:secrets:grantaccess`. Un secreto faltante tumba el build entero.
- Rotar un secreto no despliega nada: hay que crear un rollout con `apphosting:rollouts:create`.
- Firebase Auth no viene inicializada en un proyecto nuevo; el primer `deploy:functions` falla una vez
  por la carrera de Eventarc y al reintentar queda.
- zsh no divide variables sin comillas; rechazar el hash SHA-256 de la cadena vacía (`e3b0c442…`) al verificar copias.
- MUVI está atado a IP y una película puede estar dos veces; cruzar por título o assets no sirve.
- El contrato de Crazy Cake cambió sin aviso (09-23); `AtlasMovieSchema` es `passthrough`, así que no rompió.
  Un `created_by` único no dice de quién es la tienda: mirar los datos antes de escribir un correo.
- Un borrador de Gmail actualizado pierde el hilo: rehacerlo. Nunca `git add -A` con agentes en paralelo.

## 7. Cómo retomar

1. Leer este archivo y `HANDOFF-2026-10-02.md`; el histórico solo para consultar.
2. Confirmar si el paso 1 (secreto y prueba de la API real) terminó y qué devolvió.
3. Con eso, lanzar el domain agent de catálogo (paso 2) y redactar la respuesta a Mathias (paso 3).
4. Verificar contra el árbol y un build propio (`tsc`, `lint`, `test`), no contra reportes.
5. Nunca poner el Bearer en archivos, commits ni argumentos; solo en Secret Manager de dev.
