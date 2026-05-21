import { OrchestratorState, SharedMemory, AgentExecutionLog, MindMapNode, MindMapEdge } from '../orchestrator/types';
import { IntentClarifierSkill } from './IntentClarifierSkill';
import { KnowledgeArchitectSkill } from './KnowledgeArchitectSkill';
import { ExplorationSkill } from './ExplorationSkill';
import { NodeConversationSkill } from './NodeConversationSkill';
import { SkillIntentResult, SkillMapNode, SkillMapResult, SkillClarificationAnswer } from './types';

// Converts the skill tree structure to ReactFlow nodes/edges for rendering
function treeToReactFlow(tree: SkillMapResult): { nodes: MindMapNode[]; edges: MindMapEdge[] } {
  const nodes: MindMapNode[] = [];
  const edges: MindMapEdge[] = [];
  const NODE_GAP_Y = 110;
  const LEVEL_GAP_X = 290;

  function subtreeHeight(node: SkillMapNode): number {
    if (!node.children || node.children.length === 0) return 1;
    return node.children.reduce((sum, c) => sum + subtreeHeight(c), 0);
  }

  function processNode(
    id: string,
    label: string,
    description: string,
    children: SkillMapNode[],
    depth: number,
    yStart: number
  ): number {
    const totalUnits = children.length === 0 ? 1 : children.reduce((s, c) => s + subtreeHeight(c), 0);
    const totalHeight = totalUnits * NODE_GAP_Y;
    const yPos = yStart + totalHeight / 2 - NODE_GAP_Y / 2;
    const xPos = depth * LEVEL_GAP_X;

    nodes.push({
      id,
      type: 'custom',
      data: { label, description, depth, importance: depth === 0 ? 'high' : depth === 1 ? 'medium' : 'low' },
      position: { x: xPos, y: yPos }
    });

    let childYStart = yStart;
    for (const child of children) {
      const childHeight = subtreeHeight(child) * NODE_GAP_Y;
      edges.push({
        id: `e-${id}-${child.id}`,
        source: id,
        target: child.id,
        type: 'smoothstep',
        animated: depth === 0
      });
      processNode(child.id, child.label, child.description, child.children, depth + 1, childYStart);
      childYStart += childHeight;
    }

    return totalHeight;
  }

  // Calculate root vertical center
  const rootTotalUnits = tree.children.reduce((s, c) => s + subtreeHeight(c), 0);
  const rootYCenter = (rootTotalUnits * NODE_GAP_Y) / 2 - NODE_GAP_Y / 2;

  nodes.push({
    id: 'root',
    type: 'custom',
    data: { label: tree.root, depth: 0, importance: 'high' },
    position: { x: 0, y: rootYCenter }
  });

  let childYStart = 0;
  for (const child of tree.children) {
    const childHeight = subtreeHeight(child) * NODE_GAP_Y;
    edges.push({
      id: `e-root-${child.id}`,
      source: 'root',
      target: child.id,
      type: 'smoothstep',
      animated: true
    });
    processNode(child.id, child.label, child.description, child.children, 1, childYStart);
    childYStart += childHeight;
  }

  return { nodes, edges };
}

export class SkillOrchestrator {
  private state: OrchestratorState;
  private onStateChange: (state: OrchestratorState) => void;
  private intentResult?: SkillIntentResult;
  private mapTree?: SkillMapResult;

  private intentClarifier = new IntentClarifierSkill();
  private knowledgeArchitect = new KnowledgeArchitectSkill();
  private explorationSkill = new ExplorationSkill();
  private nodeConversation = new NodeConversationSkill();

  constructor(topic: string, onStateChange: (state: OrchestratorState) => void) {
    this.onStateChange = onStateChange;
    this.state = {
      memory: {
        originalInput: topic,
        clarifyingQuestions: [],
        clarifyingAnswers: [],
        compressedSummary: 'Skill session initiated.',
        conversationHistory: [{ role: 'user', content: topic }],
        skillIntentResult: undefined,
        skillMapTree: undefined
      },
      status: {
        state: 'idle',
        activeAgentId: null,
        completedAgentIds: [],
        logs: []
      }
    };
  }

  getState(): OrchestratorState {
    return this.state;
  }

  private emit(patch: Partial<OrchestratorState>) {
    if (patch.memory) this.state.memory = { ...this.state.memory, ...patch.memory };
    if (patch.status) this.state.status = { ...this.state.status, ...patch.status };
    this.onStateChange(this.state);
  }

  private log(
    agentId: string,
    status: AgentExecutionLog['status'],
    message: string,
    thought?: string,
    duration?: number
  ) {
    const entry: AgentExecutionLog = {
      timestamp: new Date().toISOString(),
      agentId: agentId as any,
      status,
      message,
      thought,
      duration
    };
    this.emit({
      status: {
        ...this.state.status,
        logs: [...this.state.status.logs, entry]
      }
    });
  }

