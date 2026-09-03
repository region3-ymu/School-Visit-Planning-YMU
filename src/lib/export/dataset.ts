import type { PrismaClient } from "@prisma/client";
import { decimalToNumber } from "@/lib/decimal";
import { isAfterschoolClass } from "@/lib/afterschool";
import { dayKeyInAppZone, formatTimeInAppZone } from "@/lib/timezone";
import { ROLE_LABELS } from "@/lib/permissions";
import type { SheetCell } from "@/lib/google/sheets";

/**
 * Every table in the app, flattened for a spreadsheet.
 *
 * Built for the Academic Manager to pivot and chart, which shapes two choices:
 *
 * Dates and times are split. A single ISO timestamp is unusable in a pivot —
 * you cannot group by month without writing a formula — so every row carries a
 * "yyyy-MM-dd" date and, where it matters, a separate "HH:mm". Both in MIAMI
 * time, because "how many visits in August" is a question about Miami's August,
 * and a UTC timestamp files an 8pm visit on the 31st under September.
 *
 * Ids come along even though nobody reads them. They are what lets one tab be
 * joined to another with a lookup, which is the point of exporting the tables
 * separately rather than one pre-joined sheet that only answers the questions
 * somebody thought of today.
 */

export type Table = { title: string; rows: SheetCell[][] };

const date = (d: Date | null | undefined) => (d ? dayKeyInAppZone(d) : "");
const time = (d: Date | null | undefined) => (d ? formatTimeInAppZone(d) : "");
const num = (v: Parameters<typeof decimalToNumber>[0]) => decimalToNumber(v) ?? "";

