import { describe, expect, it } from "vitest";

import {
  deleteSavedTeam,
  duplicateSavedTeam,
  readSavedTeams,
  renameSavedTeam,
  saveTeam,
} from "@/lib/storage";
import type { GeneratorRequest, TeamResult } from "@/lib/types";

function fakeStorage(initial = "[]") {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
}

describe("saved team storage", () => {
  it("recovers from corrupted data", () => {
    expect(readSavedTeams(fakeStorage("{broken"))).toEqual([]);
  });

  it("saves, renames, duplicates, and deletes", () => {
    const storage = fakeStorage();
    const request = {
      schemaVersion: 1,
      seed: "TEST",
    } as GeneratorRequest;
    const result = {
      members: Array.from({ length: 6 }, (_, index) => ({ id: `${index}` })),
    } as unknown as TeamResult;
    const saved = saveTeam("First", request, result, storage);
    expect(readSavedTeams(storage)).toHaveLength(1);
    expect(renameSavedTeam(saved.id, "Renamed", storage)?.name).toBe("Renamed");
    const duplicate = duplicateSavedTeam(saved.id, storage);
    expect(duplicate?.id).not.toBe(saved.id);
    expect(readSavedTeams(storage)).toHaveLength(2);
    expect(deleteSavedTeam(saved.id, storage)).toBe(true);
    expect(readSavedTeams(storage)).toHaveLength(1);
  });

  it("keeps legacy engine snapshots readable", () => {
    const legacy = JSON.stringify([
      {
        schemaVersion: 1,
        id: "legacy",
        name: "Legacy team",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        request: { schemaVersion: 1, engineVersion: 1, seed: "OLD" },
        result: {
          members: Array.from({ length: 6 }, (_, index) => ({ id: `${index}` })),
          provenance: { engineVersion: 1 },
        },
      },
    ]);

    const [saved] = readSavedTeams(fakeStorage(legacy));
    expect(saved.name).toBe("Legacy team");
    expect(Number(saved.request.engineVersion)).toBe(1);
    expect(Number(saved.result.provenance.engineVersion)).toBe(1);
  });
});