  // ----------------------------------------------------------------
  // Phase 1: Clarify intent and build the map
  // ----------------------------------------------------------------
  async startWorkflow(): Promise<void> {
    const topic = this.state.memory.originalInput.trim();

    this.emit({
      status: {
        ...this.state.status,
        state: 'running',
        activeAgentId: 'intent-clarifier' as any,
        completedAgentIds: [],
        logs: []
      }
    });

    const t0 = Date.now();
    try {
      const result = await this.intentClarifier.run(topic);
      this.intentResult = result;
      const duration = Date.now() - t0;

      this.emit({
        memory: {
          ...this.state.memory,
          skillIntentResult: result,
          compressedSummary: `Intent: ${result.intent} | Depth: ${result.depth} | Goal: ${result.userGoal}`
        },
        status: {
          ...this.state.status,
          activeAgentId: null,
          completedAgentIds: ['intent-clarifier' as any]
        }
      });

      this.log(
        'intent-clarifier',
        'completed',
        `Intent resolved — ${result.intent} at ${result.depth} depth. Confidence: ${(result.confidence * 100).toFixed(0)}%`,
        `Topic "${topic}" → intent="${result.intent}", depth="${result.depth}", goal="${result.userGoal}"`,
        duration
      );

      // If clarifications needed and confidence is low, pause for user input
      if (result.clarifications.length > 0 && result.confidence < 0.9) {
        const questions = result.clarifications.map((q, i) => ({
          id: `ic${i + 1}`,
          question: q,
          rationale: 'Helps the skill generate a more precise and useful mind map.',
          options: []
        }));

        this.emit({
          memory: { ...this.state.memory, clarifyingQuestions: questions },
          status: { ...this.state.status, state: 'waiting', activeAgentId: null }
        });
        return;
      }

      // Proceed directly to map building
      await this.runKnowledgeArchitect();
    } catch (err: any) {
      this.log('intent-clarifier', 'failed', `IntentClarifierSkill failed: ${err.message}`);
      this.emit({ status: { ...this.state.status, state: 'failed' } });
    }
  }

  // ----------------------------------------------------------------
  // Phase 2: User answered clarifying questions
  // ----------------------------------------------------------------
  async submitAnswers(answers: { questionId: string; questionText: string; answerText: string }[]): Promise<void> {
    const topic = this.state.memory.originalInput;
    const priorAnswers: SkillClarificationAnswer[] = answers.map(a => ({
      question: a.questionText,
      answer: a.answerText
    }));

    this.emit({
      memory: { ...this.state.memory, clarifyingAnswers: answers },
      status: { ...this.state.status, state: 'running', activeAgentId: 'intent-clarifier' as any }
    });

    const t0 = Date.now();
    try {
      const result = await this.intentClarifier.run(topic, priorAnswers);
      this.intentResult = result;
      const duration = Date.now() - t0;

      this.emit({
        memory: {
          ...this.state.memory,
          skillIntentResult: result,
          compressedSummary: `Intent refined — ${result.intent} at ${result.depth} depth. Goal: ${result.userGoal}`
        },
        status: {
          ...this.state.status,
          activeAgentId: null,
          completedAgentIds: [...this.state.status.completedAgentIds, 'intent-clarifier' as any]
        }
      });

      this.log(
        'intent-clarifier',
        'completed',
        `Intent refined with user answers — ${result.intent} at ${result.depth} depth.`,
        `Answers processed. Confidence raised to ${(result.confidence * 100).toFixed(0)}%.`,
        duration
      );

      await this.runKnowledgeArchitect();
    } catch (err: any) {
      this.log('intent-clarifier', 'failed', `IntentClarifierSkill (refinement) failed: ${err.message}`);
      this.emit({ status: { ...this.state.status, state: 'failed' } });
    }
  }

  private async runKnowledgeArchitect(): Promise<void> {
    if (!this.intentResult) return;

    this.emit({
      status: {
        ...this.state.status,
        state: 'running',
        activeAgentId: 'knowledge-architect' as any
      }
    });

    const t0 = Date.now();
    try {
      const tree = await this.knowledgeArchitect.run(this.intentResult);
      this.mapTree = tree;
      const duration = Date.now() - t0;

      const { nodes, edges } = treeToReactFlow(tree);

      this.emit({
        memory: {
          ...this.state.memory,
          skillMapTree: tree,
          mindMap: { nodes, edges },
          compressedSummary: `Map built: ${tree.root} → ${tree.children.length} branches | Intent: ${this.intentResult.intent} | Depth: ${this.intentResult.depth}`
        },
        status: {
          ...this.state.status,
          state: 'completed',
          activeAgentId: null,
          completedAgentIds: [...this.state.status.completedAgentIds, 'knowledge-architect' as any]
        }
      });

      this.log(
        'knowledge-architect',
        'completed',
        `Mind map built: ${nodes.length} nodes across ${tree.children.length} top-level branches.`,
        `Generated ${this.intentResult.depth} tree for "${tree.root}" with intent="${this.intentResult.intent}". Converted to ${nodes.length} ReactFlow nodes.`,
        duration
      );
    } catch (err: any) {
      this.log('knowledge-architect', 'failed', `KnowledgeArchitectSkill failed: ${err.message}`);
      this.emit({ status: { ...this.state.status, state: 'failed' } });
    }
  }

