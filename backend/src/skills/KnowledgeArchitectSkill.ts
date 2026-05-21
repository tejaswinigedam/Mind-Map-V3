import { GeminiService } from '../services/GeminiService';
import { SkillIntentResult, SkillMapResult } from './types';

/**
 * KnowledgeArchitectSkill
 *
 * Generates a semantically structured, hierarchical mind map tree.
 * Depth behaviour:
 *   basic    → broad overview (2 levels)
 *   detailed → layered hierarchy (3 levels)
 *   deep     → recursive expandable structure (4+ levels)
 */
export class KnowledgeArchitectSkill {
  public readonly id = 'knowledge-architect';
  public readonly name = 'Knowledge Architect';
  public readonly description = 'Generates the semantic mind map tree structure based on resolved intent.';

  async run(intentResult: SkillIntentResult): Promise<SkillMapResult> {
    return GeminiService.buildKnowledgeMap(intentResult);
  }
}
