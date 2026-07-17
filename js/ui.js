// ui.js — node entry point: assembles the HUD/panel UI from js/ui/*.js.
// The browser loads those part files directly via <script> tags (see index.html);
// node (the headless draw-path tests) requires this file for the same namespace.
if (typeof window === 'undefined') {
  require('./ui/core.js');
  require('./ui/input.js');
  require('./ui/orbs.js');
  require('./ui/hud.js');
  require('./ui/panels.js');
  require('./ui/tooltip.js');
  require('./ui/creation.js');
  require('./ui/draw.js');
  module.exports = require('./ui/core.js');
}
