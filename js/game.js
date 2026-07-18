// game.js — node entry point: assembles the Game simulation from js/game/*.js.
// The browser loads those part files directly via <script> tags (see index.html);
// node (tests, the future server) requires this file and gets the same namespace.
// Load order matters only for module definition, not behavior: core first, the
// frame-update stitcher last.
if (typeof window === 'undefined') {
  require('./game/core.js');
  require('./game/state.js');
  require('./game/status.js');
  require('./game/combat.js');
  require('./game/ai.js');
  require('./game/behaviors.js');
  require('./game/inventory.js');
  require('./game/town.js');
  require('./game/update.js');
  module.exports = require('./game/core.js');
}
