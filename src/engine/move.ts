import type {
  GeneratorRequest,
  MovePackageCapabilities,
  MovePackageQuality,
  MoveRecord,
  NormalizedCatalog,
  PokemonRecord,
} from "@/lib/types";

type BuildContext = Pick<PokemonRecord, "build" | "stats" | "types">;
type MoveRequest = Pick<GeneratorRequest, "style" | "weather">;

const clamp = (value: number) => Math.max(0, Math.min(100, value));
const emptyCapabilities = {
  hazard: false,
  removal: false,
  screen: false,
  offensiveStat: null,
  selfBoosts: null,
};

export function isRecoveryMove(move: MoveRecord) {
  return (
    move.flags.includes("heal") ||
    move.effect.healingFraction !== null ||
    move.effect.drainFraction !== null
  );
}

const normalizedBoostStat = (stat: string) => {
  const names: Record<string, keyof PokemonRecord["stats"]> = {
    atk: "attack",
    def: "defense",
    spa: "specialAttack",
    spd: "specialDefense",
    spe: "speed",
  };
  return names[stat] ?? stat;
};

type OffensiveStat = NonNullable<
  NonNullable<MoveRecord["capabilities"]>["offensiveStat"]
>;

function effectiveOffense(pokemon: BuildContext, stat: OffensiveStat) {
  return pokemon.stats[stat] + pokemon.build.evs[stat] / 4;
}

function offensiveStatForMove(move: MoveRecord): OffensiveStat {
  return (
    (move.capabilities ?? emptyCapabilities).offensiveStat ??
    (move.category === "Physical" ? "attack" : "specialAttack")
  );
}

function offensiveStatLabel(stat: OffensiveStat) {
  switch (stat) {
    case "specialAttack":
      return "Special Attack";
    case "specialDefense":
      return "Special Defense";
    case "defense":
      return "Defense";
    default:
      return "Attack";
  }
}

function setupPayoff(
  pokemon: BuildContext,
  moves: MoveRecord[],
  boosts: Record<string, number>,
) {
  const damaging = moves.filter((move) => move.category !== "Status");
  const recovery = moves.some(isRecoveryMove);
  const usable: string[] = [];
  let value = 0;

  for (const [stat, stages] of Object.entries(boosts)) {
    if (stages <= 0) continue;
    const matches =
      (stat === "atk" &&
        damaging.some((move) => offensiveStatForMove(move) === "attack") &&
        effectiveOffense(pokemon, "attack") >= 70) ||
      (stat === "spa" &&
        damaging.some(
          (move) => offensiveStatForMove(move) === "specialAttack",
        ) &&
        effectiveOffense(pokemon, "specialAttack") >= 70) ||
      (stat === "spe" && damaging.length > 0 && pokemon.stats.speed >= 45) ||
      (stat === "def" &&
        (recovery ||
          damaging.some(
            (move) => offensiveStatForMove(move) === "defense",
          ))) ||
      (stat === "spd" &&
        (recovery ||
          damaging.some(
            (move) => offensiveStatForMove(move) === "specialDefense",
          )));
    if (matches) {
      usable.push(stat);
      value += Math.min(8, stages * 4);
    }
  }
  return { usable, value };
}

export function usableSetupStatsForBuild(
  pokemon: BuildContext,
  catalog: NormalizedCatalog,
  sourcedMoveById?: ReadonlyMap<string, MoveRecord>,
) {
  const moveById =
    sourcedMoveById ??
    new Map(catalog.moves.map((move) => [move.id, move]));
  const moves = pokemon.build.moves
    .map((move) => moveById.get(move.id))
    .filter((move): move is MoveRecord => move !== undefined);
  return new Set(
    moves.flatMap((move) => {
      const boosts = (move.capabilities ?? emptyCapabilities).selfBoosts;
      return boosts
        ? setupPayoff(pokemon, moves, boosts).usable.map(normalizedBoostStat)
        : [];
    }),
  );
}

function moveNames(moves: MoveRecord[]) {
  return moves.map((move) => move.name).join(", ");
}

