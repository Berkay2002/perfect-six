import type {
  AvailabilityRecord,
  BuildTemplate,
  NormalizedCatalog,
  PokemonRecord,
  SpeciesFormId,
  TeamStyle,
  Weather,
} from "@/lib/types";
import { abilityBuildValue, abilityRatingValue } from "@/engine/ability";
import { itemBuildValue } from "@/engine/item";
import { movePackageQualityForBuild } from "@/engine/move";

const clampScore = (value: number) => Math.max(0, Math.min(100, value));
const candidateCache = new WeakMap<
  NormalizedCatalog,
  Map<string, PokemonRecord[]>
>();

function buildStyleScore(
  build: BuildTemplate,
  pokemon: Pick<
    PokemonRecord,
    "finalEvolution" | "roles" | "stats" | "types"
  >,
  style: TeamStyle,
  weather: Weather | undefined,
  catalog: NormalizedCatalog,
) {
  const moveById = new Map(catalog.moves.map((move) => [move.id, move]));
  const moves = build.moves
    .map((move) => moveById.get(move.id))
    .filter((move) => move !== undefined);
  const damaging = moves.filter((move) => move.category !== "Status");
  const utility = moves.filter(
    (move) =>
      move.category === "Status" ||
      move.effect.healingFraction !== null ||
      move.effect.sideCondition !== null ||
      move.effect.selfSwitch,
  );
  const weatherMatches = weather
    ? moves.filter((move) =>
        `${move.effect.weather ?? ""} ${move.name}`
          .toLowerCase()
          .includes(weather),
      ).length
    : 0;
  const ability = catalog.abilities.find(
    (record) => record.id === build.abilityId,
  );
  const abilityWeatherMatch =
    style === "weather" &&
    weather !== undefined &&
    weather !== "random" &&
    ability?.capabilities.weather.includes(weather)
      ? 1
      : 0;
  const abilityValue = abilityBuildValue(ability, { style, weather });
  const item = catalog.items.find((record) => record.id === build.heldItemId);
  const itemValue = itemBuildValue(
    { ...pokemon, build },
    item,
    { style },
    catalog,
  );
  const moveQuality = movePackageQualityForBuild(
    { ...pokemon, build },
    catalog,
    { style, weather },
  );

  switch (style) {
    case "aggressive":
      return abilityValue + itemValue + moveQuality.score * 0.65 + damaging.length * 8;
    case "bulky":
      return abilityValue + itemValue + moveQuality.score * 0.55 + utility.length * 9 + moves.filter((move) => move.effect.healingFraction).length * 12;
    case "weather":
      return abilityValue + itemValue + moveQuality.score * 0.5 + (weatherMatches + abilityWeatherMatch) * 18 + utility.length * 4;
    case "random":
      return abilityValue + itemValue + moveQuality.score * 0.25;
    case "balanced":
    default:
      return abilityValue + itemValue + moveQuality.score * 0.6 + damaging.length * 5 + utility.length * 7;
  }
}

function fallbackAvailability(speciesId: SpeciesFormId): AvailabilityRecord {
  return {
    speciesId,
    difficulty: "Late game",
    stage: "Late",
    evolutionLine: "Final evolution",
    guidance: "No verified acquisition record found.",
    score: 25,
    evidence: [
      {
        kind: "unknown",
        sourcePath: "generated-catalog",
        summary: "Missing availability record; scored conservatively.",
      },
    ],
  };
}

export function assembleCandidates(
  catalog: NormalizedCatalog,
  style: TeamStyle,
  weather?: Weather,
  options: {
    finalOnly?: boolean;
    speciesIds?: ReadonlySet<SpeciesFormId>;
  } = {},
) {
  let catalogCache = candidateCache.get(catalog);
  if (!catalogCache) {
    catalogCache = new Map();
    candidateCache.set(catalog, catalogCache);
  }
  const speciesKey = options.speciesIds
    ? [...options.speciesIds].sort().join(",")
    : "*";
  const cacheKey = `${style}|${weather ?? "none"}|${options.finalOnly !== false ? "final" : "all"}|${speciesKey}`;
  const cached = catalogCache.get(cacheKey);
  if (cached) return cached;
  const availability = new Map(
    catalog.availability.map((record) => [record.speciesId, record]),
  );
  const roles = new Map(
    catalog.roles.map((record) => [record.speciesId, record]),
  );
  const builds = new Map<SpeciesFormId, BuildTemplate[]>();
  const itemById = new Map(catalog.items.map((item) => [item.id, item]));
  const abilityById = new Map(
    catalog.abilities.map((ability) => [ability.id, ability]),
  );
  for (const build of catalog.builds) {
    const current = builds.get(build.speciesId) ?? [];
    current.push(build);
    builds.set(build.speciesId, current);
  }

  const candidates = catalog.species
    .filter(
      (species) =>
        (!options.speciesIds || options.speciesIds.has(species.id)) &&
        (options.finalOnly !== false ? species.finalEvolution : true) &&
        !species.battleOnly &&
        (builds.get(species.id)?.length ?? 0) > 0,
    )
    .map((species): PokemonRecord => {
      const role = roles.get(species.id);
      const pokemonContext = {
        finalEvolution: species.finalEvolution,
        roles: role?.roles ?? ["Flexible"],
        stats: species.stats,
        types: species.types,
      };
      const speciesBuilds = builds.get(species.id) ?? [];
      const nonMegaBuilds = speciesBuilds.filter(
        (build) => !itemById.get(build.heldItemId)?.megaStone,
      );
      const selectedBuild = [
        ...(nonMegaBuilds.length > 0 ? nonMegaBuilds : speciesBuilds),
      ].sort(
        (left, right) => {
          const scoreDifference =
            buildStyleScore(right, pokemonContext, style, weather, catalog) -
            buildStyleScore(left, pokemonContext, style, weather, catalog);
          return scoreDifference || left.id.localeCompare(right.id);
        },
      )[0];
      const rawBattleScore = role?.battleScore ?? 50;
      const ability = abilityById.get(selectedBuild.abilityId);
      const selectedItem = itemById.get(selectedBuild.heldItemId);
      const battleScore = clampScore(
        Math.round(
          rawBattleScore +
            abilityRatingValue(ability) +
            itemBuildValue(
              { ...pokemonContext, build: selectedBuild },
              selectedItem,
              { style },
              catalog,
            ) *
              0.25,
        ),
      );
      return {
        ...species,
        roles: role?.roles ?? ["Flexible"],
        battleScore,
        availability:
          availability.get(species.id) ?? fallbackAvailability(species.id),
        build: selectedBuild,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  catalogCache.set(cacheKey, candidates);
  return candidates;
}
