import { NextRequest } from 'next/server';
import { GeminiService } from '@/lib/gemini';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const { nodeId, nodeLabel, parentTopic, question } = await request.json();

  if (!nodeId || !nodeLabel || !parentTopic || !question) {
    return Response.json(
      { error: 'nodeId, nodeLabel, parentTopic, and question are required' },
      { status: 400 }
    );
  }

  const result = await GeminiService.answerNodeQuestion(nodeLabel, parentTopic, question);

  return Response.json({ nodeId, question, answer: result.answer });
}
