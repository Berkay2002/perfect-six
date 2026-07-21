import { itemCapabilityFitForBuild } from "@/engine/item";
import {
  isRecoveryMove,
  usableSetupStatsForBuild,
} from "@/engine/move";
import { weatherPlanForTeam } from "@/engine/weather";
import type {
  AbilityRecord,
  BattleMechanicsContext,
  BattleStat,
  BattlePlanQuality,
  GeneratorRequest,
  ItemRecord,
  MoveRecord,
  NormalizedCatalog,
  PokemonRecord,
  StandardStatIndex,
  StatBlock,
} from "@/lib/types";

/**
 * Planning stats use the standard level 50 comparison point with 31 IVs.
 * They are deterministic team-building indices, not damage-calculator output.
 * Only normalized numeric modifiers whose explicit conditions are active are
 * applied to the index. A generator request never activates weather by itself.
 */
export const STANDARD_BATTLE_LEVEL = 50 as const;
export const STANDARD_IV = 31 as const;

const NATURES: Record<
  string,
  { raised: keyof Omit<StatBlock, "hp"> | null; lowered: keyof Omit<StatBlock, "hp"> | null }
> = {
  adamant: { raised: "attack", lowered: "specialAttack" },
  bashful: { raised: null, lowered: null },
  bold: { raised: "defense", lowered: "attack" },
  brave: { raised: "attack", lowered: "speed" },
  calm: { raised: "specialDefense", lowered: "attack" },
  careful: { raised: "specialDefense", lowered: "specialAttack" },
  docile: { raised: null, lowered: null },
  gentle: { raised: "specialDefense", lowered: "defense" },
  hardy: { raised: null, lowered: null },
  hasty: { raised: "speed", lowered: "defense" },
  impish: { raised: "defense", lowered: "specialAttack" },
  jolly: { raised: "speed", lowered: "specialAttack" },
  lax: { raised: "defense", lowered: "specialDefense" },
  lonely: { raised: "attack", lowered: "defense" },
  mild: { raised: "specialAttack", lowered: "defense" },
  modest: { raised: "specialAttack", lowered: "attack" },
  naive: { raised: "speed", lowered: "specialDefense" },
  naughty: { raised: "attack", lowered: "specialDefense" },
  quiet: { raised: "specialAttack", lowered: "speed" },
  quirky: { raised: null, lowered: null },
  rash: { raised: "specialAttack", lowered: "specialDefense" },
  relaxed: { raised: "defense", lowered: "speed" },
  sassy: { raised: "specialDefense", lowered: "speed" },
  serious: { raised: null, lowered: null },
  timid: { raised: "speed", lowered: "attack" },
};

const clamp = (value: number) => Math.max(0, Math.min(100, value));
const average = (values: number[]) =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

type PlanningLookups = {
  moveById: ReadonlyMap<string, MoveRecord>;
  itemById: ReadonlyMap<string, ItemRecord>;
  abilityById: ReadonlyMap<
    string,
    NormalizedCatalog["abilities"][number]
  >;
  attackTypes: string[];
};

const planningLookupCache = new WeakMap<NormalizedCatalog, PlanningLookups>();

function lookupsFor(catalog: NormalizedCatalog): PlanningLookups {
  const cached = planningLookupCache.get(catalog);
  if (cached) return cached;
  const lookups = {
    moveById: new Map(catalog.moves.map((move) => [move.id, move])),
    itemById: new Map(catalog.items.map((item) => [item.id, item])),
    abilityById: new Map(
      catalog.abilities.map((ability) => [ability.id, ability]),
    ),
    attackTypes: Object.keys(catalog.typeChart),
  };
  planningLookupCache.set(catalog, lookups);
  return lookups;
}

function natureMultiplier(
  nature: string,
  stat: keyof Omit<StatBlock, "hp">,
) {
  const effect = NATURES[nature.trim().toLowerCase()];
  if (!effect) return 1;
  if (effect.raised === stat) return 1.1;
  if (effect.lowered === stat) return 0.9;
  return 1;
}

