export type SkillIntent = 'learning' | 'planning' | 'brainstorming' | 'research' | 'problem-solving';
export type SkillDepth = 'basic' | 'detailed' | 'deep';

export interface SkillIntentResult {
  topic: string;
  intent: SkillIntent;
  depth: SkillDepth;
  clarifications: string[];
  userGoal: string;
  confidence: number;
}

export interface SkillMapNode {
  id: string;
  label: string;
  description: string;
  children: SkillMapNode[];
}

export interface SkillMapResult {
  root: string;
  children: SkillMapNode[];
}

export interface SkillExpansionResult {
  newChildren: SkillMapNode[];
}

export interface SkillConversationResult {
  answer: string;
}

export interface SkillClarificationAnswer {
  question: string;
  answer: string;
}
