// Test-only storage access. This entry point is never named by Wrangler.
import main from "../index.ts";
import { AiCoordinator as Coordinator } from "../coordinator.ts";
import { Ledger } from "../storage.ts";
import type { Env } from "../env.ts";
export default main;
export class AiCoordinator extends Coordinator {
  private testState: DurableObjectState;
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.testState = state;
  }
  async fetch(request: Request) {
    if (new URL(request.url).pathname === "/__test/sql") {
      const { sql, args = [] } = await request.json<{
        sql: string;
        args?: SqlStorageValue[];
      }>();
      return Response.json(
        this.testState.storage.sql.exec(sql, ...args).toArray(),
      );
    }
    if (new URL(request.url).pathname === "/__test/ledger") {
      const {
        action,
        now = Date.now(),
        id = "lease",
        device = "test",
        key = null,
        environment = "production",
      } = await request.json<{
        action: string;
        now?: number;
        id?: string;
        device?: string;
        key?: string | null;
        environment?: "dev" | "production";
      }>();
      const ledger = new Ledger(this.testState.storage, environment);
      try {
        if (action === "reserve") ledger.reserve(id, device, key, now);
        if (action === "attempt") ledger.attempt(id, now);
        if (action === "answered") ledger.answered(id, now);
        if (action === "cleanup") ledger.cleanup(now);
        if (action === "fillCache")
          for (let i = 0; i < 1005; i++)
            ledger.save(`test-${i}`, "answer", "free", now + i);
        return Response.json(ledger.status(device, now, "test", true));
      } catch (error) {
        return Response.json(
          { kind: (error as { kind: string }).kind },
          { status: 429 },
        );
      }
    }
    return super.fetch(request);
  }
}
