"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  GeneratorRequest,
  TeamAlternative,
  TeamRecommendation,
  TeamResult,
} from "@/lib/types";

type PendingRequest = {
  resolve: (
    value: TeamResult | TeamAlternative[] | TeamRecommendation[],
  ) => void;
  reject: (error: Error) => void;
  affectsBusy: boolean;
};

type WorkerResponse =
  | {
      id: string;
      ok: true;
      value: TeamResult | TeamAlternative[] | TeamRecommendation[];
    }
  | {
      id: string;
      ok: false;
      error: { name: string; message: string; code?: string };
    };

export function useTeamWorker() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef(new Map<string, PendingRequest>());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const pendingRequests = pendingRef.current;
    const worker = new Worker(
      new URL("../workers/team.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      const pending = pendingRequests.get(response.id);
      if (!pending) return;
      pendingRequests.delete(response.id);
      setBusy([...pendingRequests.values()].some((request) => request.affectsBusy));
      if (response.ok) {
        pending.resolve(response.value);
      } else {
        const error = new Error(response.error.message);
        error.name = response.error.name;
        Object.assign(error, { code: response.error.code });
        pending.reject(error);
      }
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || "Team worker crashed.");
      for (const pending of pendingRequests.values()) pending.reject(error);
      pendingRequests.clear();
      setBusy(false);
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
      for (const pending of pendingRequests.values()) {
        pending.reject(new Error("Team worker closed."));
      }
      pendingRequests.clear();
    };
  }, []);

  const send = useCallback(
    <T extends TeamResult | TeamAlternative[] | TeamRecommendation[]>(
      message:
        | { kind: "generate"; request: GeneratorRequest }
        | {
            kind: "alternatives";
            slot: number;
            request: GeneratorRequest;
            result: TeamResult;
          }
        | {
            kind: "recommendations";
            request: GeneratorRequest;
            result: TeamResult;
          },
      affectsBusy = true,
    ) =>
      new Promise<T>((resolve, reject) => {
        const worker = workerRef.current;
        if (!worker) {
          reject(new Error("Team worker is not ready."));
          return;
        }
        const id = crypto.randomUUID();
        pendingRef.current.set(id, {
          resolve: resolve as PendingRequest["resolve"],
          reject,
          affectsBusy,
        });
        if (affectsBusy) setBusy(true);
        worker.postMessage({ id, ...message });
      }),
    [],
  );

  const generate = useCallback(
    (request: GeneratorRequest) =>
      send<TeamResult>({ kind: "generate", request }),
    [send],
  );
  const alternatives = useCallback(
    (slot: number, request: GeneratorRequest, result: TeamResult) =>
      send<TeamAlternative[]>({
        kind: "alternatives",
        slot,
        request,
        result,
      }),
    [send],
  );

  const recommendations = useCallback(
    (request: GeneratorRequest, result: TeamResult) =>
      send<TeamRecommendation[]>(
        { kind: "recommendations", request, result },
        false,
      ),
    [send],
  );

  return { generate, alternatives, recommendations, busy };
}