function hpIndex(base: number, ev: number) {
  return (
    Math.floor(
      ((2 * base + STANDARD_IV + Math.floor(ev / 4)) *
        STANDARD_BATTLE_LEVEL) /
        100,
    ) +
    STANDARD_BATTLE_LEVEL +
    10
  );
}

function otherIndex(
  base: number,
  ev: number,
  nature: string,
  stat: keyof Omit<StatBlock, "hp">,
) {
  const beforeNature =
    Math.floor(
      ((2 * base + STANDARD_IV + Math.floor(ev / 4)) *
        STANDARD_BATTLE_LEVEL) /
        100,
    ) + 5;
  return Math.floor(beforeNature * natureMultiplier(nature, stat));
}

const STAT_LABELS: Record<BattleStat, string> = {
  attack: "Attack",
  specialAttack: "Special Attack",
  defense: "Defense",
  specialDefense: "Special Defense",
  speed: "Speed",
};

type ModifierBuild = Pick<
  PokemonRecord,
  "build" | "finalEvolution" | "roles" | "stats" | "types"
>;

function modifierConditionsFit(
  pokemon: ModifierBuild,
  conditions: NonNullable<AbilityRecord["modifiers"]>["statMultipliers"][number]["conditions"],
  context: BattleMechanicsContext,
) {
  const damagingCount = pokemon.build.moves.filter(
    (move) => move.category !== "Status",
  ).length;
  return conditions.every((condition) => {
    if (condition.kind === "weather") {
      return context.activeWeather === condition.weather;
    }
    if (condition.kind === "can-evolve") return !pokemon.finalEvolution;
    if (condition.kind === "damaging-moves-only") {
      return damagingCount === pokemon.build.moves.length;
    }
    return damagingCount >= 3 && damagingCount === pokemon.build.moves.length;
  });
}

function sourcedStatModifiers(
  pokemon: ModifierBuild,
  source: ItemRecord | AbilityRecord | undefined,
  context: BattleMechanicsContext,
  itemFit?: ReturnType<typeof itemCapabilityFitForBuild>,
) {
  return (source?.modifiers?.statMultipliers ?? []).filter((modifier) => {
    if (!modifierConditionsFit(pokemon, modifier.conditions, context)) {
      return false;
    }
    if (!itemFit || !("megaStone" in source!)) return true;
    if (modifier.stat === "attack" && source.capabilities.damageCategory === "physical") {
      return itemFit.damageAmplification;
    }
    if (
      modifier.stat === "specialAttack" &&
      source.capabilities.damageCategory === "special"
    ) {
      return itemFit.damageAmplification;
    }
    return true;
  });
}

function modifierConditionExplanation(
  conditions: NonNullable<AbilityRecord["modifiers"]>["statMultipliers"][number]["conditions"],
) {
  const weather = conditions.find((condition) => condition.kind === "weather");
  return weather && weather.kind === "weather"
    ? ` while ${weather.weather} is active`
    : "";
}

