// ui/core.js — UI namespace, fonts, screen-geometry layout, and small drawing
// helpers shared by the js/ui/ parts (internal context on UI._). Load this first.
(function () {
  const UI = {};
  // Internal context shared by the js/ui/ parts; not public API.
  const I = (UI._ = {});

  I.SERIF = 'Palatino, Georgia, serif';
  I.SANS = 'Verdana, Geneva, sans-serif';
  I.BRANCH_COLORS = { war: '#e58a6a', sorcery: '#8f9bff', faith: '#e8cf7a' };

  I.layout = function layout(view) {
    const w = view.w;
    const h = view.h;
    const belt = [];
    const beltX = w - 334; // leaves room for the mana orb on the far right
    for (let i = 0; i < 4; i++) {
      belt.push({ x: beltX + i * 50, y: h - 68, w: 44, h: 54 });
    }
    // Skill bar (F/G/H) sits centered with the XP bar tucked under it, keeping
    // the bottom strip compact and clear of the gold readout above the belt.
    const skillBtns = [];
    const skillX = Math.round((w - (3 * 46 - 6)) / 2);
    for (let i = 0; i < 3; i++) {
      skillBtns.push({ x: skillX + i * 46, y: h - 116, w: 40, h: 40 });
    }
    const panelW = 660;
    const panelH = 440;
    const panel = { x: (w - panelW) / 2, y: (h - panelH) / 2 - 14, w: panelW, h: panelH };
    const grid = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 8; c++) {
        grid.push({ x: panel.x + 200 + c * 55, y: panel.y + 84 + r * 55, w: 52, h: 52 });
      }
    }
    // Paper-doll: body column (head→chest→legs→feet) plus hands column.
    const equip = {};
    const EQ_LAYOUT = [
      ['helmet', 0, 0], ['armor', 0, 1], ['pants', 0, 2], ['boots', 0, 3],
      ['weapon', 1, 0], ['gloves', 1, 1], ['ring', 1, 2],
    ];
    for (const [slot, col, row] of EQ_LAYOUT) {
      equip[slot] = { x: panel.x + 28 + col * 76, y: panel.y + 60 + row * 72, w: 56, h: 56 };
    }
    // Potion box: two five-slot rows (healing / mana) under the paper-doll.
    const potionBox = { health: [], mana: [] };
    for (let i = 0; i < Items.POTION_BOX_SIZE; i++) {
      potionBox.health.push({ x: panel.x + 28 + i * 27, y: panel.y + 360, w: 24, h: 24 });
      potionBox.mana.push({ x: panel.x + 28 + i * 27, y: panel.y + 390, w: 24, h: 24 });
    }
    // Vendor stall: a strip above the inventory panel while trading.
    const shopPanel = { x: panel.x, y: panel.y - 108, w: panel.w, h: 98 };
    const shopSlots = [];
    for (let i = 0; i < 3; i++) {
      shopSlots.push({ x: panel.x + 24 + i * 64, y: shopPanel.y + 32, w: 52, h: 52 });
    }
    const shopPotion = { x: panel.x + 24 + 3 * 64 + 42, y: shopPanel.y + 32, w: 52, h: 52 };
    // Right half of the strip: the buy-back shelf and the sell-all button.
    const shopBuyback = [];
    for (let i = 0; i < Game.BUYBACK_SIZE; i++) {
      shopBuyback.push({ x: panel.x + 404 + i * 56, y: shopPanel.y + 32, w: 52, h: 52 });
    }

    // Quest board: pinned notices on the left, your charter on the right.
    const boardPanel = { x: (w - 640) / 2, y: (h - 460) / 2 - 8, w: 640, h: 460 };
    const boardOffers = [];
    const boardActive = [];
    for (let i = 0; i < Quests.BOARD_SIZE; i++) {
      boardOffers.push({ x: boardPanel.x + 24, y: boardPanel.y + 92 + i * 116, w: 288, h: 104 });
    }
    for (let i = 0; i < Quests.MAX_ACTIVE; i++) {
      boardActive.push({ x: boardPanel.x + 328, y: boardPanel.y + 92 + i * 116, w: 288, h: 104 });
    }

    // Skill tree: three branch columns, three tiers deep.
    const treePanel = { x: (w - 700) / 2, y: (h - 480) / 2 - 8, w: 700, h: 480 };
    const treeCards = {};
    const branchOrder = ['war', 'sorcery', 'faith'];
    for (const id of Object.keys(Skills.SKILLS)) {
      const s = Skills.SKILLS[id];
      const col = branchOrder.indexOf(s.branch);
      treeCards[id] = {
        x: treePanel.x + 24 + col * 224,
        y: treePanel.y + 92 + (s.tier - 1) * 120,
        w: 204,
        h: 104,
      };
    }

    // Tally sheet: one column of labels, then the run and lifetime figures.
    const statsPanel = { x: (w - 520) / 2, y: (h - 512) / 2 - 8, w: 520, h: 512 };

    return {
      orb: { cx: 76, cy: h - 52, r: 40 },
      manaOrb: { cx: w - 76, cy: h - 52, r: 40 },
      xp: { x: Math.round((w - 280) / 2), y: h - 64, w: 280, h: 11 },
      belt,
      skillBtns,
      minimap: { x: w - 170, y: 12, size: 158 },
      questLog: { x: w - 170, y: 182, w: 158 },
      panel,
      grid,
      equip,
      potionBox,
      shopPanel,
      shopSlots,
      shopPotion,
      shopPotionMana: { x: shopPotion.x + 60, y: shopPotion.y, w: 52, h: 52 },
      shopBuyback,
      shopSellAll: { x: panel.x + 584, y: shopPanel.y + 32, w: 52, h: 52 },
      boardPanel,
      boardOffers,
      boardActive,
      treePanel,
      treeCards,
      branchOrder,
      statsPanel,
    };
  };

  I.inRect = (mx, my, r) => mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h;

  I.panelBg = function panelBg(ctx, r, alpha) {
    ctx.fillStyle = `rgba(16,12,10,${alpha === undefined ? 0.92 : alpha})`;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = '#5d4a2c';
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    ctx.strokeStyle = 'rgba(200,160,90,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 4.5, r.y + 4.5, r.w - 9, r.h - 9);
  };

  I.wrapText = function wrapText(ctx, text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      const probe = line ? line + ' ' + word : word;
      if (ctx.measureText(probe).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = probe;
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  if (typeof window !== 'undefined') window.UI = UI;
  if (typeof module !== 'undefined') module.exports = UI;
})();
