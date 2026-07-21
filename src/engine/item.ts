import type {
  GeneratorRequest,
  ItemCapabilities,
  ItemRecord,
  NormalizedCatalog,
  PokemonRecord,
} from "@/lib/types";

const emptyCapabilities: ItemCapabilities = {
  damageCategory: null,
  choiceLock: false,
  recovery: false,
  requiredType: null,
  defensiveStats: [],
  hazardProtection: false,
  survival: false,
  speedMultiplier: null,
  speedStages: 0,
  movesLast: false,
  recoil: false,
  consumable: false,
  boostedStats: [],
  requiresInaccurateMove: false,
  damagingMovesOnly: false,
  requiresEvolutionPotential: false,
};

type BuildContext = Pick<
  PokemonRecord,
  "build" | "finalEvolution" | "roles" | "stats" | "types"
>;

export function itemCapabilityFitForBuild(
  pokemon: BuildContext,
  item: ItemRecord | undefined,
) {
  const capabilities = item?.capabilities ?? emptyCapabilities;
  const moves = pokemon.build.moves;
  const damaging = moves.filter((move) => move.category !== "Status");
  const physical = damaging.filter((move) => move.category === "Physical");
  const special = damaging.filter((move) => move.category === "Special");
  const inaccurate = damaging.some(
    (move) => move.accuracy !== null && move.accuracy < 100,
  );
  const statusCount = moves.length - damaging.length;
  const defensiveInvestment =
    pokemon.build.evs.hp +
    pokemon.build.evs.defense +
    pokemon.build.evs.specialDefense;
  const defensiveJob = pokemon.roles.some((role) =>
    /wall|defen|support|stall|pivot|tank|cleric/i.test(role),
  );
  const defensiveIntent =
    defensiveInvestment >= 252 || statusCount >= 2 || defensiveJob;
  const offensiveIntent = damaging.length >= 2;
  const triggerUsable = !capabilities.requiresInaccurateMove || inaccurate;
  const compatibleDamageMoveCount = capabilities.damageCategory
    ? capabilities.damageCategory === "all"
      ? damaging.length
      : capabilities.damageCategory === "physical"
        ? physical.length
        : special.length
    : 0;
  const speedMultiplier =
    (capabilities.speedMultiplier ?? 1) > 1 && offensiveIntent;
  const speedStages =
    capabilities.speedStages > 0 && offensiveIntent && triggerUsable;
  const consumableSpeed =
    capabilities.consumable &&
    capabilities.boostedStats.includes("speed") &&
    offensiveIntent &&
    triggerUsable;
  const requiredTypeMatches =
    !capabilities.requiredType ||
    pokemon.types.includes(capabilities.requiredType);

  return {
    compatibleDamageMoveCount,
    damageAmplification: compatibleDamageMoveCount >= 2,
    recovery:
      capabilities.recovery && requiredTypeMatches && defensiveIntent,
    speedMultiplier,
    speedStages,
    consumableSpeed,
    speedControl: speedMultiplier || speedStages || consumableSpeed,
  };
}