export function standardStatIndexForBuild(
  pokemon: ModifierBuild,
  item: ItemRecord | undefined,
  ability?: AbilityRecord,
  context: BattleMechanicsContext = {},
): StandardStatIndex {
  const itemFit = itemCapabilityFitForBuild(pokemon, item);
  const itemModifiers = sourcedStatModifiers(
    pokemon,
    item,
    context,
    itemFit,
  );
  const abilityModifiers = sourcedStatModifiers(pokemon, ability, context);
  const modifiers = [
    ...itemModifiers.map((modifier) => ({ ...modifier, source: item!.name })),
    ...abilityModifiers.map((modifier) => ({
      ...modifier,
      source: ability!.name,
    })),
  ];
  if (
    item &&
    !item.modifiers &&
    item.capabilities.speedMultiplier !== null &&
    item.capabilities.speedMultiplier !== 1
  ) {
    modifiers.push({
      stat: "speed",
      multiplier: item.capabilities.speedMultiplier,
      conditions: [],
      source: item.name,
    });
  }
  const rawStats = {
    attack: otherIndex(
      pokemon.stats.attack,
      pokemon.build.evs.attack,
      pokemon.build.nature,
      "attack",
    ),
    defense: otherIndex(
      pokemon.stats.defense,
      pokemon.build.evs.defense,
      pokemon.build.nature,
      "defense",
    ),
    specialAttack: otherIndex(
      pokemon.stats.specialAttack,
      pokemon.build.evs.specialAttack,
      pokemon.build.nature,
      "specialAttack",
    ),
    specialDefense: otherIndex(
      pokemon.stats.specialDefense,
      pokemon.build.evs.specialDefense,
      pokemon.build.nature,
      "specialDefense",
    ),
    speed: otherIndex(
      pokemon.stats.speed,
      pokemon.build.evs.speed,
      pokemon.build.nature,
      "speed",
    ),
  };
  const appliedModifiers: string[] = [];
  for (const modifier of modifiers) {
    appliedModifiers.push(
      `${modifier.source}: sourced ${modifier.multiplier}x ${STAT_LABELS[modifier.stat]}${modifierConditionExplanation(modifier.conditions)}`,
    );
  }
  const apply = (stat: BattleStat) =>
    Math.floor(
      rawStats[stat] *
        modifiers
          .filter((modifier) => modifier.stat === stat)
          .reduce((product, modifier) => product * modifier.multiplier, 1),
    );
  return {
    level: STANDARD_BATTLE_LEVEL,
    assumedIvs: STANDARD_IV,
    hp: hpIndex(pokemon.stats.hp, pokemon.build.evs.hp),
    attack: apply("attack"),
    defense: apply("defense"),
    specialAttack: apply("specialAttack"),
    specialDefense: apply("specialDefense"),
    speed: apply("speed"),
    appliedModifiers,
  };
}

function sourcedMoves(
  pokemon: PokemonRecord,
  moveById: ReadonlyMap<string, MoveRecord>,
) {
  return pokemon.build.moves
    .map((move) => moveById.get(move.id))
    .filter((move): move is MoveRecord => move !== undefined);
}

export function battlePlanMemberForBuild(
  pokemon: PokemonRecord,
  catalog: NormalizedCatalog,
  context: BattleMechanicsContext = {},
) {
  const { moveById, itemById, abilityById } = lookupsFor(catalog);
  return battlePlanMemberWithLookups(
    pokemon,
    catalog,
    moveById,
    itemById,
    abilityById,
    context,
  );
}

