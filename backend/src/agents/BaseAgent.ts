import { AgentId, SharedMemory, AgentExecutionLog } from '../orchestrator/types';

export abstract class BaseAgent {
  public abstract readonly id: AgentId;
  public abstract readonly name: string;
  public abstract readonly description: string;

  /**
   * Run the agent's core cognitive process on the shared memory.
   * Returns:
   * - thought: Inner reasoning or rationale of this agent
   * - logMessage: A user-friendly message of what was completed
   * - updatedMemory: Partial update to merge back into SharedMemory
   */
  public abstract run(
    memory: SharedMemory
  ): Promise<{
    thought: string;
    logMessage: string;
    updatedMemory: Partial<SharedMemory>;
  }>;

  protected createLog(status: AgentExecutionLog['status'], message: string, thought?: string, duration?: number): AgentExecutionLog {
    return {
      timestamp: new Date().toISOString(),
      agentId: this.id,
      status,
      message,
      thought,
      duration
    };
  }
}
