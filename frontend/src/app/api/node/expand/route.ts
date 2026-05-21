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

  // Use nodeId-scoped IDs so multiple expansions never collide.
  // Gemini always returns "exp-1","exp-2"… which clash across expansions.
  const newChildren = result.newChildren ?? [];

  const newNodes: MindMapNode[] = newChildren.map((child, i) => ({
    id: `${nodeId}-exp-${i}`,        // unique: parent id + index
    type: 'custom',
    data: {
      label: child.label,
      description: child.description ?? '',
      depth: pDepth + 1,
      importance: 'low' as const,
    },
    position: {
      x: pX + 290,
      y: pY + (i - Math.floor(newChildren.length / 2)) * 110,
    },
  }));

  const newEdges: MindMapEdge[] = newChildren.map((_, i) => ({
    id: `e-${nodeId}-exp-${i}`,      // matches node IDs above
    source: nodeId,
    target: `${nodeId}-exp-${i}`,
    type: 'smoothstep',
    animated: false,
  }));

  return Response.json({ newNodes, newEdges });
}
