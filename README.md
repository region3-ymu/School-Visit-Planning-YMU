# Regional School Visit Planner

A comprehensive Next.js application for planning and managing school visits in the Miami-Dade area. Features AI-powered assistance, calendar integration, and geographic visualization.

## 🚀 Features

- **Dashboard**: Overview of visit statistics and school performance
- **Weekly Planner**: AI-assisted visit scheduling with A/B day considerations
- **School Profiles**: Manage school information and visit frequency
- **Visit History**: Track and manage completed visits
- **Zone Map**: Geographic visualization of school locations
- **AI Chat**: Intelligent assistance for planning decisions

## 🛠 Tech Stack

- **Frontend**: Next.js 16.1.6, React 19.2.3, TypeScript
- **Database**: Neon PostgreSQL with Prisma ORM
- **UI**: TailwindCSS, Lucide React icons
- **Maps**: Leaflet with React-Leaflet
- **Calendar**: FullCalendar integration
- **State Management**: Zustand

## 📦 Installation

1. Clone the repository
```bash
git clone https://github.com/[username]/regional-school-visit-planner.git
cd regional-school-visit-planner
```

2. Install dependencies
```bash
npm install
```

3. Set up environment variables
```bash
cp .env.example .env.local
# Add your DATABASE_URL from Neon
```

4. Initialize database
```bash
npx prisma db push
npx prisma generate
```

5. Run development server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

## 🗄 Database Schema

The application uses PostgreSQL with the following models:

- **School**: School information, location, availability rules, optional `googleCalendarId`
- **Teacher**, **Subject**, **ClassSession**: Class schedules (synced from Google Calendar)
- **VisitRule**: Per-school visit frequency (WEEKLY, BIWEEKLY, etc.) and priority
- **Visit**: Planned/done/cancelled/skipped visits with time windows
- **CalendarDay**: A/B day schedule and holidays (legacy)
- **VisitLog**: Historical visit records (legacy, kept for compatibility)

## 🚀 Deployment

### Vercel Deployment

1. Push to GitHub repository
2. Connect Vercel to your GitHub account
3. Import the repository
4. Configure environment variables:
   - `DATABASE_URL`: Your Neon PostgreSQL connection string
5. Deploy!

For detailed deployment instructions, see [DEPLOYMENT.md](./DEPLOYMENT.md).

## 🧪 Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run sync-calendars:test` - Sync school calendars from Google Calendar (test only)

### Database Commands

- `npx prisma db push` - Push schema changes to database
- `npx prisma generate` - Generate Prisma client
- `npx prisma studio` - Open database browser

## 📋 Project Structure

```
src/
├── app/                 # Next.js app router
│   ├── actions.ts      # Server actions
│   └── api/           # API routes
├── components/         # React components
├── lib/              # Utility functions
└── store/            # Zustand state management
```

## 🤖 AI Features

The application includes AI-powered features for:
- Intelligent visit scheduling
- Route optimization suggestions
- Planning assistance and recommendations

## 📍 Geographic Features

- Interactive maps showing school locations
- Zone-based clustering
- Geographic proximity calculations

## 📅 Calendar Integration

- A/B day scheduling support
- Holiday and planning day awareness
- Weekly and monthly view options

## 🔧 Configuration

### Environment Variables

See `.env.example`. Main variables:

- `DATABASE_URL`: PostgreSQL connection string (required)
- **Google Calendar API** (for calendar sync, do not use in production until validated):
  - `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REFRESH_TOKEN`
  - Create OAuth 2.0 credentials in Google Cloud Console, enable Calendar API, and obtain a refresh token (e.g. via OAuth Playground with `https://www.googleapis.com/auth/calendar.readonly`).
- **Visit planner work window**: `PLANNER_WORK_START=08:00`, `PLANNER_WORK_END=17:00` (HH:mm 24h).
- **OpenRouteService** (for distance/route estimates in the planner): `OPENROUTE_SERVICE_API_KEY` (get a key at [openrouteservice.org](https://openrouteservice.org/)).

### Calendar sync (test only)

Run the sync script to import classes from Google Calendar into `ClassSession` (and match calendars to schools by name):

```bash
npm run sync-calendars:test
```

This is for testing only; do not use in production until validated.

### Prisma Configuration

The database schema is defined in `prisma/schema.prisma` and uses PostgreSQL. Apply migrations with `npx prisma migrate deploy`.

## 📄 License

This project is private and confidential.

## 🤝 Support

For deployment issues or questions, refer to the [DEPLOYMENT.md](./DEPLOYMENT.md) guide.
