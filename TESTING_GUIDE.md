# Guía paso a paso para probar la app

Sigue estos pasos en orden para probar la aplicación con el nuevo módulo de horarios (Google Calendar + visitPlanner).

---

## 1. Variables de entorno

1. Copia el ejemplo de variables de entorno:
   ```bash
   cp .env.example .env.local
   ```
2. Edita `.env.local` y rellena al menos:
   - **`DATABASE_URL`**: cadena de conexión a tu PostgreSQL (Neon u otro). Ejemplo:
     ```
     DATABASE_URL="postgresql://user:password@host:5432/neondb?sslmode=require"
     ```
   - Opcionales para esta guía (puedes dejarlos vacíos al principio):
     - `PLANNER_WORK_START=08:00` y `PLANNER_WORK_END=17:00` (por defecto ya están en el código).
     - `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REFRESH_TOKEN` (solo si vas a probar la sincronización de calendarios).
     - `OPENROUTE_SERVICE_API_KEY` (solo si quieres ordenar visitas por distancia entre escuelas).

---

## 2. Base de datos y migración

1. Aplica las migraciones existentes (crean Teacher, Subject, ClassSession, VisitRule, Visit y la columna `googleCalendarId` en School):
   ```bash
   npx prisma migrate deploy
   ```
   Si nunca has usado migraciones y la BD ya tiene datos con `db push`, puede que tengas que marcar la migración como aplicada; en ese caso consulta la documentación de Prisma para “baseline” migrations.

2. Genera el cliente de Prisma (por si acaso):
   ```bash
   npx prisma generate
   ```

3. (Opcional) Abre Prisma Studio para ver y editar datos:
   ```bash
   npx prisma studio
   ```

---

## 3. Datos mínimos para que funcione el planificador nuevo

El **nuevo planificador** (visitPlanner con ClassSession + VisitRule) solo se usa si existe **al menos una VisitRule**. Si no hay ninguna, la app sigue usando el planificador antiguo (A/B + `School.availability`).

### Opción A: Probar solo el planificador antiguo (sin tocar nada nuevo)

- No crees VisitRule.
- Asegúrate de tener escuelas y, si quieres, CalendarDay y `School.availability` como hasta ahora.
- Arranca la app (paso 5) y usa el Weekly Planner como siempre.

### Opción B: Probar el planificador nuevo

Necesitas:

1. **Escuelas** en la tabla `School` (si ya tenías la app, ya las tienes; si no, puedes usar el seed de ejemplo desde la UI o crear unas a mano en Prisma Studio).

2. **Al menos una VisitRule** por cada escuela que quieras que aparezca en el plan:
   - En Prisma Studio: tabla `VisitRule` → Add record.
   - Campos: `schoolId` (id de una School), `frequencyType` (p. ej. `BIWEEKLY`), `priority` (p. ej. `NORMAL`), `notes` opcional.

3. **ClassSession** para que haya ventanas de visita:
   - Si **no** ejecutas la sincronización con Google Calendar, no habrá ClassSession y el nuevo planificador no propondrá visitas para esa semana (porque no hay clases en el rango).
   - Para tener datos de prueba sin Google Calendar puedes crear unas pocas ClassSession a mano en Prisma Studio (o con un script), asociadas a una School y a un Subject existente, con `startDateTime` y `endDateTime` en la semana que vayas a ver en el planner.

Resumen: para ver visitas propuestas con el nuevo flujo necesitas **VisitRule + ClassSession** en la misma escuela y en la semana que estés mirando.

---

## 4. (Opcional) Sincronizar calendarios desde Google

Solo si quieres probar la importación desde Google Calendar:

1. Obtén credenciales OAuth 2.0 de Google (Google Cloud Console):
   - Crea un proyecto o usa uno existente.
   - Activa la **Google Calendar API**.
   - Crea credenciales **OAuth 2.0** (tipo “Desktop” o “Web”) y anota Client ID y Client Secret.
   - Usa el [OAuth 2.0 Playground](https://developers.google.com/oauthplayground) con el scope `https://www.googleapis.com/auth/calendar.readonly`, autoriza y obtén el **Refresh token**.

2. En `.env.local` define:
   ```
   GOOGLE_CALENDAR_CLIENT_ID="..."
   GOOGLE_CALENDAR_CLIENT_SECRET="..."
   GOOGLE_CALENDAR_REFRESH_TOKEN="..."
   ```

3. El nombre de cada calendario en Google debe coincidir con el **nombre** de una escuela (`School.name`) para que se mapee a esa escuela.

4. Ejecuta el script de prueba (solo lectura, no usar en producción):
   ```bash
   npm run sync-calendars:test
   ```
   Esto listará los calendarios, asociará por nombre a las School y creará/actualizará **Subject** y **ClassSession** en el rango por defecto (próximas 12 semanas). Así tendrás ClassSession sin crear nada a mano.

---

## 5. Arrancar la app

```bash
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

---

## 6. Qué probar en la UI

1. **Dashboard**  
   Debería cargar igual que antes (estadísticas de escuelas y visitas).

2. **Weekly Planner**
   - Si **no** hay VisitRule: se usa el planificador antiguo (A/B + disponibilidad). Navega por semanas, cambia “Target Visits”, Recalculate, etc.
   - Si **hay** VisitRule y ClassSession en esa semana: se usa el nuevo planificador (ventanas basadas en ClassSession, urgencia por VisitRule y últimas Visit DONE). Comprueba que las visitas propuestas tienen sentido y que puedes:
     - Confirmar visita (marca como hecha; crea Visit DONE y VisitLog).
     - Skip (marca como no ir; crea Visit SKIPPED y se tiene en cuenta al recalcular).
     - Postponer / Add visit (igual que antes).

3. **School Profiles**  
   Sigue editando escuela, frecuencia y disponibilidad (el flujo antiguo). No es obligatorio tocar VisitRule desde aquí para esta guía.

4. **Visit History**  
   Sigue mostrando y editando visitas (VisitLog). Las visitas confirmadas desde el planner también aparecen aquí.

5. **Mapa / otras pestañas**  
   Comportamiento previo sin cambios.

---

## 7. Probar la API de sustituciones

El módulo de sustituciones expone:

- **GET** `/api/substitutions?schoolId=...&start=...&end=...&subjectId=...`
  - `schoolId`: id de una School.
  - `start`, `end`: fechas/hora en ISO 8601 (ej. `2025-03-19T12:00:00` y `2025-03-19T14:00:00`).
  - `subjectId`: opcional.

Ejemplo en el navegador o con `curl` (sustituye IDs y fechas por los tuyos):

```
http://localhost:3000/api/substitutions?schoolId=clxx...&start=2025-03-19T12:00:00&end=2025-03-19T14:00:00
```

La respuesta es un JSON con profesores que **no** tienen ClassSession solapada en ese rango, ordenados por misma escuela y carga del día.

Para que devuelva algo necesitas tener **Teacher** en la BD y, si quieres filtrar por materia, **Subject** y **ClassSession** con ese `subjectId`.

---

## 8. Resumen rápido

| Objetivo                         | Pasos mínimos                                                                 |
|----------------------------------|-------------------------------------------------------------------------------|
| Ver la app como antes            | 1) `.env.local` con `DATABASE_URL` → 2) `prisma migrate deploy` → 3) `npm run dev` |
| Probar planificador nuevo        | Además: crear al menos 1 **VisitRule** y tener **ClassSession** en esa semana (a mano o con sync). |
| Probar sync desde Google         | Añadir env de Google Calendar y ejecutar `npm run sync-calendars:test`.      |
| Probar API sustituciones         | Tener Teacher (y opcionalmente ClassSession); llamar a `GET /api/substitutions?...`. |

Si algo falla, revisa la consola del servidor (`npm run dev`) y la pestaña Red del navegador para ver errores de API o de server actions.