function battlePlanMemberWithLookups(
  pokemon: PokemonRecord,
  catalog: NormalizedCatalog,
  moveById: ReadonlyMap<string, MoveRecord>,
  itemById: ReadonlyMap<string, ItemRecord>,
  abilityById: ReadonlyMap<string, NormalizedCatalog["abilities"][number]>,
  context: BattleMechanicsContext,
) {
  const item = itemById.get(pokemon.build.heldItemId);
  const ability = abilityById.get(pokemon.build.abilityId);
  const moves = sourcedMoves(pokemon, moveById);
  const damaging = moves.filter(
    (move) => move.category !== "Status" && (move.power ?? 0) > 0,
  );
  const priorityMoves = damaging.filter((move) => move.priority > 0);
  const setupStats = usableSetupStatsForBuild(pokemon, catalog, moveById);
  const speedSetupMoves = setupStats.has("speed")
    ? moves.filter(
        (move) =>
          (move.capabilities?.selfBoosts?.spe ?? move.effect.boosts?.spe ?? 0) >
          0,
      )
    : [];
  const recoveryMoves = moves.filter(isRecoveryMove);
  const itemFit = itemCapabilityFitForBuild(pokemon, item);
  const stats = standardStatIndexForBuild(pokemon, item, ability, context);
  const naturallyFast = damaging.length > 0 && stats.speed >= 150;
  const compatibleNumericItemSpeed = sourcedStatModifiers(
    pokemon,
    item,
    context,
    itemFit,
  ).some(
    (modifier) => modifier.stat === "speed" && modifier.multiplier > 1,
  );
  const legacyItemSpeed = !item?.modifiers && itemFit.speedMultiplier;
  const itemSpeed =
    damaging.length >= 2 &&
    (compatibleNumericItemSpeed ||
      legacyItemSpeed ||
      itemFit.speedStages ||
      itemFit.consumableSpeed);
  const itemName = item?.name ?? pokemon.build.heldItem;
  const abilityName = ability?.name ?? pokemon.build.ability;
  const damageTakenModifiers = [
    ...(item?.modifiers?.damageTakenMultipliers ?? []).map((modifier) => ({
      ...modifier,
      source: itemName,
    })),
    ...(ability?.modifiers?.damageTakenMultipliers ?? []).map((modifier) => ({
      ...modifier,
      source: abilityName,
    })),
  ].filter((modifier) =>
    modifierConditionsFit(pokemon, modifier.conditions, context),
  );
  const itemMitigation = {
    defense:
      item?.capabilities.defensiveStats.includes("defense") === true &&
      (!item.capabilities.requiresEvolutionPotential || !pokemon.finalEvolution) &&
      (!item.capabilities.damagingMovesOnly ||
        pokemon.build.moves.every((move) => move.category !== "Status")),
    specialDefense:
      item?.capabilities.defensiveStats.includes("specialDefense") === true &&
      (!item.capabilities.requiresEvolutionPotential || !pokemon.finalEvolution) &&
      (!item.capabilities.damagingMovesOnly ||
        pokemon.build.moves.every((move) => move.category !== "Status")),
  };
  return {
    stats,
    naturallyFast,
    priorityMoves,
    speedSetupMoves,
    itemSpeed,
    recoveryMoves,
    itemRecovery: itemFit.recovery,
    itemMitigation,
    damageTakenModifiers,
    immunities: ability?.capabilities.immunities ?? [],
    absorptions: ability?.capabilities.absorptions ?? [],
    abilityName,
    itemName,
  };
}

function typeMultiplier(
  pokemon: PokemonRecord,
  attackType: string,
  catalog: NormalizedCatalog,
  immunities: string[],
  absorptions: string[],
) {
  if (immunities.includes(attackType) || absorptions.includes(attackType)) {
    return 0;
  }
  return pokemon.types.reduce(
    (multiplier, defenderType) =>
      multiplier * (catalog.typeChart[attackType]?.[defenderType] ?? 1),
    1,
  );
}

function switchInValue(multiplier: number) {
  if (multiplier === 0) return 100;
  if (multiplier <= 0.5) return 85;
  if (multiplier < 1) return 75;
  if (multiplier === 1) return 55;
  if (multiplier <= 2) return 25;
  return 0;
}

