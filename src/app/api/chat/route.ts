import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText } from 'ai';

const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
});

export const maxDuration = 30;

export async function POST(req: Request) {
    try {
        const { messages } = await req.json();

        const result = streamText({
            model: openrouter('google/gemini-2.0-flash-lite-preview-02-05:free'),
            system: `You are an expert Regional School Visit Pramer Assistant for Miami-Dade County. 
      You help the Regional Manager optimize their schedule, review completed visits, and plan future routes based on A/B day logic.
      Be concise, helpful, and professional. 
      The user is working with frequency targets like weekly, bi-weekly, and monthly.
      Do not generate imaginary data unless asked; ask the user for context if needed.`,
            messages,
        });

        return (result as any).toDataStreamResponse();
    } catch (error: any) {
        console.error("AI chat error:", error);
        return new Response(JSON.stringify({ error: error.message || "Failed to initiate AI stream" }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
}
