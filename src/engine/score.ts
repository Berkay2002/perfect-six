import { abilityQualityForTeam } from "@/engine/ability";
import { battlePlanQualityForTeam } from "@/engine/battle-plan";
import {
  incomingTypeMultiplier,
  roleCoverageQualityForTeam,
} from "@/engine/coverage";
import { itemQualityForTeam } from "@/engine/item";
import {
  journeyCurveQualityForTeam,
  type JourneyCurveOptions,
} from "@/engine/journey";
import { moveQualityForTeam } from "@/engine/move";
import { teamQualityForTeam } from "@/engine/team";
import { synergyQualityForTeam } from "@/engine/synergy";
import { weatherPlanForTeam, type TeamWeatherPlan } from "@/engine/weather";
import type {
  GeneratorRequest,
  MoveRecord,
  NormalizedCatalog,
  PokemonRecord,
  ScoreBreakdown,
  TeamWeakness,
} from "@/lib/types";

const clamp = (value: number) => Math.max(0, Math.min(100, value));
const average = (values: number[]) =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

function utilityScore(
  team: PokemonRecord[],
  moveById: Map<string, MoveRecord>,
) {
  const moves = team.flatMap((pokemon) =>
    pokemon.build.moves
      .map((move) => moveById.get(move.id))
      .filter((move): move is MoveRecord => move !== undefined),
  );
  const capabilities = [
    moves.some((move) => move.effect.healingFraction !== null),
    moves.some((move) => move.effect.status !== null),
    moves.some((move) => move.effect.volatileStatus !== null),
    moves.some((move) => move.effect.sideCondition !== null),
    moves.some((move) => move.effect.selfSwitch),
    moves.some((move) => move.effect.boosts !== null),
    moves.some((move) => move.priority > 0),
  ];
  return (capabilities.filter(Boolean).length / capabilities.length) * 100;
}

export function defensiveAnalysis(
  team: PokemonRecord[],
  catalog: NormalizedCatalog,
): { score: number; weaknesses: TeamWeakness[] } {
  const attackTypes = Object.keys(catalog.typeChart);
  if (attackTypes.length === 0 || team.length === 0) {
    return { score: 50, weaknesses: [] };
  }
  const abilityById = new Map(
    catalog.abilities.map((ability) => [ability.id, ability]),
  );
  let penalty = 0;
  let resistanceBonus = 0;
  let absorptionBonus = 0;
  const weaknesses: TeamWeakness[] = [];
  for (const attackType of attackTypes) {
    const matchup = team.map((pokemon) => {
      const capabilities = abilityById.get(pokemon.build.abilityId)
        ?.capabilities;
      if (capabilities?.absorptions.includes(attackType)) {
        absorptionBonus += 0.75;
      }
      return incomingTypeMultiplier(
        pokemon,
        attackType,
        catalog,
        abilityById.get(pokemon.build.abilityId),
      );
    });
    const weak = matchup.filter((value) => value > 1).length;
    const resistant = matchup.filter((value) => value < 1).length;
    if (weak >= 3) penalty += (weak - 2) * 7;
    resistanceBonus += Math.min(weak, resistant) * 1.5;
    if (weak >= 2) {
      weaknesses.push({
        attackType,
        weakMembers: weak,
        protectedMembers: resistant,
      });
    }
  }
  weaknesses.sort(
    (left, right) =>
      right.weakMembers - left.weakMembers ||
      left.protectedMembers - right.protectedMembers ||
      left.attackType.localeCompare(right.attackType),
  );
  return {
    score: clamp(88 - penalty + resistanceBonus + absorptionBonus),
    weaknesses,
  };
}

function weatherScore(
  request: GeneratorRequest,
  weatherPlan: TeamWeatherPlan,
) {
  if (request.style !== "weather" || !request.weather) return 100;
  if (request.weather === "random") return 70;
  const active = weatherPlan.activeWeather === request.weather;
  const matches =
    weatherPlan.setterMemberIds.length +
    (active ? weatherPlan.beneficiaryMemberIds.length : 0) -
    (active ? weatherPlan.detrimentMemberIds.length : 0);
  return clamp(40 + matches * 12);
}

export function scoreTeam(
  team: PokemonRecord[],
  request: GeneratorRequest,
  catalog: NormalizedCatalog,
  journeyOptions: Pick<JourneyCurveOptions, "influence"> = {},
): ScoreBreakdown {
  const moveById = new Map(catalog.moves.map((move) => [move.id, move]));
  const weatherPlan = weatherPlanForTeam(team, request, catalog);
  const teamQuality = teamQualityForTeam(team, request, catalog, weatherPlan);
  const acquisitionCurve = journeyCurveQualityForTeam(
    team,
    request,
    catalog,
    {
      evaluatedJobs: teamQuality.memberExplanations,
      influence: journeyOptions.influence,
    },
  );
  const journeyFit = acquisitionCurve.score;
  const accessibility = clamp(
    average(
      team.map((pokemon) => {
        const legal = new Map(
          pokemon.learnset.map((entry) => [entry.moveId, entry.methods]),
        );
        const accessible = pokemon.build.moves.filter((move) =>
          (legal.get(move.id) ?? []).some((method) =>
            ["level", "tm", "tutor"].includes(method),
          ),
        ).length;
        return (accessible / 4) * 100;
      }),
    ),
  );
  const simplicity = clamp(
    100 -
      team.reduce(
        (sum, pokemon) =>
          sum +
          pokemon.build.moves.filter((move) => move.category === "Status")
            .length * 3,
        0,
      ),
  );
  const journeyScore = clamp(
    journeyFit * 0.55 + accessibility * 0.3 + simplicity * 0.15,
  );

  const roleCoverageQuality = roleCoverageQualityForTeam(team, catalog);
  const roleCoverage = roleCoverageQuality.score;
  const defensiveFit = defensiveAnalysis(team, catalog).score;
  const offensiveReach = roleCoverageQuality.offensiveScore;
  const utility = utilityScore(team, moveById);
  const weather = weatherScore(request, weatherPlan);
  const abilityQuality = abilityQualityForTeam(
    team,
    request,
    catalog,
    weatherPlan,
  );
  const itemQuality = itemQualityForTeam(team, request, catalog);
  const moveQuality = moveQualityForTeam(team, request, catalog);
  const battlePlan = battlePlanQualityForTeam(
    team,
    request,
    catalog,
    weatherPlan.context,
  );
  const synergy = synergyQualityForTeam(team, request, catalog, weatherPlan);
  const battleScore = clamp(
    roleCoverage * 0.23 +
      defensiveFit * 0.25 +
      offensiveReach * 0.25 +
      utility * 0.17 +
      average(team.map((pokemon) => pokemon.battleScore)) * 0.05 +
      weather * 0.05 +
      abilityQuality.contribution +
      itemQuality.contribution +
      moveQuality.contribution +
      teamQuality.contribution +
      battlePlan.contribution +
      synergy.contribution,
  );

  const score: ScoreBreakdown = {
    total: Math.round(journeyScore * 0.6 + battleScore * 0.4),
    journeyScore: Math.round(journeyScore),
    battleScore: Math.round(battleScore),
    roleCoverage: Math.round(roleCoverage),
    defensiveFit: Math.round(defensiveFit),
    offensiveReach: Math.round(offensiveReach),
    journeyFit: Math.round(journeyFit),
    utility: Math.round(utility),
  };
  if ((journeyOptions.influence ?? 1) !== 0) {
    score.journeyCurveFit = acquisitionCurve.score;
  }
  return score;
}
