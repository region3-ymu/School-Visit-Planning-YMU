# AUDIT — Regional School Visit Planner

Fecha: 2026-06-16
Alcance: revisión estática completa del repositorio (no se ejecutó la app).

---

## 1. Resumen ejecutivo

Aplicación interna (Next.js + Prisma/Postgres) para planificar visitas semanales a escuelas en Miami-Dade, con calendario A/B, sustituciones de profesores y un mapa de zonas. El núcleo (planificador semanal, perfiles de escuela, historial, sustitutos) **funciona y está usable**, pero el código arrastra **dos planificadores en paralelo** (legacy `scoringEngine` + nuevo `visitPlanner` basado en `VisitRule`/`ClassSession`), un tercer sub-planificador a medio integrar dentro del legacy (`EligibilityEngine`/`ConflictResolution`/`CapacityModel`), y varias capas (AuditTrail, IA chat, visit-rules UI) que son **placeholders no terminados**. Hay deuda técnica seria: sin tests, sin auth, instancias múltiples de `PrismaClient`, dependencias sin usar, datos seed hardcoded con 11 escuelas frente a un CSV de ~50, y el chat IA está marcado con `@ts-nocheck` y muy probablemente roto con la versión actual del AI SDK. Es un MVP que funciona para un único usuario interno pero no está listo para escalar ni para producción multi-usuario.

---

## 2. Stack técnico

- **Framework**: Next.js 16.1.6 (App Router), React 19.2.3, TypeScript 5 (strict).
- **DB / ORM**: Prisma 5.13 sobre PostgreSQL (Neon). Una migración aplicada + un parche SQL manual (`prisma/manual_add_teacher_subjects.sql`) que añade `Teacher.subjects`.
- **Estado cliente**: Zustand 5 con `persist` middleware a localStorage.
- **UI**: TailwindCSS 4, Lucide React.
- **Mapas**: Leaflet + react-leaflet (carga dinámica `ssr:false`).
- **Calendario externo**: googleapis 144 (OAuth refresh token + Calendar API readonly).
- **Distancia**: OpenRouteService HTTP API (matrix endpoint).
- **IA**: `ai` 6 + `@ai-sdk/react` 3 + `@openrouter/ai-sdk-provider` 2 (chat). Modelo usado: `google/gemini-2.0-flash-lite-preview-02-05:free` vía OpenRouter.
- **Build/deploy**: `vercel.json` mínimo, `next.config.ts` vacío.
- **Sin framework de tests**, sin CI, sin linter custom.

Dependencias instaladas pero **no importadas en `src/`** (peso muerto):
- `@ai-sdk/deepseek`, `@ai-sdk/google`, `@google/genai`
- `@fullcalendar/daygrid`, `@fullcalendar/react`, `@fullcalendar/timegrid`
- `date-fns` sí se usa.

Archivos sueltos en el repo (residuos de debugging, deberían moverse a `.gitignore` o borrarse): `prisma/dev.db` (SQLite legacy con schema Postgres), `out.txt`, `prisma_err.txt`, `prisma_error.txt`, `ts_errors.txt`, `ts_errors2.txt`, `ts_errors3.txt`, `tsconfig.tsbuildinfo`, varios PDF/CSV/XLSX de origen, carpeta `Planificador de visitas/` vacía, `habilidad_calendario_ab/`.

---

## 3. Features que funcionan

Verificadas en código (no probadas en runtime):

