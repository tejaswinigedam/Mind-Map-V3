import { GeminiService } from '../services/GeminiService';
import { SkillExpansionResult } from './types';

/**
 * ExplorationSkill
 *
 * Dynamically expands an existing node in the mind map.
 * Activated when the user clicks "Expand Node" on any node.
 * Generates deeper subtopics, alternate perspectives, and recursive exploration paths.
 */
export class ExplorationSkill {
  public readonly id = 'exploration';
  public readonly name = 'Exploration';
  public readonly description = 'Dynamically deepens a selected node with new child concepts.';

  async run(
    selectedNode: string,
    parentTopic: string,
    depth: 'basic' | 'detailed' | 'deep'
  ): Promise<SkillExpansionResult> {
    return GeminiService.exploreNode(selectedNode, parentTopic, depth);
  }
}
