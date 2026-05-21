import { NextRequest } from 'next/server';
import { SkillOrchestrator } from '@/lib/orchestrator';
import { OrchestratorState } from '@/lib/types';

// Allow up to 60s on Vercel Pro; Hobby plan caps at 10s automatically
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { topic, answers } = body as {
    topic: string;
    answers?: { questionId: string; questionText: string; answerText: string }[];
  };

  if (!topic?.trim()) {
    return Response.json({ error: 'Topic is required' }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (state: OrchestratorState) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'STATE_UPDATE', state })}\n\n`)
          );
        } catch {
          // Stream may have been closed by client disconnect
        }
      };

      const orchestrator = new SkillOrchestrator(topic.trim(), enqueue);

      try {
        if (answers && answers.length > 0) {
          await orchestrator.submitAnswers(answers);
        } else {
          await orchestrator.startWorkflow();
        }
      } catch (err: any) {
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'ERROR', message: err.message })}\n\n`
            )
          );
        } catch {}
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
