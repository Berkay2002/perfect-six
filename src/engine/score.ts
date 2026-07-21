import { abilityQualityForTeam } from "@/engine/ability";
import { battlePlanQualityForTeam } from "@/engine/battle-plan";
import { itemQualityForTeam } from "@/engine/item";
import { moveQualityForTeam } from "@/engine/move";
import { teamQualityForTeam } from "@/engine/team";
import type {
  GeneratorRequest,
  MoveRecord,
  NormalizedCatalog,
  PokemonRecord,
  ScoreBreakdown,
} from "@/lib/types";

const clamp = (value: number) => Math.max(0, Math.min(100, value));
const average = (values: number[]) =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

function damagingMoves(team: PokemonRecord[], moveById: Map<string, MoveRecord>) {
  return team.flatMap((pokemon) =>
    pokemon.build.moves
      .map((move) => moveById.get(move.id))
      .filter(
        (move): move is MoveRecord =>
          move !== undefined && move.category !== "Status",
      ),
  );
}

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

function roleScore(team: PokemonRecord[]) {
  const roles = new Set(team.flatMap((pokemon) => pokemon.roles));
  const physical = team.filter((pokemon) =>
    pokemon.build.moves.some((move) => move.category === "Physical"),
  ).length;
  const special = team.filter((pokemon) =>
    pokemon.build.moves.some((move) => move.category === "Special"),
  ).length;
  const balance = Math.min(physical, special) / Math.max(1, team.length / 2);
  return clamp(roles.size * 14 + balance * 30);
}

function defensiveScore(team: PokemonRecord[], catalog: NormalizedCatalog) {
  const attackTypes = Object.keys(catalog.typeChart);
  if (attackTypes.length === 0 || team.length === 0) return 50;
  const abilityById = new Map(
    catalog.abilities.map((ability) => [ability.id, ability]),
  );
  let penalty = 0;
  let resistanceBonus = 0;
  let absorptionBonus = 0;
  for (const attackType of attackTypes) {
    const matchup = team.map((pokemon) => {
      const capabilities = abilityById.get(pokemon.build.abilityId)
        ?.capabilities;
      if (capabilities?.absorptions.includes(attackType)) {
        absorptionBonus += 0.75;
        return 0;
      }
      if (capabilities?.immunities.includes(attackType)) return 0;
      return pokemon.types.reduce(
        (multiplier, defenderType) =>
          multiplier *
          (catalog.typeChart[attackType]?.[defenderType] ?? 1),
        1,
      );
    });
    const weak = matchup.filter((value) => value > 1).length;
    const resistant = matchup.filter((value) => value < 1).length;
    if (weak >= 3) penalty += (weak - 2) * 7;
    resistanceBonus += Math.min(weak, resistant) * 1.5;
  }
  return clamp(88 - penalty + resistanceBonus + absorptionBonus);
}

function offensiveScore(team: PokemonRecord[], catalog: NormalizedCatalog) {
  const moveById = new Map(catalog.moves.map((move) => [move.id, move]));
  const attacks = damagingMoves(team, moveById);
  const defendingTypes = [
    ...new Set(
      Object.values(catalog.typeChart).flatMap((matchups) =>
        Object.keys(matchups),
      ),
    ),
  ];
  if (defendingTypes.length === 0 || attacks.length === 0) return 50;
  const covered = defendingTypes.filter((defenderType) =>
    attacks.some(
      (move) =>
        (catalog.typeChart[move.type]?.[defenderType] ?? 1) > 1,
    ),
  ).length;
  const uniqueAttackTypes = new Set(attacks.map((move) => move.type)).size;
  return clamp(
    (covered / defendingTypes.length) * 75 +
      Math.min(25, uniqueAttackTypes * 3),
  );
}

function weatherScore(
  team: PokemonRecord[],
  request: GeneratorRequest,
  catalog: NormalizedCatalog,
) {
  if (request.style !== "weather" || !request.weather) return 100;
  const term = request.weather === "random" ? "" : request.weather;
  if (!term) return 70;
  const moveById = new Map(catalog.moves.map((move) => [move.id, move]));
  const abilityById = new Map(
    catalog.abilities.map((ability) => [ability.id, ability]),
  );
  const matches = team.reduce((sum, pokemon) => {
    const moveMatch = pokemon.build.moves.some((move) => {
      const sourced = moveById.get(move.id);
      return `${sourced?.effect.weather ?? ""} ${sourced?.name ?? ""}`
        .toLowerCase()
        .includes(term);
    });
    const ability = abilityById.get(pokemon.build.abilityId);
    const abilityMatch = ability?.capabilities?.weather.includes(term) ?? false;
    const abilityDetriment =
      ability?.capabilities?.weatherDetriments?.includes(term) ?? false;
    const abilityEffect = Number(abilityMatch) - Number(abilityDetriment);
    return sum + (moveMatch ? Math.max(1, abilityEffect) : abilityEffect);
  }, 0);
  return clamp(40 + matches * 12);
}

export function scoreTeam(
  team: PokemonRecord[],
  request: GeneratorRequest,
  catalog: NormalizedCatalog,
): ScoreBreakdown {
  const moveById = new Map(catalog.moves.map((move) => [move.id, move]));
  const journeyFit = clamp(
    average(team.map((pokemon) => pokemon.availability.score)),
  );
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

  const roleCoverage = roleScore(team);
  const defensiveFit = defensiveScore(team, catalog);
  const offensiveReach = offensiveScore(team, catalog);
  const utility = utilityScore(team, moveById);
  const weather = weatherScore(team, request, catalog);
  const abilityQuality = abilityQualityForTeam(team, request, catalog);
  const itemQuality = itemQualityForTeam(team, request, catalog);
  const moveQuality = moveQualityForTeam(team, request, catalog);
  const teamQuality = teamQualityForTeam(team, request, catalog);
  const battlePlan = battlePlanQualityForTeam(team, request, catalog);
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
      battlePlan.contribution,
  );

  return {
    total: Math.round(journeyScore * 0.6 + battleScore * 0.4),
    journeyScore: Math.round(journeyScore),
    battleScore: Math.round(battleScore),
    roleCoverage: Math.round(roleCoverage),
    defensiveFit: Math.round(defensiveFit),
    offensiveReach: Math.round(offensiveReach),
    journeyFit: Math.round(journeyFit),
    utility: Math.round(utility),
  };
}
