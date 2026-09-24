/**
 * The FAQ — what each part of School Visit Planning does, and what to do when
 * it doesn't.
 *
 * Content, not data, for the same reason as the Updates log. Unlike the log it
 * is not dated: a FAQ describes how the app works now, so an answer that stops
 * being true is edited, never appended to.
 *
 * The audience split here is NOT the one YMU-A uses. Everyone who signs in to
 * SVP is a manager, so there is no teacher to hold anything back from — but
 * the oversight roles read the week rather than change it (canPlanVisits is
 * false for them, and WeeklyPlanner hides its Add/Confirm/Postpone/Skip
 * controls). Telling somebody how to confirm a visit they have no button for
 * is the same mistake in a different coat, so planning answers are tagged
 * `planners`.
 *
 * The numbers come from the code: 250 m is ConfirmVisitModal's
 * GEOFENCE_RADIUS_M, and the three visit modes and three vehicle types are the
 * VisitMode and VehicleType enums.
 */

export type Audience = "everyone" | "planners";

export type FaqItem = {
  q: string;
  /** Paragraphs. Kept to one or two — a FAQ answer nobody finishes is no answer. */
  a: string[];
};

export type FaqSection = {
  title: string;
  audience: Audience;
  items: FaqItem[];
};

export const FAQ: FaqSection[] = [
  {
    title: "The Weekly Planner",
    audience: "planners",
    items: [
      {
        q: "How is my week built?",
        a: [
          "As days you could actually drive: schools that teach that day, close together, and due for a visit. Each visit is treated as a twenty-minute drop-in, not the whole class.",
        ],
      },
      {
        q: "Can I change the plan?",
        a: [
          "Yes — add, postpone, skip, or reorder a day's route, and the mileage reprices itself. A change you make by hand sticks; the planner won't undo it the next time it runs.",
        ],
      },
      {
        q: "Can I limit how many visits a day?",
        a: ["Yes, set a daily cap. Past days stop competing with today's plan."],
      },
      {
        q: "A school never seems to come up.",
        a: [
          "The planner only proposes schools on days they actually teach, and it works from the region that owns the school. Check the Zone Map and the school's own page.",
        ],
      },
    ],
  },
  {
    title: "Confirming a visit",
    audience: "planners",
    items: [
      {
        q: "How do I confirm one?",
        a: [
          "Open the visit and confirm it. For an in-person visit on the day, the app checks you're within 250 m of the school.",
        ],
      },
      {
        q: "I'm at the school but it says I'm too far.",
        a: [
          "You can override it and confirm anyway. The override is recorded — it isn't a workaround anyone needs to hide.",
        ],
      },
      {
        q: "What if I have no GPS?",
        a: [
          "A visit can be confirmed on the strength of the clock alone, but only on the day itself and only when the timetable behind it is sound.",
        ],
      },
      {
        q: "I'm logging a day that already happened.",
        a: [
          "Confirm it from Visit History. A past day is closed without pretending to check where you were.",
        ],
      },
      {
        q: "Why is the observation note required?",
        a: [
          "Only when you say the visit included the YMU teacher. It was optional, and the fastest way through the form recorded nothing about what you saw.",
        ],
      },
      {
        q: "I couldn't fill in the rubric.",
        a: [
          "Say why it's blank. “There was no class” and “I didn't stay for it” are different answers and the app keeps them apart.",
        ],
      },
    ],
  },
  {
    title: "Visits, calls and online",
    audience: "everyone",
    items: [
      {
        q: "What counts as a visit?",
        a: [
          "In person, online, or by phone. A phone call counts as contact with the school, but it is not a visit and nobody drives to one.",
        ],
      },
      {
        q: "Can I log a visit to another region's school?",
        a: [
          "Yes. It's recorded against you, and it doesn't count towards that region's own coverage.",
        ],
      },
      {
        q: "Which teacher does a visit record?",
        a: [
          "Whoever was teaching that class. It defaults to the teacher on the timetable, and you can change it.",
        ],
      },
    ],
  },
  {
    title: "Mileage",
    audience: "everyone",
    items: [
      {
        q: "Which miles are owed back to me?",
        a: [
          "The ones you drove in your own car. Miles in the YMU van, or riding in someone else's car, are recorded but not owed back to you.",
        ],
      },
      {
        q: "Is the commute paid?",
        a: ["No. The drive to your first school and home from your last are not counted."],
      },
      {
        q: "A day has no mileage on it.",
        a: [
          "The app says so rather than quietly reporting zero. Open the day in Visit History and add it.",
        ],
      },
      {
        q: "Does the office count?",
        a: [
          "The YMU office can be where a day starts, passes through, or ends, and it stays inside your region's mileage.",
        ],
      },
    ],
  },
  {
    title: "Schools, teachers and the map",
    audience: "everyone",
    items: [
      {
        q: "Where do schools and classes come from?",
        a: [
          "The same roster and Google Calendars as YMU-A, so both apps agree on what a school is and who teaches there.",
        ],
      },
      {
        q: "A school's teachers look wrong.",
        a: [
          "The list is built from the classes they actually teach this school year, not from last year's record. If it's still wrong, the school's calendar is the place to fix it.",
        ],
      },
      {
        q: "What's the Zone Map for?",
        a: ["Seeing your region's schools laid out, and which of them have gone unvisited."],
      },
    ],
  },
  {
    title: "Reports",
    audience: "everyone",
    items: [
      {
        q: "What's in Reports?",
        a: [
          "Visits and mileage over any period you choose. Everything also exports daily into the spreadsheet the Academic Manager works from.",
        ],
      },
      {
        q: "What time zone is shown?",
        a: ["Miami time, wherever the app happens to be running."],
      },
    ],
  },
  {
    title: "Your account",
    audience: "everyone",
    items: [
      {
        q: "How do I sign in?",
        a: [
          "With your YMU email and password, or with Google. Google only reaches an account that is already on the roster — it doesn't create one.",
        ],
      },
      {
        q: "Can I use it on my phone?",
        a: [
          "Yes. Add it to your home screen and it behaves like a normal app, including offline for pages you've already opened.",
        ],
      },
      {
        q: "I can open the Planner but can't change anything.",
        a: [
          "That's deliberate for the oversight roles — the CPO, Operations Manager and Academic Manager read the week; the Regional Manager driving it is the one who changes it.",
        ],
      },
    ],
  },
];

/** The FAQ as a given reader should see it. */
export function faqFor(audience: Audience): FaqSection[] {
  if (audience === "planners") return FAQ;
  return FAQ.filter((section) => section.audience === "everyone");
}
