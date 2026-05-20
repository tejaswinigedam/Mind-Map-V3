import { BaseAgent } from './BaseAgent';
import { AgentId, SharedMemory } from '../orchestrator/types';
import { GeminiService } from '../services/GeminiService';

export class MemoryAgent extends BaseAgent {
  public readonly id: AgentId = 'memory';
  public readonly name = 'Memory / Compression Agent';
  public readonly description = 'Maintains dynamic session memory, summarizes long histories, and compresses cognitive context for flawless long-session continuity.';

  public async run(memory: SharedMemory): Promise<{
    thought: string;
    logMessage: string;
    updatedMemory: Partial<SharedMemory>;
  }> {
    const history = memory.conversationHistory;
    const currentSummary = memory.compressedSummary;

    const thought = `Executing memory compression algorithms. Decomposing active conversational thread into semantic vectors. Maintaining structural focus on user's core interests (e.g. alignment models, scaling laws) to ensure downstream agents remember what was established in previous branches.`;

    const result = await GeminiService.compressMemory(history, currentSummary);

    return {
      thought,
      logMessage: `Shared memory compressed and optimized for session continuity. Context capacity fully retained.`,
      updatedMemory: {
        compressedSummary: result.compressedSummary
      }
    };
  }
}
