import type {
  AbilityRecord,
  GeneratorRequest,
  NormalizedCatalog,
  PokemonRecord,
} from "@/lib/types";

const POSITIVE_RATING_WEIGHT = 4;
const DETRIMENTAL_RATING_WEIGHT = 25;
const IMMUNITY_WEIGHT = 2;
const ABSORPTION_WEIGHT = 2;
const WEATHER_MATCH_WEIGHT = 4;
const TEAM_CONTRIBUTION_WEIGHT = 0.25;

const emptyCapabilities = {
  immunities: [] as string[],
  absorptions: [] as string[],
  weather: [] as string[],
  weatherDetriments: [] as string[],
};

export function abilityRatingValue(ability: AbilityRecord | undefined) {
  const rating = ability?.rating;
  if (rating === null || rating === undefined) return 0;
  return rating < 0
    ? rating * DETRIMENTAL_RATING_WEIGHT
    : rating * POSITIVE_RATING_WEIGHT;
}

export function abilityBuildValue(
  ability: AbilityRecord | undefined,
  request: Pick<GeneratorRequest, "style" | "weather">,
) {
  if (!ability) return 0;
  const capabilities = ability.capabilities ?? emptyCapabilities;
  const weatherMatch =
    request.style === "weather" &&
    request.weather &&
    request.weather !== "random" &&
    capabilities.weather.includes(request.weather)
      ? WEATHER_MATCH_WEIGHT
      : 0;
  const weatherDetriment =
    request.style === "weather" &&
    request.weather &&
    request.weather !== "random" &&
    capabilities.weatherDetriments?.includes(request.weather)
      ? WEATHER_MATCH_WEIGHT
      : 0;
  return (
    abilityRatingValue(ability) +
    capabilities.immunities.length * IMMUNITY_WEIGHT +
    capabilities.absorptions.length * ABSORPTION_WEIGHT +
    weatherMatch -
    weatherDetriment
  );
}

export function abilityQualityForTeam(
  team: PokemonRecord[],
  request: GeneratorRequest,
  catalog: NormalizedCatalog,
) {
  const byId = new Map(
    catalog.abilities.map((ability) => [ability.id, ability]),
  );
  const selected = team.map((pokemon) => byId.get(pokemon.build.abilityId));
  const values = selected.map((ability) =>
    abilityBuildValue(ability, request),
  );
  const contribution = Math.round(
    (values.reduce((sum, value) => sum + value, 0) /
      Math.max(1, values.length)) *
      TEAM_CONTRIBUTION_WEIGHT,
  );
  const supported = selected.filter(
    (ability): ability is AbilityRecord => {
      if (!ability) return false;
      const capabilities = ability.capabilities ?? emptyCapabilities;
      return (
        ability.rating !== null ||
        capabilities.immunities.length > 0 ||
        capabilities.absorptions.length > 0 ||
        capabilities.weather.some(
          (weather) =>
            request.style === "weather" && request.weather === weather,
        ) ||
        capabilities.weatherDetriments?.some(
          (weather) =>
            request.style === "weather" && request.weather === weather,
        )
      );
    },
  );

  if (supported.length === 0) {
    return {
      contribution,
      explanation:
        "No selected ability has a sourced rating or supported team capability, so ability quality remains neutral.",
    };
  }

  const details = supported.map((ability) => {
    const capabilities = ability.capabilities ?? emptyCapabilities;
    const facts = [];
    if (ability.rating !== null) facts.push(`sourced rating ${ability.rating}`);
    if (capabilities.immunities.length > 0) {
      facts.push(`${capabilities.immunities.join("/")} immunity`);
    }
    if (capabilities.absorptions.length > 0) {
      facts.push(`${capabilities.absorptions.join("/")} absorption`);
    }
    const relevantWeather = capabilities.weather.filter(
      (weather) =>
        request.style === "weather" && request.weather === weather,
    );
    if (relevantWeather.length > 0) {
      facts.push(`${relevantWeather.join("/")} interaction`);
    }
    const detrimentalWeather = capabilities.weatherDetriments?.filter(
      (weather) =>
        request.style === "weather" && request.weather === weather,
    );
    if (detrimentalWeather?.length) {
      facts.push(`${detrimentalWeather.join("/")} drawback`);
    }
    return `${ability.name}: ${facts.join(", ")}`;
  });
  const direction =
    contribution > 0
      ? `adds ${contribution}`
      : contribution < 0
        ? `subtracts ${Math.abs(contribution)}`
        : "adds no";

  return {
    contribution,
    explanation: `Selected abilities ${direction} battle-quality points. ${details.join("; ")}.`,
  };
}
