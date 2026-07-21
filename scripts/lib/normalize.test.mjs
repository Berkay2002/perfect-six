import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAbilityRecords,
  normalizeItemRecords,
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
  hazardmove: {
    name: "Hazard Move",
    type: "Rock",
    category: "Status",
    basePower: 0,
    accuracy: true,
    priority: 0,
    target: "foeSide",
    flags: {},
    sideCondition: "fixturehazard",
    desc: "Sets a sourced entry hazard on the opposing side.",
  },
  removalmove: {
    name: "Removal Move",
    type: "Flying",
    category: "Status",
    basePower: 0,
    accuracy: true,
    priority: 0,
    target: "normal",
    flags: {},
    shortDesc: "Ends the effects of all hazards on the user's side.",
  },
  hazardtiming: {
    name: "Hazard Timing",
    type: "Psychic",
    category: "Status",
    basePower: 0,
    accuracy: true,
    priority: 0,
    target: "self",
    flags: {},
    desc: "The effect ends before hazards take effect on the replacement.",
  },
  screenmove: {
    name: "Screen Move",
    type: "Psychic",
    category: "Status",
    basePower: 0,
    accuracy: true,
    priority: 0,
    target: "allySide",
    flags: {},
    sideCondition: "fixturescreen",
    desc: "For 5 turns, damage to allies is reduced by half.",
  },
  setupattack: {
    name: "Setup Attack",
    type: "Normal",
    category: "Physical",
    basePower: 50,
    accuracy: 100,
    priority: 0,
    target: "normal",
    flags: {},
    secondary: { chance: 100, self: { boosts: { spe: 1 } } },
  },
  defenseattack: {
    name: "Defense Attack",
    type: "Fighting",
    category: "Physical",
    basePower: 80,
    accuracy: 100,
    priority: 0,
    target: "normal",
    flags: {},
    desc: "Damage is calculated using the user's Defense stat as its Attack.",
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
  assert.deepEqual(
    moves.find((move) => move.id === "hazardmove").capabilities,
    {
      hazard: true,
      removal: false,
      screen: false,
      offensiveStat: null,
      selfBoosts: null,
    },
  );
  assert.equal(
    moves.find((move) => move.id === "removalmove").capabilities.removal,
    true,
  );
  assert.equal(
    moves.find((move) => move.id === "hazardtiming").capabilities.removal,
    false,
  );
  assert.equal(
    moves.find((move) => move.id === "screenmove").capabilities.screen,
    true,
  );
  assert.deepEqual(
    moves.find((move) => move.id === "setupattack").capabilities.selfBoosts,
    { spe: 1 },
  );
  assert.equal(
    moves.find((move) => move.id === "defenseattack").capabilities
      .offensiveStat,
    "defense",
  );
});

test("ability ratings and team capabilities come from source records", () => {
  const abilities = normalizeAbilityRecords(
    {
      restorative: {
        name: "Restorative",
        desc: "This Pokemon is immune to Water-type moves and restores 1/4 of its maximum HP when hit by a Water-type move.",
        rating: 3.5,
      },
      grounded: {
        name: "Grounded",
        desc: "This Pokemon is immune to Ground-type attacks.",
        rating: 3,
      },
      rainspeed: {
        name: "Rain Speed",
        desc: "If Rain Dance is active, this Pokemon's Speed is doubled.",
        rating: 2.5,
      },
      drawback: {
        name: "Drawback",
        desc: "This Pokemon skips every other turn instead of using a move.",
        rating: -1,
      },
      unsupported: {
        name: "Unsupported",
        desc: "Has an effect that is not represented by a supported capability.",
      },
    },
    sourcePath,
  );

  assert.deepEqual(
    abilities.find((ability) => ability.id === "restorative").capabilities,
    {
      immunities: ["Water"],
      absorptions: ["Water"],
      weather: [],
      weatherDetriments: [],
    },
  );
  assert.deepEqual(
    abilities.find((ability) => ability.id === "grounded").capabilities,
    {
      immunities: ["Ground"],
      absorptions: [],
      weather: [],
      weatherDetriments: [],
    },
  );
  assert.deepEqual(
    abilities.find((ability) => ability.id === "rainspeed").capabilities,
    {
      immunities: [],
      absorptions: [],
      weather: ["rain"],
      weatherDetriments: [],
    },
  );
  assert.equal(
    abilities.find((ability) => ability.id === "drawback").rating,
    -1,
  );
  assert.deepEqual(
    abilities.find((ability) => ability.id === "unsupported").capabilities,
    {
      immunities: [],
      absorptions: [],
      weather: [],
      weatherDetriments: [],
    },
  );
});

test("ability weather capabilities preserve sourced direction", () => {
  const abilities = normalizeAbilityRecords(
    {
      weathertradeoff: {
        name: "Weather Tradeoff",
        desc: "This Pokemon restores HP if the weather is Rain Dance, and loses HP if the weather is Sunny Day.",
      },
      solartradeoff: {
        name: "Solar Tradeoff",
        desc: "If Sunny Day is active, this Pokemon's Special Attack is multiplied by 1.5 and it loses 1/8 of its maximum HP.",
      },
      sandbenefit: {
        name: "Sand Benefit",
        desc: "If Sandstorm is active, this Pokemon's Ground-, Rock-, and Steel-type attacks have their power multiplied by 1.3. This Pokemon takes no damage from Sandstorm.",
      },
    },
    sourcePath,
  );

  assert.deepEqual(
    abilities.find((ability) => ability.id === "weathertradeoff").capabilities,
    {
      immunities: [],
      absorptions: [],
      weather: ["rain"],
      weatherDetriments: ["sun"],
    },
  );
  assert.deepEqual(
    abilities.find((ability) => ability.id === "solartradeoff").capabilities,
    {
      immunities: [],
      absorptions: [],
      weather: ["sun"],
      weatherDetriments: ["sun"],
    },
  );
  assert.deepEqual(
    abilities.find((ability) => ability.id === "sandbenefit").capabilities,
    {
      immunities: [],
      absorptions: [],
      weather: ["sand"],
      weatherDetriments: [],
    },
  );
});

