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

    // Per-scene secrets, packed (see Crypto.unpackObj). Flags are
    // HMAC(seed, sceneId + ":" + SCENE_SECRET); keeping the secrets out of
    // readable plaintext means a view-source of this file alone reveals nothing
    // usable. This is obfuscation, not encryption — the real anti-cheat controls
    // are the in-lab solve gating and the facilitator verbal checks.
    SCENE_SECRETS: global.Crypto.unpackObj('1c4a5e414359494a1a505e444b5f0458081f5502474b4a5e42435949591f524652121e00570c5f03591c4a5c1e524d41181e540b0f550757065c4e500d400b03095f094c52520f5a135e034409435f0a5e1650174a0f4c004c56530f5a135e024409434d115b04500613090013090202435b081c154a11120f41084042000b0400000e0a1842181c1c05441f434a54105817020f075e044c13004a5b0719154a111201410840590a0403491f160d464e17415e43095d041450024048'),

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
