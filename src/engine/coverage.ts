import type {
  AbilityRecord,
  DefensiveTypeAnswer,
  NormalizedCatalog,
  OffensiveTypeAnswer,
  PokemonRecord,
  RoleCoverageQuality,
  UncoveredTypeWeakness,
} from "@/lib/types";

const clamp = (value: number) => Math.max(0, Math.min(100, value));

export function sourcedTypeMultiplier(
  pokemon: PokemonRecord,
  attackType: string,
  catalog: NormalizedCatalog,
  immunities: readonly string[] = [],
  absorptions: readonly string[] = [],
) {
  if (absorptions.includes(attackType) || immunities.includes(attackType)) {
    return 0;
  }
  return pokemon.types.reduce(
    (multiplier, defenderType) =>
      multiplier * (catalog.typeChart[attackType]?.[defenderType] ?? 1),
    1,
  );
}

export function incomingTypeMultiplier(
  pokemon: PokemonRecord,
  attackType: string,
  catalog: NormalizedCatalog,
  ability: AbilityRecord | undefined,
) {
  return sourcedTypeMultiplier(
    pokemon,
    attackType,
    catalog,
    ability?.capabilities.immunities,
    ability?.capabilities.absorptions,
  );
}

function roleScore(team: PokemonRecord[]) {
  const roles = new Set(team.flatMap((pokemon) => pokemon.roles));
  const physical = team.filter((pokemon) =>
    pokemon.build.moves.some((move) => move.category === "Physical"),
  ).length;
  const special = team.filter((pokemon) =>
    pokemon.build.moves.some((move) => move.category === "Special"),
  ).length;
  const balance = Math.min(physical, special) / Math.max(1, team.length / 2);
  return {
    roles: [...roles].sort(),
    score: clamp(roles.size * 14 + balance * 30),
  };
}

function offensiveCoverage(
  team: PokemonRecord[],
  catalog: NormalizedCatalog,
) {
  const moveById = new Map(catalog.moves.map((move) => [move.id, move]));
  const defendingTypes = [
    ...new Set(
      catalog.species.flatMap((pokemon) => pokemon.types),
    ),
  ].sort();
  const answers: OffensiveTypeAnswer[] = [];
  const uncovered: string[] = [];

  for (const defendingType of defendingTypes) {
    const memberAnswers = team.flatMap((pokemon) => {
      const candidates = pokemon.build.moves.flatMap((buildMove) => {
        const move = moveById.get(buildMove.id);
        if (!move || move.category === "Status") return [];
        const effectiveness =
          catalog.typeChart[move.type]?.[defendingType] ?? 1;
        if (effectiveness <= 1) return [];
        return [
          {
            defendingType,
            memberId: pokemon.id,
            memberName: pokemon.name,
            moveId: move.id,
            moveName: move.name,
            moveType: move.type,
            effectiveness,
            power: move.power ?? 0,
            accuracy: move.accuracy ?? 0,
          },
        ];
      });
      candidates.sort(
        (left, right) =>
          right.effectiveness - left.effectiveness ||
          right.power - left.power ||
          right.accuracy - left.accuracy ||
          left.moveName.localeCompare(right.moveName),
      );
      return candidates.slice(0, 1);
    });
    if (memberAnswers.length === 0) {
      uncovered.push(defendingType);
      continue;
    }
    answers.push(
      ...memberAnswers.map((answer) => ({
        defendingType: answer.defendingType,
        memberId: answer.memberId,
        memberName: answer.memberName,
        moveId: answer.moveId,
        moveName: answer.moveName,
        moveType: answer.moveType,
        effectiveness: answer.effectiveness,
      })),
    );
  }
  answers.sort(
    (left, right) =>
      left.defendingType.localeCompare(right.defendingType) ||
      left.memberName.localeCompare(right.memberName) ||
      left.moveName.localeCompare(right.moveName),
  );
  const coveredTypes = defendingTypes.length - uncovered.length;
  const coverageValue = defendingTypes.reduce((sum, defendingType) => {
    const independentAnswers = answers.filter(
      (answer) => answer.defendingType === defendingType,
    ).length;
    if (independentAnswers === 0) return sum;
    return sum + (independentAnswers === 1 ? 0.85 : 1);
  }, 0);

  return {
    answers,
    uncovered,
    score:
      defendingTypes.length === 0
        ? 50
        : Math.round((coverageValue / defendingTypes.length) * 100),
    coveredTypes,
    totalTypes: defendingTypes.length,
  };
}

function defensiveCoverageSource(
  pokemon: PokemonRecord,
  attackType: string,
  catalog: NormalizedCatalog,
  ability: AbilityRecord | undefined,
) {
  if (ability?.capabilities.absorptions.includes(attackType)) {
    return {
      relation: "absorption" as const,
      sourceKind: "ability" as const,
      sourceName: ability.name,
    };
  }
  if (ability?.capabilities.immunities.includes(attackType)) {
    return {
      relation: "immunity" as const,
      sourceKind: "ability" as const,
      sourceName: ability.name,
    };
  }
  const multiplier = incomingTypeMultiplier(
    pokemon,
    attackType,
    catalog,
    ability,
  );
  const protectingTypes = pokemon.types.filter((type) => {
    const typeMultiplier = catalog.typeChart[attackType]?.[type] ?? 1;
    return multiplier === 0 ? typeMultiplier === 0 : typeMultiplier < 1;
  });
  return {
    relation:
      multiplier === 0 ? ("immunity" as const) : ("resistance" as const),
    sourceKind: "type" as const,
    sourceName: protectingTypes.join("/") || pokemon.types.join("/"),
  };
}

