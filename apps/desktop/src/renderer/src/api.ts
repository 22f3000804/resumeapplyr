// The window's side of the bridge: typed calls into the main process, plus a hook that loads data
// and reloads it whenever the main process says a topic it covers has changed.
import { useCallback, useEffect, useRef, useState } from "react";
import type { PushChannel, RpcError, RpcMethod, RpcMethods } from "../../shared/rpc";

export type Topic =
  | "profile"
  | "settings"
  | "resumes"
  | "boards"
  | "campaigns"
  | "applications"
  | "questions"
  | "answers"
  | "letters"
  | "runs";

export type Result<M extends RpcMethod> = Awaited<ReturnType<RpcMethods[M]>>;

export class RpcFailure extends Error {
  readonly code?: string;
  readonly status?: number;
  readonly details?: unknown;

  constructor(error: RpcError) {
    super(error.message);
    this.code = error.code;
    this.status = error.status;
    this.details = error.details;
  }
}

export async function call<M extends RpcMethod>(method: M, ...args: Parameters<RpcMethods[M]>): Promise<Result<M>> {
  const result = await window.resumeapplyr.call(method, ...args);
  if (!result.ok) throw new RpcFailure(result.error);
  return result.value;
}

// One IPC listener per channel, fanned out here: Electron warns past ten listeners on a channel.
const listeners = new Map<PushChannel, Set<(payload: unknown) => void>>();

export function subscribe(channel: PushChannel, listener: (payload: unknown) => void): () => void {
  let set = listeners.get(channel);
  if (!set) {
    const created = new Set<(payload: unknown) => void>();
    listeners.set(channel, created);
    window.resumeapplyr.on(channel, (payload) => {
      for (const fn of [...created]) fn(payload);
    });
    set = created;
  }
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

export function usePush(channel: PushChannel, listener: (payload: unknown) => void): void {
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(() => subscribe(channel, (payload) => ref.current(payload)), [channel]);
}

interface RpcState<T> {
  key: string;
  data: T | undefined;
  error: Error | null;
  loading: boolean;
}

/**
 * Loads `method(...args)` and reloads it when any of `topics` changes. A burst of changes (an agent
 * adding forty jobs) collapses into one reload per animation frame or so.
 */
export function useRpc<M extends RpcMethod>(
  method: M,
  args: Parameters<RpcMethods[M]>,
  topics: Topic[],
  options: { skip?: boolean } = {},
) {
  const key = `${method}:${JSON.stringify(args)}`;
  const [state, setState] = useState<RpcState<Result<M>>>({ key, data: undefined, error: null, loading: true });
  const argsRef = useRef(args);
  argsRef.current = args;
  const seq = useRef(0);
  const skip = options.skip ?? false;

  const load = useCallback(async () => {
    const id = ++seq.current;
    try {
      const data = await call(method, ...argsRef.current);
      if (id === seq.current) setState({ key, data, error: null, loading: false });
    } catch (error) {
      if (id === seq.current) {
        setState((prev) => ({
          key,
          data: prev.key === key ? prev.data : undefined,
          error: error instanceof Error ? error : new Error(String(error)),
          loading: false,
        }));
      }
    }
  }, [method, key]);

  useEffect(() => {
    if (skip) return;
    void load();
  }, [load, skip]);

  const topicKey = topics.join(",");
  useEffect(() => {
    if (skip || !topicKey) return;
    const wanted = new Set(topicKey.split(","));
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribe("changed", (payload) => {
      if (!Array.isArray(payload) || !payload.some((t) => wanted.has(t))) return;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void load();
      }, 120);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [topicKey, load, skip]);

  const current = state.key === key;
  return {
    data: current ? state.data : undefined,
    error: current ? state.error : null,
    loading: !current || state.loading,
    reload: load,
  };
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