1. **Dashboard básico** ([Dashboard.tsx](src/components/Dashboard.tsx)) — total de escuelas y lista ordenada por nº de visitas. Las tarjetas "Due This Week", "Overdue", "Recent Cancellations" están con valores placeholder (ver §5).
2. **Weekly Planner** ([WeeklyPlanner.tsx](src/components/WeeklyPlanner.tsx)) — vista de 5 días L-V, navegación semanal, target visitas/semana, confirmar visita, postergar, eliminar, añadir extra. Detecta solapamientos de horarios en cliente y muestra warning.
3. **Histórico de visitas** ([VisitHistory.tsx](src/components/VisitHistory.tsx)) — tabla con filtro por mes, CRUD manual sobre `VisitLog`.
4. **School Profiles** ([SchoolProfiles.tsx](src/components/SchoolProfiles.tsx)) — listado con búsqueda y modal de edición (`frequencyTarget` + `availability` JSON crudo).
5. **Map / Zone View** ([MapZoneViewImpl.tsx](src/components/MapZoneViewImpl.tsx)) — Leaflet con marcadores y polylines que conectan visitas del día.
6. **CRUD de profesores por escuela** (`/schools/[id]/teachers/...`) — lista, crear, editar, borrar; campo `subjects` libre.
7. **Sustituciones** (`/substitutions`, [findSubstitutes.ts](src/modules/substitutions/findSubstitutes.ts) + `/api/substitutions`, `/api/class-sessions`, `/api/visits`) — selección escuela+fecha+clase, busca profesores sin `ClassSession` solapada, ordena por (libre exacto 100 + misma escuela 50 + materia coincide 30), permite asignar (crea `Visit` con status `PLANNED` y `reason="SUBSTITUTE:<teacherId>"`).
8. **Planificador legacy** ([scoringEngine.ts](src/lib/scoringEngine.ts)) — A/B day + `School.availability` JSON, simula semanas previas hasta la fecha objetivo para anti-bunching.
9. **Planificador nuevo** ([proposeVisitsForWeek](src/modules/visitPlanner/proposeVisits.ts)) — basado en `VisitRule` + `ClassSession` reales del calendario; opcionalmente reordena por travel time (OpenRouteService matrix).
10. **Sync de Google Calendar** ([syncAllSchoolCalendars](src/modules/calendarSync/sync.ts)) — solo ejecutable vía script `npm run sync-calendars:test`; lista calendarios, los matchea por `summary === School.name`, crea/actualiza `ClassSession`.
11. **Seed inicial** ([seedSchoolsMock](src/app/actions.ts:350)) — 11 escuelas hardcoded; se ejecuta automáticamente en cada montaje del Home (idempotente: si hay escuelas no hace nada).

---

## 4. Features incompletas o rotas

1. **AI Chat** ([AIChat.tsx](src/components/AIChat.tsx)) — el archivo entero está bajo `// @ts-nocheck` (línea 1). Usa la API antigua de `useChat` (`messages[].content`, `handleInputChange`, `isLoading`) que en `@ai-sdk/react` v3 + `ai` v6 ya **no existe en esa forma** (los mensajes ahora tienen `parts`, hay `setInput`, etc.). Muy probablemente renderiza vacío o tira en runtime. Además, el system prompt tiene typo: `"Pramer Assistant"` ([route.ts:16](src/app/api/chat/route.ts)). Y depende de `OPENROUTER_API_KEY` que no está en `.env.example`.
2. **Visit Rules page** ([/schools/[id]/visit-rules](src/app/schools/[id]/visit-rules/page.tsx)) — literalmente un placeholder: "Placeholder: si quieres, aquí migramos el editor de VisitRule por escuela." No hay forma de crear/editar `VisitRule` desde la UI; hay que hacerlo en Prisma Studio (lo dice `TESTING_GUIDE.md`).
3. **School "Horarios" page** ([/schools/[id]/page.tsx](src/app/schools/[id]/page.tsx)) — solo muestra el nombre/zip/frecuencia. El texto admite: "Esta página es el "home" de la escuela (Horarios). Por ahora, usa la pestaña de Profesores para gestionar el CRUD."
4. **AuditTrail** ([AuditTrail.ts](src/lib/audit/AuditTrail.ts)) — toda la clase loggea a `console.log` ("In production, save to database"). Métodos `getAuditHistory`, `getOverridePatterns`, `getSystemHealth` devuelven arrays/objetos vacíos hardcoded. No existe tabla `AuditLog` en el schema.
5. **Dashboard stats** ([actions.ts:67-71](src/app/actions.ts)) — `dueThisWeek: Math.floor(totalSchools/3)`, `overdue: 0`, `recentCancellations: 0` son placeholders explícitos ("Since we are calculating 'dueThiseWeek' dynamically via scoring engine, keep these as placeholders or compute fully.").
6. **ConflictResolution travel time** ([ConflictResolution.ts:215-237](src/lib/planner/ConflictResolution.ts)) — `calculateTravelTime` usa un map ZIP→minutos hardcoded ("In production, this would use a real routing API"). Solo lo usa el path legacy (`generatePlanWithNewArchitecture`).
7. **CapacityModel** ([CapacityModel.ts](src/lib/planner/CapacityModel.ts)) — diseñado con muchísimas opciones (`adminDays`, `meetingDays`, `unavailableDays`, `preferredZones`, `reserveEmergencySlot`, etc.) pero solo se le pasa `{ maxVisitsPerWeek }`. El resto se calcula con defaults invisibles para el usuario: por ejemplo, **lunes y viernes son "admin days" → capacidad reducida a 50 %**, y **miércoles es "meeting day" → 0 visitas**. Esto no es configurable desde ningún sitio y el usuario no sabe que existe. Crítico (ver §5).
8. **Pestaña Sustitutos en la app principal** ([page.tsx:71-76](src/app/page.tsx)) — renderiza `/substitutions` dentro de un `<iframe src="/substitutions">`. Funciona pero pierde sidebar, no comparte estado, doble bundle CSS.
9. **`getSchoolOptionsForWeek` (legacy mix)** ([actions.ts:232-299](src/app/actions.ts)) — combina `ClassSession` reales + reglas A/B; usa fallback `idx % 2 === 0 ? "A" : "B"` cuando no hay `CalendarDay` (mismo bug que §5).
10. **Visit Rules creation flow** — no existe ningún server action ni UI para crear `VisitRule` (solo CRUD de Teacher/School). El "nuevo planificador" depende de que existan `VisitRule`, así que hoy solo se puede activar manualmente en BD.

