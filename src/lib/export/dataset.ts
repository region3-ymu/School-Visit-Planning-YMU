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
  const [regions, schools, visits, sessions, teachers, rules, users, subjects, quarters, scheduleNotes] =
    await Promise.all([
    prisma.region.findMany({
      select: { id: true, code: true, name: true, manager: { select: { email: true, name: true } },
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
        observedTeacherId: true, observedSubjectId: true,
        school: { select: { id: true, name: true, region: { select: { code: true } } } },
        visitedBy: { select: { email: true, name: true, role: true, region: { select: { code: true } } } },
        observedTeacher: { select: { name: true } },
        observedSubject: { select: { name: true } },
      },
      orderBy: { plannedStartDateTime: "desc" },
    }),
    prisma.classSession.findMany({
      select: { id: true, startDateTime: true, endDateTime: true, teacherId: true, subjectId: true,
                school: { select: { id: true, name: true, region: { select: { code: true } } } },
                subject: { select: { name: true } }, teacher: { select: { name: true } } },
      orderBy: { startDateTime: "asc" },
    }),
    prisma.teacher.findMany({
      select: { id: true, name: true, subjects: true, email: true, externalId: true, schoolId: true,
                school: { select: { name: true, region: { select: { code: true } } } } },
      orderBy: { name: "asc" },
    }),
    prisma.visitRule.findMany({
      select: { id: true, schoolId: true, frequencyType: true, priority: true, notes: true, reason: true,
                effectiveFrom: true, effectiveTo: true, createdAt: true,
                school: { select: { name: true, region: { select: { code: true } } } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, isAppAdmin: true,
                region: { select: { code: true } }, _count: { select: { visits: true } } },
      orderBy: { email: "asc" },
    }),
    prisma.subject.findMany({
      select: { id: true, name: true, description: true,
                _count: { select: { classSessions: true, observedVisits: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.quarter.findMany({ orderBy: [{ schoolYear: "asc" }, { label: "asc" }] }),
    prisma.programScheduleNote.findMany({
      select: { id: true, schoolId: true, subjectName: true, dayPattern: true, period: true,
                timesText: true, teacherName: true, scheduleStatus: true, sourceRow: true,
                importedAt: true,
                school: { select: { name: true, region: { select: { code: true } } } } },
      orderBy: [{ school: { name: "asc" } }, { sourceRow: "asc" }],
    }),
  ]);

  return [
    {
      title: "Regions",
      rows: [
        ["Region ID", "Code", "Name", "Schools", "Manager", "Manager email"],
        ...regions.map((r) => [r.id, r.code, r.name, r._count.schools, r.manager?.name ?? "", r.manager?.email ?? ""]),
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
         "Visited by", "Visited by email", "Role", "Visited by region", "Miles out", "Miles back",
         "Commute miles out",
         "Commute miles back", "Reimbursable miles", "Origin", "Geofence metres", "Geofence overridden",
         "Visited with", "Program", "Program ID", "Observed teacher", "Observed teacher ID",
         "Planning & prep", "Culture & management",
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
            // The region column beside it is the SCHOOL's, and the office has
            // none by design — isOffice is kept out of regions, lists and
            // counts. That left every office stop with a blank region and
            // dropped it out of any pivot by region. Whose work it was is a
            // different fact from where the building sits, and it is the one
            // that answers "how much did East do this month".
            v.visitedBy?.region?.code ?? "",
            num(v.milesDriven), num(v.returnMilesDriven), num(v.commuteMiles), num(v.returnCommuteMiles),
            reimbursable, v.originLabel ?? "",
            v.geofenceDistanceM ?? "", v.geofenceOverridden,
            v.visitedWith.join(", "),
            v.observedSubject?.name ?? "", v.observedSubjectId ?? "",
            v.observedTeacher?.name ?? "", v.observedTeacherId ?? "",
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
        ["Class ID", "Date", "Start", "End", "School", "School ID", "Region", "Class", "Subject ID",
         "Teacher", "Teacher ID", "Afterschool"],
        ...sessions.map((s) => [
          s.id, date(s.startDateTime), time(s.startDateTime), time(s.endDateTime), s.school.name, s.school.id,
          s.school.region?.code ?? "", s.subject.name, s.subjectId, s.teacher?.name ?? "", s.teacherId ?? "",
          // The same classifier the app plans from, so the sheet can never
          // disagree with the app about whose class it is.
          isAfterschoolClass(s.subject.name, s.startDateTime),
        ]),
      ],
    },
    {
      title: "Teachers",
      rows: [
        ["Teacher ID", "Name", "Email", "School", "School ID", "Region", "Subjects", "From YMU-A"],
        ...teachers.map((t) => [t.id, t.name, t.email ?? "", t.school?.name ?? "", t.schoolId ?? "",
                               t.school?.region?.code ?? "", t.subjects ?? "", t.externalId != null]),
      ],
    },
    {
      title: "Visit rules",
      rows: [
        ["Rule ID", "School", "School ID", "Region", "Frequency", "Priority", "Reason", "Notes",
         "Effective from", "Effective to", "Created"],
        ...rules.map((r) => [r.id, r.school.name, r.schoolId, r.school.region?.code ?? "", r.frequencyType, r.priority,
                             r.reason ?? "", r.notes ?? "", date(r.effectiveFrom), date(r.effectiveTo), date(r.createdAt)]),
      ],
    },
    {
      // The master programmes spreadsheet, as imported. Reference and not
      // record: nothing in the app plans from it, the wording is hand-written
      // and drifts from the calendar's, and teacherName is a string rather
      // than a Teacher — which is exactly why it is worth exporting. For 87 of
      // the 110 schools it is the only place a programme and the person
      // teaching it are written down at all, so leaving it out of the export
      // was leaving out the answer to the question the export gets asked.
      title: "Program schedule",
      rows: [
        ["Note ID", "School", "School ID", "Region", "Program", "Teacher (as written)",
         "Day pattern", "Period", "Times", "Status", "Source row", "Imported"],
        ...scheduleNotes.map((n) => [
          n.id, n.school.name, n.schoolId, n.school.region?.code ?? "", n.subjectName,
          n.teacherName ?? "", n.dayPattern ?? "", n.period ?? "", n.timesText ?? "",
          n.scheduleStatus ?? "", n.sourceRow ?? "", date(n.importedAt),
        ]),
      ],
    },
    {
      // The programme catalogue, and the join target for Visits.Program ID and
      // Classes.Subject ID.
      title: "Subjects",
      rows: [
        ["Subject ID", "Name", "Description", "Classes scheduled", "Visits observed"],
        ...subjects.map((sub) => [sub.id, sub.name, sub.description ?? "",
                                  sub._count.classSessions, sub._count.observedVisits]),
      ],
    },
    {
      // Four rows, and the reason a pivot can say "Q2" instead of "November".
      title: "Quarters",
      rows: [
        ["School year", "Quarter", "Starts", "Ends"],
        ...quarters.map((q) => [q.schoolYear, q.label, date(q.startDate), date(q.endDate)]),
      ],
    },
    {
      title: "Users",
      rows: [
        ["User ID", "Email", "Name", "Role", "App administrator", "Region", "Visits recorded"],
        ...users.map((u) => [u.id, u.email, u.name ?? "", ROLE_LABELS[u.role], u.isAppAdmin,
                             u.region?.code ?? "", u._count.visits]),
      ],
    },
  ];
}
