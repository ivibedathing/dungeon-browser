// server/sim.js — loads the browser simulation into the node process.
//
// js/*.js are plain scripts that expect their siblings as globals (the browser
// gets them from <script> tags). Node has no window, so the modules fall back to
// require() internally — but they still resolve each other by global name. This
// file is the one place that wiring lives; require it before anything that
// touches Game. It mirrors the bootstrap every test/*.test.js file does.
'use strict';

globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Props = require('../js/props.js');
globalThis.Skills = require('../js/skills.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Dungeon = require('../js/dungeon.js');
globalThis.Quests = require('../js/quests.js');

// Sfx and Save are browser-only. The sim already guards both with `typeof … !==
// 'undefined'`, so leaving them undefined here is what keeps the server silent
// and stateless: no audio, and no localStorage writes (Phase 3 adds real saves).
const Game = require('../js/game.js');

module.exports = { Game };
