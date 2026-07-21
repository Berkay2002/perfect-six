import type {
  GeneratorRequest,
  ItemRecord,
  MoveRecord,
  NormalizedCatalog,
  PokemonRecord,
  TeamJob,
  TeamJobQuality,
} from "@/lib/types";
import {
  itemBuildValue,
  itemCapabilityFitForBuild,
} from "@/engine/item";
import { battlePlanMemberForBuild } from "@/engine/battle-plan";
import {
  isRecoveryMove,
  movePackageQualityForBuild,
} from "@/engine/move";
import { weatherPlanForTeam, type TeamWeatherPlan } from "@/engine/weather";

type MemberEvaluation = TeamJobQuality["memberExplanations"][number] & {
  winCondition: string | null;
};

const CORE_JOBS: TeamJob[] = [
  "physical pressure",
  "special pressure",
  "speed control",
  "defensive switch-in",
  "sustain",
  "pivoting",
  "hazards",
  "hazard removal",
  "status pressure",
  "weather support",
  "proactive win condition",
];

type StyleExpectation = {
  label: string;
  anyOf: TeamJob[];
};

function styleExpectations(
  request: GeneratorRequest,
): {
  expectations: StyleExpectation[];
  minimum: number;
  requiredJobs: TeamJob[];
} {
  if (request.style === "aggressive") {
    return {
      expectations: [
        { label: "physical pressure", anyOf: ["physical pressure"] },
        { label: "special pressure", anyOf: ["special pressure"] },
        { label: "speed control", anyOf: ["speed control"] },
        {
          label: "proactive win condition",
          anyOf: ["proactive win condition"],
        },
      ],
      minimum: 3,
      requiredJobs: ["proactive win condition"],
    };
  }
  if (request.style === "bulky") {
    return {
      expectations: [
        { label: "defensive switch-in", anyOf: ["defensive switch-in"] },
        { label: "sustain", anyOf: ["sustain"] },
        {
          label: "hazards or status pressure",
          anyOf: ["hazards", "status pressure"],
        },
        {
          label: "pivoting or hazard removal",
          anyOf: ["pivoting", "hazard removal"],
        },
        {
          label: "proactive win condition",
          anyOf: ["proactive win condition"],
        },
      ],
      minimum: 4,
      requiredJobs: ["defensive switch-in", "proactive win condition"],
    };
  }
  if (request.style === "weather") {
    return {
      expectations: [
        { label: "weather support", anyOf: ["weather support"] },
        {
          label: "physical or special pressure",
          anyOf: ["physical pressure", "special pressure"],
        },
        {
          label: "speed control or pivoting",
          anyOf: ["speed control", "pivoting"],
        },
        {
          label: "proactive win condition",
          anyOf: ["proactive win condition"],
        },
      ],
      minimum: 4,
      requiredJobs: ["proactive win condition"],
    };
  }
  return {
    expectations: [
      { label: "physical pressure", anyOf: ["physical pressure"] },
      { label: "special pressure", anyOf: ["special pressure"] },
      { label: "speed control", anyOf: ["speed control"] },
      { label: "defensive switch-in", anyOf: ["defensive switch-in"] },
      {
        label: "proactive win condition",
        anyOf: ["proactive win condition"],
      },
    ],
    minimum: request.style === "random" ? 3 : 4,
    requiredJobs: ["proactive win condition"],
  };
}

function sourcedMoves(
  pokemon: PokemonRecord,
  moveById: Map<string, MoveRecord>,
) {
  return pokemon.build.moves
    .map((move) => moveById.get(move.id))
    .filter((move): move is MoveRecord => move !== undefined);
}

function itemFor(
  pokemon: PokemonRecord,
  itemById: Map<string, ItemRecord>,
) {
  return itemById.get(pokemon.build.heldItemId);
}

