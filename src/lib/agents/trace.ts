import type { Prisma, StepKind } from "@prisma/client";
import { db } from "@/lib/db";

export class ToolBudgetError extends Error {}

/** Records every step of an execution (plan, tool call, LLM call, analysis, publish) as AgentExecutionStep rows. */
export class Trace {
  private index = 0;
  toolCalls = 0;

  constructor(
    private executionId: string,
    private maxToolCalls: number,
  ) {}

  get toolBudgetLeft() {
    return this.maxToolCalls - this.toolCalls;
  }

  async step<T>(kind: StepKind, name: string, input: unknown, fn: () => Promise<T>, summarize?: (r: T) => unknown): Promise<T> {
    if (kind === "TOOL_CALL") {
      if (this.toolCalls >= this.maxToolCalls) throw new ToolBudgetError(`Tool call budget exceeded (${this.maxToolCalls})`);
      this.toolCalls++;
    }
    const started = Date.now();
    const idx = this.index++;
    try {
      const result = await fn();
      await db.agentExecutionStep.create({
        data: {
          executionId: this.executionId,
          index: idx,
          kind,
          name,
          input: (input ?? undefined) as Prisma.InputJsonValue | undefined,
          output: (summarize ? summarize(result) : undefined) as Prisma.InputJsonValue | undefined,
          ok: true,
          durationMs: Date.now() - started,
        },
      });
      return result;
    } catch (err) {
      await db.agentExecutionStep.create({
        data: {
          executionId: this.executionId,
          index: idx,
          kind,
          name,
          input: (input ?? undefined) as Prisma.InputJsonValue | undefined,
          ok: false,
          error: (err instanceof Error ? err.message : String(err)).slice(0, 1000),
          durationMs: Date.now() - started,
        },
      });
      throw err;
    }
  }

  async note(kind: StepKind, name: string, output: unknown, ok = true) {
    await db.agentExecutionStep.create({
      data: { executionId: this.executionId, index: this.index++, kind, name, output: output as Prisma.InputJsonValue, ok },
    });
  }
}
