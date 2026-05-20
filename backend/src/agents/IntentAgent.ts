import { BaseAgent } from './BaseAgent';
import { AgentId, SharedMemory } from '../orchestrator/types';
import { GeminiService } from '../services/GeminiService';

export class IntentAgent extends BaseAgent {
  public readonly id: AgentId = 'intent';
  public readonly name = 'Intent Extraction Agent';
  public readonly description = 'Analyzes clarifying answers to formulate explicit goals, learning style, expertise level, and exploration depth.';

  public async run(memory: SharedMemory): Promise<{
    thought: string;
    logMessage: string;
    updatedMemory: Partial<SharedMemory>;
  }> {
    const topic = memory.originalInput;
    const answers = memory.clarifyingAnswers;

    const thought = `Decomposing user responses to construct a cognitive intent blueprint. Let's see: answers reveal goals relating to "${topic}". Inferring expertise level and mapping user choice to depth constraints. Generating depth level parameters which will instruct downstream expansion and generation agents.`;

    const extractedIntent = await GeminiService.extractIntent(topic, answers);

    return {
      thought,
      logMessage: `Extracted cognitive blueprint. Depth level diagnosed as: "${typeof extractedIntent.explorationDepth === 'number' ? 'LEVEL ' + extractedIntent.explorationDepth : String(extractedIntent.explorationDepth).toUpperCase()}" with expertise "${extractedIntent.expertiseLevel}".`,
      updatedMemory: {
        extractedIntent
      }
    };
  }
}