function evaluateItemFit(
  pokemon: BuildContext,
  item: ItemRecord | undefined,
  request: Pick<GeneratorRequest, "style">,
  catalog: NormalizedCatalog,
) {
  const capabilities = item?.capabilities ?? emptyCapabilities;
  const moves = pokemon.build.moves;
  const damaging = moves.filter((move) => move.category !== "Status");
  const statusCount = moves.length - damaging.length;
  const physical = damaging.filter((move) => move.category === "Physical");
  const special = damaging.filter((move) => move.category === "Special");
  const inaccurate = damaging.some(
    (move) => move.accuracy !== null && move.accuracy < 100,
  );
  const defensiveInvestment =
    pokemon.build.evs.hp +
    pokemon.build.evs.defense +
    pokemon.build.evs.specialDefense;
  const defensiveJob = pokemon.roles.some((role) =>
    /wall|defen|support|stall|pivot|tank|cleric/i.test(role),
  );
  const defensiveIntent =
    defensiveInvestment >= 252 || statusCount >= 2 || defensiveJob;
  const offensiveIntent = damaging.length >= 2;
  const speedIntent = offensiveIntent && pokemon.build.evs.speed > 0;
  const capabilityFit = itemCapabilityFitForBuild(pokemon, item);
  const ability = capabilities.recovery
    ? catalog.abilities.find(
        (record) => record.id === pokemon.build.abilityId,
      )
    : undefined;
  const abilitySustain = (ability?.capabilities?.absorptions.length ?? 0) > 0;
  const facts: string[] = [];
  let value = 0;
  const evolutionConditionFailed =
    capabilities.requiresEvolutionPotential && pokemon.finalEvolution;

  if (evolutionConditionFailed) {
    value -= 8;
    facts.push("defensive mitigation requires evolution potential this build lacks");
  }

  if (capabilities.damageCategory) {
    if (capabilityFit.damageAmplification) {
      value += Math.min(14, 8 + capabilityFit.compatibleDamageMoveCount * 2);
      facts.push(
        `${capabilities.damageCategory} damage amplification matches ${capabilityFit.compatibleDamageMoveCount} attacks`,
      );
      if (request.style === "aggressive") value += 2;
    } else {
      value -= capabilityFit.compatibleDamageMoveCount === 0 ? 8 : 4;
      facts.push(
        `${capabilities.damageCategory} damage amplification lacks enough matching attacks`,
      );
    }
  }

  if (capabilities.choiceLock) {
    if (statusCount > 0 || damaging.length < 3) {
      value -= 8;
      facts.push("choice locking conflicts with the selected move mix");
    } else {
      value += 5;
      facts.push("choice locking suits the all-attacking move set");
    }
  }

  if (capabilities.recovery) {
    if (
      capabilities.requiredType &&
      !pokemon.types.includes(capabilities.requiredType)
    ) {
      value -= 8;
      facts.push(
        `recovery requires ${capabilities.requiredType} typing that this build lacks`,
      );
    } else if (capabilityFit.recovery) {
      value += abilitySustain ? 5 : 6;
      facts.push(
        abilitySustain
          ? "recovery supports a defensive job alongside sourced ability sustain"
          : "recovery supports the build's defensive investment and job",
      );
      if (request.style === "bulky") value += 2;
    } else {
      facts.push("recovery has no defensive investment or sustain job to support");
    }
  }

  for (const stat of evolutionConditionFailed
    ? []
    : capabilities.defensiveStats) {
    const invested = pokemon.build.evs[stat] > 0;
    const naturallyDefensive = pokemon.stats[stat] >= 90;
    if (invested) {
      value += 7;
      facts.push(
        `${stat === "defense" ? "physical" : "special"} mitigation matches explicit build investment`,
      );
    } else if (naturallyDefensive || defensiveJob) {
      value += 3;
      facts.push(
        `${stat === "defense" ? "physical" : "special"} mitigation matches the build's bulk`,
      );
    } else {
      facts.push(
        `${stat === "defense" ? "physical" : "special"} mitigation lacks matching bulk investment`,
      );
    }
  }
  if (
    capabilities.defensiveStats.length > 0 &&
    !evolutionConditionFailed &&
    request.style === "bulky" &&
    defensiveIntent
  ) {
    value += 2;
  }
  if (capabilities.hazardProtection) {
    const moveIds = new Set(moves.map((move) => move.id));
    const pivots = catalog.moves.some(
      (move) => moveIds.has(move.id) && move.effect.selfSwitch,
    );
    value += pivots || defensiveIntent ? 5 : 2;
    facts.push(
      pivots || defensiveIntent
        ? "hazard protection supports repeated switching"
        : "hazard protection offers limited switch-in support",
    );
  }
  if (capabilities.survival) {
    value += offensiveIntent ? 5 : 2;
    facts.push(
      offensiveIntent
        ? "single-hit survival preserves an attacking turn"
        : "single-hit survival offers limited passive-build value",
    );
  }

  if (capabilities.speedMultiplier !== null) {
    if (capabilityFit.speedMultiplier) {
      value += speedIntent ? 7 : 5;
      facts.push("speed amplification supports the attacking plan");
      if (request.style === "aggressive") value += 2;
    } else if (capabilities.speedMultiplier < 1) {
      value -= speedIntent ? 8 : 4;
      facts.push("speed reduction works against the selected build");
    } else {
      facts.push("speed modification has no attacking plan to support");
    }
  }
  if (capabilities.speedStages > 0) {
    if (capabilityFit.speedStages) {
      value += speedIntent ? 7 : 5;
      facts.push("single-use speed setup has a matching attacking payoff");
    } else {
      facts.push(
        capabilities.requiresInaccurateMove && !inaccurate
          ? "speed setup requires an inaccurate move that is not selected"
          : "speed setup has no attacking plan to support",
      );
    }
  }
  if (capabilities.movesLast) {
    value -= speedIntent ? 8 : 4;
    facts.push("moving last conflicts with the build's speed plan");
  }

  if (capabilities.recoil && damaging.length > 0) {
    value -= 6;
    facts.push("recoil taxes the attacks that activate this item");
  }

  if (capabilities.consumable && capabilities.boostedStats.length > 0) {
    const triggerUsable = !capabilities.requiresInaccurateMove || inaccurate;
    const usableBoosts = capabilities.boostedStats.filter((stat) => {
      if (stat === "attack") return physical.length > 0;
      if (stat === "specialAttack") return special.length > 0;
      if (stat === "speed") return offensiveIntent;
      return defensiveIntent;
    });
    if (triggerUsable && usableBoosts.length > 0) {
      value += Math.min(8, usableBoosts.length * 4);
      facts.push(
        `single-use ${usableBoosts.join("/")} boosts have matching moves or investment`,
      );
    } else {
      facts.push(
        capabilities.requiresInaccurateMove && !inaccurate
          ? "single-use setup requires an inaccurate move that is not selected"
          : "single-use stat boosts lack a matching payoff",
      );
    }
  }

  if (capabilities.damagingMovesOnly) {
    if (statusCount > 0) {
      value -= 10;
      facts.push("damaging-moves-only restriction disables selected status moves");
    } else {
      value += 3;
      facts.push("damaging-moves-only restriction preserves the full move set");
    }
  }

  return { value, facts };
}