---

## 5. Bugs y problemas detectados (por severidad)

### Alta

1. **Sin autenticación en server actions ni API routes**. Cualquiera puede llamar a `confirmVisit`, `deleteVisitLog`, `POST /api/visits`, etc. ([actions.ts](src/app/actions.ts), [api/visits/route.ts](src/app/api/visits/route.ts)). Si la app está pública en Vercel, es manipulable.
2. **`CapacityModel` aplica defaults invisibles que silencian días enteros**: `meetingDays: [3]` → **miércoles siempre 0 visitas** en el path nuevo de scoringEngine ([CapacityModel.ts:42](src/lib/planner/CapacityModel.ts) + [scoringEngine.ts:609](src/lib/scoringEngine.ts)). Si el usuario nunca ve visitas el miércoles en el planificador legacy "nuevo", esta es la causa. No hay forma de cambiarlo desde la UI.
3. **`populateViableOptions` calcula A/B con `day.getDay() % 2 === 0`** ([scoringEngine.ts:815](src/lib/scoringEngine.ts)). Eso da A los martes/jueves y B los lunes/miércoles/viernes — no tiene nada que ver con el calendario A/B real de Miami-Dade ni con `CalendarDay`. Las opciones "viables" mostradas en el planner pueden ser falsas.
4. **Mismo bug, segunda instancia**: en `getSchoolOptionsForWeek` el fallback dayType es `idx % 2 === 0 ? "A" : "B"` ([actions.ts:286](src/app/actions.ts)) — y en `generatePlanForWeek`/`generatePlanWithNewArchitecture` también ([scoringEngine.ts:81, 581](src/lib/scoringEngine.ts)). Si `CalendarDay` no está sembrada para esa fecha, A/B es básicamente aleatorio y todo el resto del cálculo está mal.
5. **`AIChat` está roto silenciosamente** con el `ai` SDK actual ([AIChat.tsx](src/components/AIChat.tsx)) — está enmascarado por `@ts-nocheck`. La UI muestra el botón flotante y abre el panel pero el chat probablemente no renderiza mensajes correctamente.
6. **Múltiples instancias de `PrismaClient`** (9 archivos): `actions.ts:11`, `scoringEngine.ts:17`, `calendarParser.ts:4`, `AuditTrail.ts:32`, `schools/[id]/page.tsx:3`, `schools/[id]/visit-rules/page.tsx:3`, `api/class-sessions/route.ts:4`, `api/visits/route.ts:4`, `api/substitutions/route.ts:5`. En dev con HMR esto agota el pool de conexiones de Neon; en serverless cada cold start crea su propio cliente. Patrón estándar: singleton en `lib/prisma.ts`.
7. **`EligibilityEngine.checkHardConstraints` no acota el pin a la misma semana** ([EligibilityEngine.ts:62-68](src/lib/planner/EligibilityEngine.ts)): si una escuela quedó "pinned" para una fecha cualquiera (incluso meses atrás, ya pasada), el código la descarta para *todo* otro día. Como los overrides se persisten en localStorage indefinidamente, esto degrada al planner con el tiempo.
8. **`confirmVisit` escribe en dos tablas sin transacción** ([actions.ts:746-768](src/app/actions.ts)): crea `Visit` (DONE) y luego `VisitLog`. Si la segunda falla queda `Visit` huérfana. `getWeeklyPlan` luego merge-a ambas como "completadas" — riesgo de doble conteo si la deduplicación schoolId+día falla.

