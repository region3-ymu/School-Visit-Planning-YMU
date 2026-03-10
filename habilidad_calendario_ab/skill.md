# SKILL: Regional School Visit Planner (Miami-Dade A/B Schedule Expert)

## Role & Core Objective
Act as an Expert Software Architect and Full-Stack Developer. Your goal is to build a dynamic web application called "Regional School Visit Planner". This system will autonomously generate and continuously update the optimal weekly visit plan for a regional manager visiting 11 active schools in the Miami-Dade County Public Schools system.

This is NOT a static routing app. It is a dynamic scheduling engine that must adapt to an uploaded A/B block schedule, specific class windows, varying visit frequencies, geographic proximity, and manual overrides.

## 1. Data Inputs & Structure

### A. The Calendar Engine (Source of Truth)
* **Input:** Miami-Dade 2025-2026 School Calendar (parsed from PDF/data).
* **Logic:** Do NOT assume a fixed alternating A/B pattern. The system must read the calendar data to determine if a specific date is an "A Day", "B Day", "Teacher Planning Day", or "Holiday". 
* **Exception Handling:** Holidays and breaks shift the A/B rhythm. The uploaded calendar dictates the reality of the week.

### B. School Dataset & Availability
The app must manage specific availability windows for the following active schools:
* Young Men’s Preparatory Academy
* West Little River K-8
* Coral Gables Senior High School
* Horace Mann Middle School
* Miami Edison Senior High School
* Brownsville Middle School 
* Edison Park K-8
* Georgia Jones-Ayers Middle School
* Kelsey L Pharr Elementary School
* Citrus Grove K-8
* MorningSide K-8

**Availability Normalization:** Convert complex text schedules into structured JSON rules. 
*Example:* ```json
{
  "school": "West Little River K-8",
  "availability": [
    { "dayType": "A", "start": "13:40", "end": "15:05", "class": "Beginning Band" },
    { "dayType": "B", "start": "13:40", "end": "15:05", "class": "Drumline" },
    { "weekday": "Wednesday", "start": "12:42", "end": "13:50", "note": "Early Release" }
  ],
  "frequencyTarget": "bi-weekly"
}
2. The Scheduling Engine (Core Algorithm)
The engine must calculate the best practical route for a given week. Do not over-optimize routing at the expense of due visits.

Scoring Model for Visit Candidates:

Overdue/Urgency (High Weight): How many days since the last visit compared to the target frequency (weekly, bi-weekly, monthly)?

Schedule Viability (Hard Constraint): Does the school actually have the required class (A/B day match) on this date?

Geographic Clustering (Medium Weight): Are there other high-priority schools in the same zip code/zone available on the exact same day and compatible time window?

Manual Overrides (Absolute Override): Did the user click "Pin to Tuesday" or "Skip this week"?

3. UI/UX Features
Build a fast, responsive web interface with the following sections:

Dashboard: Show total active schools, "Due this week", "Overdue", and recent cancellations.

The Weekly Planner (Main View): A Mon-Fri board showing A/B labels for the week, the recommended order of visits, class times, and a plain-language reason (e.g., "Scheduled because it is overdue and groups geographically with Citrus Grove").

Replanning Trigger: A prominent "Recalculate Plan" button to instantly re-run the algorithm if a teacher cancels or a manual edit is made.

School Profiles: Editable CRM-style pages for each school to adjust schedules, frequencies, and priority levels.

Map/Zone View: Visual clustering of the 11 schools to verify geographic logic.

4. Technical Stack Requirements
Frontend: React + TypeScript

UI/Styling: Tailwind CSS, FullCalendar (or custom week grid)

State Management: Zustand

Backend/API: Next.js API Routes or Node.js/Express

Database: Supabase or PostgreSQL (to store history, schedules, and logs)

Date/Time Math: date-fns

5. Execution Directives for Antigravity
Begin by scaffolding the MVP structure using the requested Tech Stack.

Create the database schema (Schools, Calendar Days, Visit Logs).

Implement the A/B calendar parser and the core Scoring Engine.

Do not hardcode a fixed weekly schedule. Ensure the UI dynamically fetches recommendations from the scoring engine.

Wait for my approval after scaffolding the initial project structure before proceeding to the UI components.