// ─── Orchestrator / Shared types ──────────────────────────────────────────────

export type ExplorationDepth = 'surface' | 'intermediate' | 'deep' | 'strategic' | number;

export type SemanticArchitecture = {
  expansion?: unknown;
  structure?: unknown;
  [key: string]: unknown;
};

export interface ClarifyingQuestion {
  id: string;
  question: string;
  rationale: string;
  options?: string[];
}

export interface ClarifyingAnswer {
  questionId: string;
  questionText: string;
  answerText: string;
}

export interface ExtractedIntent {
  goals: string[];
  useCase: string;
  learningStyle: string;
  explorationDepth: ExplorationDepth;
  expertiseLevel: string;
  breadthPreference: 'breadth' | 'specialization' | 'balanced';
}

export interface KnowledgeExpansion {
  missingAreas: string[];
  relatedConcepts: string[];
  hiddenBranches: string[];
  recommendedPerspectives: string[];
}

export interface StructurePlan {
  clusters: { name: string; conceptIds: string[] }[];
  hierarchy: { parentId: string; childIds: string[] }[];
  flowOrder: string[];
}

export interface MindMapNode {
  id: string;
  type?: string;
  data: {
    label: string;
    description?: string;
    depth?: number;
    details?: string;
    isCollapsed?: boolean;
    importance?: 'high' | 'medium' | 'low';
    tradeoff?: string;
  };
  position: { x: number; y: number };
}

export interface MindMapEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  animated?: boolean;
  label?: string;
}

export interface SharedMemory {
  originalInput: string;
  clarifyingQuestions: ClarifyingQuestion[];
  clarifyingAnswers: ClarifyingAnswer[];
  extractedIntent?: ExtractedIntent;
  expandedKnowledge?: KnowledgeExpansion;
  structurePlan?: StructurePlan;
  mindMap?: { nodes: MindMapNode[]; edges: MindMapEdge[] };
  compressedSummary: string;
  conversationHistory?: { role: 'user' | 'assistant'; content: string }[];
  skillIntentResult?: SkillIntentResult;
  skillMapTree?: SkillMapResult;
}

export type AgentId =
  | 'intent-clarifier'
  | 'knowledge-architect'
  | 'exploration'
  | 'node-conversation'
  | 'validation'
  | 'clarity'
  | 'intent'
  | 'expansion'
  | 'structure'
  | 'generation'
  | 'memory';

export type WorkflowState = 'idle' | 'running' | 'waiting' | 'completed' | 'failed';

export interface AgentExecutionLog {
  timestamp: string;
  agentId: AgentId;
  status: 'running' | 'completed' | 'failed' | 'waiting';
  message: string;
  thought?: string;
  duration?: number;
}

export interface WorkflowStatus {
  state: WorkflowState;
  activeAgentId: AgentId | null;
  completedAgentIds: AgentId[];
  logs: AgentExecutionLog[];
}

export interface OrchestratorState {
  memory: SharedMemory;
  status: WorkflowStatus;
}

// ─── Skill types ───────────────────────────────────────────────────────────────

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
