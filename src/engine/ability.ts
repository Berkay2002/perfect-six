import type {
  AbilityRecord,
  BattleMechanicsContext,
  GeneratorRequest,
  NormalizedCatalog,
  PokemonRecord,
} from "@/lib/types";
import { weatherPlanForTeam, type TeamWeatherPlan } from "@/engine/weather";

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
  weatherSetters: [] as string[],
  weatherBenefits: [] as string[],
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
  context: BattleMechanicsContext = {},
) {
  if (!ability) return 0;
  const capabilities = ability.capabilities ?? emptyCapabilities;
  const requestedWeather =
    request.style === "weather" &&
    request.weather &&
    request.weather !== "random"
      ? request.weather
      : undefined;
  const setterMatch =
    requestedWeather &&
    capabilities.weatherSetters?.includes(requestedWeather)
      ? WEATHER_MATCH_WEIGHT
      : 0;
  const activeBenefit =
    requestedWeather &&
    context.activeWeather === requestedWeather &&
    capabilities.weatherBenefits?.includes(requestedWeather)
      ? WEATHER_MATCH_WEIGHT
      : 0;
  const weatherDetriment =
    requestedWeather &&
    context.activeWeather === requestedWeather &&
    capabilities.weatherDetriments?.includes(requestedWeather)
      ? WEATHER_MATCH_WEIGHT
      : 0;
  return (
    abilityRatingValue(ability) +
    capabilities.immunities.length * IMMUNITY_WEIGHT +
    capabilities.absorptions.length * ABSORPTION_WEIGHT +
    Math.max(setterMatch, activeBenefit) -
    weatherDetriment
  );
}

export function abilityFitFacts(
  ability: AbilityRecord | undefined,
  request: Pick<GeneratorRequest, "style" | "weather">,
  context: BattleMechanicsContext = {},
) {
  if (!ability) return [];
  const capabilities = ability.capabilities ?? emptyCapabilities;
  const facts: string[] = [];
  if (ability.rating !== null) facts.push(`sourced rating ${ability.rating}`);
  if (capabilities.immunities.length > 0) {
    facts.push(`${capabilities.immunities.join("/")} immunity`);
  }
  if (capabilities.absorptions.length > 0) {
    facts.push(`${capabilities.absorptions.join("/")} absorption`);
  }
  const requestedWeather =
    request.style === "weather" &&
    request.weather &&
    request.weather !== "random"
      ? request.weather
      : undefined;
  if (
    requestedWeather &&
    capabilities.weatherSetters?.includes(requestedWeather)
  ) {
    facts.push(`${requestedWeather} interaction (setter)`);
  }
  if (
    requestedWeather &&
    context.activeWeather === requestedWeather &&
    capabilities.weatherBenefits?.includes(requestedWeather)
  ) {
    facts.push(`${requestedWeather} interaction while active`);
  }
  const detrimentalWeather = capabilities.weatherDetriments?.filter(
    (weather) =>
      requestedWeather === weather && context.activeWeather === weather,
  );
  if (detrimentalWeather?.length) {
    facts.push(`${detrimentalWeather.join("/")} drawback`);
  }
  return facts;
}

export function abilityQualityForTeam(
  team: PokemonRecord[],
  request: GeneratorRequest,
  catalog: NormalizedCatalog,
  weatherPlan: TeamWeatherPlan = weatherPlanForTeam(team, request, catalog),
) {
  const byId = new Map(
    catalog.abilities.map((ability) => [ability.id, ability]),
  );
  const selected = team.map((pokemon) => byId.get(pokemon.build.abilityId));
  const values = selected.map((ability) =>
    abilityBuildValue(ability, request, weatherPlan.context),
  );
  const contribution = Math.round(
    (values.reduce((sum, value) => sum + value, 0) /
      Math.max(1, values.length)) *
      TEAM_CONTRIBUTION_WEIGHT,
  );
  const supported = selected.filter(
    (ability): ability is AbilityRecord =>
      abilityFitFacts(ability, request, weatherPlan.context).length > 0,
  );

  if (supported.length === 0) {
    return {
      contribution,
      explanation:
        "No selected ability has a sourced rating or supported team capability, so ability quality remains neutral.",
    };
  }

  const details = supported.map(
    (ability) =>
      `${ability.name}: ${abilityFitFacts(ability, request, weatherPlan.context).join(", ")}`,
  );
  return {
    contribution,
    explanation: `Selected abilities have these sourced battle effects: ${details.join("; ")}.`,
  };
}
