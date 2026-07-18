// server/intents.js — server-authoritative progression. The client sends INTENTS
// (indices and ids only — "equip bag slot 3", never "my damage is 47"); the server
// looks each up in ITS OWN copy of the player's bag/equip and recomputes stats from
// its own Items/Skills/Balance tables. No number from the client is ever trusted or
// stored. Each handler returns {ok, reason} and mutates nothing on failure.
'use strict';

require('./sim.js'); // loads Entities/Items/Skills globals in node

// Clamp hp after a gear change so a swap that lowers max HP can't leave hp above it.
function clampHp(player) {
  player.hp = Math.min(player.hp, Entities.effectiveStats(player).maxHP);
}

function equip(state, player, msg) {
  const i = msg.slot;
  if (!Number.isInteger(i) || i < 0 || i >= player.bag.slots.length) return { ok: false, reason: 'bad_slot' };
  const item = player.bag.slots[i];
  if (!item || !Items.EQUIP_SLOTS.includes(item.slot)) return { ok: false, reason: 'not_equippable' };
  Items.equipFromBag(player, player.bag, i); // swaps the old piece back into the bag slot
  clampHp(player);
  return { ok: true };
}

function unequip(state, player, msg) {
  const s = msg.slotName;
  if (!Items.EQUIP_SLOTS.includes(s)) return { ok: false, reason: 'bad_slot' };
  const item = player.equip[s];
  if (!item) return { ok: false, reason: 'empty' };
  if (!Items.addItem(player.bag, item)) return { ok: false, reason: 'bag_full' };
  player.equip[s] = null;
  clampHp(player);
  return { ok: true };
}

function sell(state, player, msg) {
  const i = msg.slot;
  if (!Number.isInteger(i) || i < 0 || i >= player.bag.slots.length) return { ok: false, reason: 'bad_slot' };
  const item = player.bag.slots[i];
  if (!item) return { ok: false, reason: 'empty' };
  const price = Items.sellPrice(item); // the SERVER's price, from its own tables
  player.bag.slots[i] = null;
  player.bag.gold += price;
  return { ok: true, gold: price };
}

function upgrade(state, player, msg) {
  const s = msg.slotName || 'weapon';
  const item = player.equip[s];
  if (!item || item.slot !== 'weapon') return { ok: false, reason: 'not_weapon' };
  if ((item.plus || 0) >= Items.MAX_PLUS) return { ok: false, reason: 'maxed' };
  const cost = Items.upgradeCost(item); // server-priced
  if ((player.bag.gold || 0) < cost) return { ok: false, reason: 'insufficient_gold' };
  if (!Items.upgradeWeapon(item)) return { ok: false, reason: 'failed' };
  player.bag.gold -= cost;
  return { ok: true };
}

function learn(state, player, msg) {
  const id = msg.skillId;
  if (typeof id !== 'string' || !Skills.SKILLS[id]) return { ok: false, reason: 'unknown_skill' };
  if (!Skills.learn(player, id)) return { ok: false, reason: 'cannot_learn' }; // re-checks points + prereqs
  return { ok: true };
}

function buy(state, player, msg) {
  if (!Array.isArray(state.shop)) return { ok: false, reason: 'no_shop' };
  const i = msg.index;
  if (!Number.isInteger(i) || i < 0 || i >= state.shop.length) return { ok: false, reason: 'bad_index' };
  const entry = state.shop[i];
  if (!entry || !entry.item) return { ok: false, reason: 'sold' };
  const price = Items.buyPrice(entry.item); // server price, never the client's
  if ((player.bag.gold || 0) < price) return { ok: false, reason: 'insufficient_gold' };
  if (!Items.addItem(player.bag, entry.item)) return { ok: false, reason: 'bag_full' };
  player.bag.gold -= price;
  state.shop[i] = null;
  return { ok: true };
}

const HANDLERS = { equip, unequip, sell, upgrade, learn, buy };

// Apply one validated intent against the room state + acting player. Returns
// {ok, reason?}. The protocol layer has already rejected unexpected keys.
function apply(state, player, msg) {
  const h = HANDLERS[msg && msg.intent];
  if (!h) return { ok: false, reason: 'unknown_intent' };
  return h(state, player, msg);
}

module.exports = { apply, HANDLERS };
