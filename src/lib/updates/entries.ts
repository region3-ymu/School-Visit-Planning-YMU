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
    date: "2026-10-15",
    items: [
      {
        module: "Schools",
        text: "Schools can be put On hold (ours, but no classes yet) or marked Inactive (we no longer work there, or it closed), from the school's page — by Admin, Operations or that region's Regional Manager. On hold: never proposed by the planner, not counted in the dashboard, no \"Never visited\" or \"Overdue\"; a visit can still be logged there. Inactive: hidden everywhere except visit history; find it under School Directory → Inactive to bring it back. A school that resumes counts its visits from that day.",
      },
      {
        module: "Dashboard",
        text: "\"Put on hold?\" lists active schools with no class on the calendar in the last 3 weeks or the next 4 — confirm with one tap, or \"Not now\" to hide it for 30 days. \"Schools on hold\" lists the rest, and says when one has classes on the calendar again.",
      },
      {
        module: "Weekly Planner",
        text: "Choose how long visits are on your Google Calendar: a default for the week (\"Calendar visits\": recommended 20 min, first or last 20 min, or the whole class), and per visit — tap \"On your calendar\" on a card to pick another slice or set your own start and length.",
      },
      {
        module: "Weekly Planner",
        text: "Changing a visit's slice and sending it to Google Calendar again moves the event that's already there instead of adding a second one.",
      },
      {
        module: "Weekly Planner",
        text: "Postponing a visit to another day now takes that day's class: before, it kept the original day's class, and the calendar could put the visit at an hour with no class at all (Little River, Thursday at 12:30).",
      },
      {
        module: "Weekly Planner",
        text: "Visits on the same day no longer land on the same 20 minutes — planned, added by hand or postponed alike. Two classes at the same time (Henry E. S. Reeves and Lakeview, 1:05–2:05) get the first 20 minutes of one and the last 20 of the other, checked against real drive times. If a visit can't be reached in time, its card says where you'd be coming from, how long the drive is and when you'd arrive, with one-tap fixes — or, when no slice works, to postpone one of them. Slices you chose yourself are never moved.",
      },
      {
        module: "Visit History",
        text: "When you observed a class (\"Yes — I observed it\"), the teacher now sees your ratings, notes and name under Evaluations in YMU-A, and is notified. Choosing which teacher you observed is required for that. Nothing else from the visit is shared.",
      },
      {
        module: "Visit History",
        text: "Only the person who logged a visit (or a role allowed to edit others' visits) can delete it.",
      },
      {
        module: "Classes",
        text: "A school added overnight gets its classes the same night, and a class moved to a date past the planning window no longer stays at its old time.",
      },
    ],
  },
  {
    date: "2026-10-14",
    items: [
      {
        module: "Weekly Planner",
        text: "Moving to another week and back no longer re-plans the week you had set up — each week stays as you left it until you press Recalculate. The buttons on each visit card also fit on a phone screen now.",
      },
      {
        module: "Classes",
        text: "Classes now come from YMU-A, which reads the school calendars every 5 minutes — a class added in Google Calendar reaches the planner within minutes instead of the next morning, with its real teacher. \"Refresh classes\" on the Weekly Planner fetches them right away.",
      },
      {
        module: "Weekly Planner",
        text: "Send your planned visits to your own Google Calendar: the whole week, one day, or a single visit. Sending again updates them and removes visits you took out of the plan — it never touches anything else in your calendar.",
      },
      {
        module: "Dashboard",
        text: "\"Log a visit\" opens the visit form in one tap, and Overdue, Due This Week and Never Visited now open the list of schools behind the number.",
      },
      {
        module: "Visits",
        text: "A visit logged by hand today now checks your GPS against the school, the same as confirming a planned visit.",
      },
      {
        module: "Zone Map",
        text: "Plan a route for any day, this week or later, with the arrows next to the day picker.",
      },
      {
        module: "Report a problem",
        text: "Attach a screenshot to your report, and send another one without reloading.",
      },
      {
        module: "Schools",
        text: "Added Glades Middle School, Southwest Miami Sr. High, Rockway Middle School and Cypress K-8. From now on, a school added in YMU-A appears here the next morning on its own.",
      },
    ],
  },
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
