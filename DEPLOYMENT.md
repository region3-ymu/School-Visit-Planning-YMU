# Deployment Guide - Regional School Visit Planner

## Current Status ✅
- Next.js project builds successfully
- Neon PostgreSQL database connected and schema synchronized
- Prisma client generated
- Development server running on localhost:3000
- All components and functionality in place

## Pre-Deployment Checklist

### 1. GitHub Repository Setup
- [ ] Create new GitHub repository
- [ ] Update remote origin URL
- [ ] Push local commits to GitHub

### 2. Environment Variables
- [ ] `DATABASE_URL` - Neon PostgreSQL connection string
- [ ] Any AI API keys (if using external AI services)

### 3. Vercel Configuration
- [ ] Connect Vercel to GitHub repository
- [ ] Configure environment variables in Vercel
- [ ] Set up custom domain (optional)

### 4. Production Testing
- [ ] Test database connectivity
- [ ] Verify all features work in production
- [ ] Test AI chat functionality
- [ ] Validate calendar and planning features

## Deployment Steps

### Step 1: Create GitHub Repository
```bash
# Create repository on GitHub first, then:
git remote add origin https://github.com/[username]/[repository-name].git
git push -u origin master
```

### Step 2: Deploy to Vercel
1. Go to [vercel.com](https://vercel.com)
2. Click "New Project"
3. Import GitHub repository
4. Configure environment variables:
   - `DATABASE_URL`: Your Neon database connection string
5. Deploy

### Step 3: Post-Deployment
1. Test the live application
2. Verify database seeding works
3. Test all features:
   - Dashboard
   - Weekly Planner
   - School Profiles
   - Visit History
   - Map View
   - AI Chat

## Environment Variables Required

**Required for Production:**
- `DATABASE_URL` - PostgreSQL connection string (Neon)

**Optional (if using AI features):**
- `OPENAI_API_KEY` - For AI chat functionality
- Other AI service API keys as needed

## Database Information

**Provider:** Neon PostgreSQL
**Schema:** Already synchronized
**Models:** School, CalendarDay, VisitLog
**Seeding:** Automatic on first run

## Build Configuration

**Framework:** Next.js 16.1.6
**Build Command:** `npm run build`
**Output Directory:** `.next`
**Node Version:** 18.x or higher

## Troubleshooting

### Database Connection Issues
- Verify DATABASE_URL is correct in Vercel environment
- Check Neon database is active
- Run `npx prisma db push` if schema issues

### Build Issues
- Ensure all dependencies are installed
- Check TypeScript compilation
- Verify environment variables are set

### Feature Issues
- Test API endpoints manually
- Check browser console for errors
- Verify Prisma client is working

## Support

For deployment issues:
1. Check Vercel deployment logs
2. Verify environment variables
3. Test database connection
4. Review build output for errors
