import { describe, expect, it } from "vitest";

import { catalog } from "@/data/catalog";
import { generateTeam } from "@/engine/generate";
import { preV3SharePayloads } from "@/lib/fixtures/pre-v3-snapshots";
import {
  alternativeQualitySummary,
  alternativeTradeoffPresentation,
  battleQualityPresentation,
  resultScoringState,
} from "@/lib/quality-presentation";
import {
  DATA_VERSION,
  ENGINE_VERSION,
  SCHEMA_VERSION,
  type GeneratorRequest,
} from "@/lib/types";

const request: GeneratorRequest = {
  schemaVersion: SCHEMA_VERSION,
  dataVersion: DATA_VERSION,
  engineVersion: ENGINE_VERSION,
  seed: "QUALITY-PRESENTATION",
  style: "balanced",
  availability: "journey",
  allowSpecial: false,
  requireMega: false,
  slots: [null, null, null, null, null, null],
};

describe("battle-quality presentation", () => {
  it("presents every current quality explanation without internal contributions", () => {
    const result = generateTeam(request, catalog);
    const presentation = battleQualityPresentation(result);

    expect(presentation.state).toBe("current");
    expect(presentation.sections.map((section) => section.label)).toEqual([
      "Ability quality",
      "Held-item fit",
      "Move-package quality",
      "Team jobs",
      "Speed and resilience",
      "Team synergy",
      "Acquisition curve",
    ]);
    expect(presentation.sections.every((section) => section.explanation.length > 0)).toBe(true);
    expect(presentation.sections.map((section) => section.summary).join(" ")).not.toMatch(
      /[+-]\d+|contribution|weight/i,
    );
    expect(presentation.sections.map((section) => section.explanation).join(" ")).not.toMatch(
      /adds? \d+|subtracts? \d+|battle-quality points/i,
    );
  });

  it("summarizes alternative quality without exposing score arithmetic", () => {
    expect(alternativeQualitySummary(4)).toBe("Stronger complete-team quality");
    expect(alternativeQualitySummary(0)).toBe("Comparable complete-team quality");
    expect(alternativeQualitySummary(-3)).toBe(
      "Lower complete-team quality with stated tradeoffs",
    );
  });

  it("splits alternative tradeoffs into a readable summary and labeled details", () => {
    const presentation = alternativeTradeoffPresentation(
      "Highest complete-team quality while preserving every invariant. Ability fit: gains Blaze. Held-item fit: loses Berry and gains Specs. Move package: overall move quality improves. Team jobs preserve the same coverage. Team synergy: gains pivoting. Speed plan: gains Delphox (natural speed). Acquisition curve: gains Delphox (Early, Easy).",
    );

    expect(presentation.summary).toBe(
      "Highest complete-team quality while preserving every invariant.",
    );
    expect(presentation.sections.map(({ label }) => label)).toEqual([
      "Ability fit",
      "Held-item fit",
      "Move package",
      "Team jobs",
      "Team synergy",
      "Speed plan",
      "Acquisition curve",
    ]);
    expect(presentation.sections[1].explanation).toBe(
      "loses Berry and gains Specs.",
    );
  });

  it.each(preV3SharePayloads)(
    "labels an exact pre-v3 result as legacy scoring (engine $request.engineVersion)",
    ({ result: legacy }) => {
      const exactSnapshot = JSON.stringify(legacy);

      expect(resultScoringState(legacy)).toBe("legacy");
      expect(battleQualityPresentation(legacy)).toEqual({
        state: "legacy",
        label: "Legacy scoring",
        explanation:
          "This exact snapshot predates the complete battle-quality model. Its original score and builds are unchanged.",
        sections: [],
      });
      expect(JSON.stringify(legacy)).toBe(exactSnapshot);
    },
  );
});
