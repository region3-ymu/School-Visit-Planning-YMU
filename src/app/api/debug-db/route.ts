import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(request: NextRequest) {
  try {
    // Test database connection
    await prisma.$connect();
    
    // Check if schools exist
    const schoolCount = await prisma.school.count();
    
    // Check if visit logs exist
    const visitCount = await prisma.visitLog.count();
    
    // Test seeding if no schools
    let seedResult = null;
    if (schoolCount === 0) {
      const { seedSchoolsMock } = await import('@/app/actions');
      seedResult = await seedSchoolsMock();
    }
    
    return NextResponse.json({
      success: true,
      database: 'connected',
      schoolCount,
      visitCount,
      seedResult
    });
    
  } catch (error) {
    console.error('Database debug error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      database: 'disconnected'
    }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}