function defensiveCoverage(
  team: PokemonRecord[],
  catalog: NormalizedCatalog,
) {
  const abilityById = new Map(
    catalog.abilities.map((ability) => [ability.id, ability]),
  );
  const attackTypes = Object.keys(catalog.typeChart).sort();
  const answers: DefensiveTypeAnswer[] = [];
  const uncovered: UncoveredTypeWeakness[] = [];
  let totalWeaknessWeight = 0;
  let coveredWeaknessValue = 0;
  let totalWeaknesses = 0;
  let coveredWeaknesses = 0;

  for (const [vulnerableIndex, vulnerable] of team.entries()) {
    const vulnerableAbility = abilityById.get(vulnerable.build.abilityId);
    for (const attackType of attackTypes) {
      const incomingMultiplier = incomingTypeMultiplier(
        vulnerable,
        attackType,
        catalog,
        vulnerableAbility,
      );
      if (incomingMultiplier <= 1) continue;

      totalWeaknesses += 1;
      const weaknessWeight = Math.max(1, Math.log2(incomingMultiplier));
      totalWeaknessWeight += weaknessWeight;
      const providers = team.flatMap((provider, providerIndex) => {
        if (providerIndex === vulnerableIndex) return [];
        const ability = abilityById.get(provider.build.abilityId);
        const providerMultiplier = incomingTypeMultiplier(
          provider,
          attackType,
          catalog,
          ability,
        );
        if (providerMultiplier >= 1) return [];
        const source = defensiveCoverageSource(
          provider,
          attackType,
          catalog,
          ability,
        );
        return [
          {
            provider,
            multiplier: providerMultiplier,
            ...source,
          },
        ];
      });
      providers.sort(
        (left, right) =>
          left.multiplier - right.multiplier ||
          left.provider.name.localeCompare(right.provider.name) ||
          left.provider.id.localeCompare(right.provider.id),
      );
      const best = providers[0];
      if (!best) {
        uncovered.push({
          attackType,
          memberId: vulnerable.id,
          memberName: vulnerable.name,
          incomingMultiplier,
        });
        continue;
      }

      coveredWeaknesses += 1;
      const protectionQuality =
        best.multiplier === 0 ? 1 : best.multiplier <= 0.25 ? 0.9 : 0.8;
      const redundancyBonus = Math.min(0.1, (providers.length - 1) * 0.05);
      coveredWeaknessValue +=
        weaknessWeight *
        Math.min(1, 0.8 + protectionQuality * 0.15 + redundancyBonus);
      answers.push(
        ...providers.map((provider) => ({
          attackType,
          vulnerableMemberId: vulnerable.id,
          vulnerableMemberName: vulnerable.name,
          coveringMemberId: provider.provider.id,
          coveringMemberName: provider.provider.name,
          relation: provider.relation,
          sourceKind: provider.sourceKind,
          sourceName: provider.sourceName,
          incomingMultiplier: provider.multiplier,
        })),
      );
    }
  }

  answers.sort(
    (left, right) =>
      left.vulnerableMemberName.localeCompare(right.vulnerableMemberName) ||
      left.attackType.localeCompare(right.attackType) ||
      left.coveringMemberName.localeCompare(right.coveringMemberName),
  );
  uncovered.sort(
    (left, right) =>
      right.incomingMultiplier - left.incomingMultiplier ||
      left.memberName.localeCompare(right.memberName) ||
      left.attackType.localeCompare(right.attackType),
  );

  return {
    answers,
    uncovered,
    score:
      totalWeaknessWeight === 0
        ? 100
        : Math.round(
            clamp((coveredWeaknessValue / totalWeaknessWeight) * 100),
          ),
    coveredWeaknesses,
    totalWeaknesses,
  };
}

export function roleCoverageQualityForTeam(
  team: PokemonRecord[],
  catalog: NormalizedCatalog,
): RoleCoverageQuality {
  const roles = roleScore(team);
  const offense = offensiveCoverage(team, catalog);
  const defense = defensiveCoverage(team, catalog);
  const score = Math.round(
    clamp(roles.score * 0.4 + offense.score * 0.3 + defense.score * 0.3),
  );
  const examples = defense.answers
    .slice(0, 6)
    .map(
      (answer) =>
        `${answer.coveringMemberName}'s ${answer.sourceName} ${answer.relation} covers ${answer.vulnerableMemberName}'s ${answer.attackType} weakness`,
    );
  const defensiveSummary =
    defense.totalWeaknesses === 0
      ? "No sourced type weakness needs a teammate answer."
      : `${defense.coveredWeaknesses}/${defense.totalWeaknesses} member weaknesses have a resistant, immune, or absorbing teammate${examples.length > 0 ? `, including ${examples.join("; ")}` : ""}.`;
  const offensiveSummary =
    offense.totalTypes === 0
      ? "No sourced type chart was available."
      : `${offense.coveredTypes}/${offense.totalTypes} actual defending types have a super-effective damaging move${offense.uncovered.length > 0 ? `; missing answers for ${offense.uncovered.join(", ")}` : ""}.`;

  return {
    score,
    roleScore: Math.round(roles.score),
    offensiveScore: offense.score,
    defensiveScore: defense.score,
    roles: roles.roles,
    offensiveAnswers: offense.answers,
    defensiveAnswers: defense.answers,
    uncoveredDefendingTypes: offense.uncovered,
    uncoveredWeaknesses: defense.uncovered,
    explanation: `Role coverage scores ${score}/100: ${roles.roles.length} distinct sourced roles score ${Math.round(roles.score)}/100. Offensive answers score ${offense.score}/100: ${offensiveSummary} Teammate protection scores ${defense.score}/100: ${defensiveSummary}`,
  };
}
