import { describe, expect, it } from "vitest";

import { catalog } from "@/data/catalog";
import { generateAlternatives } from "@/engine/alternatives";
import { materializeTeamResult } from "@/engine/generate";
import { preV3SharePayloads } from "@/lib/fixtures/pre-v3-snapshots";
import { alternativeQualitySummary } from "@/lib/quality-presentation";
import { toCurrentGeneratorRequest } from "@/lib/share";
import { ENGINE_VERSION } from "@/lib/types";

describe("legacy alternative quality", () => {
  it("compares alternatives with the current-model score while preserving the legacy snapshot", () => {
    const legacy = preV3SharePayloads[0];
    const exactLegacyPayload = JSON.stringify(legacy);
    const evaluationRequest = toCurrentGeneratorRequest(legacy.request);
    const evaluatedCurrent = materializeTeamResult(
      legacy.result.members,
      evaluationRequest,
      catalog,
    );

    expect(evaluationRequest.engineVersion).toBe(ENGINE_VERSION);
    expect(legacy.request.engineVersion).toBe(1);
    expect(evaluatedCurrent.score.total).not.toBe(legacy.result.score.total);

    const alternatives = generateAlternatives(
      1,
      evaluationRequest,
      legacy.result,
      catalog,
    );

    expect(alternatives).toHaveLength(3);
    for (const alternative of alternatives) {
      const currentModelDelta =
        alternative.result.score.total - evaluatedCurrent.score.total;

      expect(alternative.scoreDelta).toBe(currentModelDelta);
      expect(alternativeQualitySummary(alternative.scoreDelta)).toBe(
        alternativeQualitySummary(currentModelDelta),
      );
    }
    const directionChange = alternatives.find((alternative) => {
      const currentModelDelta =
        alternative.result.score.total - evaluatedCurrent.score.total;
      const legacySnapshotDelta =
        alternative.result.score.total - legacy.result.score.total;
      return (
        alternativeQualitySummary(currentModelDelta) !==
        alternativeQualitySummary(legacySnapshotDelta)
      );
    });
    expect(directionChange).toBeDefined();
    expect(alternativeQualitySummary(directionChange!.scoreDelta)).not.toBe(
      alternativeQualitySummary(
        directionChange!.result.score.total - legacy.result.score.total,
      ),
    );
    expect(JSON.stringify(legacy)).toBe(exactLegacyPayload);
  }, 20_000);
});
