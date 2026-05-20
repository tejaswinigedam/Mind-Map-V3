import { 
  OrchestratorState, 
  SharedMemory, 
  WorkflowState, 
  AgentId, 
  ClarifyingAnswer,
  AgentExecutionLog
} from './types';
import { BaseAgent } from '../agents/BaseAgent';
import { ClarityAgent } from '../agents/ClarityAgent';
import { IntentAgent } from '../agents/IntentAgent';
import { ExpansionAgent } from '../agents/ExpansionAgent';
import { StructureAgent } from '../agents/StructureAgent';
import { GenerationAgent } from '../agents/GenerationAgent';
import { MemoryAgent } from '../agents/MemoryAgent';

export class Orchestrator {
  private state: OrchestratorState;
  private onStateChange: (state: OrchestratorState) => void;

  private agents: Record<AgentId, BaseAgent> = {
    clarity: new ClarityAgent(),
    intent: new IntentAgent(),
    expansion: new ExpansionAgent(),
    structure: new StructureAgent(),
    generation: new GenerationAgent(),
    memory: new MemoryAgent(),
  };

  constructor(topic: string, onStateChange: (state: OrchestratorState) => void) {
    this.onStateChange = onStateChange;
    this.state = {
      memory: {
        originalInput: topic,
        clarifyingQuestions: [],
        clarifyingAnswers: [],
        compressedSummary: 'Session initiated. Awaiting initial context clarity.',
        conversationHistory: [{ role: 'user', content: topic }]
      },
      status: {
        state: 'idle',
        activeAgentId: null,
        completedAgentIds: [],
        logs: []
      }
    };
  }

  public getState(): OrchestratorState {
    return this.state;
  }

  private updateState(updated: Partial<OrchestratorState>) {
    if (updated.memory) {
      this.state.memory = { ...this.state.memory, ...updated.memory };
    }
    if (updated.status) {
      this.state.status = { ...this.state.status, ...updated.status };
    }
    this.onStateChange(this.state);
  }

  /**
   * Run a specific agent and manage state transitions + duration logging
   */
  private async runAgent(agentId: AgentId): Promise<void> {
    const agent = this.agents[agentId];
    
    // Add "running" log
    const startLog: AgentExecutionLog = {
      timestamp: new Date().toISOString(),
      agentId,
      status: 'running',
      message: `Agent [${agent.name}] activated.`
    };
    
    this.updateState({
      status: {
        ...this.state.status,
        activeAgentId: agentId,
        logs: [...this.state.status.logs, startLog]
      }
    });

    const startTime = Date.now();
    try {
      // Run the cognitive execution
      const result = await agent.run(this.state.memory);
      const duration = Date.now() - startTime;

      // Update memory with agent findings
      this.state.memory = { ...this.state.memory, ...result.updatedMemory };

      // Replace the start log with a comprehensive completed log
      const completedLog: AgentExecutionLog = {
        timestamp: new Date().toISOString(),
        agentId,
        status: 'completed',
        message: result.logMessage,
        thought: result.thought,
        duration
      };

      const filteredLogs = this.state.status.logs.filter(
        l => !(l.agentId === agentId && l.status === 'running')
      );

      this.updateState({
        status: {
          ...this.state.status,
          activeAgentId: null,
          completedAgentIds: [...this.state.status.completedAgentIds, agentId],
          logs: [...filteredLogs, completedLog]
        }
      });

    } catch (error: any) {
      const duration = Date.now() - startTime;
      const failedLog: AgentExecutionLog = {
        timestamp: new Date().toISOString(),
        agentId,
        status: 'failed',
        message: `Agent compilation/runtime failed: ${error.message || error}`,
        duration
      };

      const filteredLogs = this.state.status.logs.filter(
        l => !(l.agentId === agentId && l.status === 'running')
      );

      this.updateState({
        status: {
          ...this.state.status,
          state: 'failed',
          activeAgentId: null,
          logs: [...filteredLogs, failedLog]
        }
      });
      throw error;
    }
  }

