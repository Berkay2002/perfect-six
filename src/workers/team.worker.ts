/// <reference lib="webworker" />

import { generateAlternatives } from "@/engine/alternatives";
import { generateTeam } from "@/engine/generate";
import { generateRecommendations } from "@/engine/recommendations";
import { catalog } from "@/data/catalog";
import type {
  GeneratorRequest,
  TeamRecommendation,
  TeamResult,
} from "@/lib/types";

type WorkerRequest =
  | {
      id: string;
      kind: "generate";
      request: GeneratorRequest;
    }
  | {
      id: string;
      kind: "alternatives";
      slot: number;
      request: GeneratorRequest;
      result: TeamResult;
    }
  | {
      id: string;
      kind: "recommendations";
      request: GeneratorRequest;
      result: TeamResult;
    };

type WorkerResponse =
  | {
      id: string;
      ok: true;
      value: TeamResult | TeamRecommendation[] | ReturnType<typeof generateAlternatives>;
    }
  | {
      id: string;
      ok: false;
      error: { name: string; message: string; code?: string };
    };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  try {
    const value =
      message.kind === "generate"
        ? generateTeam(message.request, catalog)
        : message.kind === "alternatives"
          ? generateAlternatives(
            message.slot,
            message.request,
            message.result,
            catalog,
            )
          : generateRecommendations(
              message.request,
              message.result,
              catalog,
            );
    self.postMessage({ id: message.id, ok: true, value } satisfies WorkerResponse);
  } catch (error) {
    const caught = error as Error & { code?: string };
    self.postMessage({
      id: message.id,
      ok: false,
      error: {
        name: caught.name || "Error",
        message: caught.message || "Generation failed.",
        ...(caught.code ? { code: caught.code } : {}),
      },
    } satisfies WorkerResponse);
  }
};

export {};