function resilienceForTeam(
  team: PokemonRecord[],
  catalog: NormalizedCatalog,
  members: ReturnType<typeof battlePlanMemberForBuild>[],
  defenseStat: "defense" | "specialDefense",
  attackTypes: string[],
) {
  const category = defenseStat === "defense" ? "physical" : "special";
  const effectiveBulk = members.map((member) => {
    const damageMultiplier = member.damageTakenModifiers
      .filter((modifier) => modifier.category === category)
      .reduce((product, modifier) => product * modifier.multiplier, 1);
    return Math.round(
      (member.stats.hp * member.stats[defenseStat]) /
        100 /
        damageMultiplier,
    );
  });
  const strongestBulk = [...effectiveBulk]
    .sort((left, right) => right - left)
    .slice(0, Math.min(3, effectiveBulk.length));
  const bulkScore = clamp(average(strongestBulk) / 4);
  const coverageValues = attackTypes.map((attackType) => {
    const best = Math.min(
      ...team.map((pokemon, index) =>
        typeMultiplier(
          pokemon,
          attackType,
          catalog,
          members[index].immunities,
          members[index].absorptions,
        ),
      ),
    );
    return switchInValue(best);
  });
  const switchInCoverage = Math.round(average(coverageValues));
  const recoverySources = team
    .filter(
      (_, index) =>
        members[index].recoveryMoves.length > 0 || members[index].itemRecovery,
    )
    .map((pokemon) => pokemon.id);
  const immunitySources = team
    .filter(
      (_, index) =>
        members[index].immunities.length > 0 ||
        members[index].absorptions.length > 0,
    )
    .map((pokemon) => pokemon.id);
  const absorptionSources = team
    .filter((_, index) => members[index].absorptions.length > 0)
    .map((pokemon) => pokemon.id);
  const mitigationSources = team.filter(
    (_, index) => members[index].itemMitigation[defenseStat],
  );
  const sustainScore = clamp(
    recoverySources.length * 16 + absorptionSources.length * 10,
  );
  const mitigationScore = clamp(
    mitigationSources.length * 10,
  );
  const score = Math.round(
    clamp(
      bulkScore * 0.55 +
        switchInCoverage * 0.3 +
        (sustainScore + mitigationScore) * 0.15,
    ),
  );
  const labels = team.flatMap((pokemon, index) => {
    const facts: string[] = [];
    if (members[index].recoveryMoves.length > 0) {
      facts.push(
        `${pokemon.name}'s ${members[index].recoveryMoves.map((move) => move.name).join("/")}`,
      );
    } else if (members[index].itemRecovery) {
      facts.push(`${members[index].itemName} on ${pokemon.name}`);
    }
    if (
      members[index].immunities.length > 0 ||
      members[index].absorptions.length > 0
    ) {
      facts.push(
        `${members[index].abilityName} on ${pokemon.name} (${[
          ...new Set([
            ...members[index].immunities,
            ...members[index].absorptions,
          ]),
        ].join("/")})`,
      );
    }
    if (members[index].itemMitigation[defenseStat]) {
      facts.push(`${members[index].itemName} mitigation on ${pokemon.name}`);
    }
    for (const modifier of members[index].damageTakenModifiers.filter(
      (candidate) => candidate.category === category,
    )) {
      facts.push(
        `${modifier.source}: sourced ${modifier.multiplier}x ${category} damage taken on ${pokemon.name}`,
      );
    }
    return facts;
  });
  return {
    score,
    effectiveBulk: Math.round(average(strongestBulk)),
    switchInCoverage,
    recoverySources,
    immunitySources,
    explanation: `${defenseStat === "defense" ? "Physical" : "Special"} resilience scores ${score}/100 from level-${STANDARD_BATTLE_LEVEL} effective bulk ${Math.round(average(strongestBulk))}, ${switchInCoverage}/100 switch-in coverage across sourced type matchups, and ${labels.length > 0 ? labels.join(", ") : "no sourced recovery, mitigation, immunity, or absorption support"}.`,
  };
}

