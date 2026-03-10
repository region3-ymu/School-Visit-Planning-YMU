import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    // Dynamic import to avoid build-time issues
    const { seedSchoolsMock } = await import('@/app/actions');
    const result = await seedSchoolsMock();
    
    return NextResponse.json({
      success: true,
      message: 'Database seeded successfully',
      result
    });
    
  } catch (error) {
    console.error('Seeding error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    message: 'Use POST to seed the database with initial school data'
  });
}
