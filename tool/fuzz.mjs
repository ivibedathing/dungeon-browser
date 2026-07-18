// tool/fuzz.mjs — manual deep protocol/room fuzz driver. The CI slice lives in
// test/fuzz.test.js; this runs a longer sweep for pre-deploy soaking.
//   node tool/fuzz.mjs [seed] [iterations]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Protocol = require('../server/protocol.js');
const { Room } = require('../server/room.js');
const FuzzGen = require('../server/fuzz-gen.js');

const seed = Number(process.argv[2]) || 1;
const iterations = Number(process.argv[3]) || 200000;
const rng = FuzzGen.mulberry32(seed >>> 0);
const seeds = FuzzGen.validSeeds();

let decoded = 0;
let validated = 0;
let accepted = 0;
let t = 0;
const room = new Room({ code: 'FUZZ', seed });
room.join({});

const started = process.hrtime.bigint();
for (let i = 0; i < iterations; i++) {
  const raw = i % 3 === 0 ? FuzzGen.randomFrame(rng) : JSON.stringify(FuzzGen.mutate(seeds[i % seeds.length], rng));
  let dec;
  try {
    dec = Protocol.decode(raw);
  } catch (e) {
    console.error(`FAIL: decode threw at seed=${seed} i=${i}\n  frame=${String(raw).slice(0, 200)}\n  ${e.stack}`);
    process.exit(1);
  }
  if (dec.ok) {
    decoded++;
    let v;
    try {
      v = Protocol.validateClient(dec.msg);
    } catch (e) {
      console.error(`FAIL: validateClient threw at seed=${seed} i=${i}\n  msg=${JSON.stringify(dec.msg).slice(0, 200)}\n  ${e.stack}`);
      process.exit(1);
    }
    if (v.ok) {
      validated++;
      if (v.msg.t === 'input') { accepted++; room.setInput('p0', v.msg); }
    }
  }
  if (i % 100 === 0) {
    try { room.tick((t += 34)); } catch (e) {
      console.error(`FAIL: room.tick threw at seed=${seed} i=${i}\n  ${e.stack}`);
      process.exit(1);
    }
    if (room.inputs.size !== room.state.players.length) {
      console.error(`FAIL: orphan input buffer at seed=${seed} i=${i}`);
      process.exit(1);
    }
  }
}
const ms = Number(process.hrtime.bigint() - started) / 1e6;
console.log(`OK — ${iterations} frames (seed ${seed}) in ${ms.toFixed(0)}ms: no crash. decoded=${decoded} validated=${validated} inputs=${accepted}`);
