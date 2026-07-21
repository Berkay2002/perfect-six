import { assembleCandidates } from "@/engine/catalog";
import { scoreTeam } from "@/engine/score";
import {
  canonicalSeed,
  createRandom,
  type SeededRandom,
} from "@/lib/random";
import type {
  GeneratorRequest,
  NormalizedCatalog,
  PokemonRecord,
  TeamMember,
  TeamResult,
  TeamWarning,
  Weather,
} from "@/lib/types";

const BEAM_WIDTH = 120;
const QUALITY_BEAM_WIDTH = BEAM_WIDTH / 2;
const CANDIDATE_WIDTH = 220;
const ELITE_BAND = 3;
const SEED_AFFINITY_RANGE = 8;

type BeamState = {
  members: PokemonRecord[];
  heuristic: number;
  seedAffinity: number;
};

export class GeneratorInputError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "GeneratorInputError";
  }
}

function canonicalRequest(request: GeneratorRequest) {
  return JSON.stringify({
    schemaVersion: request.schemaVersion,
    dataVersion: request.dataVersion,
    engineVersion: request.engineVersion,
    seed: canonicalSeed(request.seed),
    style: request.style,
    weather: request.weather ?? null,
    availability: request.availability,
    allowSpecial: request.allowSpecial,
    requireMega: request.requireMega,
    slots: request.slots,
  });
}

function resolveWeather(request: GeneratorRequest): GeneratorRequest {
  if (request.style !== "weather" || request.weather !== "random") return request;
  const values: Weather[] = ["rain", "sun", "sand", "snow"];
  const random = createRandom(`${canonicalRequest(request)}:weather`);
  return { ...request, weather: random.pick(values) };
}

function validateLocks(
  request: GeneratorRequest,
  candidates: PokemonRecord[],
) {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const locked = request.slots
    .filter((id): id is string => id !== null)
    .map((id) => {
      const candidate = byId.get(id);
      if (!candidate) {
        throw new GeneratorInputError(
          `Locked Pokémon "${id}" is unavailable, not a selectable final evolution, or has no validated build.`,
          "unknown-lock",
        );
      }
      return candidate;
    });
  if (new Set(locked.map((pokemon) => pokemon.id)).size !== locked.length) {
    throw new GeneratorInputError(
      "Locked roster contains duplicate species.",
      "duplicate-lock",
    );
  }
  if (locked.filter((pokemon) => pokemon.starter).length > 1) {
    throw new GeneratorInputError(
      "Only one starter can be locked.",
      "multiple-starters",
    );
  }
  if (locked.length === 6 && !locked.some((pokemon) => pokemon.starter)) {
    throw new GeneratorInputError(
      "Six locked non-starters leave no room for required starter.",
      "starter-required",
    );
  }
  const specials = locked.filter(
    (pokemon) => pokemon.specialClasses.length > 0,
  );
  if (!request.allowSpecial && specials.length > 0) {
    throw new GeneratorInputError(
      "Special-class Pokémon locked while special-class toggle is off.",
      "special-disabled",
    );
  }
  if (specials.length > 1) {
    throw new GeneratorInputError(
      "At most one special-class Pokémon is permitted.",
      "too-many-specials",
    );
  }
  if (
    request.requireMega &&
    locked.length === 6 &&
    !locked.some((pokemon) => pokemon.megaFormIds.length > 0)
  ) {
    throw new GeneratorInputError(
      "Six locked Pokémon contain no Mega-capable species.",
      "mega-required",
    );
  }
}

function individualScore(
  pokemon: PokemonRecord,
  request: GeneratorRequest,
) {
  const stats = pokemon.stats;
  const bulk = stats.hp + stats.defense + stats.specialDefense;
  const offense = Math.max(stats.attack, stats.specialAttack) + stats.speed;
  let style = 0;
  if (request.style === "aggressive") style = offense / 5;
  if (request.style === "bulky") style = bulk / 8;
  if (request.style === "balanced") style = (offense + bulk) / 16;
  if (request.style === "weather") style = 5;
  const journey =
    request.availability === "journey" ? pokemon.availability.score * 0.45 : 25;
  return pokemon.battleScore * 0.55 + journey + style;
}

function candidatePool(
  candidates: PokemonRecord[],
  request: GeneratorRequest,
) {
  const sorted = [...candidates].sort((left, right) => {
    const difference =
      individualScore(right, request) - individualScore(left, request);
    return difference || left.id.localeCompare(right.id);
  });
  const protectedCandidates = [
    ...sorted.slice(0, CANDIDATE_WIDTH),
    ...sorted.filter((pokemon) => pokemon.starter).slice(0, 70),
    ...sorted.filter((pokemon) => pokemon.megaFormIds.length > 0).slice(0, 50),
  ];
  return [
    ...new Map(
      protectedCandidates.map((pokemon) => [pokemon.id, pokemon]),
    ).values(),
  ];
}

export function canonicalRosterKey(members: readonly { id: string }[]) {
  return members
    .map((pokemon) => pokemon.id)
    .sort()
    .join("|");
}

