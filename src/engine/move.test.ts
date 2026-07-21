import { describe, expect, it } from "vitest";

import { catalog } from "@/data/catalog";
import { assembleCandidates } from "@/engine/catalog";
import { movePackageQualityForBuild } from "@/engine/move";
import type { PokemonRecord } from "@/lib/types";

function buildWith(
  pokemon: PokemonRecord,
  moveIds: [string, string, string, string],
  overrides: Partial<PokemonRecord> = {},
) {
  const moveById = new Map(catalog.moves.map((move) => [move.id, move]));
  const moves = moveIds.map((id) => {
    const move = moveById.get(id);
    if (!move) throw new Error(`Missing sourced fixture move ${id}`);
    return {
      id: move.id,
      name: move.name,
      type: move.type,
      category: move.category,
      power: move.power,
      accuracy: move.accuracy,
      purpose: "Golden comparison fixture",
    };
  }) as PokemonRecord["build"]["moves"];
  return {
    ...pokemon,
    ...overrides,
    build: { ...pokemon.build, moves },
  };
}

const fixture = assembleCandidates(catalog, "balanced")[0];

describe("complete four-move package quality", () => {
  it("prefers accurate STAB pressure and the matching damage category", () => {
    const specialAttacker = {
      ...fixture,
      types: ["Electric"] as [string],
      stats: {
        ...fixture.stats,
        attack: 45,
        specialAttack: 125,
      },
    };
    const reliable = buildWith(specialAttacker, [
      "thunderbolt",
      "icebeam",
      "voltswitch",
      "thunderwave",
    ]);
    const inaccurate = buildWith(specialAttacker, [
      "thunder",
      "icebeam",
      "voltswitch",
      "thunderwave",
    ]);
    const categoryMismatch = buildWith(specialAttacker, [
      "wildcharge",
      "icepunch",
      "uturn",
      "thunderwave",
    ]);

    const reliableQuality = movePackageQualityForBuild(reliable, catalog);
    expect(reliableQuality.score).toBeGreaterThan(
      movePackageQualityForBuild(inaccurate, catalog).score,
    );
    expect(reliableQuality.score).toBeGreaterThan(
      movePackageQualityForBuild(categoryMismatch, catalog).score,
    );
    expect(reliableQuality.explanation).toContain("STAB");
    expect(reliableQuality.explanation).toContain("accuracy-adjusted");
  });

  it("aligns pressure to a source-derived offensive stat override", () => {
    const defender = {
      ...fixture,
      types: ["Fighting"] as [string],
      stats: {
        ...fixture.stats,
        attack: 45,
        defense: 135,
        specialAttack: 100,
      },
      build: {
        ...fixture.build,
        evs: {
          ...fixture.build.evs,
          attack: 0,
          defense: 252,
          specialAttack: 0,
        },
      },
    };
    const defensePressure = movePackageQualityForBuild(
      buildWith(defender, ["bodypress", "roost", "toxic", "stealthrock"]),
      catalog,
    );
    const attackPressure = movePackageQualityForBuild(
      buildWith(defender, ["brickbreak", "roost", "toxic", "stealthrock"]),
      catalog,
    );

    expect(defensePressure.score).toBeGreaterThan(attackPressure.score);
    expect(defensePressure.strengths.join(" ")).toContain(
      "Body Press uses Defense",
    );
    expect(defensePressure.concerns.join(" ")).not.toContain(
      "Every damaging move mismatches",
    );
  });

  it("recognizes defensive setup that powers a sourced defensive-stat attack", () => {
    const defender = {
      ...fixture,
      types: ["Fighting"] as [string],
      stats: {
        ...fixture.stats,
        attack: 45,
        defense: 135,
        specialAttack: 100,
      },
      build: {
        ...fixture.build,
        evs: {
          ...fixture.build.evs,
          attack: 0,
          defense: 252,
          specialAttack: 0,
        },
      },
    };
    const quality = movePackageQualityForBuild(
      buildWith(defender, ["irondefense", "bodypress", "bravebird", "uturn"]),
      catalog,
    );

    expect(quality.capabilities.setup).toBe(true);
    expect(quality.strengths.join(" ")).toContain(
      "Iron Defense setup has payoff through def",
    );
    expect(quality.concerns.join(" ")).not.toContain(
      "Iron Defense boosts stats this build cannot exploit",
    );
  });

  it("exposes utility jobs as distinct sourced capabilities", () => {
    const first = movePackageQualityForBuild(
      buildWith(fixture, ["extremespeed", "recover", "uturn", "stealthrock"]),
      catalog,
    );
    const second = movePackageQualityForBuild(
      buildWith(fixture, ["toxic", "defog", "lightscreen", "raindance"]),
      catalog,
    );

    expect(first.capabilities).toMatchObject({
      priority: true,
      recovery: true,
      pivoting: true,
      hazards: true,
    });
    expect(second.capabilities).toMatchObject({
      status: true,
      removal: true,
      screens: true,
      weather: true,
    });
    expect(
      movePackageQualityForBuild(
        buildWith(fixture, ["rest", "sleeptalk", "toxic", "scald"]),
        catalog,
      ).capabilities.recovery,
    ).toBe(true);
  });

  it("rewards setup only with matching stats and attacking payoff", () => {
    const physical = {
      ...fixture,
      types: ["Fighting"] as [string],
      stats: { ...fixture.stats, attack: 125, specialAttack: 45 },
    };
    const payoff = buildWith(physical, [
      "swordsdance",
      "closecombat",
      "earthquake",
      "suckerpunch",
    ]);
    const contradiction = buildWith(physical, [
      "nastyplot",
      "closecombat",
      "earthquake",
      "suckerpunch",
    ]);

    const coherent = movePackageQualityForBuild(payoff, catalog);
    const incoherent = movePackageQualityForBuild(contradiction, catalog);
    expect(coherent.score).toBeGreaterThan(incoherent.score);
    expect(coherent.capabilities.setup).toBe(true);
    expect(incoherent.capabilities.setup).toBe(false);
    expect(incoherent.concerns.join(" ")).toContain("Nasty Plot");
  });

  it("penalizes and explains redundant attacks and contradictory setup", () => {
    const physical = {
      ...fixture,
      types: ["Fighting"] as [string],
      stats: { ...fixture.stats, attack: 120, specialAttack: 50 },
    };
    const coherent = buildWith(physical, [
      "bulkup",
      "closecombat",
      "earthquake",
      "suckerpunch",
    ]);
    const redundant = buildWith(physical, [
      "nastyplot",
      "aurasphere",
      "focusblast",
      "vacuumwave",
    ]);
    const coherentQuality = movePackageQualityForBuild(coherent, catalog);
    const redundantQuality = movePackageQualityForBuild(redundant, catalog);

    expect(coherentQuality.score).toBeGreaterThan(redundantQuality.score);
    expect(redundantQuality.concerns.join(" ")).toMatch(
      /unused|redundant|mismatch/i,
    );
    expect(redundantQuality.explanation).toContain("concern");
  });
});
