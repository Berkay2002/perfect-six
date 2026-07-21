import type {
  AbilityRecord,
  BattleMechanicsContext,
  GeneratorRequest,
  MoveRecord,
  NormalizedCatalog,
  PokemonRecord,
  Weather,
} from "@/lib/types";

type ConcreteWeather = Exclude<Weather, "random">;

export type WeatherSetterSource = {
  memberId: string;
  memberName: string;
  capabilities: string[];
};

export type TeamWeatherPlan = {
  requestedWeather?: ConcreteWeather;
  activeWeather?: ConcreteWeather;
  context: BattleMechanicsContext;
  setterMemberIds: string[];
  beneficiaryMemberIds: string[];
  detrimentMemberIds: string[];
  setters: WeatherSetterSource[];
  supported: boolean;
};

function weatherTerms(weather: ConcreteWeather) {
  if (weather === "rain") return ["rain"];
  if (weather === "sun") return ["sun", "sunnyday"];
  if (weather === "sand") return ["sand"];
  return ["snow", "snowscape", "hail"];
}

export function moveSetsWeather(
  move: MoveRecord,
  weather: ConcreteWeather,
) {
  if (move.effect.weather === null) return false;
  const effect = `${move.effect.weather} ${move.name}`
    .toLowerCase()
    .replaceAll(/[^a-z]/g, "");
  return weatherTerms(weather).some((term) => effect.includes(term));
}

export function requestedWeatherFor(
  request: Pick<GeneratorRequest, "style" | "weather">,
) {
  return request.style === "weather" &&
    request.weather &&
    request.weather !== "random"
    ? request.weather
    : undefined;
}

function abilityFor(
  pokemon: PokemonRecord,
  abilityById: ReadonlyMap<string, AbilityRecord>,
) {
  return abilityById.get(pokemon.build.abilityId);
}

export function weatherPlanForTeam(
  team: readonly PokemonRecord[],
  request: Pick<GeneratorRequest, "style" | "weather">,
  catalog: NormalizedCatalog,
): TeamWeatherPlan {
  const requestedWeather = requestedWeatherFor(request);
  if (!requestedWeather) {
    return {
      context: {},
      setterMemberIds: [],
      beneficiaryMemberIds: [],
      detrimentMemberIds: [],
      setters: [],
      supported: false,
    };
  }

  const moveById = new Map(catalog.moves.map((move) => [move.id, move]));
  const abilityById = new Map(
    catalog.abilities.map((ability) => [ability.id, ability]),
  );
  const setters = team.flatMap((pokemon) => {
    const ability = abilityFor(pokemon, abilityById);
    const capabilities = pokemon.build.moves
      .map((move) => moveById.get(move.id))
      .filter((move): move is MoveRecord => move !== undefined)
      .filter((move) => moveSetsWeather(move, requestedWeather))
      .map((move) => move.name);
    if (ability?.capabilities.weatherSetters?.includes(requestedWeather)) {
      capabilities.push(ability.name);
    }
    return capabilities.length > 0
      ? [{ memberId: pokemon.id, memberName: pokemon.name, capabilities }]
      : [];
  });
  const setterMemberIds = setters.map((setter) => setter.memberId);
  const beneficiaryMemberIds = team
    .filter((pokemon) =>
      abilityFor(pokemon, abilityById)?.capabilities.weatherBenefits?.includes(
        requestedWeather,
      ),
    )
    .map((pokemon) => pokemon.id);
  const detrimentMemberIds = team
    .filter((pokemon) =>
      abilityFor(
        pokemon,
        abilityById,
      )?.capabilities.weatherDetriments.includes(requestedWeather),
    )
    .map((pokemon) => pokemon.id);
  const activeWeather = setters.length > 0 ? requestedWeather : undefined;
  const supported = setterMemberIds.some((setterId) =>
    beneficiaryMemberIds.some((beneficiaryId) => beneficiaryId !== setterId),
  );

  return {
    requestedWeather,
    activeWeather,
    context: activeWeather ? { activeWeather } : {},
    setterMemberIds,
    beneficiaryMemberIds,
    detrimentMemberIds,
    setters,
    supported,
  };
}
