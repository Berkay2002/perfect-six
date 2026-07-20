import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeNamedRecords,
  normalizeShowdownMoves,
  normalizeSmogonBuilds,
  normalizeSpecies,
  validateCatalog,
} from "./normalize.mjs";

const sourcePath = "fixture://source";

const rawMoves = {
  leafhit: {
    name: "Leaf Hit",
    type: "Grass",
    category: "Physical",
    basePower: 80,
    accuracy: 100,
    priority: 0,
    target: "normal",
    flags: { contact: 1 },
  },
  waterhit: {
    name: "Water Hit",
    type: "Water",
    category: "Special",
    basePower: 80,
    accuracy: 100,
    priority: 0,
    target: "normal",
    flags: {},
  },
  recovermove: {
    name: "Recover Move",
    type: "Normal",
    category: "Status",
    basePower: 0,
    accuracy: true,
    priority: 0,
    target: "self",
    flags: {},
    heal: [1, 2],
  },
  statusmove: {
    name: "Status Move",
    type: "Grass",
    category: "Status",
    basePower: 0,
    accuracy: 100,
    priority: 0,
    target: "normal",
    flags: {},
    status: "par",
  },
  illegalmove: {
    name: "Illegal Move",
    type: "Fire",
    category: "Special",
    basePower: 120,
    accuracy: 100,
    priority: 0,
    target: "normal",
    flags: {},
  },
};

function fixtureSpecies() {
  const rejected = [];
  const species = normalizeSpecies({
    cobblemonDocuments: [
      {
        authority: "species-legality",
        kind: "species",
        path: "fixture://sprout.json",
        filename: "sprout",
        data: {
          nationalPokedexNumber: 1,
          name: "Sprout",
          primaryType: "grass",
          labels: ["starter"],
          abilities: ["grow"],
          baseStats: {
            hp: 40,
            attack: 50,
            defence: 40,
            special_attack: 50,
            special_defence: 40,
            speed: 40,
          },
          moves: ["1:leafhit"],
          evolutions: [{ result: "tree", variant: "level_up", requirements: [] }],
        },
      },
      {
        authority: "species-legality",
        kind: "species",
        path: "fixture://tree.json",
        filename: "tree",
        data: {
          nationalPokedexNumber: 2,
          name: "Tree",
          primaryType: "grass",
          abilities: ["grow"],
          baseStats: {
            hp: 80,
            attack: 90,
            defence: 80,
            special_attack: 70,
            special_defence: 80,
            speed: 50,
          },
          moves: [
            "1:leafhit",
            "tm:waterhit",
            "tutor:recovermove",
            "egg:statusmove",
          ],
          evolutions: [],
        },
      },
    ],
    overlayDocuments: [],
    showdownPokedex: {
      sprout: {
        name: "Sprout",
        num: 1,
        types: ["Grass"],
        baseStats: { hp: 40, atk: 50, def: 40, spa: 50, spd: 40, spe: 40 },
        abilities: { 0: "Grow" },
        evos: ["Tree"],
      },
      tree: {
        name: "Tree",
        num: 2,
        types: ["Grass"],
        baseStats: { hp: 80, atk: 90, def: 80, spa: 70, spd: 80, spe: 50 },
        abilities: { 0: "Grow" },
        prevo: "Sprout",
      },
    },
    showdownLearnsets: {},
    rejected,
  });
  return { species, rejected };
}

test("move category and effects come from source records", () => {
  const moves = normalizeShowdownMoves(rawMoves, sourcePath);
  assert.equal(moves.find((move) => move.id === "leafhit").category, "Physical");
  assert.equal(
    moves.find((move) => move.id === "recovermove").effect.healingFraction,
    0.5,
  );
});

test("starter status follows sourced evolution ancestry", () => {
  const { species } = fixtureSpecies();
  const tree = species.find((record) => record.id === "tree");
  assert.equal(tree.finalEvolution, true);
  assert.equal(tree.starter, true);
});

test("curated sets are rejected when a move is not in sourced learnset", () => {
  const { species, rejected } = fixtureSpecies();
  const moves = normalizeShowdownMoves(rawMoves, sourcePath);
  const abilities = normalizeNamedRecords({ grow: { name: "Grow" } }, sourcePath);
  const items = normalizeNamedRecords({ seed: { name: "Seed" } }, sourcePath);
  const builds = normalizeSmogonBuilds({
    rawSets: {
      gen9fixture: {
        Tree: {
          Legal: {
            moves: ["Leaf Hit", "Water Hit", "Recover Move", "Status Move"],
            ability: "Grow",
            item: "Seed",
            nature: "Careful",
            evs: { hp: 252, def: 4, spd: 252 },
          },
          Illegal: {
            moves: ["Leaf Hit", "Water Hit", "Recover Move", "Illegal Move"],
            ability: "Grow",
            item: "Seed",
            nature: "Careful",
            evs: { hp: 252, def: 4, spd: 252 },
          },
        },
      },
    },
    species,
    moves,
    abilities,
    items,
    sourceUrl: sourcePath,
    rejected,
  });
  assert.equal(builds.length, 1);
  assert.match(rejected.at(-1).reason, /not four legal moves/);
  assert.deepEqual(
    validateCatalog({ species, moves, abilities, items, builds }),
    [],
  );
});