test("item capabilities and drawbacks come from source records", () => {
  const items = normalizeItemRecords(
    {
      amplifier: {
        name: "Amplifier",
        desc: "Holder's physical attacks have 1.3x power, and it loses 1/10 its max HP after the attack.",
      },
      lockingSpeed: {
        name: "Locking Speed",
        desc: "Holder's Speed is 1.5x, but it can only select the first move it executes.",
      },
      sustain: {
        name: "Sustain",
        desc: "Each turn, if holder is a Water type, restores 1/16 max HP; loses 1/8 if not.",
      },
      specialArmor: {
        name: "Special Armor",
        desc: "Holder's Sp. Def is 1.5x, but it can only select damaging moves.",
      },
      evolutionArmor: {
        name: "Evolution Armor",
        desc: "If holder's species can evolve, its Defense and Sp. Def are 1.5x.",
      },
      setup: {
        name: "Setup",
        desc: "If holder is hit super effectively, raises Attack, Sp. Atk by 2 stages. Single use.",
      },
      speedSetup: {
        name: "Speed Setup",
        desc: "If the holder misses due to accuracy, its Speed is raised by 2 stages. Single use.",
      },
      unsupported: {
        name: "Unsupported",
        desc: "Has an effect outside the supported item capability vocabulary.",
      },
    },
    sourcePath,
  );
  const byId = new Map(items.map((item) => [item.id, item.capabilities]));

  assert.deepEqual(byId.get("amplifier"), {
    damageCategory: "physical",
    choiceLock: false,
    recovery: false,
    requiredType: null,
    defensiveStats: [],
    hazardProtection: false,
    survival: false,
    speedMultiplier: null,
    speedStages: 0,
    movesLast: false,
    recoil: true,
    consumable: false,
    boostedStats: [],
    requiresInaccurateMove: false,
    damagingMovesOnly: false,
    requiresEvolutionPotential: false,
  });
  assert.equal(byId.get("lockingspeed").choiceLock, true);
  assert.equal(byId.get("lockingspeed").speedMultiplier, 1.5);
  assert.equal(byId.get("sustain").recovery, true);
  assert.equal(byId.get("sustain").requiredType, "Water");
  assert.deepEqual(byId.get("specialarmor").defensiveStats, [
    "specialDefense",
  ]);
  assert.equal(byId.get("specialarmor").damagingMovesOnly, true);
  assert.equal(
    byId.get("evolutionarmor").requiresEvolutionPotential,
    true,
  );
  assert.equal(byId.get("setup").consumable, true);
  assert.deepEqual(byId.get("setup").boostedStats, [
    "attack",
    "specialAttack",
  ]);
  assert.equal(byId.get("speedsetup").speedStages, 2);
  assert.equal(byId.get("speedsetup").requiresInaccurateMove, true);
  assert.deepEqual(byId.get("unsupported"), {
    damageCategory: null,
    choiceLock: false,
    recovery: false,
    requiredType: null,
    defensiveStats: [],
    hazardProtection: false,
    survival: false,
    speedMultiplier: null,
    speedStages: 0,
    movesLast: false,
    recoil: false,
    consumable: false,
    boostedStats: [],
    requiresInaccurateMove: false,
    damagingMovesOnly: false,
    requiresEvolutionPotential: false,
  });
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

test("species additions rewrite fields but append forms and evolutions", () => {
  const rejected = [];
  const species = normalizeSpecies({
    cobblemonDocuments: [
      {
        authority: "species-legality",
        kind: "species",
        path: "fixture://base.json",
        filename: "base",
        data: {
          nationalPokedexNumber: 10,
          name: "Base",
          primaryType: "normal",
          abilities: ["plain"],
          baseStats: {
            hp: 50,
            attack: 50,
            defence: 50,
            special_attack: 50,
            special_defence: 50,
            speed: 50,
          },
          moves: ["1:leafhit"],
          evolutions: [],
        },
      },
    ],
    overlayDocuments: [
      {
        authority: "pack-legality",
        kind: "species-addition",
        path: "fixture://addition.json",
        filename: "addition",
        data: {
          target: "cobblemon:base",
          primaryType: "water",
          forms: [
            {
              name: "Mega",
              primaryType: "grass",
              baseStats: {
                hp: 50,
                attack: 90,
                defence: 70,
                special_attack: 90,
                special_defence: 70,
                speed: 90,
              },
            },
          ],
          evolutions: [
            { result: "other", variant: "level_up", requirements: [] },
          ],
        },
      },
    ],
    showdownPokedex: {},
    showdownLearnsets: {},
    rejected,
  });
  assert.equal(species.find((record) => record.id === "base").types[0], "Water");
  assert.ok(species.some((record) => record.id === "basemega"));
  assert.equal(
    species.find((record) => record.id === "base").evolutions[0].targetId,
    "other",
  );
});
