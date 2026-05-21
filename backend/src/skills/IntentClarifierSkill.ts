import { GeminiService } from '../services/GeminiService';
import { SkillIntentResult, SkillClarificationAnswer } from './types';

/**
 * IntentClarifierSkill
 *
 * Understands what the user is actually trying to do before the mind map is generated.
 * Detects ambiguity, identifies intent, determines depth, and asks clarification questions
 * only when the input is too vague to proceed confidently.
 */
export class IntentClarifierSkill {
  public readonly id = 'intent-clarifier';
  public readonly name = 'Intent Clarifier';
  public readonly description = 'Understands user intent, depth, and goal before generating the mind map.';

  async run(
    topic: string,
    priorAnswers?: SkillClarificationAnswer[]
  ): Promise<SkillIntentResult> {
    return GeminiService.clarifyIntent(topic, priorAnswers);
  }
}
