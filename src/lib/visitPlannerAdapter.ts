import type { VisitInfo } from "./types";
import type { ProposedVisit } from "@/modules/visitPlanner";

export function proposedVisitToVisitInfo(p: ProposedVisit): VisitInfo {
  return {
    schoolId: p.schoolId,
    schoolName: p.schoolName,
    zipCode: p.zipCode,
    lat: p.lat,
    lng: p.lng,
    date: p.date,
    score: p.score,
    reason: p.reason,
    startTime: p.startTime,
    endTime: p.endTime,
    classStartTime: p.classStartTime,
    classEndTime: p.classEndTime,
    subjectName: p.subjectName,
    teacherId: p.teacherId,
    teacherName: p.teacherName,
    isPinned: false,
    isCompleted: false,
    viableOptionsThisWeek: [],
    noClassWarning: p.noClassWarning,
    visitRuleFrequency: p.visitRuleFrequency,
    visitRuleNote: p.visitRuleNote,
    scheduleConflict: p.scheduleConflict,
  };
}
