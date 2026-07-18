// render.js — node entry point: assembles world rendering from js/render/*.js.
// The browser loads those part files directly via <script> tags (see index.html);
// node (the headless draw-path tests) requires this file for the same namespace.
if (typeof window === 'undefined') {
  require('./render/core.js');
  require('./render/tiles.js');
  require('./render/icons.js');
  require('./render/fixtures.js');
  require('./render/monster.js');
  require('./render/player.js');
  require('./render/props.js');
  require('./render/draw.js');
  module.exports = require('./render/core.js');
}