  // ----------------------------------------------------------------
  // Stateless: Expand a node
  // ----------------------------------------------------------------
  async expandNode(
    nodeId: string,
    nodeLabel: string,
    parentTopic: string,
    depth: 'basic' | 'detailed' | 'deep'
  ): Promise<void> {
    this.emit({
      status: {
        ...this.state.status,
        state: 'running',
        activeAgentId: 'exploration' as any
      }
    });

    const t0 = Date.now();
    try {
      const result = await this.explorationSkill.run(nodeLabel, parentTopic, depth);
      const duration = Date.now() - t0;

      // Convert new children to ReactFlow nodes + edges and append to current mindMap
      const currentNodes = this.state.memory.mindMap?.nodes ?? [];
      const currentEdges = this.state.memory.mindMap?.edges ?? [];

      // Find the parent node's position to place children relative to it
      const parentNode = currentNodes.find(n => n.id === nodeId);
      const parentX = parentNode?.position.x ?? 0;
      const parentY = parentNode?.position.y ?? 0;
      const parentDepth = (parentNode?.data?.depth as number) ?? 1;

      const newNodes: MindMapNode[] = result.newChildren.map((child, i) => ({
        id: child.id,
        type: 'custom',
        data: {
          label: child.label,
          description: child.description,
          depth: parentDepth + 1,
          importance: 'low' as const
        },
        position: {
          x: parentX + 290,
          y: parentY + (i - Math.floor(result.newChildren.length / 2)) * 110
        }
      }));

      const newEdges: MindMapEdge[] = result.newChildren.map(child => ({
        id: `e-${nodeId}-${child.id}`,
        source: nodeId,
        target: child.id,
        type: 'smoothstep',
        animated: false
      }));

      this.emit({
        memory: {
          ...this.state.memory,
          mindMap: {
            nodes: [...currentNodes, ...newNodes],
            edges: [...currentEdges, ...newEdges]
          }
        },
        status: {
          ...this.state.status,
          state: 'completed',
          activeAgentId: null,
          completedAgentIds: [...this.state.status.completedAgentIds, 'exploration' as any]
        }
      });

      this.log(
        'exploration',
        'completed',
        `Expanded "${nodeLabel}" with ${result.newChildren.length} new child nodes.`,
        `ExplorationSkill generated ${result.newChildren.length} deeper concepts for node "${nodeLabel}" within "${parentTopic}".`,
        duration
      );
    } catch (err: any) {
      this.log('exploration', 'failed', `ExplorationSkill failed: ${err.message}`);
      this.emit({ status: { ...this.state.status, state: 'completed' } });
    }
  }

  // ----------------------------------------------------------------
  // Stateless: Answer a question about a node
  // ----------------------------------------------------------------
  async answerNodeQuestion(
    nodeId: string,
    nodeLabel: string,
    parentTopic: string,
    question: string
  ): Promise<{ nodeId: string; question: string; answer: string }> {
    this.emit({
      status: {
        ...this.state.status,
        state: 'running',
        activeAgentId: 'node-conversation' as any
      }
    });

    const t0 = Date.now();
    try {
      const result = await this.nodeConversation.run(nodeLabel, parentTopic, question);
      const duration = Date.now() - t0;

      this.emit({
        status: {
          ...this.state.status,
          state: 'completed',
          activeAgentId: null,
          completedAgentIds: [...this.state.status.completedAgentIds, 'node-conversation' as any]
        }
      });

      this.log(
        'node-conversation',
        'completed',
        `Answered question about "${nodeLabel}".`,
        `NodeConversationSkill answered: "${question.substring(0, 60)}..."`,
        duration
      );

      return { nodeId, question, answer: result.answer };
    } catch (err: any) {
      this.log('node-conversation', 'failed', `NodeConversationSkill failed: ${err.message}`);
      this.emit({ status: { ...this.state.status, state: 'completed' } });
      return { nodeId, question, answer: 'Sorry, I could not generate an answer at this time.' };
    }
  }
}
