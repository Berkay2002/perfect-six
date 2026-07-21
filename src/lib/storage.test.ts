import { describe, expect, it } from "vitest";

import {
  deleteSavedTeam,
  duplicateSavedTeam,
  readSavedTeams,
  renameSavedTeam,
  saveTeam,
} from "@/lib/storage";
import { preV3SavedTeams } from "@/lib/fixtures/pre-v3-snapshots";
import { resultScoringState } from "@/lib/quality-presentation";
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
    const exact = JSON.stringify(preV3SavedTeams);
    const saved = readSavedTeams(fakeStorage(exact));

    expect(saved).toEqual([...preV3SavedTeams].reverse());
    expect(saved.every((team) => resultScoringState(team.result) === "legacy")).toBe(true);
    expect(JSON.stringify(preV3SavedTeams)).toBe(exact);
  });
});