### Media

9. **`MapZoneViewImpl` aplica jitter aleatorio en cada render** ([MapZoneViewImpl.tsx:54-58](src/components/MapZoneViewImpl.tsx)): los marcadores se mueven cada vez que el componente re-renderiza. Mal UX y desorienta.
10. **Persistencia de `plannedVisits` en localStorage rompe el tipo `Date`** ([plannerStore.ts:55-60](src/store/plannerStore.ts)). Tras hidratar, `visit.date` es `string`, pero el tipo dice `Date`. El código hace `new Date(v.date)` en todos los puntos críticos, pero cualquier comparación directa con `.getTime()` falla. Los overrides también guardan `Date` y sufren lo mismo.
11. **`findAvailableSubstitutes` carga todos los profesores de la BD sin filtro** ([findSubstitutes.ts:17](src/modules/substitutions/findSubstitutes.ts)). Con 50+ escuelas y N profesores por escuela esto escala mal. Además hace una segunda query agregada para el day-count.
12. **`scoringEngine` filtro anti-bunching** ([scoringEngine.ts:203](src/lib/scoringEngine.ts)): `if (!isPinned && daysSinceVisit < freqLimit - 14) continue;` — para `weekly` (7) y `bi-weekly` (14) esto da `-7` y `0`, nunca filtra. Solo aplica a `monthly` (skip si <16 días desde la última). El comentario "Not due yet, skip this school for this week to avoid bunching up" sugiere otra intención.
13. **`proposeVisitsForWeek` no respeta `CalendarDay`** ([proposeVisits.ts](src/modules/visitPlanner/proposeVisits.ts)) — usa solo `ClassSession` filtrada por `startDateTime` en la semana. No descarta días `Planning`/`Holiday` (sí lo hace el scoringEngine). En la pestaña Planner, según se use el path nuevo o legacy, se obtiene comportamiento distinto en festivos.
14. **`getCalendarDaysForWeek`** ([actions.ts:333](src/app/actions.ts)) compara `date: { in: weekDates }` con `Date` objects creados como `addDays(startOfWeek(...), i)` en horario local. Si `CalendarDay.date` se guardó en UTC distinto, no matchea. Date-matching frágil contra `@unique` en `DateTime`.
15. **`seedSchoolsMock` se ejecuta en cada montaje de la Home** ([page.tsx:17-19](src/app/page.tsx)) — server action async en cada navigation. Idempotente, pero innecesario.
16. **`scoringEngine.ts:295` variable `endMins` declarada y nunca usada** (dentro del legacy loop).
17. **`scoringEngine.ts:441` shadowing de `i`** en el loop simulado (el outer `i` y el inner del `.map((_, i) => ...)`). Funcional, pero confuso.
18. **Logs de debug ruidosos en `proposeVisitsForWeek`** ([proposeVisits.ts:150,155](src/modules/visitPlanner/proposeVisits.ts)) — un `console.log` por cada escuela considerada en cada request.
19. **El system prompt del chat IA contiene errata** y mezcla idiomas ("Pramer Assistant"). El modelo OpenRouter `google/gemini-2.0-flash-lite-preview-02-05:free` es de febrero 2025 y puede estar deprecado.
20. **`vercel.json`** no define `prisma migrate deploy` ni `prisma generate`. La build de Vercel puede fallar si el cliente Prisma no está pre-generado.

### Baja

21. **`actions.ts` (889 líneas)** tiene formato roto: muchísimas líneas en blanco entre statements, mezcla de estilos. Difícil de leer.
22. **Texto mezclado ES/EN** en toda la UI sin convención (algunos botones "Edit Settings", "Profesores", "Add Extra Visit", "Sustitutos", "Skip to Next Week", "Recalculate"…).
23. **`Subject_name_key UNIQUE`** ([migration.sql:80](prisma/migrations/20250316000000_add_calendar_visit_models/migration.sql)) — implica que dos escuelas no pueden tener `Subject` con el mismo nombre porque la materia es global. `getOrCreateSubject` ([sync.ts:10](src/modules/calendarSync/sync.ts)) asume esto correctamente, pero significa que "Drumline" de Edison Park y "Drumline" de Brownsville comparten id → no se puede tener descripciones distintas.
24. **Mensajes de error genéricos** en API routes: `{ error: "Failed to create visit" }` sin información, dificulta debugging desde el cliente.
25. **No hay validación de zod ni similar** en bordes (server actions, API). Las server actions confían en que el cliente pasa tipos correctos. `updateSchoolSettings` solo hace `JSON.parse` de la availability — si pasas `[]` válido pero con shape erróneo se acepta.
26. **`schemas/dev.db`** (SQLite) sigue commiteada aunque el provider Postgres no lo usa. Posible confusión.