export function itemFitFactsForBuild(
  pokemon: BuildContext,
  item: ItemRecord | undefined,
  request: Pick<GeneratorRequest, "style">,
  catalog: NormalizedCatalog,
) {
  return evaluateItemFit(pokemon, item, request, catalog).facts;
}

export function itemBuildValue(
  pokemon: BuildContext,
  item: ItemRecord | undefined,
  request: Pick<GeneratorRequest, "style">,
  catalog: NormalizedCatalog,
) {
  return evaluateItemFit(pokemon, item, request, catalog).value;
}

export function itemQualityForTeam(
  team: PokemonRecord[],
  request: GeneratorRequest,
  catalog: NormalizedCatalog,
) {
  const itemById = new Map(catalog.items.map((item) => [item.id, item]));
  const evaluated = team.map((pokemon) => {
    const item = itemById.get(pokemon.build.heldItemId);
    return {
      pokemon,
      item,
      ...evaluateItemFit(pokemon, item, request, catalog),
    };
  });
  const contribution = Math.round(
    (evaluated.reduce((sum, entry) => sum + entry.value, 0) /
      Math.max(1, evaluated.length)) *
      0.25,
  );
  const supported = evaluated.filter((entry) => entry.facts.length > 0);
  if (supported.length === 0) {
    return {
      contribution,
      explanation:
        "No selected held item has a supported sourced capability, so item fit remains neutral.",
    };
  }
  const details = supported.map(
    ({ pokemon, item, facts }) =>
      `${item?.name ?? pokemon.build.heldItem} on ${pokemon.name}: ${facts.join(", ")}`,
  );
  return {
    contribution,
    explanation: `Selected held items have these sourced build interactions: ${details.join("; ")}.`,
  };
}
