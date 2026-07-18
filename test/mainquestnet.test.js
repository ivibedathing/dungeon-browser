// Task 8: quests were solo-only in practice. js/net.js hardcoded `quests: []`
// into the online render state and Room.snapshotFor never sent any quest data,
// even though the server had been persisting it since Phase 3.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Room } = require('../server/room.js');
const Quests = require('../js/quests.js');
const Bosses = require('../js/bosses.js');

const progressed = (acts) => {
  const mq = Quests.newMain();
  for (let i = 0; i < acts; i++) {
    const a = Bosses.ACTS[i];
    Quests.recordBossKill(mq, Entities.makeBoss(a.bossFloor), a.bossFloor);
  }
  return mq;
};

test('each player receives their OWN main quest and not their ally\'s', () => {
  const room = new Room({ code: 'QSTA', seed: 21 });
  const a = room.join({ name: 'Ash', shirt: '#4a5578' });
  const b = room.join({ name: 'Bo', shirt: '#7a5578' });
  const pa = room.state.players.find((p) => p.id === a.id);
  const pb = room.state.players.find((p) => p.id === b.id);
  pa.mainQuest = progressed(3); // act IV
  pb.mainQuest = progressed(1); // act II

  const sa = room.snapshotFor(a.id);
  const sb = room.snapshotFor(b.id);

  assert.equal(sa.self.mainQuest.act, 4, 'Ash sees their own act');
  assert.equal(sb.self.mainQuest.act, 2, 'Bo sees their own act');
  assert.notDeepEqual(sa.self.mainQuest, sb.self.mainQuest, 'the two differ, as a mixed-act party should');
});

test('a snapshot never carries anyone else\'s quest state', () => {
  const room = new Room({ code: 'QSTB', seed: 21 });
  const a = room.join({ name: 'Ash' });
  const b = room.join({ name: 'Bo' });
  room.state.players.find((p) => p.id === b.id).mainQuest = progressed(5);

  const sa = room.snapshotFor(a.id);
  const wire = JSON.stringify(sa.players);
  assert.ok(!wire.includes('mainQuest'), 'the shared player list stays free of quest state');
  assert.equal(sa.self.mainQuest.act, 1, 'and Ash still gets their own');
});

test('boss telegraph state reaches every client in range so all four can dodge', () => {
  const room = new Room({ code: 'QSTC', seed: 21 });
  const a = room.join({ name: 'Ash' });
  const b = room.join({ name: 'Bo' });
  const s = room.state;

  const boss = {
    ...Entities.makeBoss(4),
    id: 9001,
    x: s.players[0].x + 40,
    y: s.players[0].y,
    attackT: 0, hitT: 0, lungeT: 0, wanderT: 99, wandA: NaN, aggroed: true, kbx: 0, kby: 0,
  };
  boss.telegraphT = 0.5;
  boss.telegraph = { x: s.players[0].x, y: s.players[0].y, r: 88 };
  boss.phaseIdx = 1;
  s.monsters.push(boss);
  // Put the ally right next to the boss so it is inside their AOI too.
  const pb = s.players.find((p) => p.id === b.id);
  pb.x = boss.x + 20;
  pb.y = boss.y;

  for (const id of [a.id, b.id]) {
    const snap = room.snapshotFor(id);
    const m = snap.monsters.find((x) => x.id === 9001);
    assert.ok(m, `${id} sees the boss`);
    assert.ok(m.telegraphT > 0, `${id} sees the wind-up`);
    assert.ok(m.telegraph && typeof m.telegraph.x === 'number', `${id} gets the circle position`);
    assert.ok(m.slamWindup > 0, `${id} can compute how far along it is`);
    assert.equal(m.phaseIdx, 1, `${id} sees the phase for the health-bar pips`);
  }
});

test('a boss that is not winding up sends no telegraph payload', () => {
  const room = new Room({ code: 'QSTD', seed: 21 });
  const a = room.join({ name: 'Ash' });
  const s = room.state;
  const boss = {
    ...Entities.makeBoss(4), id: 9002,
    x: s.players[0].x + 40, y: s.players[0].y,
    attackT: 0, hitT: 0, lungeT: 0, wanderT: 99, wandA: NaN, aggroed: true, kbx: 0, kby: 0,
  };
  s.monsters.push(boss);
  const m = room.snapshotFor(a.id).monsters.find((x) => x.id === 9002);
  assert.equal(m.telegraphT, 0, 'no wind-up in flight');
  assert.equal(m.telegraph, null, 'and no circle to draw');
});

test('a fresh online hero gets a main quest rather than null', () => {
  const room = new Room({ code: 'QSTE', seed: 21 });
  const a = room.join({ name: 'Ash' });
  const snap = room.snapshotFor(a.id);
  assert.ok(snap.self.mainQuest, 'present on the wire');
  assert.equal(snap.self.mainQuest.act, 1, 'starting on act I');
});

test('the snapshot survives JSON round-tripping, quest included', () => {
  const room = new Room({ code: 'QSTF', seed: 21 });
  const a = room.join({ name: 'Ash' });
  room.state.players[0].mainQuest = progressed(2);
  const wire = JSON.parse(JSON.stringify(room.snapshotFor(a.id)));
  assert.equal(wire.self.mainQuest.act, 3);
  assert.deepEqual(wire.self.mainQuest.slain, [1, 2]);
});
