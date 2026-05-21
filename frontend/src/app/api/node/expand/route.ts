import { NextRequest } from 'next/server';
import { GeminiService } from '@/lib/gemini';
import { MindMapNode, MindMapEdge } from '@/lib/types';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const { nodeId, nodeLabel, parentTopic, depth, parentPosition, parentDepth } =
    await request.json();

  if (!nodeId || !nodeLabel || !parentTopic) {
    return Response.json(
      { error: 'nodeId, nodeLabel, and parentTopic are required' },
      { status: 400 }
    );
  }

  const safeDepth: 'basic' | 'detailed' | 'deep' =
    depth === 'basic' || depth === 'deep' ? depth : 'detailed';

  const result = await GeminiService.exploreNode(nodeLabel, parentTopic, safeDepth);

  const pX: number = parentPosition?.x ?? 0;
  const pY: number = parentPosition?.y ?? 0;
  const pDepth: number = parentDepth ?? 1;

  const newNodes: MindMapNode[] = result.newChildren.map((child, i) => ({
    id: child.id,
    type: 'custom',
    data: {
      label: child.label,
      description: child.description,
      depth: pDepth + 1,
      importance: 'low' as const,
    },
    position: {
      x: pX + 290,
      y: pY + (i - Math.floor(result.newChildren.length / 2)) * 110,
    },
  }));

  const newEdges: MindMapEdge[] = result.newChildren.map(child => ({
    id: `e-${nodeId}-${child.id}`,
    source: nodeId,
    target: child.id,
    type: 'smoothstep',
    animated: false,
  }));

  return Response.json({ newNodes, newEdges });
}
