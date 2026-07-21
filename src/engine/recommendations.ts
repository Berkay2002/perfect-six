import { assembleCandidates } from "@/engine/catalog";
import { materializeTeamResult } from "@/engine/generate";
import { pokemonRecordFromMember } from "@/engine/member";
import { ownedSlotsForRequest } from "@/lib/request";
import type {
  GeneratedTeamResult,
  GeneratorRequest,
  NormalizedCatalog,
  PokemonRecord,
  TeamRecommendation,
  TeamResult,
} from "@/lib/types";

export function recommendationChangeCap(ownedCount: number) {
  if (ownedCount >= 6) return 3;
  if (ownedCount === 5) return 2;
  if (ownedCount === 4) return 1;
  return 0;
}

function compositionCount(roster: PokemonRecord[]) {
  return {
    starters: roster.filter((pokemon) => pokemon.starter).length,
    specials: roster.filter((pokemon) => pokemon.specialClasses.length > 0)
      .length,
    megas: roster.filter((pokemon) => pokemon.megaFormIds.length > 0).length,
  };
}

export function doesNotWorsenComposition(
  current: PokemonRecord[],
  next: PokemonRecord[],
  request: GeneratorRequest,
) {
  const currentCounts = new Map<string, number>();
  const nextCounts = new Map<string, number>();
  for (const pokemon of current) {
    currentCounts.set(pokemon.id, (currentCounts.get(pokemon.id) ?? 0) + 1);
  }
  for (const pokemon of next) {
    nextCounts.set(pokemon.id, (nextCounts.get(pokemon.id) ?? 0) + 1);
  }
  for (const [id, count] of nextCounts) {
    if (count > Math.max(1, currentCounts.get(id) ?? 0)) return false;
  }
  const before = compositionCount(current);
  const after = compositionCount(next);
  if (after.starters > Math.max(1, before.starters)) return false;
  const permittedSpecials = request.allowSpecial
    ? Math.max(1, before.specials)
    : before.specials;
  if (after.specials > permittedSpecials) return false;
  if (request.requireMega && before.megas > 0 && after.megas === 0) return false;
  return true;
}

function closedGaps(current: GeneratedTeamResult, next: GeneratedTeamResult) {
  const nextGaps = new Set(next.battleQuality.team.importantGaps);
  return current.battleQuality.team.importantGaps.filter(
    (gap) => !nextGaps.has(gap),
  );
}

export function recommendationQualifies(
  scoreDelta: number,
  gaps: ReturnType<typeof closedGaps>,
) {
  return scoreDelta >= 3 || (scoreDelta >= 0 && gaps.length > 0);
}

function withRecommendedOrigins(
  result: GeneratedTeamResult,
  changedSlots: number[],
) {
  const changed = new Set(changedSlots);
  return {
    ...result,
    members: result.members.map((member, slot) =>
      changed.has(slot)
        ? {
            ...member,
            origin: "recommended" as const,
            enteredSpeciesId: undefined,
            evolutionPath: undefined,
          }
        : member,
    ) as GeneratedTeamResult["members"],
  };
}

function recommendation(
  id: string,
  kind: TeamRecommendation["kind"],
  changedSlots: number[],
  current: GeneratedTeamResult,
  next: GeneratedTeamResult,
): TeamRecommendation | null {
  const preview = withRecommendedOrigins(next, changedSlots);
  const scoreDelta = preview.score.total - current.score.total;
  const gaps = closedGaps(current, preview);
  if (!recommendationQualifies(scoreDelta, gaps)) return null;
  const changes = changedSlots.map((slot) => ({
    slot,
    from: current.members[slot],
    to: preview.members[slot],
  }));
  return {
    id,
    kind,
    label:
      kind === "single"
        ? `Consider ${changes[0].to.name} for slot ${changedSlots[0] + 1}`
        : `Coordinated ${changedSlots.length}-member plan`,
    changedSlots,
    changes,
    scoreDelta,
    closedGaps: gaps,
    tradeoffs: [
      scoreDelta === 0
        ? "Keeps the current total team score."
        : `Changes the total team score by ${scoreDelta > 0 ? "+" : ""}${scoreDelta}.`,
      gaps.length > 0
        ? `Closes ${gaps.join(", ")}.`
        : "Does not close a currently important team-job gap.",
    ],
    preview,
  };
}

export function generateRecommendations(
  request: GeneratorRequest,
  snapshot: TeamResult,
  catalog: NormalizedCatalog,
): TeamRecommendation[] {
  const ownedSlots = ownedSlotsForRequest(request);
  const ownedIndexes = ownedSlots.flatMap((slot, index) =>
    slot ? [index] : [],
  );
  const cap = recommendationChangeCap(ownedIndexes.length);
  if (cap === 0) return [];

  const currentRoster = snapshot.members.map(pokemonRecordFromMember);
  const current = materializeTeamResult(currentRoster, request, catalog);
  const rosterIds = new Set(currentRoster.map((pokemon) => pokemon.id));
  const candidatePool = assembleCandidates(
    catalog,
    request.style,
    request.weather,
  )
    .filter((candidate) => !rosterIds.has(candidate.id))
    .sort(
      (left, right) =>
        right.battleScore - left.battleScore ||
        right.availability.score - left.availability.score ||
        left.id.localeCompare(right.id),
    )
    .slice(0, 90);

  const bestBySlot = new Map<
    number,
    { roster: PokemonRecord[]; result: GeneratedTeamResult }
  >();
  for (const slot of ownedIndexes) {
    for (const candidate of candidatePool) {
      const roster = currentRoster.map((member, index) =>
        index === slot ? candidate : member,
      );
      if (!doesNotWorsenComposition(currentRoster, roster, request)) continue;
      const result = materializeTeamResult(roster, request, catalog);
      const best = bestBySlot.get(slot);
      if (
        !best ||
        result.score.total > best.result.score.total ||
        (result.score.total === best.result.score.total &&
          candidate.id < best.roster[slot].id)
      ) {
        bestBySlot.set(slot, { roster, result });
      }
    }
  }

  const singles = [...bestBySlot]
    .map(([slot, best]) =>
      recommendation(`single:${slot}`, "single", [slot], current, best.result),
    )
    .filter(
      (entry): entry is TeamRecommendation => entry !== null,
    );

  let coordinated: TeamRecommendation | null = null;
  if (cap >= 2) {
    let roster = [...currentRoster];
    const changedSlots: number[] = [];
    for (const [slot, best] of [...bestBySlot.entries()]
      .sort(
        (left, right) =>
          right[1].result.score.total - left[1].result.score.total ||
          left[0] - right[0],
      )
      .slice(0, cap)) {
      const candidate = best.roster[slot];
      const next = roster.map((member, index) =>
        index === slot ? candidate : member,
      );
      if (!doesNotWorsenComposition(currentRoster, next, request)) continue;
      roster = next;
      changedSlots.push(slot);
    }
    if (changedSlots.length >= 2) {
      const result = materializeTeamResult(roster, request, catalog);
      coordinated = recommendation(
        `coordinated:${changedSlots.join("-")}`,
        "coordinated",
        changedSlots,
        current,
        result,
      );
      if (
        coordinated &&
        singles.some(
          (single) =>
            single.scoreDelta >= coordinated!.scoreDelta &&
            single.closedGaps.length >= coordinated!.closedGaps.length,
        )
      ) {
        coordinated = null;
      }
    }
  }

  return coordinated ? [...singles, coordinated] : singles;
}
