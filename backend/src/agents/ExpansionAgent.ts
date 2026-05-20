import { BaseAgent } from './BaseAgent';
import { AgentId, SharedMemory } from '../orchestrator/types';
import { GeminiService } from '../services/GeminiService';

export class ExpansionAgent extends BaseAgent {
  public readonly id: AgentId = 'expansion';
  public readonly name = 'Knowledge Expansion Agent';
  public readonly description = 'Expands boundaries, uncovers hidden branches, detects missing conceptual areas, and recommends interdisciplinary perspectives.';

  public async run(memory: SharedMemory): Promise<{
    thought: string;
    logMessage: string;
    updatedMemory: Partial<SharedMemory>;
  }> {
    const topic = memory.originalInput;
    const intent = memory.extractedIntent;

    if (!intent) {
      throw new Error('[ExpansionAgent] Extracted intent is missing in shared memory.');
    }

    const thought = `Activating Knowledge Expansion protocols. Since depth level is set to "${intent.explorationDepth}", I will expand concept boundaries by looking for adjacent topics that standard brainstorming models ignore. Focus areas: ${intent.goals.join(', ')}. Discovering hidden branches and lateral perspectives.`;

    const expandedKnowledge = await GeminiService.expandKnowledge(topic, intent);

    return {
      thought,
      logMessage: `Expanded domain boundaries. Unearthed ${expandedKnowledge.missingAreas.length} hidden branches and recommended ${expandedKnowledge.recommendedPerspectives.length} lateral perspectives.`,
      updatedMemory: {
        expandedKnowledge
      }
    };
  }
}
