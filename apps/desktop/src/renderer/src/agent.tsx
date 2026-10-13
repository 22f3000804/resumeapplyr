// What the agent is doing right now, and which AI tools this computer has — shared by the rail,
// Home, campaigns and Settings.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import type { AgentSetup } from "../../shared/rpc";
import type { ActiveRun } from "../../shared/types";
import { call, subscribe } from "./api";

interface AgentState {
  current: ActiveRun | null;
  setup: AgentSetup | null;
  checking: boolean;
  checkSetup: (refresh: boolean) => Promise<void>;
}

const AgentContext = createContext<AgentState>({
  current: null,
  setup: null,
  checking: false,
  checkSetup: async () => {},
});

export function AgentProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<ActiveRun | null>(null);
  const [setup, setSetup] = useState<AgentSetup | null>(null);
  const [checking, setChecking] = useState(false);

  const checkSetup = useCallback(async (refresh: boolean) => {
    setChecking(true);
    try {
      setSetup(await call("agent.setup", refresh));
    } catch {
      // Settings shows the detail; the rail just stays quiet.
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void call("agent.current").then(setCurrent, () => {});
    void checkSetup(false);
    const offRunner = subscribe("runner", (payload) => setCurrent((payload as ActiveRun | null) ?? null));
    const offChanged = subscribe("changed", (payload) => {
      if (Array.isArray(payload) && payload.includes("settings")) void checkSetup(false);
    });
    return () => {
      offRunner();
      offChanged();
    };
  }, [checkSetup]);

  return <AgentContext.Provider value={{ current, setup, checking, checkSetup }}>{children}</AgentContext.Provider>;
}

export const useAgent = () => useContext(AgentContext);

/** The selected AI tool, and whether it can run. */
export function useProvider() {
  const { setup } = useAgent();
  const status = setup?.providers.find((p) => p.id === setup.provider) ?? null;
  return {
    status,
    name: status?.name ?? (setup?.provider === "codex" ? "Codex" : "Claude Code"),
    ready: !!status?.installed && status.missingFlags.length === 0,
    known: !!setup,
  };
}
