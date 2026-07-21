import {
  movePackageQualityForBuild,
  usableSetupStatsForBuild,
} from "@/engine/move";
import { weatherPlanForTeam, type TeamWeatherPlan } from "@/engine/weather";
import type {
  GeneratorRequest,
  AbilityRecord,
  MoveRecord,
  NormalizedCatalog,
  PokemonRecord,
  SynergyInteraction,
  SynergyInteractionKind,
  TeamSynergyQuality,
} from "@/lib/types";

const INTERACTION_KINDS: SynergyInteractionKind[] = [
  "pivot support",
  "setup opportunity",
  "weather support",
  "hazard control",
  "complementary offense",
  "immunity coverage",
  "switch-in coverage",
];

type MemberFacts = {
  pokemon: PokemonRecord;
  moves: MoveRecord[];
  ability: AbilityRecord | undefined;
  movePackage: ReturnType<typeof movePackageQualityForBuild>;
};

function typeMultiplier(
  pokemon: PokemonRecord,
  attackType: string,
  catalog: NormalizedCatalog,
  ability: AbilityRecord | undefined,
) {
  if (
    ability?.capabilities.immunities.includes(attackType) ||
    ability?.capabilities.absorptions.includes(attackType)
  ) {
    return 0;
  }
  return pokemon.types.reduce(
    (multiplier, defenderType) =>
      multiplier * (catalog.typeChart[attackType]?.[defenderType] ?? 1),
    1,
  );
}

function firstDistinct(
  left: MemberFacts[],
  right: MemberFacts[],
) {
  for (const leftMember of left) {
    const rightMember = right.find(
      (candidate) => candidate.pokemon.id !== leftMember.pokemon.id,
    );
    if (rightMember) return [leftMember, rightMember] as const;
  }
  return null;
}

function addInteraction(
  interactions: SynergyInteraction[],
  kind: SynergyInteractionKind,
  members: readonly MemberFacts[],
  explanation: string,
) {
  if (interactions.some((interaction) => interaction.kind === kind)) return;
  interactions.push({
    kind,
    memberIds: members.map((member) => member.pokemon.id),
    explanation,
  });
}

/**
 * Synergy is deliberately limited to relations between different members.
 * Individual ability, item, move, job, and planning quality are scored by their
 * owning evaluators; this seam only recognizes a capability when another build
 * supplies its concrete prerequisite or payoff. One interaction per kind and a
 * +1 cap keep this a soft tie-breaker inside the existing elite quality band.
 */