export function deduplicateRosterStates<
  T extends { members: readonly { id: string }[] },
>(states: readonly T[]) {
  const byRoster = new Map<string, T>();
  for (const state of states) {
    const key = canonicalRosterKey(state.members);
    if (!byRoster.has(key)) byRoster.set(key, state);
  }
  return [...byRoster.values()];
}

export function selectEliteRoster<T extends { score: { total: number } }>(
  finals: readonly T[],
  random: Pick<SeededRandom, "pick">,
) {
  if (finals.length === 0) {
    throw new Error("Cannot select from an empty finalist collection.");
  }
  const bestScore = Math.max(...finals.map((entry) => entry.score.total));
  const elite = finals.filter(
    (entry) => entry.score.total >= bestScore - ELITE_BAND,
  );
  return { selected: random.pick(elite), bestScore };
}

function compareBeamStates(left: BeamState, right: BeamState) {
  return (
    right.heuristic - left.heuristic ||
    left.members
      .map((pokemon) => pokemon.id)
      .join("|")
      .localeCompare(right.members.map((pokemon) => pokemon.id).join("|"))
  );
}

function pruneBeam(
  states: BeamState[],
  unlockedCount: number,
) {
  states.sort(compareBeamStates);
  const unique = deduplicateRosterStates(states);
  const quality = unique.slice(0, QUALITY_BEAM_WIDTH);
  const qualityKeys = new Set(
    quality.map((state) => canonicalRosterKey(state.members)),
  );
  const exploration = unique
    .filter((state) => !qualityKeys.has(canonicalRosterKey(state.members)))
    .sort((left, right) => {
      const leftAffinity =
        unlockedCount === 0
          ? 0
          : (left.seedAffinity / unlockedCount - 0.5) * SEED_AFFINITY_RANGE;
      const rightAffinity =
        unlockedCount === 0
          ? 0
          : (right.seedAffinity / unlockedCount - 0.5) * SEED_AFFINITY_RANGE;
      const seededDifference =
        right.heuristic + rightAffinity - (left.heuristic + leftAffinity);
      return seededDifference || compareBeamStates(left, right);
    })
    .slice(0, BEAM_WIDTH - quality.length);
  return [...quality, ...exploration];
}

function hardValidPartial(
  members: PokemonRecord[],
  remaining: number,
  request: GeneratorRequest,
) {
  if (new Set(members.map((pokemon) => pokemon.id)).size !== members.length) {
    return false;
  }
  const starters = members.filter((pokemon) => pokemon.starter).length;
  if (starters > 1 || (remaining === 0 && starters !== 1)) return false;
  if (starters === 0 && remaining === 0) return false;

  const specials = members.filter(
    (pokemon) => pokemon.specialClasses.length > 0,
  ).length;
  if ((!request.allowSpecial && specials > 0) || specials > 1) return false;

  const megas = members.filter(
    (pokemon) => pokemon.megaFormIds.length > 0,
  ).length;
  if (request.requireMega && remaining === 0 && megas === 0) return false;
  return true;
}

function partialHeuristic(
  members: PokemonRecord[],
  request: GeneratorRequest,
) {
  const typeDiversity = new Set(members.flatMap((pokemon) => pokemon.types)).size;
  const roleDiversity = new Set(members.flatMap((pokemon) => pokemon.roles)).size;
  const quality =
    members.reduce(
      (sum, pokemon) =>
        sum +
        pokemon.battleScore * 0.4 +
        pokemon.availability.score * 0.35 +
        Math.max(pokemon.stats.attack, pokemon.stats.specialAttack) * 0.08 +
        pokemon.stats.speed * 0.05,
      0,
    ) / Math.max(1, members.length);
  return (
    quality +
    typeDiversity * 1.4 +
    roleDiversity * 1.2 +
    (members.some((pokemon) => pokemon.starter) ? 2 : 0) +
    (request.requireMega &&
    members.some((pokemon) => pokemon.megaFormIds.length > 0)
      ? 2
      : 0)
  );
}

function asMembers(
  roster: PokemonRecord[],
  request: GeneratorRequest,
  catalog: NormalizedCatalog,
): TeamMember[] {
  const megaCandidate = request.requireMega
    ? [...roster]
        .filter((pokemon) => pokemon.megaFormIds.length > 0)
        .sort(
          (left, right) =>
            right.battleScore - left.battleScore ||
            left.id.localeCompare(right.id),
        )[0]
    : undefined;
  const itemById = new Map(catalog.items.map((item) => [item.id, item]));
  return roster.map((pokemon, index) => {
    const mega = pokemon.id === megaCandidate?.id;
    let build = pokemon.build;
    if (mega) {
      const megaItems = catalog.items
        .filter(
          (item) =>
            item.megaEvolves === pokemon.id &&
            item.megaStone !== null &&
            pokemon.megaFormIds.includes(item.megaStone),
        )
        .sort((left, right) => left.id.localeCompare(right.id));
      const sourcedMegaBuild = catalog.builds
        .filter(
          (candidate) =>
            candidate.speciesId === pokemon.id &&
            megaItems.some((item) => item.id === candidate.heldItemId),
        )
        .sort((left, right) => left.id.localeCompare(right.id))[0];
      if (sourcedMegaBuild) {
        build = sourcedMegaBuild;
      } else if (megaItems[0]) {
        build = {
          ...pokemon.build,
          id: `${pokemon.build.id}:mega`,
          heldItemId: megaItems[0].id,
          heldItem: itemById.get(megaItems[0].id)?.name ?? megaItems[0].name,
        };
      }
    }
    const materialized = { ...pokemon, build };
    return {
      ...materialized,
      slot: index,
      selectedRole: pokemon.roles[0] ?? "Flexible",
      mega,
      gamePlan: createGamePlan(materialized),
    };
  });
}

