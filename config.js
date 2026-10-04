/* config.js
   Single source of tunable constants for Operation Glasshouse.

   DAY_SALT: change this before every session (date + class code is a good
   choice). It makes victory codes from a practice run, a rehearsal, or a
   previous semester fail verification, because every seed, flag, marker and
   checksum derives from it. See FACILITATOR.md.
*/
(function (global) {
  'use strict';

  var Config = {
    // Session salt — fixed for this single session.
    DAY_SALT: 'glasshouse-2026-10-04-session01',

    // Entry gate. Only the salted SHA-256 hash of the passcode is stored, so the
    // passcode itself never appears in the source. Checked as
    // sha256('glasshouse-gate:v1:' + entered) === GATE_HASH.
    GATE_HASH: 'a23cd44927b751384df27678d70f0effc83007fc6a0474b951bebfb211f630ac',
    GATE_PREFIX: 'glasshouse-gate:v1:',

    // Per-scene secrets. Flags are HMAC(seed, sceneId + ":" + SCENE_SECRET),
    // so nothing solvable is stored in source; a flag only forms at runtime.
    SCENE_SECRETS: {
      s1: 'glass-leak-77',
      s2: 'ticket-anomaly-43',
      s3: 'badge-boundary-19',
      s4: 'filter-gap-58',
      s5: 'trifecta-chain-91',
      s6: 'well-poison-12',
      s7: 'ghost-pkg-64',
      s8: 'lockdown-capstone-30'
    },

    // Par times in seconds. Speed bonus decays to zero over twice par.
    PAR: {
      s1: 5 * 60,
      s2: 10 * 60,
      s3: 12 * 60,
      s4: 12 * 60,
      s5: 20 * 60,
      s6: 15 * 60,
      s7: 10 * 60,
      s8: 25 * 60
    },

    BASE_POINTS: {
      s1: 100, s2: 150, s3: 200, s4: 250,
      s5: 400, s6: 300, s7: 250, s8: 500
    },

    // Scene prerequisites. A scene cannot be recorded solved until all of
    // these are solved. Keeps timestamps honest and ordering enforced.
    PREREQS: {
      s1: [],
      s2: ['s1'],
      s3: ['s2'],
      s4: ['s3'],
      s5: ['s4'],
      s6: ['s5'],
      s7: ['s6'],
      s8: ['s7']
    },

    SCENE_ORDER: ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'],

    // Hint tiers: cost in points and cooldown before the NEXT tier unlocks.
    HINT_COSTS: [25, 50, 100],
    HINT_COOLDOWN_MS: 2 * 60 * 1000,      // default: two minutes between tiers
    HINT_COOLDOWN_OVERRIDE: { s5: 45 * 1000 }, // scene 5 only: 45 seconds

    SPEED_BONUS_MAX: 50,                    // per scene, decays over 2x par

    ARCADE_IDS: ['a1', 'a2', 'a3', 'a4'],
    ARCADE_MAX: 100,                        // per round

    // Parity constant shared by state.js and verify.html for the victory code.
    CODE_VERSION: 1
  };

  global.Config = Config;
})(typeof window !== 'undefined' ? window : globalThis);
