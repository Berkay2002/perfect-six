import {
  SCHEMA_VERSION,
  type GeneratorRequest,
  type LegacySlots,
  type OwnedSlots,
} from "@/lib/types";

export const EMPTY_LEGACY_SLOTS: LegacySlots = [
  null,
  null,
  null,
  null,
  null,
  null,
];

export const EMPTY_OWNED_SLOTS: OwnedSlots = [
  null,
  null,
  null,
  null,
  null,
  null,
];

export function ownedSlotsForRequest(request: GeneratorRequest): OwnedSlots {
  if (request.ownedSlots) return request.ownedSlots;
  return request.slots.map((speciesId) =>
    speciesId ? { speciesId } : null,
  ) as OwnedSlots;
}

export function migrateGeneratorRequest(
  request: GeneratorRequest,
): GeneratorRequest {
  const ownedSlots = ownedSlotsForRequest(request);
  return {
    ...request,
    schemaVersion: SCHEMA_VERSION,
    ownedSlots,
    slots: ownedSlots.map((slot) => slot?.speciesId ?? null) as LegacySlots,
  };
}

export function hasOwnedPokemon(request: GeneratorRequest) {
  return ownedSlotsForRequest(request).some(Boolean);
}
