# Transición de DNS — sacar el proxy heredado del camino

_T0 · 2026-08-28 · dominio ya registrado en App Hosting_

## Situación medida

`promote.pijamafilms.com` resuelve a **`64.176.6.210`** (Vultr), la IP que Pablo entregó el
19 de enero. El tráfico entra por un **nginx/1.31.3** en esa VM y se reenvía a App Hosting:

```
por el dominio       server: nginx/1.31.3   dur=450 ms
directo App Hosting  server: envoy          dur= 77 ms
```

**Casi 6× de latencia** por un intermediario que ya no cumple ninguna función. El `CLAUDE.md`
dice que el deployment es App Hosting y **no menciona esa VM**, o sea es un punto único de
falla, sin monitoreo, en el camino de todos los usuarios, y que no está documentado.

**Corrección de una especulación previa de T0:** se dijo que ese salto "probablemente determina
qué IP ve MUVI". **Falso.** `MUVI_IP_ADDRESS` es un valor que *enviamos* dentro del payload de
la consulta (`src/lib/muvi/api.ts:319`), no un chequeo contra nuestra IP de egreso; y el nginx
solo proxea tráfico **entrante**, mientras las llamadas a MUVI salen desde Cloud Run. **Mover
el A record no toca MUVI.**

## Lo hecho

`promote.pijamafilms.com` **no estaba registrado** como custom domain en App Hosting — solo
existía el `hosted.app` por defecto. Por eso el proxy era el único camino y por eso no existían
valores de DNS que pedir: App Hosting los emite recién al registrar el dominio.

Registrado el 2026-08-28 21:31 UTC, con `validateOnly` primero:

```
POST .../backends/pijama-promote/domains?domainId=promote.pijamafilms.com
type: CUSTOM · uid 198b7569-ffc4-4fa3-82f1-0e9360663173
estado inicial: ownership OWNERSHIP_MISSING · host HOST_WRONG_SHARD · cert CERT_VALIDATING
```

**Crear el dominio no movió tráfico**: el DNS sigue apuntando a Vultr y el sitio sirve igual.

## Los registros, de `requiredDnsUpdates`

DNS de `pijamafilms.com` está en **Route 53 de Crazy Cake** (`ns-*.awsdns-*`), así que los
aplican ellos. TTL actual del A record: **300 s**.

### Etapa 1 — sin impacto, solo agrega

| Acción | Tipo | Nombre | Valor |
|---|---|---|---|
| AGREGAR | TXT | `promote.pijamafilms.com` | `fah-claim=002-02-198b7569-ffc4-4fa3-82f1-0e9360663173` |
| AGREGAR | CNAME | `_acme-challenge_kxvtiox5aof6c5rr.promote.pijamafilms.com.` | `8dfbdf5f-5c3e-4515-ac81-e54ed3739426.1.authorize.certificatemanager.goog.` |

Verifica propiedad y emite el certificado. **El A record no se toca y el tráfico sigue por el
proxy.** No hay ventana de riesgo: se puede aplicar cualquier día y esperar.

Verificado que **no existe ningún TXT previo** en ese subdominio, así que no hay conflicto.

### Etapa 2 — el corte

| Acción | Tipo | Nombre | Valor |
|---|---|---|---|
| AGREGAR | A | `promote.pijamafilms.com` | `35.219.200.9` |
| QUITAR | A | `promote.pijamafilms.com` | `64.176.6.210` |

Con TTL 300 s, propaga en ~5 minutos.

## Orden, y por qué importa

**La etapa 1 tiene que estar propagada antes de la 2.** Si se cambia el A record con la
propiedad sin verificar y el certificado sin emitir, App Hosting recibe tráfico para un
hostname que todavía no reconoce: error de TLS para todos los usuarios. La etapa 1 primero
convierte el corte en un cambio de una línea con red debajo.

## Verificación del corte, y rollback

**No verificar por "el sitio carga"** — cargaba antes también, por el proxy. La señal
inequívoca es **quién responde**:

```bash
curl -sI https://promote.pijamafilms.com/login | grep -i '^server'
# antes:   server: nginx/1.31.3
# después: server: envoy
```

**El proxy se deja arriba** hasta confirmar eso. Rollback = reponer el A record anterior, otros
5 minutos. Recién después se da de baja la VM.

## Pendiente al cerrar

- Documentar la VM en `CLAUDE.md` **mientras siga en el camino**, y borrarla del documento
  cuando se dé de baja. Hoy el documento afirma una topología que no es la real (relacionado
  con el issue #53: los documentos que se leen primero afirmando cosas falsas).
- Confirmar quién administra Route 53 del lado de Crazy Cake.
