import type {
  NormalizedCatalog,
  OwnedEvolutionFacts,
  SpeciesFormId,
  SpeciesRecord,
} from "@/lib/types";

export type EvolutionOption = {
  species: SpeciesRecord;
  path: SpeciesFormId[];
};

function requiredGender(rawRequirements: unknown[]) {
  for (const raw of rawRequirements) {
    if (!raw || typeof raw !== "object") continue;
    const target = String((raw as { target?: unknown }).target ?? "");
    const match = target.match(/gender=(female|male)/i);
    if (match) return match[1].toLowerCase() as "female" | "male";
  }
  return undefined;
}

function evolutionAllowed(
  rawRequirements: unknown[],
  facts: OwnedEvolutionFacts | undefined,
) {
  const gender = requiredGender(rawRequirements);
  return !gender || facts?.gender === gender;
}

export function evolutionNeedsGender(
  speciesId: SpeciesFormId,
  catalog: Pick<NormalizedCatalog, "species">,
) {
  const byId = new Map(catalog.species.map((species) => [species.id, species]));
  const queue = [speciesId];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = byId.get(queue.shift()!);
    if (!current || visited.has(current.id)) continue;
    visited.add(current.id);
    for (const evolution of current.evolutions) {
      if (requiredGender(evolution.rawRequirements)) return true;
      queue.push(evolution.targetId);
    }
  }
  return false;
}

export function reachableEvolutionOptions(
  speciesId: SpeciesFormId,
  facts: OwnedEvolutionFacts | undefined,
  catalog: Pick<NormalizedCatalog, "species">,
): EvolutionOption[] {
  const byId = new Map(catalog.species.map((species) => [species.id, species]));
  const start = byId.get(speciesId);
  if (!start || start.battleOnly) return [];

  const options: EvolutionOption[] = [];
  const queue: EvolutionOption[] = [{ species: start, path: [start.id] }];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.species.id)) continue;
    visited.add(current.species.id);
    const next = current.species.evolutions
      .filter((evolution) =>
        evolutionAllowed(evolution.rawRequirements, facts),
      )
      .map((evolution) => byId.get(evolution.targetId))
      .filter(
        (species): species is SpeciesRecord =>
          species !== undefined && !species.battleOnly,
      );
    if (next.length === 0) options.push(current);
    for (const species of next) {
      queue.push({ species, path: [...current.path, species.id] });
    }
  }
  return options.sort((left, right) =>
    left.species.id.localeCompare(right.species.id),
  );
}

export function evolutionPath(
  enteredSpeciesId: SpeciesFormId,
  selectedSpeciesId: SpeciesFormId,
  facts: OwnedEvolutionFacts | undefined,
  catalog: Pick<NormalizedCatalog, "species">,
) {
  return reachableEvolutionOptions(enteredSpeciesId, facts, catalog).find(
    (option) => option.species.id === selectedSpeciesId,
  )?.path;
}