function evaluateMember(
  pokemon: PokemonRecord,
  request: GeneratorRequest,
  catalog: NormalizedCatalog,
  weatherPlan: TeamWeatherPlan,
): MemberEvaluation {
  const moveById = new Map(catalog.moves.map((move) => [move.id, move]));
  const itemById = new Map(catalog.items.map((item) => [item.id, item]));
  const abilityById = new Map(
    catalog.abilities.map((ability) => [ability.id, ability]),
  );
  const moves = sourcedMoves(pokemon, moveById);
  const physical = moves.filter(
    (move) => move.category === "Physical" && (move.power ?? 0) > 0,
  );
  const special = moves.filter(
    (move) => move.category === "Special" && (move.power ?? 0) > 0,
  );
  const recovery = moves.filter(isRecoveryMove);
  const setup = moves.filter((move) =>
    Object.values(move.capabilities?.selfBoosts ?? move.effect.boosts ?? {}).some(
      (stages) => stages > 0,
    ),
  );
  const pivoting = moves.filter((move) => move.effect.selfSwitch);
  const hazards = moves.filter(
    (move) =>
      move.capabilities?.hazard ||
      Boolean(move.effect.sideCondition && move.target === "foeSide"),
  );
  const removal = moves.filter((move) => move.capabilities?.removal);
  const status = moves.filter(
    (move) =>
      move.effect.status !== null || move.effect.volatileStatus !== null,
  );
  const item = itemFor(pokemon, itemById);
  const ability = abilityById.get(pokemon.build.abilityId);
  const moveQuality = movePackageQualityForBuild(pokemon, catalog, request);
  const itemFit = itemCapabilityFitForBuild(pokemon, item);
  const battlePlan = battlePlanMemberForBuild(
    pokemon,
    catalog,
    weatherPlan.context,
  );
  const jobs: TeamJob[] = [];
  const facts: string[] = [];

  if (physical.length > 0) {
    jobs.push("physical pressure");
    facts.push(`${physical.map((move) => move.name).join("/")} supply physical pressure`);
  }
  if (special.length > 0) {
    jobs.push("special pressure");
    facts.push(`${special.map((move) => move.name).join("/")} supply special pressure`);
  }

  const speedSetup = battlePlan.speedSetupMoves.length > 0;
  const naturalSpeedControl = battlePlan.naturallyFast;
  if (
    battlePlan.priorityMoves.length > 0 ||
    speedSetup ||
    naturalSpeedControl ||
    itemFit.speedControl
  ) {
    jobs.push("speed control");
    facts.push(
      battlePlan.priorityMoves.length > 0
        ? `${battlePlan.priorityMoves.map((move) => move.name).join("/")} provide priority speed control`
        : speedSetup
          ? `${battlePlan.speedSetupMoves.map((move) => move.name).join("/")} provide coherent speed setup`
        : item && itemFit.speedControl
            ? `${item.name} provides sourced speed control`
            : `the level-50 Speed index of ${battlePlan.stats.speed} provides natural speed control`,
    );
  }

  const abilitySwitchIn =
    (ability?.capabilities.immunities.length ?? 0) > 0 ||
    (ability?.capabilities.absorptions.length ?? 0) > 0;
  const effectiveBulk = Math.max(
    (battlePlan.stats.hp * battlePlan.stats.defense) / 100,
    (battlePlan.stats.hp * battlePlan.stats.specialDefense) / 100,
  );
  if (effectiveBulk >= 180 || abilitySwitchIn) {
    jobs.push("defensive switch-in");
    facts.push(
      abilitySwitchIn
        ? `${pokemon.build.ability} supplies a sourced immunity or absorption for switch-ins`
        : `the level-50 effective-bulk index of ${Math.round(effectiveBulk)} supports switch-ins`,
    );
  }

  if (
    recovery.length > 0 ||
    itemFit.recovery ||
    (ability?.capabilities.absorptions.length ?? 0) > 0
  ) {
    jobs.push("sustain");
    facts.push(
      recovery.length > 0
        ? `${recovery.map((move) => move.name).join("/")} provide sustain`
        : item && itemFit.recovery
          ? `${item.name} provides sourced sustain`
          : `${pokemon.build.ability} provides absorption-based sustain`,
    );
  }
  if (pivoting.length > 0) {
    jobs.push("pivoting");
    facts.push(`${pivoting.map((move) => move.name).join("/")} provide pivoting`);
  }
  if (hazards.length > 0) {
    jobs.push("hazards");
    facts.push(`${hazards.map((move) => move.name).join("/")} set hazards`);
  }
  if (removal.length > 0) {
    jobs.push("hazard removal");
    facts.push(`${removal.map((move) => move.name).join("/")} remove hazards`);
  }
  if (status.length > 0) {
    jobs.push("status pressure");
    facts.push(`${status.map((move) => move.name).join("/")} apply status pressure`);
  }
  const weatherSetter = weatherPlan.setters.find(
    (setter) => setter.memberId === pokemon.id,
  );
  const activeBeneficiary =
    weatherPlan.activeWeather === weatherPlan.requestedWeather &&
    weatherPlan.beneficiaryMemberIds.includes(pokemon.id);
  if (weatherSetter || activeBeneficiary) {
    jobs.push("weather support");
    facts.push(
      weatherSetter
        ? `${weatherSetter.capabilities.join("/")} set ${weatherPlan.requestedWeather}`
        : `${pokemon.build.ability} benefits from active ${weatherPlan.activeWeather}`,
    );
  }

  const attacks = [...physical, ...special];
  const setupPayoff = moveQuality.capabilities.setup;
  const offensiveStat = Math.max(
    physical.length > 0 ? pokemon.stats.attack + pokemon.build.evs.attack / 8 : 0,
    special.length > 0
      ? pokemon.stats.specialAttack + pokemon.build.evs.specialAttack / 8
      : 0,
  );
  const amplified =
    itemFit.damageAmplification &&
    itemBuildValue(pokemon, item, request, catalog) > 0;
  const fastPressure = jobs.includes("speed control") && attacks.length >= 2;
  const wallbreaking = offensiveStat >= 130 && attacks.length >= 2 && amplified;
  const winCondition = setupPayoff
    ? `${pokemon.name} can close through ${setup.map((move) => move.name).join("/")} setup backed by ${attacks.map((move) => move.name).join("/")}.`
    : wallbreaking
      ? `${pokemon.name} can break a path to the win with ${item?.name} and ${attacks.map((move) => move.name).join("/")}.`
      : fastPressure
        ? `${pokemon.name} can finish weakened teams through its speed plan and ${attacks.map((move) => move.name).join("/")}.`
        : null;
  if (winCondition) {
    jobs.push("proactive win condition");
    facts.push(winCondition.replace(`${pokemon.name} `, ""));
  }

  return {
    speciesId: pokemon.id,
    speciesName: pokemon.name,
    jobs,
    explanation:
      jobs.length > 0
        ? `${pokemon.name} provides ${jobs.join(", ")}. ${facts.join("; ")}.`
        : `${pokemon.name} provides no supported team job from this validated build.`,
    winCondition,
  };
}

