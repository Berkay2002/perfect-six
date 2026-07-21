import type {
  AvailabilityRecord,
  BuildTemplate,
  NormalizedCatalog,
  PokemonRecord,
  SpeciesFormId,
  TeamStyle,
  Weather,
} from "@/lib/types";

const clampScore = (value: number) => Math.max(0, Math.min(100, value));

function buildStyleScore(
  build: BuildTemplate,
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

  switch (style) {
    case "aggressive":
      return damaging.length * 8 + damaging.reduce((sum, move) => sum + (move.power ?? 0), 0) / 25;
    case "bulky":
      return utility.length * 9 + moves.filter((move) => move.effect.healingFraction).length * 12;
    case "weather":
      return weatherMatches * 18 + utility.length * 4;
    case "random":
      return 0;
    case "balanced":
    default:
      return damaging.length * 5 + utility.length * 7;
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
) {
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

  return catalog.species
    .filter(
      (species) =>
        species.finalEvolution &&
        !species.battleOnly &&
        (builds.get(species.id)?.length ?? 0) > 0,
    )
    .map((species): PokemonRecord => {
      const role = roles.get(species.id);
      const speciesBuilds = builds.get(species.id) ?? [];
      const nonMegaBuilds = speciesBuilds.filter(
        (build) => !itemById.get(build.heldItemId)?.megaStone,
      );
      const selectedBuild = [
        ...(nonMegaBuilds.length > 0 ? nonMegaBuilds : speciesBuilds),
      ].sort(
        (left, right) => {
          const scoreDifference =
            buildStyleScore(right, style, weather, catalog) -
            buildStyleScore(left, style, weather, catalog);
          return scoreDifference || left.id.localeCompare(right.id);
        },
      )[0];
      const rawBattleScore = role?.battleScore ?? 50;
      const abilityRating =
        abilityById.get(selectedBuild.abilityId)?.rating ?? 0;
      const battleScore = clampScore(
        rawBattleScore + Math.min(0, abilityRating) * 25,
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
}
