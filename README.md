# Backend — App de Guardias de Residentes (Hospital U. de Dénia)

API REST + PostgreSQL + JWT que sustituye los datos simulados (`mock.js`) del
frontend. Implementa el modelo de datos, las reglas de negocio críticas, el
flujo de aprobación, el histórico de auditoría y las notificaciones descritos
en el handoff.

**Stack:** Node.js + Express + PostgreSQL (`pg`, migraciones SQL propias) + JWT
(`jsonwebtoken`) + bcrypt (`bcryptjs`) + validación con `zod`. Todas las
respuestas y errores van **en español**.

---

## Puesta en marcha

Requisitos: Node ≥ 18 y un PostgreSQL accesible (≥ 13, por `gen_random_uuid()`).

```bash
cd backend
cp .env.example .env          # ajusta DATABASE_URL y JWT_SECRET
npm install

# crea la base de datos (si no existe), p.ej.:
createdb guardias_denia       # o: psql -c "CREATE DATABASE guardias_denia;"

npm run migrate               # aplica el esquema
npm run seed                  # siembra el prototipo (9 usuarios, junio 2026, ...)
npm start                     # API en http://localhost:4000
```

Atajos: `npm run reset` (recrea el esquema desde cero y re-siembra) y
`npm test` (verifica la lógica de las dos reglas duras sin necesidad de BD).

### Acceso de prueba

El seed activa los **9 usuarios con una contraseña por defecto** (`SEED_PASSWORD`
en `.env`, por defecto `Denia2026!`) para que el frontend funcione al instante.

```bash
curl -X POST localhost:4000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"dni":"53110874P","password":"Denia2026!"}'   # Lucía (residente R3)
```

DNIs útiles: `21456789X` Carmen (tutora) · `48721903K` Marta (R4) ·
`53110874P` Lucía (R3) · `49872013D` Aitana · `51230496G` Nerea · `30019283F` Tomás (externo).

Para probar el **primer acceso con código**, da de alta un usuario nuevo
(`POST /usuarios`): la respuesta incluye su `activation_code` (de un solo uso,
**sin caducidad**), y luego `POST /auth/primer-acceso` → `POST /auth/crear-password`.

---

## Decisiones de diseño (acordadas en el handoff)

1. **Contadores anuales Vi/Sa/Do = fuente almacenada.** Viven en la tabla
   `year_stats`, sembrada con los números del prototipo (que no coinciden con el
   calendario de junio porque incluyen histórico no modelado como guardias). Un
   **cambio/cesión aprobado** ajusta `vi/sa/do` de los implicados. `guardias_mes`
   se calcula **en vivo** desde `shifts`.
2. **Las dos reglas duras se aplican solo a cambios/cesiones**, no a la edición
   manual de la planilla (`PUT /guardias`), que sí respeta el máximo de 2/día.
3. **Días consecutivos: bloqueo absoluto que cruza meses** (p.ej. 30 jun ↔ 1 jul).
4. **Intercambio: el límite se evalúa en ambos receptores**; `flag_exceso` guarda
   el peor caso (incluye `user_id` del afectado para la auditoría).

### Las dos reglas duras

- **Límites Vi/Sa/Do (anuales, 8 por tipo, reinicio 1 ene).** Si una operación
  deja a un receptor en **=8** → permitido y marcado ámbar (informativo). Si lo
  dejaría en **>8** → la solicitud se crea con `flag_exceso` y **solo el tutor**
  puede aprobarla, con doble confirmación (`{ "confirmar": true }`). Los
  `externo` con `aplica_limites=false` quedan exentos.
- **Días consecutivos (bloqueante, HTTP 422).** Ningún residente puede quedar con
  guardia en dos días seguidos. Se valida al crear, al aceptar y al aprobar
  (re-evaluación con el estado actual). No admite confirmación: es un bloqueo.

### Flujo y permisos

`pend_companero` → (compañero acepta) → `pend_tutor` → (**solo tutor** aprueba) →
`aprobada` (reasigna las guardias reales y recalcula contadores) o `rechazada`.
El solicitante puede `cancelar` mientras esté pendiente.

| Acción | residente | externo | r4 | tutor |
|---|:--:|:--:|:--:|:--:|
| Ver calendario publicado | ✅ | ✅ | ✅ | ✅ |
| Crear / aceptar / rechazar (compañero) solicitud propia | ✅ | ✅ | ✅ | — |
| Editar planilla / publicar | — | — | ✅ | ✅ |
| **Aprobar/rechazar cambios (final)** | — | — | **❌** | ✅ |
| Alta/baja/edición de usuarios | — | — | ✅ | ✅ |
| Consultar histórico de auditoría | — | — | ✅ | ✅ |