export function synergyQualityForTeam(
  team: PokemonRecord[],
  request: GeneratorRequest,
  catalog: NormalizedCatalog,
  weatherPlan: TeamWeatherPlan = weatherPlanForTeam(team, request, catalog),
): TeamSynergyQuality {
  const moveById = new Map(catalog.moves.map((move) => [move.id, move]));
  const abilityById = new Map(
    catalog.abilities.map((ability) => [ability.id, ability]),
  );
  const members: MemberFacts[] = team.map((pokemon) => ({
    pokemon,
    moves: pokemon.build.moves
      .map((move) => moveById.get(move.id))
      .filter((move): move is MoveRecord => move !== undefined),
    ability: abilityById.get(pokemon.build.abilityId),
    movePackage: movePackageQualityForBuild(pokemon, catalog, request),
  }));
  const interactions: SynergyInteraction[] = [];

  const pivoters = members.filter(
    (member) => member.movePackage.capabilities.pivoting,
  );
  const setupUsers = members.filter(
    (member) => member.movePackage.capabilities.setup,
  );
  const pivotPair = firstDistinct(pivoters, setupUsers);
  if (pivotPair) {
    const [pivoter, pivotTarget] = pivotPair;
    const pivotMoves = pivoter.moves
      .filter((move) => move.effect.selfSwitch)
      .map((move) => move.name);
    addInteraction(
      interactions,
      "pivot support",
      [pivoter, pivotTarget],
      `${pivoter.pokemon.name}'s ${pivotMoves.join("/")} pivoting brings ${pivotTarget.pokemon.name} into its usable setup win condition with less exposure.`,
    );
  }

  const screenUsers = members.filter((member) =>
    member.moves.some((move) => move.capabilities?.screen),
  );
  const setupPair = firstDistinct(screenUsers, setupUsers);
  if (setupPair) {
    const [supporter, setupUser] = setupPair;
    const screens = supporter.moves
      .filter((move) => move.capabilities?.screen)
      .map((move) => move.name);
    const usableStats = usableSetupStatsForBuild(
      setupUser.pokemon,
      catalog,
      moveById,
    );
    const statNames: Record<string, keyof PokemonRecord["stats"]> = {
      atk: "attack",
      def: "defense",
      spa: "specialAttack",
      spd: "specialDefense",
      spe: "speed",
    };
    const setupMoves = setupUser.moves
      .filter((move) =>
        Object.entries(
          move.capabilities?.selfBoosts ?? move.effect.boosts ?? {},
        ).some(([stat, stages]) => {
          const normalized = statNames[stat];
          return stages > 0 && normalized !== undefined && usableStats.has(normalized);
        }),
      )
      .map((move) => move.name);
    addInteraction(
      interactions,
      "setup opportunity",
      setupPair,
      `${supporter.pokemon.name}'s ${screens.join("/")} screens create setup room for ${setupUser.pokemon.name}'s usable ${setupMoves.join("/")} package.`,
    );
  }

  if (weatherPlan.requestedWeather) {
    const weather = weatherPlan.requestedWeather;
    const setters = members.filter((member) =>
      weatherPlan.setterMemberIds.includes(member.pokemon.id),
    );
    const beneficiaries = members.filter((member) =>
      weatherPlan.beneficiaryMemberIds.includes(member.pokemon.id),
    );
    const weatherPair = firstDistinct(setters, beneficiaries);
    if (weatherPair) {
      const [setter, beneficiary] = weatherPair;
      const setterCapability = weatherPlan.setters
        .find((source) => source.memberId === setter.pokemon.id)!
        .capabilities.join("/");
      addInteraction(
        interactions,
        "weather support",
        weatherPair,
        `${setter.pokemon.name}'s sourced ${setterCapability} supplies ${weather} for ${beneficiary.pokemon.name}'s sourced ${beneficiary.pokemon.build.ability} weather capability.`,
      );
    }
  }

  const hazardSetters = members.filter((member) =>
    member.movePackage.capabilities.hazards,
  );
  const hazardRemovers = members.filter((member) =>
    member.movePackage.capabilities.removal,
  );
  const hazardPair = firstDistinct(hazardSetters, hazardRemovers);
  if (hazardPair) {
    const [setter, remover] = hazardPair;
    const hazards = setter.moves
      .filter((move) => move.capabilities?.hazard)
      .map((move) => move.name);
    const removal = remover.moves
      .filter((move) => move.capabilities?.removal)
      .map((move) => move.name);
    addInteraction(
      interactions,
      "hazard control",
      hazardPair,
      `${setter.pokemon.name}'s ${hazards.join("/")} keeps hazard pressure while ${remover.pokemon.name}'s ${removal.join("/")} clears the team's side.`,
    );
  }

  const physical = members.filter((member) =>
    member.moves.some(
      (move) => move.category === "Physical" && (move.power ?? 0) > 0,
    ),
  );
  const special = members.filter((member) =>
    member.moves.some(
      (move) => move.category === "Special" && (move.power ?? 0) > 0,
    ),
  );
  const offensePair = firstDistinct(physical, special);
  if (offensePair) {
    const [physicalMember, specialMember] = offensePair;
    const physicalMoves = physicalMember.moves
      .filter((move) => move.category === "Physical" && (move.power ?? 0) > 0)
      .map((move) => move.name);
    const specialMoves = specialMember.moves
      .filter((move) => move.category === "Special" && (move.power ?? 0) > 0)
      .map((move) => move.name);
    addInteraction(
      interactions,
      "complementary offense",
      offensePair,
      `${physicalMember.pokemon.name}'s physical ${physicalMoves.join("/")} pressure complements ${specialMember.pokemon.name}'s special ${specialMoves.join("/")} pressure.`,
    );
  }

  const attackTypes = Object.keys(catalog.typeChart).sort();
  outerImmunity: for (const attackType of attackTypes) {
    for (const vulnerable of members) {
      if (typeMultiplier(vulnerable.pokemon, attackType, catalog, vulnerable.ability) <= 1) {
        continue;
      }
      const provider = members.find(
        (member) =>
          member.pokemon.id !== vulnerable.pokemon.id &&
          (member.ability?.capabilities.immunities.includes(attackType) ||
            member.ability?.capabilities.absorptions.includes(attackType)),
      );
      if (!provider) continue;
      const relation = provider.ability?.capabilities.absorptions.includes(attackType)
        ? "absorption"
        : "immunity";
      addInteraction(
        interactions,
        "immunity coverage",
        [provider, vulnerable],
        `${provider.pokemon.name}'s sourced ${provider.ability?.name ?? provider.pokemon.build.ability} ${relation} covers ${vulnerable.pokemon.name}'s ${attackType} weakness.`,
      );
      break outerImmunity;
    }
  }

  outerResistance: for (const attackType of attackTypes) {
    for (const vulnerable of members) {
      if (typeMultiplier(vulnerable.pokemon, attackType, catalog, vulnerable.ability) <= 1) {
        continue;
      }
      const provider = members.find((member) => {
        if (member.pokemon.id === vulnerable.pokemon.id) return false;
        const multiplier = typeMultiplier(
          member.pokemon,
          attackType,
          catalog,
          member.ability,
        );
        return multiplier > 0 && multiplier < 1;
      });
      if (!provider) continue;
      addInteraction(
        interactions,
        "switch-in coverage",
        [provider, vulnerable],
        `${provider.pokemon.name}'s ${provider.pokemon.types.join("/")} typing resists ${attackType} for ${vulnerable.pokemon.name}'s ${attackType} weakness.`,
      );
      break outerResistance;
    }
  }

  interactions.sort(
    (left, right) =>
      INTERACTION_KINDS.indexOf(left.kind) -
      INTERACTION_KINDS.indexOf(right.kind),
  );
  const representedKinds = new Set(
    interactions.map((interaction) => interaction.kind),
  ).size;
  const score = Math.round(
    (representedKinds / INTERACTION_KINDS.length) * 100,
  );
  const hasRequestedWeatherPlan =
    request.style !== "weather" ||
    interactions.some((interaction) => interaction.kind === "weather support");
  const contribution =
    representedKinds >= 2 && hasRequestedWeatherPlan ? 1 : 0;
  return {
    score,
    contribution,
    interactions,
    explanation:
      interactions.length > 0
        ? `Team synergy connects ${representedKinds} supported cross-member plan${representedKinds === 1 ? "" : "s"}: ${interactions.map((interaction) => interaction.explanation).join(" ")}`
        : "Team synergy found no supported cross-member interaction with every required prerequisite present.",
  };
}
