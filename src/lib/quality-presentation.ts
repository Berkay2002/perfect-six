import type { GeneratedTeamResult, TeamResult } from "@/lib/types";

export type BattleQualityPresentation = {
  state: "current" | "legacy";
  label: string;
  explanation: string;
  sections: Array<{
    label: string;
    summary: string;
    explanation: string;
  }>;
};

function completeBattleQuality(
  result: TeamResult,
): GeneratedTeamResult["battleQuality"] | null {
  const quality = result.battleQuality;
  if (
    !quality?.ability ||
    !quality.item ||
    !quality.move ||
    !quality.team ||
    !quality.plan ||
    !quality.synergy ||
    !quality.acquisitionCurve
  ) {
    return null;
  }
  return {
    ability: quality.ability,
    item: quality.item,
    move: quality.move,
    team: quality.team,
    plan: quality.plan,
    synergy: quality.synergy,
    acquisitionCurve: quality.acquisitionCurve,
  };
}

export function resultScoringState(result: TeamResult): "current" | "legacy" {
  return completeBattleQuality(result) ? "current" : "legacy";
}

export function alternativeQualitySummary(scoreDelta: number) {
  if (scoreDelta > 0) return "Stronger complete-team quality";
  if (scoreDelta < 0) return "Lower complete-team quality with stated tradeoffs";
  return "Comparable complete-team quality";
}

export function battleQualityPresentation(
  result: TeamResult,
): BattleQualityPresentation {
  const quality = completeBattleQuality(result);
  if (!quality) {
    return {
      state: "legacy",
      label: "Legacy scoring",
      explanation:
        "This exact snapshot predates the complete battle-quality model. Its original score and builds are unchanged.",
      sections: [],
    };
  }

  return {
    state: "current",
    label: "Complete battle-quality scoring",
    explanation:
      "This team includes the current ability, item, move, team-plan, synergy, and journey evaluation.",
    sections: [
      {
        label: "Ability quality",
        summary: "Sourced ability mechanics",
        explanation: quality.ability.explanation,
      },
      {
        label: "Held-item fit",
        summary: "Sourced item and build fit",
        explanation: quality.item.explanation,
      },
      {
        label: "Move-package quality",
        summary: `${quality.move.score}/100 quality`,
        explanation: quality.move.explanation,
      },
      {
        label: "Team jobs",
        summary: `${quality.team.score}/100 coverage`,
        explanation: quality.team.explanation,
      },
      {
        label: "Speed and resilience",
        summary: `${quality.plan.score}/100 plan quality`,
        explanation: quality.plan.explanation,
      },
      {
        label: "Team synergy",
        summary: `${quality.synergy.score}/100 coherence`,
        explanation: quality.synergy.explanation,
      },
      {
        label: "Acquisition curve",
        summary: `${quality.acquisitionCurve.score}/100 journey fit`,
        explanation: quality.acquisitionCurve.explanation,
      },
    ],
  };
}