  /**
   * Phase 1: Start the workflow. 
   * Dynamic Customization Routing: 
   * If the input topic contains highly dense context (> 80 chars or has newlines/sentences),
   * we skip the Context Clarity questions phase and directly execute the main pipeline.
   */
  public async startWorkflow() {
    const topic = this.state.memory.originalInput.trim();
    const isDetailed = topic.length > 80 || topic.includes('\n') || (topic.match(/\.|\?|!/g) || []).length > 1;

    if (isDetailed) {
      // Dynamic bypass routing
      this.updateState({
        status: {
          ...this.state.status,
          state: 'running',
          activeAgentId: 'intent',
          completedAgentIds: [],
          logs: [
            {
              timestamp: new Date().toISOString(),
              agentId: 'clarity',
              status: 'completed',
              message: 'Context Clarity Agent bypassed: High density initial context detected. Dynamic routing activated.',
              thought: `Initial query "${topic.substring(0, 30)}..." contains rich context parameters. Asking clarifying questions would add cognitive friction. Bypassing human-in-the-loop and routing directly to the main reasoning pipeline.`,
              duration: 50
            }
          ]
        }
      });

      try {
        // Execute the entire pipeline directly: intent -> expansion -> structure -> generation -> memory
        const pipeline: AgentId[] = ['intent', 'expansion', 'structure', 'generation', 'memory'];

        for (const agentId of pipeline) {
          await this.runAgent(agentId);
        }

        this.updateState({
          status: {
            ...this.state.status,
            state: 'completed',
            activeAgentId: null
          }
        });
      } catch (error) {
        console.error('[Orchestrator] Error during bypassed multi-agent pipeline:', error);
        this.updateState({
          status: {
            ...this.state.status,
            state: 'failed'
          }
        });
      }
    } else {
      // Normal human-in-the-loop routing
      this.updateState({
        status: {
          ...this.state.status,
          state: 'running',
          activeAgentId: 'clarity',
          completedAgentIds: [],
          logs: []
        }
      });

      try {
        await this.runAgent('clarity');

        // Once clarity finishes, pause execution for user interaction (clarifying questions)
        this.updateState({
          status: {
            ...this.state.status,
            state: 'waiting',
            activeAgentId: null
          }
        });
      } catch (error) {
        console.error('[Orchestrator] Error during Phase 1 clarity run:', error);
      }
    }
  }

  /**
   * Phase 2: User has submitted clarifying answers. Resume the multi-agent pipeline!
   */
  public async submitClarifyingAnswers(answers: ClarifyingAnswer[]) {
    if (this.state.status.state !== 'waiting') {
      throw new Error('Workflow is not in waiting state. Cannot submit clarifying answers.');
    }

    const expectedCount = this.state.memory.clarifyingQuestions.length;
    if (!answers || answers.length < expectedCount || answers.some(a => !a.answerText || a.answerText.trim() === '')) {
      throw new Error(`Invalid answers payload. Expected ${expectedCount} fully answered questions, got ${answers?.filter(a => a.answerText && a.answerText.trim() !== '').length || 0}.`);
    }

    // Merge answers into memory
    this.updateState({
      memory: {
        ...this.state.memory,
        clarifyingAnswers: answers,
        conversationHistory: [
          ...this.state.memory.conversationHistory,
          { role: 'user', content: `Answers submitted: ${answers.map(a => `${a.questionText}: ${a.answerText}`).join(', ')}` }
        ]
      },
      status: {
        ...this.state.status,
        state: 'running'
      }
    });

    try {
      // Execute the remaining cognitive agents in pipeline sequence:
      // intent -> expansion -> structure -> generation -> memory
      const pipeline: AgentId[] = ['intent', 'expansion', 'structure', 'generation', 'memory'];

      for (const agentId of pipeline) {
        await this.runAgent(agentId);
      }

      this.updateState({
        status: {
          ...this.state.status,
          state: 'completed',
          activeAgentId: null
        }
      });

    } catch (error) {
      console.error('[Orchestrator] Error during sequential cognitive execution pipeline:', error);
      this.updateState({
        status: {
          ...this.state.status,
          state: 'failed'
        }
      });
    }
  }

  /**
   * Phase 3: Iterative Refinement. User wants to add, refine, or regenerate a branch!
   */
  public async refineMindMap(userPrompt: string) {
    this.updateState({
      memory: {
        ...this.state.memory,
        conversationHistory: [
          ...this.state.memory.conversationHistory,
          { role: 'user', content: userPrompt }
        ]
      },
      status: {
        ...this.state.status,
        state: 'running',
        // Reset completion status for generation/memory to visually animate updates
        completedAgentIds: this.state.status.completedAgentIds.filter(
          id => id !== 'generation' && id !== 'memory'
        )
      }
    });

    try {
      // For refinement, we run:
      // 1. Intent (re-extract refinement goals)
      // 2. Expansion (add nodes for new concepts)
      // 3. Generation (re-draw tree positions and coordinate system)
      // 4. Memory (compress history log)
      
      // Let's create an elegant mini-pipeline for map regeneration
      const refinementPipeline: AgentId[] = ['intent', 'expansion', 'generation', 'memory'];

      for (const agentId of refinementPipeline) {
        await this.runAgent(agentId);
      }

      this.updateState({
        status: {
          ...this.state.status,
          state: 'completed'
        }
      });

    } catch (error) {
      console.error('[Orchestrator] Error during refinement pipeline:', error);
      this.updateState({
        status: {
          ...this.state.status,
          state: 'failed'
        }
      });
    }
  }
}
