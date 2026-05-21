import { GeminiService } from '../services/GeminiService';
import { SkillConversationResult } from './types';

/**
 * NodeConversationSkill
 *
 * Allows users to ask contextual questions about any node in the mind map.
 * Stays grounded to the selected node and its branch context.
 * The interaction feels like chatting with the mind map itself.
 */
export class NodeConversationSkill {
  public readonly id = 'node-conversation';
  public readonly name = 'Node Conversation';
  public readonly description = 'Answers contextual questions about a selected node in the mind map.';

  async run(
    selectedNode: string,
    parentTopic: string,
    question: string,
    branchContext?: string
  ): Promise<SkillConversationResult> {
    return GeminiService.answerNodeQuestion(selectedNode, parentTopic, question, branchContext);
  }
}