export function movePackageQualityForBuild(
  pokemon: BuildContext,
  catalog: NormalizedCatalog,
  request?: MoveRequest,
): MovePackageQuality {
  const moveById = new Map(catalog.moves.map((move) => [move.id, move]));
  const moves = pokemon.build.moves
    .map((move) => moveById.get(move.id))
    .filter((move): move is MoveRecord => move !== undefined);
  const damaging = moves.filter(
    (move) => move.category !== "Status" && (move.power ?? 0) > 0,
  );
  const strengths: string[] = [];
  const concerns: string[] = [];
  const defensiveInvestment =
    pokemon.build.evs.hp +
    pokemon.build.evs.defense +
    pokemon.build.evs.specialDefense;
  const defensiveIntent = defensiveInvestment >= 252;
  let score = 8;

  const stabMoves = damaging.filter((move) => pokemon.types.includes(move.type));
  const alignedMoves: MoveRecord[] = [];
  for (const move of damaging) {
    const category = move.category === "Physical" ? "Physical" : "Special";
    const offensiveStat = offensiveStatForMove(move);
    const ownStat = effectiveOffense(pokemon, offensiveStat);
    const otherStat = effectiveOffense(
      pokemon,
      category === "Physical" ? "specialAttack" : "attack",
    );
    const hasOverride = offensiveStat !== (category === "Physical" ? "attack" : "specialAttack");
    const aligned = ownStat >= 70 && (hasOverride || ownStat >= otherStat * 0.9);
    if (aligned) alignedMoves.push(move);
    const accuracy = move.accuracy === null ? 1 : move.accuracy / 100;
    const stab = pokemon.types.includes(move.type) ? 1.5 : 1;
    const alignment = aligned ? 1 : 0.45;
    const adjustedPressure = (move.power ?? 0) * accuracy * stab * alignment;
    score += adjustedPressure / 17 + (aligned ? 2 : 0);
    if (pokemon.types.includes(move.type)) {
      strengths.push(
        `${move.name} supplies ${Math.round(adjustedPressure)} accuracy-adjusted STAB pressure`,
      );
    }
    if (hasOverride) {
      strengths.push(
        `${move.name} uses ${offensiveStatLabel(offensiveStat)} for aligned pressure`,
      );
    }
  }

  if (damaging.length > 0 && alignedMoves.length === 0) {
    concerns.push("Every damaging move mismatches the build's usable attacking stats");
    score -= damaging.length >= 2 ? 10 : 3;
  } else if (alignedMoves.length < damaging.length) {
    const mismatches = damaging.filter((move) => !alignedMoves.includes(move));
    concerns.push(`${moveNames(mismatches)} mismatch the stronger attacking stat`);
    score -= mismatches.length * 4;
  }

  const attackTypes = new Set(damaging.map((move) => move.type));
  const defendingTypes = new Set(
    Object.values(catalog.typeChart).flatMap((matchups) => Object.keys(matchups)),
  );
  const covered = [...defendingTypes].filter((defendingType) =>
    damaging.some(
      (move) => (catalog.typeChart[move.type]?.[defendingType] ?? 1) > 1,
    ),
  );
  score += Math.min(10, attackTypes.size * 2 + covered.length * 0.35);
  if (attackTypes.size > 1) {
    strengths.push(`${attackTypes.size} attack types provide useful coverage`);
  }

  const redundantAttackCount = [...attackTypes].reduce(
    (sum, type) =>
      sum + Math.max(0, damaging.filter((move) => move.type === type).length - 1),
    0,
  );
  if (redundantAttackCount > 0) {
    concerns.push(
      `${redundantAttackCount} damaging move${redundantAttackCount === 1 ? " repeats" : "s repeat"} a type without adding coverage`,
    );
    score -= redundantAttackCount * 5;
  }

  const priorityMoves = damaging.filter((move) => move.priority > 0);
  const recoveryMoves = moves.filter(isRecoveryMove);
  const statusMoves = moves.filter(
    (move) =>
      move.effect.status !== null ||
      (move.effect.volatileStatus !== null && move.target !== "self"),
  );
  const pivotMoves = moves.filter((move) => move.effect.selfSwitch);
  const hazardMoves = moves.filter(
    (move) =>
      (move.capabilities ?? emptyCapabilities).hazard ||
      Boolean(move.effect.sideCondition && move.target === "foeSide"),
  );
  const removalMoves = moves.filter(
    (move) => (move.capabilities ?? emptyCapabilities).removal,
  );
  const screenMoves = moves.filter(
    (move) => (move.capabilities ?? emptyCapabilities).screen,
  );
  const weatherMoves = moves.filter((move) => move.effect.weather !== null);

  const utilityGroups: Array<[string, MoveRecord[], number]> = [
    ["priority", priorityMoves, 5],
    ["recovery", recoveryMoves, 6],
    ["status pressure", statusMoves, 4],
    ["pivoting", pivotMoves, 5],
    ["hazards", hazardMoves, 5],
    ["hazard removal", removalMoves, 6],
    ["screens", screenMoves, 5],
  ];
  const activeUtilityGroups = utilityGroups.filter(([, matches]) => matches.length > 0);
  for (const [label, matches, value] of utilityGroups) {
    if (matches.length === 0) continue;
    score += value;
    strengths.push(`${moveNames(matches)} provide ${label}`);
  }
  if (activeUtilityGroups.length > 1) {
    score += Math.min(6, (activeUtilityGroups.length - 1) * 2);
    strengths.push(
      `${activeUtilityGroups.length} distinct utility jobs make the four-move package more complete`,
    );
  }
  if (defensiveIntent && recoveryMoves.length > 0) {
    score += 5;
    strengths.push("Recovery matches the build's defensive investment");
  }
  if (defensiveIntent && statusMoves.length > 0) {
    score += 2;
    strengths.push("Status pressure gives the defensive build a progress plan");
  }

  if (weatherMoves.length > 0) {
    const requestedWeather = request?.weather?.toLowerCase();
    const matching = requestedWeather
      ? weatherMoves.some((move) =>
          `${move.effect.weather} ${move.name}`.toLowerCase().includes(requestedWeather),
        )
      : false;
    score += matching && request?.style === "weather" ? 8 : 3;
    strengths.push(`${moveNames(weatherMoves)} provide weather support`);
  }

  if (recoveryMoves.length > 1) {
    concerns.push(`${moveNames(recoveryMoves)} duplicate the same recovery job`);
    score -= (recoveryMoves.length - 1) * 6;
  }
  if (weatherMoves.length > 1) {
    const weatherKinds = new Set(weatherMoves.map((move) => move.effect.weather));
    if (weatherKinds.size > 1) {
      concerns.push(`${moveNames(weatherMoves)} set contradictory weather conditions`);
      score -= 10;
    } else {
      concerns.push(`${moveNames(weatherMoves)} duplicate the same weather job`);
      score -= 6;
    }
  }

  let hasSetupPayoff = false;
  const boostedStats = new Map<string, MoveRecord[]>();
  for (const move of moves) {
    const boosts = (move.capabilities ?? emptyCapabilities).selfBoosts;
    if (!boosts) continue;
    const payoff = setupPayoff(pokemon, moves, boosts);
    if (payoff.usable.length > 0) {
      hasSetupPayoff = true;
      score += payoff.value;
      strengths.push(
        `${move.name} setup has payoff through ${payoff.usable.join("/")} and matching attacks or sustain`,
      );
      for (const stat of payoff.usable) {
        const existing = boostedStats.get(stat) ?? [];
        existing.push(move);
        boostedStats.set(stat, existing);
      }
    } else if (Object.values(boosts).some((stages) => stages > 0)) {
      concerns.push(`${move.name} boosts stats this build cannot exploit`);
      score -= 9;
    }
  }
  for (const [stat, setupMoves] of boostedStats) {
    if (setupMoves.length < 2) continue;
    concerns.push(`${moveNames(setupMoves)} redundantly boost ${stat}`);
    score -= (setupMoves.length - 1) * 6;
  }

  const roundedScore = Math.round(clamp(score));
  const capabilities: MovePackageCapabilities = {
    stab: stabMoves.length > 0,
    priority: priorityMoves.length > 0,
    recovery: recoveryMoves.length > 0,
    status: statusMoves.length > 0,
    setup: hasSetupPayoff,
    pivoting: pivotMoves.length > 0,
    hazards: hazardMoves.length > 0,
    removal: removalMoves.length > 0,
    screens: screenMoves.length > 0,
    weather: weatherMoves.length > 0,
  };
  const strengthText =
    strengths.length > 0
      ? `Strengths: ${strengths.join("; ")}.`
      : "No supported move-package strengths were found.";
  const concernText =
    concerns.length > 0
      ? ` Coherence concerns: ${concerns.join("; ")}.`
      : " No move-package coherence concerns were found.";

  return {
    score: roundedScore,
    contribution: Math.round((roundedScore - 45) * 0.12),
    capabilities,
    strengths,
    concerns,
    explanation: `${strengthText}${concernText}`,
  };
}