export function battlePlanQualityForTeam(
  team: PokemonRecord[],
  request: GeneratorRequest,
  catalog: NormalizedCatalog,
  context?: BattleMechanicsContext,
): BattlePlanQuality {
  const mechanicsContext =
    context ?? weatherPlanForTeam(team, request, catalog).context;
  const { moveById, itemById, abilityById, attackTypes } = lookupsFor(catalog);
  const members = team.map((pokemon) =>
    battlePlanMemberWithLookups(
      pokemon,
      catalog,
      moveById,
      itemById,
      abilityById,
      mechanicsContext,
    ),
  );
  const naturalSpeedMembers = team
    .filter((_, index) => members[index].naturallyFast)
    .map((pokemon) => pokemon.id);
  const priorityMembers = team
    .filter((_, index) => members[index].priorityMoves.length > 0)
    .map((pokemon) => pokemon.id);
  const setupMembers = team
    .filter((_, index) => members[index].speedSetupMoves.length > 0)
    .map((pokemon) => pokemon.id);
  const itemMembers = team
    .filter((_, index) => members[index].itemSpeed)
    .map((pokemon) => pokemon.id);
  const speedScore = Math.round(
    clamp(
      Math.min(80, naturalSpeedMembers.length * 20) +
        Math.min(75, priorityMembers.length * 25) +
        Math.min(50, setupMembers.length * 25) +
        Math.min(50, itemMembers.length * 25),
    ),
  );
  const missingSpeed =
    naturalSpeedMembers.length +
      priorityMembers.length +
      setupMembers.length +
      itemMembers.length ===
    0;
  const speedFacts: string[] = [];
  if (naturalSpeedMembers.length > 0) {
    speedFacts.push(
      `natural Speed from ${team.filter((pokemon) => naturalSpeedMembers.includes(pokemon.id)).map((pokemon) => pokemon.name).join("/")}`,
    );
  }
  if (priorityMembers.length > 0) {
    speedFacts.push(
      `priority from ${team.filter((pokemon) => priorityMembers.includes(pokemon.id)).map((pokemon) => `${pokemon.name} (${members[team.indexOf(pokemon)].priorityMoves.map((move) => move.name).join("/")})`).join(", ")}`,
    );
  }
  if (setupMembers.length > 0) {
    speedFacts.push(
      `coherent Speed setup from ${team.filter((pokemon) => setupMembers.includes(pokemon.id)).map((pokemon) => pokemon.name).join("/")}`,
    );
  }
  if (itemMembers.length > 0) {
    speedFacts.push(
      `sourced Speed modifiers on ${team.filter((pokemon) => itemMembers.includes(pokemon.id)).map((pokemon) => pokemon.name).join("/")}`,
    );
  }
  const speed = {
    score: speedScore,
    missing: missingSpeed,
    naturalSpeedMembers,
    priorityMembers,
    setupMembers,
    itemMembers,
    explanation: missingSpeed
      ? "Missing speed control: no naturally fast attacker, damaging priority, coherent Speed setup, or supported Speed modifier is present."
      : `Speed plan scores ${speedScore}/100 through ${speedFacts.join("; ")}.`,
  };
  const physicalResilience = resilienceForTeam(
    team,
    catalog,
    members,
    "defense",
    attackTypes,
  );
  const specialResilience = resilienceForTeam(
    team,
    catalog,
    members,
    "specialDefense",
    attackTypes,
  );
  const defenseGap = Math.abs(
    physicalResilience.score - specialResilience.score,
  );
  const concerns: string[] = [];
  if (missingSpeed) concerns.push("Missing speed control leaves faster threats unchecked.");
  if (defenseGap >= 20) {
    concerns.push(
      `The defensive plan is one-sided: ${physicalResilience.score}/100 physical resilience versus ${specialResilience.score}/100 special resilience.`,
    );
  }
  if (physicalResilience.score < 45) {
    concerns.push("Physical resilience lacks reliable bulk and switch-in coverage.");
  }
  if (specialResilience.score < 45) {
    concerns.push("Special resilience lacks reliable bulk and switch-in coverage.");
  }
  const speedContribution = missingSpeed ? -2 : 0;
  const averageResilience =
    (physicalResilience.score + specialResilience.score) / 2;
  const resilienceContribution = averageResilience < 45 ? -1 : 0;
  const asymmetryPenalty = defenseGap >= 20 ? 2 : 0;
  const contribution =
    speedContribution + resilienceContribution - asymmetryPenalty;
  const score = Math.round(
    (speedScore + physicalResilience.score + specialResilience.score) / 3,
  );
  return {
    score,
    contribution,
    speed,
    physicalResilience,
    specialResilience,
    memberIndices: team.map((pokemon, index) => ({
      speciesId: pokemon.id,
      speciesName: pokemon.name,
      stats: members[index].stats,
    })),
    concerns,
    explanation: `${speed.explanation} ${physicalResilience.explanation} ${specialResilience.explanation} ${concerns.length > 0 ? `Concerns: ${concerns.join(" ")}` : "The speed and defensive plans are balanced."}`,
  };
}