export async function buildDataset(prisma: PrismaClient): Promise<Table[]> {
  const [regions, schools, visits, sessions, teachers, rules, users] = await Promise.all([
    prisma.region.findMany({
      select: { code: true, name: true, manager: { select: { email: true, name: true } },
                _count: { select: { schools: true } } },
      orderBy: { code: "asc" },
    }),
    prisma.school.findMany({
      select: { id: true, name: true, externalId: true, address: true, zipCode: true, lat: true, lng: true,
                geocodeSource: true, active: true, isOffice: true, googleCalendarId: true,
                calendarLastSyncedAt: true, region: { select: { code: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.visit.findMany({
      select: {
        id: true, plannedStartDateTime: true, status: true, reason: true, mode: true, vehicle: true,
        milesDriven: true, returnMilesDriven: true, commuteMiles: true, returnCommuteMiles: true,
        originLabel: true, geofenceDistanceM: true, geofenceOverridden: true, visitedWith: true,
        principalNotes: true, hasInstrumentRequest: true, instrumentRequestDetails: true,
        obsPlanningPrep: true, obsCultureManagement: true, obsInstructionMusicianship: true,
        obsEngagementEvidence: true, obsProfessionalismGrowth: true, obsNotes: true,
        obsSkipReason: true, obsSkipNotes: true, createdAt: true,
        school: { select: { id: true, name: true, region: { select: { code: true } } } },
        visitedBy: { select: { email: true, name: true, role: true } },
        observedTeacher: { select: { name: true } },
      },
      orderBy: { plannedStartDateTime: "desc" },
    }),
    prisma.classSession.findMany({
      select: { startDateTime: true, endDateTime: true,
                school: { select: { id: true, name: true, region: { select: { code: true } } } },
                subject: { select: { name: true } }, teacher: { select: { name: true } } },
      orderBy: { startDateTime: "asc" },
    }),
    prisma.teacher.findMany({
      select: { name: true, subjects: true, externalId: true,
                school: { select: { name: true, region: { select: { code: true } } } } },
      orderBy: { name: "asc" },
    }),
    prisma.visitRule.findMany({
      select: { frequencyType: true, priority: true, notes: true, reason: true,
                effectiveFrom: true, effectiveTo: true, createdAt: true,
                school: { select: { name: true, region: { select: { code: true } } } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.findMany({
      select: { email: true, name: true, role: true, isAppAdmin: true,
                region: { select: { code: true } }, _count: { select: { visits: true } } },
      orderBy: { email: "asc" },
    }),
  ]);

  return [
    {
      title: "Regions",
      rows: [
        ["Code", "Name", "Schools", "Manager", "Manager email"],
        ...regions.map((r) => [r.code, r.name, r._count.schools, r.manager?.name ?? "", r.manager?.email ?? ""]),
      ],
    },
    {
      title: "Schools",
      rows: [
        ["School ID", "Name", "Region", "Address", "Zip", "Latitude", "Longitude", "Geocode source",
         "Active", "Is office", "Calendar connected", "Calendar last synced", "YMU-A ID"],
        ...schools.map((s) => [
          s.id, s.name, s.region?.code ?? "", s.address ?? "", s.zipCode, s.lat ?? "", s.lng ?? "",
          s.geocodeSource ?? "", s.active, s.isOffice, s.googleCalendarId != null,
          date(s.calendarLastSyncedAt), s.externalId ?? "",
        ]),
      ],
    },
    {
      title: "Visits",
      rows: [
        ["Visit ID", "Date", "Time", "School", "School ID", "Region", "Status", "Mode", "Vehicle",
         "Visited by", "Visited by email", "Role", "Miles out", "Miles back", "Commute miles out",
         "Commute miles back", "Reimbursable miles", "Origin", "Geofence metres", "Geofence overridden",
         "Visited with", "Observed teacher", "Planning & prep", "Culture & management",
         "Instruction & musicianship", "Engagement", "Professionalism", "Observation notes",
         "Observation skipped because", "Skip notes", "Principal notes", "Instrument request",
         "Instrument request details", "Reason", "Logged at"],
        ...visits.map((v) => {
          const out = decimalToNumber(v.milesDriven) ?? 0;
          const back = decimalToNumber(v.returnMilesDriven) ?? 0;
          const commute =
            (decimalToNumber(v.commuteMiles) ?? 0) + (decimalToNumber(v.returnCommuteMiles) ?? 0);
          // Van miles are YMU's own fuel, and a ride in someone else's car is
          // nobody's fuel to reimburse to this RM — both are a hard zero
          // rather than blank, since blank reads as "not measured", which is
          // a different thing and already has a meaning here.
          const reimbursable =
            v.vehicle === "YMU_VAN" || v.vehicle === "OTHER_PERSON_CAR" ? 0 : Math.max(0, out + back - commute);
          return [
            v.id, date(v.plannedStartDateTime), time(v.plannedStartDateTime), v.school.name, v.school.id,
            v.school.region?.code ?? "", v.status, v.mode, v.vehicle,
            v.visitedBy?.name ?? "", v.visitedBy?.email ?? "",
            v.visitedBy ? ROLE_LABELS[v.visitedBy.role] : "",
            num(v.milesDriven), num(v.returnMilesDriven), num(v.commuteMiles), num(v.returnCommuteMiles),
            reimbursable, v.originLabel ?? "",
            v.geofenceDistanceM ?? "", v.geofenceOverridden,
            v.visitedWith.join(", "), v.observedTeacher?.name ?? "",
            v.obsPlanningPrep ?? "", v.obsCultureManagement ?? "", v.obsInstructionMusicianship ?? "",
            v.obsEngagementEvidence ?? "", v.obsProfessionalismGrowth ?? "", v.obsNotes ?? "",
            v.obsSkipReason ?? "", v.obsSkipNotes ?? "", v.principalNotes ?? "",
            v.hasInstrumentRequest, v.instrumentRequestDetails ?? "", v.reason ?? "", date(v.createdAt),
          ];
        }),
      ],
    },
    {
      title: "Classes",
      rows: [
        ["Date", "Start", "End", "School", "School ID", "Region", "Class", "Teacher", "Afterschool"],
        ...sessions.map((s) => [
          date(s.startDateTime), time(s.startDateTime), time(s.endDateTime), s.school.name, s.school.id,
          s.school.region?.code ?? "", s.subject.name, s.teacher?.name ?? "",
          // The same classifier the app plans from, so the sheet can never
          // disagree with the app about whose class it is.
          isAfterschoolClass(s.subject.name, s.startDateTime),
        ]),
      ],
    },
    {
      title: "Teachers",
      rows: [
        ["Name", "School", "Region", "Subjects", "From YMU-A"],
        ...teachers.map((t) => [t.name, t.school?.name ?? "", t.school?.region?.code ?? "",
                               t.subjects ?? "", t.externalId != null]),
      ],
    },
    {
      title: "Visit rules",
      rows: [
        ["School", "Region", "Frequency", "Priority", "Reason", "Notes", "Effective from", "Effective to", "Created"],
        ...rules.map((r) => [r.school.name, r.school.region?.code ?? "", r.frequencyType, r.priority,
                             r.reason ?? "", r.notes ?? "", date(r.effectiveFrom), date(r.effectiveTo), date(r.createdAt)]),
      ],
    },
    {
      title: "Users",
      rows: [
        ["Email", "Name", "Role", "App administrator", "Region", "Visits recorded"],
        ...users.map((u) => [u.email, u.name ?? "", ROLE_LABELS[u.role], u.isAppAdmin,
                             u.region?.code ?? "", u._count.visits]),
      ],
    },
  ];
}