function createGamePlan(pokemon: PokemonRecord) {
  const damageMoves = pokemon.build.moves.filter(
    (move) => move.category !== "Status",
  );
  const utilityMoves = pokemon.build.moves.filter(
    (move) => move.category === "Status",
  );
  if (utilityMoves.length === 0) {
    return `Use ${damageMoves[0]?.name ?? "its strongest sourced attack"} for reliable pressure; switch when matchup turns poor.`;
  }
  return `Use ${utilityMoves[0].name} when safe, then pressure with ${damageMoves[0]?.name ?? "a sourced damaging move"}.`;
}

export function materializeTeamResult(
  roster: PokemonRecord[],
  request: GeneratorRequest,
  catalog: NormalizedCatalog,
  warnings: TeamWarning[] = [],
): TeamResult {
  return {
    members: asMembers(roster, request, catalog) as TeamResult["members"],
    score: scoreTeam(roster, request, catalog),
    warnings,
    provenance: {
      dataVersion: catalog.manifest.dataVersion,
      engineVersion: catalog.manifest.engineVersion,
      generatedAt: catalog.manifest.generatedAt,
      sources: catalog.manifest.sources.map((source) => source.url),
      verified: catalog.manifest.dependencyScan === "all-manifest-archives",
    },
  };
}

export function generateTeam(
  originalRequest: GeneratorRequest,
  catalog: NormalizedCatalog,
): TeamResult {
  const request = resolveWeather(originalRequest);
  const requestKey = canonicalRequest(request);
  const random = createRandom(requestKey);
  const candidates = assembleCandidates(
    catalog,
    request.style,
    request.weather,
  );
  if (candidates.length < 6) {
    throw new GeneratorInputError(
      "Fewer than six selectable Pokémon have validated source-backed builds.",
      "insufficient-catalog",
    );
  }
  validateLocks(request, candidates);
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const pool = candidatePool(candidates, request);
  const affinityById = new Map(
    candidates.map((candidate) => [
      candidate.id,
      createRandom(`${requestKey}:affinity:${candidate.id}`).next(),
    ]),
  );
  let beam: BeamState[] = [{ members: [], heuristic: 0, seedAffinity: 0 }];
  for (let slot = 0; slot < 6; slot += 1) {
    const lockedId = request.slots[slot];
    const unlockedCount = request.slots
      .slice(0, slot + 1)
      .filter((id) => id === null).length;
    const options = lockedId ? [byId.get(lockedId)!] : pool;
    const next: BeamState[] = [];
    for (const state of beam) {
      for (const pokemon of options) {
        const members = [...state.members, pokemon];
        if (!hardValidPartial(members, 5 - slot, request)) continue;
        next.push({
          members,
          heuristic: partialHeuristic(members, request),
          seedAffinity:
            state.seedAffinity +
            (lockedId ? 0 : (affinityById.get(pokemon.id) ?? 0.5)),
        });
      }
    }
    beam = pruneBeam(next, unlockedCount);
    if (beam.length === 0) {
      throw new GeneratorInputError(
        "Locks and toggles produce no legal six-Pokémon team.",
        "impossible-request",
      );
    }
  }

  const finals = deduplicateRosterStates(beam)
    .map((state) => ({
      roster: state.members,
      score: scoreTeam(state.members, request, catalog),
    }))
    .sort(
      (left, right) =>
        right.score.total - left.score.total ||
        left.roster
          .map((pokemon) => pokemon.id)
          .join("|")
          .localeCompare(right.roster.map((pokemon) => pokemon.id).join("|")),
    );
  const { selected, bestScore } = selectEliteRoster(finals, random);
  const warnings: TeamWarning[] = [];
  if (selected.score.total < 85) {
    warnings.push({
      code: "below-target",
      severity: "warning",
      message:
        selected.score.total === bestScore
          ? `Best legal result scores ${bestScore}/100, below 85 target. Locks or catalog limits prevented stronger result.`
          : `Seeded result scores ${selected.score.total}/100, below 85 target; the best searched result scores ${bestScore}/100.`,
    });
  }

  return materializeTeamResult(selected.roster, request, catalog, warnings);
}
