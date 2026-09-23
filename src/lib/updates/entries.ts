/**
 * The Updates log for School Visit Planning — what changed, newest first.
 *
 * Content, not data: nobody writes it from inside the app and every line is
 * reviewed before it ships.
 *
 * No audience filter here, unlike YMU-A's copy of this file. Everyone who can
 * sign in to SVP is a manager of some kind, so there is no reader to hold
 * anything back from.
 */

export type UpdateItem = {
  /** Module name shown in bold at the front, or null for a general line. */
  module: string | null;
  text: string;
};

export type UpdateEntry = {
  /** Plain Y-M-D. Never turned into a Date — see formatEntryDate. */
  date: string;
  items: UpdateItem[];
};

export const UPDATES: UpdateEntry[] = [
  {
    date: "2026-09-22",
    items: [
      { module: "Visits", text: "The observation note is required when the visit included the YMU teacher." },
    ],
  },
  {
    date: "2026-09-17",
    items: [
      {
        module: "Visits",
        text: "A visit can be confirmed without GPS, on the day, when the timetable behind it is sound.",
      },
    ],
  },
  {
    date: "2026-09-16",
    items: [
      {
        module: "Weekly Planner & Zone Map",
        text: "The CPO and Operations Manager can now open both, read-only.",
      },
      { module: "Weekly Planner", text: "A manual change sticks instead of being re-planned away." },
      {
        module: "Afterschool",
        text: "A Regional Manager can be given afterschool alongside the school day.",
      },
      { module: "Sign-in", text: "Google sign-in only reaches accounts already on the roster." },
    ],
  },
  {
    date: "2026-09-08",
    items: [
      {
        module: "Weekly Planner",
        text: "Simultaneous classes and same-day pins no longer collapse into one.",
      },
    ],
  },
  {
    date: "2026-09-02",
    items: [
      { module: "Reports", text: "Daily automatic export to the spreadsheet." },
      { module: null, text: "Fixed various bugs." },
    ],
  },
  {
    date: "2026-08-27",
    items: [
      {
        module: "Reports",
        text: "Every table exports into a spreadsheet the Academic Manager can pivot.",
      },
      { module: "Afterschool", text: "Classified the way YMU-A classifies it, so the two apps agree." },
      { module: "Dashboard", text: "Ordered by class times." },
    ],
  },
  {
    date: "2026-08-25",
    items: [
      { module: "Mileage", text: "Reports the miles you drove, and the commute is no longer counted." },
      { module: "Visits", text: "A phone call counts as contact, not as a visit." },
      { module: "Visits", text: "Records which teacher you actually observed." },
      {
        module: "Schools & Teachers",
        text: "Each has a page worth opening, built from the classes they teach.",
      },
      { module: "Weekly Planner", text: "A day's route can be reordered and repriced." },
      { module: null, text: "All times are Miami time, wherever the server runs." },
    ],
  },
  {
    date: "2026-08-19",
    items: [
      { module: "Mileage", text: "Can be logged from History, and reported for any period." },
      {
        module: "Visits",
        text: "A blank rubric records why it's blank, and a visit can be logged against another region's school.",
      },
    ],
  },
  {
    date: "2026-08-14",
    items: [
      { module: "Visits", text: "A visit can be online or a phone call." },
      {
        module: "Weekly Planner",
        text: "Past days stop eating today's plan, and you can set a daily cap.",
      },
    ],
  },
  {
    date: "2026-08-13",
    items: [
      {
        module: "Weekly Planner",
        text: "The week is built as days you could actually drive: schools teaching that day, close together, twenty-minute drop-ins.",
      },
    ],
  },
];
