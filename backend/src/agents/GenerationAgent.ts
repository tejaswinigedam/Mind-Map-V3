import { BaseAgent } from './BaseAgent';
import { AgentId, SharedMemory } from '../orchestrator/types';
import { GeminiService } from '../services/GeminiService';

export class GenerationAgent extends BaseAgent {
  public readonly id: AgentId = 'generation';
  public readonly name = 'Mind Map Generation Agent';
  public readonly description = 'Generates physical nodes, connects structural edges, and calculates tree-based spatial coordinates.';

  public async run(memory: SharedMemory): Promise<{
    thought: string;
    logMessage: string;
    updatedMemory: Partial<SharedMemory>;
  }> {
    const topic = memory.originalInput;
    const intent = memory.extractedIntent;
    const expansion = memory.expandedKnowledge;
    const structure = memory.structurePlan;

    if (!intent || !expansion || !structure) {
      throw new Error('[GenerationAgent] Missing context prerequisites in shared memory.');
    }

    const thought = `Calculating spatial layouts on the 2D Cartesian plane. Setting root at (0,0). Positioning Level 1 nodes with wide vertical offsets at X: 250 to ensure zero overlap. Distributing Level 2 child nodes at X: 520 to establish a high-definition, readable horizontal tree structure. Tailoring density for "${intent.explorationDepth}" depth.`;

    const mindMap = await GeminiService.generateMindMap(topic, intent, expansion, structure);

    return {
      thought,
      logMessage: `Successfully generated interactive graph structure. Positioned ${mindMap.nodes.length} nodes and wired ${mindMap.edges.length} edges.`,
      updatedMemory: {
        mindMap
      }
    };
  }
}
