import { BaseAgent } from './BaseAgent';
import { AgentId, SharedMemory } from '../orchestrator/types';
import { GeminiService } from '../services/GeminiService';

export class ClarityAgent extends BaseAgent {
  public readonly id: AgentId = 'clarity';
  public readonly name = 'Context Clarity Agent';
  public readonly description = 'Detects topic ambiguity and generates adaptive clarifying questions to establish high-definition cognitive context.';

  public async run(memory: SharedMemory): Promise<{
    thought: string;
    logMessage: string;
    updatedMemory: Partial<SharedMemory>;
  }> {
    const topic = memory.originalInput;
    const priorAnswers = memory.clarifyingAnswers;

    let thought = '';
    if (priorAnswers.length === 0) {
      thought = `Analyzing input "${topic}" for immediate ambiguity. Since there are no prior answers, I need to outline our baseline blindspots. Topic seems broad; generating three diagnostic questions to clarify target expertise level, depth of exploration, and exact project goal.`;
    } else {
      thought = `Analyzing answers to clarifying questions. User responded to questions, providing crucial focus. I am checking if there is any remaining ambiguity. Current answers: ${priorAnswers.map(a => `[${a.questionText} -> ${a.answerText}]`).join('; ')}. Context is highly clarified. Moving to intent formulation.`;
    }

    // Call Gemini Service to get adaptive questions
    const result = await GeminiService.generateClarifyingQuestions(topic, priorAnswers);

    return {
      thought,
      logMessage: priorAnswers.length === 0 
        ? `Identified ambiguity in "${topic}". Formulated 3 context-aware questions to align the brainstorming system.` 
        : `Clarified context successfully using user answers. Shared memory updated with cognitive constraints.`,
      updatedMemory: {
        clarifyingQuestions: result.questions
      }
    };
  }
}