export function memberJobExplanation(
  pokemon: PokemonRecord,
  request: GeneratorRequest,
  catalog: NormalizedCatalog,
  weatherPlan: TeamWeatherPlan = weatherPlanForTeam(
    [pokemon],
    request,
    catalog,
  ),
) {
  const { winCondition, ...explanation } = evaluateMember(
    pokemon,
    request,
    catalog,
    weatherPlan,
  );
  void winCondition;
  return explanation;
}

export function teamQualityForTeam(
  team: PokemonRecord[],
  request: GeneratorRequest,
  catalog: NormalizedCatalog,
  weatherPlan: TeamWeatherPlan = weatherPlanForTeam(team, request, catalog),
): TeamJobQuality {
  const evaluated = team.map((pokemon) =>
    evaluateMember(pokemon, request, catalog, weatherPlan),
  );
  if (!evaluated.some((member) => member.winCondition !== null)) {
    const hazardSetter = evaluated.find((member) => member.jobs.includes("hazards"));
    const statusSource = evaluated.find((member) =>
      member.jobs.includes("status pressure"),
    );
    const durableSource = evaluated.find(
      (member) =>
        member.jobs.includes("sustain") ||
        member.jobs.includes("defensive switch-in"),
    );
    if (hazardSetter && statusSource && durableSource) {
      hazardSetter.jobs.push("proactive win condition");
      hazardSetter.winCondition = `${hazardSetter.speciesName} sets hazards so ${statusSource.speciesName} can apply status pressure while ${durableSource.speciesName} sustains the residual plan to close the battle.`;
      hazardSetter.explanation = `${hazardSetter.explanation} Together with ${statusSource.speciesName} and ${durableSource.speciesName}, it provides a proactive residual win condition.`;
    }
  }
  const coveredJobs = CORE_JOBS.filter((job) =>
    evaluated.some((member) => member.jobs.includes(job)),
  );
  const winner = evaluated.find((member) => member.winCondition !== null);
  const proactiveWinCondition = winner
    ? { speciesId: winner.speciesId, explanation: winner.winCondition! }
    : null;
  const profile = styleExpectations(request);
  const met = profile.expectations
    .filter((expectation) =>
      expectation.anyOf.some((job) => coveredJobs.includes(job)),
    )
    .map((expectation) => expectation.label);
  const missingExpectations = profile.expectations.filter(
    (expectation) => !met.includes(expectation.label),
  );
  const missing = missingExpectations.map((expectation) => expectation.label);
  const importantGaps = CORE_JOBS.filter(
    (job) =>
      !coveredJobs.includes(job) &&
      missingExpectations.some((expectation) => expectation.anyOf.includes(job)),
  );
  const hasRequiredPlan = profile.requiredJobs.every((job) =>
    coveredJobs.includes(job),
  );
  const satisfied = met.length >= profile.minimum && hasRequiredPlan;
  const score = Math.round((met.length / profile.expectations.length) * 100);
  const contribution =
    request.style === "weather"
      ? (satisfied ? 2 : 0) - missing.length * 10
      : -missing.length * 2;
  return {
    score,
    contribution,
    coveredJobs,
    importantGaps,
    memberExplanations: evaluated.map(({ winCondition, ...member }) => {
      void winCondition;
      return member;
    }),
    proactiveWinCondition,
    minimumProfile: {
      style: request.style,
      expectations: profile.expectations.map((expectation) => expectation.label),
      minimumMet: profile.minimum,
      requiredConditions: profile.requiredJobs,
      met,
      missing,
      satisfied,
    },
    explanation: `Team jobs: ${coveredJobs.join(", ") || "none"}. Important gaps: ${importantGaps.join(", ") || "none"}. ${proactiveWinCondition?.explanation ?? "No credible proactive win condition was found."} ${satisfied ? `The ${request.style} minimum job profile is satisfied.` : `The ${request.style} profile still lacks ${missing.join(", ") || "a credible proactive plan"}.`}`,
  };
}
