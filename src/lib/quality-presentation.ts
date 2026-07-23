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

export type AlternativeTradeoffPresentation = {
  summary: string;
  sections: Array<{
    label: string;
    explanation: string;
  }>;
};

const alternativeTradeoffLabels = [
  "Ability fit",
  "Held-item fit",
  "Move package",
  "Team jobs",
  "Team synergy",
  "Role coverage",
  "Speed plan",
  "Acquisition curve",
] as const;

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
    !quality.roleCoverage ||
    !quality.acquisitionCurve
  ) {
    return null;
  }
  return {
    ability: quality.ability,
    weaknesses: quality.weaknesses ?? [],
    item: quality.item,
    move: quality.move,
    team: quality.team,
    plan: quality.plan,
    synergy: quality.synergy,
    roleCoverage: quality.roleCoverage,
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

export function alternativeTradeoffPresentation(
  tradeoff: string,
): AlternativeTradeoffPresentation {
  const normalized = tradeoff.replace("Team jobs ", "Team jobs: ");
  const sectionPattern = new RegExp(
    `(?=${alternativeTradeoffLabels.join("|")}:)`,
  );
  const [summary = normalized, ...details] = normalized.split(sectionPattern);

  return {
    summary: summary.trim(),
    sections: details.flatMap((detail) => {
      const separator = detail.indexOf(":");
      if (separator < 0) return [];
      return [
        {
          label: detail.slice(0, separator).trim(),
          explanation: detail.slice(separator + 1).trim(),
        },
      ];
    }),
  };
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
      "This team includes the current ability, item, move, role coverage, team-plan, synergy, and journey evaluation.",
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
        label: "Role coverage",
        summary: `${quality.roleCoverage.score}/100 coverage`,
        explanation: quality.roleCoverage.explanation,
      },
      {
        label: "Acquisition curve",
        summary: `${quality.acquisitionCurve.score}/100 journey fit`,
        explanation: quality.acquisitionCurve.explanation,
      },
    ],
  };
}
