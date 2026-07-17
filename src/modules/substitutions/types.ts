export interface SubstituteCandidate {
  teacherId: string;
  teacherName: string;
  email: string | null;
  schoolId: string | null;
  schoolName: string | null;
  sameSchool: boolean;
  sessionsThatDay: number;
}

export interface ScoredSubstituteCandidate extends SubstituteCandidate {
  /** true when no overlapping ClassSession exists for the requested range */
  freeExact: boolean;
  /** true when teacher.subjects matches the requested subject strongly */
  subjectsMatch: boolean;
  score: number;
  availableStart: string; // ISO
  availableEnd: string; // ISO
  subjects: string | null;
}
