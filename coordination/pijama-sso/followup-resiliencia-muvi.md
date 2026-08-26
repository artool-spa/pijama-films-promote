# Follow-up — resiliencia ante la caída del catálogo (MUVI)

_Abierto por T0 · 2026-08-26 · decisión de JP tras un incidente real en producción_

## El requisito

**Cuando MUVI no responda, el sitio debe entregar un mensaje claro de que el problema está en
el proveedor del catálogo de películas**, no la pantalla cruda de error de Next.

## El incidente que lo originó

2026-08-26, ~17:45–18:10 hora de Chile. `promote.pijamafilms.com/films` mostraba:

```
This page couldn't load
A server error occurred. Reload to try again.
ERROR 1113709055
```

Causa raíz **medida**: el gateway de MUVI devolvía `503` sostenido (seis muestras espaciadas),
con `server: awselb/2.0` y `x-cache: Error from cloudfront` — su load balancer de AWS sin
backends sanos. La misma caída dejó el catálogo de Crazy Cake vacío en `pijamafilms.com`
(*"There are no recommendations available at the moment"*): **las dos plataformas leen de
MUVI**, así que una sola causa explicaba los dos síntomas.

**Descartado con evidencia:** nuestra app (`/login` y `/privacy-policy` en 200) · el nginx
heredado de Vultr (falla idéntica por el dominio y por la URL directa de App Hosting) · un
deploy nuestro (nada mergeado ese día) · el candado por IP de MUVI (un 5xx del ELB ocurre
antes de cualquier chequeo de credencial).

## La traza del throw

```
src/lib/muvi/api.ts:267   if (!response.ok)          ← entra el 503
src/lib/muvi/api.ts:269   if (status === 401)        ← no aplica
src/lib/muvi/api.ts:292   throw new MuviApiError
src/models/film.ts        getFilms catch → log + throw error   ← re-lanza
src/app/(dashboard)/films/page.tsx                    ← sin try/catch
```

Y **no existe ningún `error.tsx` ni `global-error.tsx` en todo `src/app`**, así que el throw
en un server component llega crudo al navegador.

La rama que devuelve lista vacía ante `status: 'FAILED'` **no** cubre esto: requiere un 200 con
cuerpo de error, y un 503 nunca llega ahí.

**Inconsistencia en el mismo archivo:** `getAggregateStats()` (`src/models/film.ts:572`)
degrada — su catch devuelve ceros. `getFilms()` (`:491`) re-lanza. La página podría haber
mostrado las estadísticas con un aviso.

## Alcance

**Diez rutas** del dashboard dependen de MUVI, no solo `/films`:

```
/films                                     /campaigns
/films/[id]/campaigns                      /campaigns/drafts
/films/[id]/assets                         /api/copies/generate
/films/[id]/campaigns/new
/films/[id]/campaigns/[campaignId]
/films/[id]/campaigns/[campaignId]/edit
/films/[id]/campaigns/[campaignId]/ads
```

Los triggers de `functions/` **no** llaman a MUVI: no hubo tormenta de reintentos ni cola
llenándose. Verificado.

## Propuesta, en dos piezas separadas

**1 · Mitigador.** Un `error.tsx` en el grupo `(dashboard)`. Convierte la pantalla cruda en un
mensaje legible para un productor. Chico, no toca lógica de negocio.

**2 · De fondo.** Que `getFilms()` degrade como ya degrada `getAggregateStats()`, y que la
página distinga los dos estados.

> **Decisión pendiente de JP, y es el punto delicado:** una lista vacía silenciosa se lee como
> *"no tienes películas"*, que para un productor es **peor** que un error honesto. La UI tiene
> que separar **"no hay catálogo"** de **"no se pudo cargar el catálogo"**. Degradar sin esa
> distinción cambia un problema visible por uno invisible.

## Cómo sondear MUVI de verdad

Aprendido a la mala en el mismo incidente: el vigilante que armó T0 declaró "recuperado" ante
un `403` transitorio, porque su condición era *"cualquier cosa que no sea 5xx"*.

**La sonda correcta es el endpoint que usa la app:**

```
POST https://apigateway.muvi.com/content
Content-Type: application/json
{"query":"{ __typename }"}
```

- **Servicio sano:** responde la *aplicación* — `server: Muvi Server`, JSON propio, incluso un
  `400` por parámetros faltantes. Eso prueba que procesa peticiones.
- **Servicio caído:** responde la *infraestructura* — `server: awselb/2.0`, HTML de nginx o
  CloudFront, `503`.

Un `GET` a la raíz no sirve: durante la recuperación devolvió `403`, que es ambiguo desde
afuera (rechazo normal a un anónimo, o credenciales revocadas).

**Lección generalizable:** una sonda que no ejercita el método y la ruta que usa la aplicación
no puede decir que la aplicación funciona. Es la misma doctrina que se exigió a los domain
agents —corrida por el ensamblador real, sin fakes en las fronteras— y T0 no la aplicó a su
propio monitor.

## Estado

Cerrado el incidente: MUVI se recuperó solo, sin desplegar nada, confirmado por JP en ambos
sitios. **El follow-up de resiliencia queda abierto** y no es urgente: con MUVI caído, ninguna
versión del código devuelve el catálogo. Lo que cambia es lo que ve el productor.
