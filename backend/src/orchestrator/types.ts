import { SkillIntentResult, SkillMapResult } from '../skills/types';

export type ExplorationDepth = 'surface' | 'intermediate' | 'deep' | 'strategic' | number;

// Alias used by legacy GenerationAgent / GeminiService
export type SemanticArchitecture = {
  expansion?: unknown;
  structure?: unknown;
  [key: string]: unknown;
};

export interface ClarifyingQuestion {
  id: string;
  question: string;
  rationale: string; // why this question is being asked
  options?: string[]; // potential answers for easier selection
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

export interface ConceptNode {
  id: string;
  label: string;
  description: string;
  importance: 'high' | 'medium' | 'low';
  category?: string;
  parentId?: string;
  contradictionOrTradeoff?: string; // perspective or trade-off
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
  flowOrder: string[]; // sequence of understanding
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
  mindMap?: {
    nodes: MindMapNode[];
    edges: MindMapEdge[];
  };
  validation?: {
    status: 'clear' | 'ambiguous' | 'invalid';
    message: string;
    options?: string[];
  };
  compressedSummary: string;
  conversationHistory: { role: 'user' | 'assistant'; content: string }[];
  // Skill-based fields
  skillIntentResult?: SkillIntentResult;
  skillMapTree?: SkillMapResult;
}

export type AgentId =
  | 'validation'
  | 'clarity'
  | 'intent'
  | 'expansion'
  | 'structure'
  | 'generation'
  | 'memory'
  // Skill IDs
  | 'intent-clarifier'
  | 'knowledge-architect'
  | 'exploration'
  | 'node-conversation';

export type WorkflowState = 'idle' | 'running' | 'waiting' | 'completed' | 'failed';

export interface AgentExecutionLog {
  timestamp: string;
  agentId: AgentId;
  status: 'running' | 'completed' | 'failed' | 'waiting';
  message: string;
  thought?: string; // The visible "inner thought" process of the agent
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
