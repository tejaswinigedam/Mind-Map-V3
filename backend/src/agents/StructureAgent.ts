import { BaseAgent } from './BaseAgent';
import { AgentId, SharedMemory } from '../orchestrator/types';
import { GeminiService } from '../services/GeminiService';

export class StructureAgent extends BaseAgent {
  public readonly id: AgentId = 'structure';
  public readonly name = 'Structure Planning Agent';
  public readonly description = 'Clusters concepts, designs tree hierarchies, and creates a logical flow of understanding.';

  public async run(memory: SharedMemory): Promise<{
    thought: string;
    logMessage: string;
    updatedMemory: Partial<SharedMemory>;
  }> {
    const topic = memory.originalInput;
    const intent = memory.extractedIntent;
    const expansion = memory.expandedKnowledge;

    if (!intent || !expansion) {
      throw new Error('[StructureAgent] Pre-requisite shared memory (intent/expansion) is missing.');
    }

    const thought = `Structuring the conceptual grid. Organizing the concepts from knowledge expansion into hierarchical levels. We must avoid cognitive overload. I will group topics into major semantic clusters: Core Foundations, Advanced Methodologies, and Systems Implications, and map parent-child pathways.`;

    const structurePlan = await GeminiService.planStructure(topic, intent, expansion);

    return {
      thought,
      logMessage: `Hierarchical layout planned. Grouped nodes into ${structurePlan.clusters.length} semantic clusters. Established path flow order.`,
      updatedMemory: {
        structurePlan
      }
    };
  }
}