export function moveQualityForTeam(
  team: PokemonRecord[],
  request: GeneratorRequest,
  catalog: NormalizedCatalog,
): MovePackageQuality {
  const packages = team.map((pokemon) =>
    movePackageQualityForBuild(pokemon, catalog, request),
  );
  const score = Math.round(
    packages.reduce((sum, quality) => sum + quality.score, 0) /
      Math.max(1, packages.length),
  );
  const keys = Object.keys(
    packages[0]?.capabilities ?? {
      stab: false,
      priority: false,
      recovery: false,
      status: false,
      setup: false,
      pivoting: false,
      hazards: false,
      removal: false,
      screens: false,
      weather: false,
    },
  ) as Array<keyof MovePackageCapabilities>;
  const capabilities = Object.fromEntries(
    keys.map((key) => [key, packages.some((quality) => quality.capabilities[key])]),
  ) as MovePackageCapabilities;
  const strengths = packages.flatMap((quality) => quality.strengths);
  const concerns = packages.flatMap((quality) => quality.concerns);

  return {
    score,
    contribution: Math.round((score - 45) * 0.12),
    capabilities,
    strengths,
    concerns,
    explanation:
      packages.length === 0
        ? "No move packages were available to evaluate."
        : `The selected four-move packages average ${score}/100. ${strengths.slice(0, 6).join("; ") || "No supported strengths"}.${concerns.length > 0 ? ` Coherence concerns: ${concerns.slice(0, 4).join("; ")}.` : " No move-package coherence concerns were found."}`,
  };
}