---

## 6. Deuda técnica

- **Tres planificadores conviviendo**:
  1. `generatePlanForWeek` (legacy puro, ya no se llama directamente desde fuera).
  2. `generatePlanWithNewArchitecture` (legacy con EligibilityEngine/Conflict/Capacity).
  3. `proposeVisitsForWeek` (módulo nuevo basado en ClassSession + VisitRule).
  `getWeeklyPlan` ([actions.ts:93](src/app/actions.ts)) decide entre 2 y 3 según `prisma.visitRule.count() > 0`. Esto es trampa: si alguien crea una sola VisitRule de prueba se cambia silenciosamente la lógica de toda la app. Y el fallback al legacy en `try/catch` enmascara errores reales del nuevo path.
- **`AuditTrail` es código muerto** que no persiste nada y se llama desde el scoringEngine en cada generación de plan. Eliminar o implementar de verdad.
- **`SchoolProfiles` edita `availability` como JSON crudo en un `<textarea>`**. No hay UI estructurada. Validación trivial (`JSON.parse`).
- **`VisitLog` vs `Visit`** son dos tablas con propósito solapado (la primera "legacy, kept for compatibility" según README, pero `confirmVisit` sigue escribiendo ambas y todo el dashboard sigue leyendo `VisitLog`). Decidir cuál es la fuente de verdad y migrar.
- **Dependencias AI no usadas** (`@ai-sdk/deepseek`, `@ai-sdk/google`, `@google/genai`) y **FullCalendar** entero. Eliminar.
- **Sin barrel exports consistentes**: `modules/calendarSync/index.ts` exporta 1 cosa, `modules/substitutions/index.ts` exporta 1 cosa, `modules/visitPlanner/index.ts` exporta varias. No es problema, solo poco uniforme.
- **`SchoolAvailabilityRule` se duplica conceptualmente con `ClassSession`** ahora que existe sync de Google Calendar. Mantener ambas indefinidamente confunde la fuente de verdad.
- **`@ts-nocheck`** en AIChat oculta errores reales.
- **No hay `lib/prisma.ts` singleton** (ver bug #6).
- **`useChat` API antigua + AI SDK v6**: requiere migración.
- **63 usos de `any` en 15 archivos** (en su mayoría parámetros de Prisma includes y rules JSON). No crítico, pero erosiona el strict mode del tsconfig.

---

## 7. Lo que falta / lo que no hace

- **No hay autenticación / multi-usuario** ni concepto de "regional manager" como entidad. Todo asume un único operador.
- **No hay tests** (unit, integration, e2e). Cero.
- **No hay manejo de timezone explícito**. Todo asume el TZ del servidor; los `Date` se guardan a `12:00:00Z` en algunos sitios ([actions.ts:364, 776](src/app/actions.ts)) para evitar deriva, pero otros usan `new Date(visitDate + "T12:00:00Z")` desde el cliente. Frágil.
- **No hay UI para crear/editar `VisitRule`** (el path "nuevo" del planificador queda inaccesible para no-desarrolladores).
- **No hay UI para gestionar `CalendarDay` A/B / festivos**. Hay un seeder pero no se invoca desde la app.
- **No hay UI para disparar el sync de Google Calendar** (solo script CLI marcado "test only, do not use in production").
- **No hay export** (CSV/PDF/iCal) del plan semanal — esperable para un planner.
- **No hay vista mensual ni vista de ruta del día** (solo grilla L-V).
- **No hay notificaciones / recordatorios**.
- **El mapa no muestra la ruta secuencial real**, solo polylines arbitrarias entre coordenadas; no consume distancias del OpenRouteService aunque el módulo existe.
- **Sin métricas reales** en el dashboard (overdue, cancelaciones, sí están a 0/placeholder).
- **Sin paginación** en `getVisitHistory` ni en sustituciones — todo se carga de un golpe.
- **Sin auditoría real** (AuditTrail es vacío).
- **Sin retry/backoff** para llamadas a Google Calendar u OpenRouteService.
- **Sin error boundaries** en React.
- **Sin manejo de loading skeletons consistente**.
- **El seed de escuelas tiene 11 hardcoded** (`seedSchoolsMock`) frente al CSV "Regional Manager - Summer List 2025_26" con muchas más. No hay importador de ese CSV.

---

## 8. Recomendaciones priorizadas

### Arreglar primero (alta severidad, bajo esfuerzo)

1. **Singleton de Prisma**. Crear `src/lib/prisma.ts` y reemplazar las 9 instancias. ~30 min, evita problemas reales en Neon/Vercel.
2. **Decidir y arreglar la lógica A/B**. Hoy hay tres puntos con `idx % 2 === 0 ? "A" : "B"` como fallback que no corresponde al calendario real. O se exige `CalendarDay` sembrada para toda la temporada, o se calcula A/B de forma determinista correcta. Esto invalida silenciosamente la mitad del planner.
3. **Quitar `meetingDays: [3]` y `adminDays: [1,5]` de `CapacityModel`** o hacerlos configurables. Hoy los miércoles desaparecen del planner sin explicación.
4. **Limpiar overrides obsoletos del Zustand persist**. Filtrar `manualOverrides` por fecha actual al hidratar; si no, los pins viejos descalifican escuelas para siempre (bug #7).
5. **Reparar o eliminar `AIChat`**. Hoy: feature visible, código bajo `@ts-nocheck`, probablemente rota. Si se quiere mantener: migrar al API v6 de `useChat`, mover `OPENROUTER_API_KEY` a `.env.example`, corregir typo "Pramer". Si no: eliminar el componente y la ruta.
6. **Eliminar `MapZoneViewImpl` jitter aleatorio en render**. Calcular jitter una vez (memo por id) o mejor: cluster real.
7. **Decidir Visit vs VisitLog** y migrar a una sola tabla. Mantener ambas en paralelo con dual-write sin transacción es un foco constante de bugs futuros.
8. **Eliminar dependencias muertas**: `@ai-sdk/deepseek`, `@ai-sdk/google`, `@google/genai`, `@fullcalendar/*`. Reduce build size y confusión.
9. **Mover archivos basura del root** (`*.txt`, `dev.db`, `prisma_err*`, `out.txt`, `*.tsbuildinfo`, PDFs/CSVs sin uso) a un `archive/` o gitignorar.

### Construir primero (donde sí hay valor)

10. **UI para crear/editar `VisitRule`** en `/schools/[id]/visit-rules`. Hoy es placeholder y sin él, todo el camino "nuevo" del planner es inaccesible.
11. **UI para gestionar el calendario A/B y festivos** (`CalendarDay`). Importar del PDF "ab calendar-25-26.pdf" que está en el repo. Hoy se siembra a mano.
12. **Importador del CSV "Regional Manager - Summer List 2025_26"** para reemplazar las 11 escuelas hardcoded.
13. **Editor estructurado para `availability`** (en vez de JSON crudo en textarea). Tabla con (dayType|weekday) + start + end + class.
14. **Botón "Sync Google Calendar" en la UI** (hoy solo CLI), con feedback de resultado.
15. **Dashboard stats reales**: `dueThisWeek`, `overdue`, `recentCancellations` calculados de verdad. Mover lógica al backend.
16. **Pestaña Sustitutos como ruta interna del app shell** (no iframe).
17. **Export del plan semanal** a iCal / CSV / PDF.

### Reescribir / consolidar

18. **Colapsar los tres planificadores en uno**. El path legacy + `generatePlanWithNewArchitecture` + `proposeVisitsForWeek` no pueden coexistir indefinidamente. Decidir si el modelo es "rules + ClassSessions sincronizadas" o "availability JSON manual"; el primero es el camino moderno (Google Calendar es la fuente de verdad), pero exige completar §10 y §14.
19. **Eliminar `AuditTrail`** o implementarlo con tabla real `AuditLog`. Hoy solo añade overhead de await en hot paths sin guardar nada.
20. **Refactor de `actions.ts`** (889 líneas, formato roto): partir por dominio (`actions/schools.ts`, `actions/visits.ts`, `actions/planner.ts`). Pasar formateo por Prettier.
21. **Auth mínima** (NextAuth con magic link o un Bearer simple) antes de cualquier deploy público.
22. **Test suite mínima**: al menos integration tests sobre `proposeVisitsForWeek` y `EligibilityEngine` con fixtures Prisma. Hoy cualquier cambio en scoring es ruleta rusa.