> Los **R4 NO aprueban cambios** (solo el tutor). Los R4 son administradores de
> planilla y usuarios. Un residente solo puede ofrecer **sus propias** guardias.

### Histórico / auditoría

`AuditLog` es **inmutable** (un trigger de BD impide `UPDATE`/`DELETE`). Cada
acción sobre solicitudes, planillas y usuarios escribe una entrada **dentro de la
misma transacción**. En las aprobaciones se guarda: solicitante, compañero que
aceptó, **tutor que aprobó**, guardias implicadas, `flag_exceso` y si se
**forzó pese a un exceso**. Consulta: `GET /auditoria` (filtros) y
`GET /solicitudes/:id/historial` (línea de tiempo de una solicitud).

---

## Endpoints

Todos requieren `Authorization: Bearer <token>` salvo los de `/auth` de entrada.

**Auth:** `POST /auth/login` · `POST /auth/primer-acceso` · `POST /auth/crear-password` · `GET /auth/me`

**Calendario:** `GET /planes?anio=&mes=` · `GET /guardias?anio=&mes=` ·
`PUT /guardias/:fecha` (r4/tutor) · `POST /planes/:anio/:mes/publicar` ·
`POST /planes/:anio/:mes/borrador`

**Estadísticas:** `GET /estadisticas?anio=&mes=`

**Cambios/ventas:** `GET /solicitudes` · `POST /solicitudes` ·
`POST /solicitudes/:id/aceptar` · `POST /solicitudes/:id/rechazar` ·
`POST /solicitudes/:id/aprobar` · `POST /solicitudes/:id/cancelar` ·
`GET /solicitudes/:id/historial`

**Notificaciones:** `GET /notificaciones` · `POST /notificaciones/marcar-leidas` · `POST /notificaciones/:id/leer`

**Administración:** `GET /usuarios` · `POST /usuarios` · `PATCH /usuarios/:id` · `DELETE /usuarios/:id`

**Auditoría:** `GET /auditoria?entidad=&entidad_id=&desde=&hasta=&limit=`

**Salud:** `GET /salud`

### Crear una solicitud (las fechas van en formato ISO `YYYY-MM-DD`)

```bash
curl -X POST localhost:4000/solicitudes -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{
    "tipo": "cesion",
    "a_user_id": "aitana",
    "guardia_de": "2026-06-23",
    "nota": "Te cedo la guardia del 23."
  }'
```

---

## Contrato de datos (mapeo con `mock.js`)

Para que el frontend funcione **sin cambios**, la API devuelve las entidades con
las **mismas claves que el prototipo**, aunque internamente se almacenen en
snake_case:

| Entidad | Claves que devuelve la API (= mock) |
|---|---|
| Usuario | `id, nombre, trato, ini, dni, role, anio, color, guardias, limites, activo, pendiente_activacion` |
| Guardias del mes | `{ "<díaDelMes>": [userId, ...] }` |
| Estadística | `{ mes, guardias_mes, anio, vi, sa, do, limite, aplica_limites, flags:{vi,sa,do} }` con flag `ambar` (=8) / `rojo` (>8) |
| Solicitud | `id, tipo, de, a, guardiaDe:{fecha,d,label}, guardiaA, status, flag, nota, motivo, fecha, creada_en` |
| Notificación | `id, tipo, icon, titulo, cuerpo, fecha, leida, ref, creada_en` |
| Auditoría | snake_case: `entidad, entidad_id, accion, actor_id, estado_anterior, estado_nuevo, detalle, creado_en` |

Mapeo de columnas internas: `iniciales→ini`, `hace_guardias→guardias`,
`aplica_limites→limites`, `de_user_id→de`, `a_user_id→a`, `estado→status`,
`icono→icon`, `ref_request_id→ref`. El campo `fecha` de solicitudes/notis es un
texto relativo en español ("hace 2 h", "ayer", ...) calculado a partir del
`timestamp` real (también disponible como `creada_en`).

> Nota sobre los IDs de solicitud: el prototipo usaba `rq1..rq6`; la API genera
> UUIDs reales. Las notificaciones referencian la solicitud por su UUID en `ref`.

---

## Estructura

```
src/
  config/        env y pool de PostgreSQL (DATE → string, sin desfase de zona)
  db/            migrate.js (runner) · seed.js · migrations/001_init.sql
  middleware/    auth (JWT + roles), validate (zod), errores, asyncHandler
  utils/         jwt, dates (weekday/consecutivos/labels), errors, serialize
  services/      audit, notifications, calendar, changeRequests (REGLAS DURAS)
  routes/        auth, planes, guardias, estadisticas, solicitudes,
                 notificaciones, usuarios, auditoria
  app.js / server.js
tests/reglas.test.js   verificación de las reglas (sin BD)
```
