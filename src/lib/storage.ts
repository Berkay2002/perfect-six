import {
  SCHEMA_VERSION,
  type GeneratorRequest,
  type SavedTeam,
  type TeamResult,
} from "@/lib/types";

export const SAVED_TEAMS_KEY = "perfect-six:saved-teams:v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function isSavedTeam(value: unknown): value is SavedTeam {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SavedTeam>;
  return (
    (candidate.schemaVersion === 1 || candidate.schemaVersion === 2) &&
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    (candidate.request?.schemaVersion === 1 ||
      candidate.request?.schemaVersion === 2) &&
    candidate.result?.members?.length === 6
  );
}

function resolveStorage(storage?: StorageLike) {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function readSavedTeams(storage?: StorageLike): SavedTeam[] {
  const target = resolveStorage(storage);
  if (!target) return [];
  try {
    const parsed: unknown = JSON.parse(target.getItem(SAVED_TEAMS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isSavedTeam)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } catch {
    return [];
  }
}

function writeSavedTeams(teams: SavedTeam[], storage?: StorageLike) {
  const target = resolveStorage(storage);
  if (!target) return;
  target.setItem(SAVED_TEAMS_KEY, JSON.stringify(teams));
}

export function saveTeam(
  name: string,
  request: GeneratorRequest,
  result: TeamResult,
  storage?: StorageLike,
) {
  const now = new Date().toISOString();
  const saved: SavedTeam = {
    schemaVersion: SCHEMA_VERSION,
    id: crypto.randomUUID(),
    name: name.trim() || `Team ${request.seed}`,
    createdAt: now,
    updatedAt: now,
    request,
    result,
  };
  writeSavedTeams([saved, ...readSavedTeams(storage)], storage);
  return saved;
}

export function renameSavedTeam(
  id: string,
  name: string,
  storage?: StorageLike,
) {
  const updatedAt = new Date().toISOString();
  const teams = readSavedTeams(storage).map((team) =>
    team.id === id
      ? { ...team, name: name.trim() || team.name, updatedAt }
      : team,
  );
  writeSavedTeams(teams, storage);
  return teams.find((team) => team.id === id) ?? null;
}

export function duplicateSavedTeam(id: string, storage?: StorageLike) {
  const teams = readSavedTeams(storage);
  const source = teams.find((team) => team.id === id);
  if (!source) return null;
  const now = new Date().toISOString();
  const duplicate: SavedTeam = {
    ...source,
    id: crypto.randomUUID(),
    name: `${source.name} copy`,
    createdAt: now,
    updatedAt: now,
  };
  writeSavedTeams([duplicate, ...teams], storage);
  return duplicate;
}

export function deleteSavedTeam(id: string, storage?: StorageLike) {
  const teams = readSavedTeams(storage);
  const remaining = teams.filter((team) => team.id !== id);
  writeSavedTeams(remaining, storage);
  return remaining.length !== teams.length;
}
