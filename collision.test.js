import { test } from 'node:test';
import assert from 'node:assert/strict';
import registryFactory from 'prismarine-registry';
import {
  createCollision, configureCollision, activeCollision, topOf, isClimbable, isHazard,
  CLIMBABLE, HAZARD, FULL_CUBE, EPS, STRICT_FLOOR,
} from './collision.js';

const registry = registryFactory('bedrock_1.26.60');
const collision = createCollision(registry);

// --- テスト用ヘルパー ---------------------------------------------------------

const same = (a, b) => a === b || Number(a) === Number(b);

/** 状態プロパティから stateId を探す（registry.blockStates の states[prop].value と比較）。 */
function stateIdOf(name, props = {}) {
  const def = registry.blocksByName[name];
  assert.ok(def, `ブロック ${name} がレジストリにありません`);
  for (let id = def.minStateId; id <= def.maxStateId; id++) {
    const states = registry.blockStates[id].states ?? {};
    if (Object.entries(props).every(([k, v]) => states[k] && same(states[k].value, v))) return id;
  }
  assert.fail(`${name} に状態 ${JSON.stringify(props)} がありません`);
}

const blockOf = (name, props) => ({
  name,
  stateId: props === undefined ? registry.blocksByName[name].defaultState : stateIdOf(name, props),
});

/** 座標→ブロックの小さな世界。未指定のセルは空気。read は controls.block と同様に小数座標を floor する。 */
function makeWorld() {
  const cells = new Map();
  const air = blockOf('air');
  const key = (x, y, z) => `${x},${y},${z}`;
  return {
    put(x, y, z, block) { cells.set(key(x, y, z), block); return this; },
    fill(x1, y1, z1, x2, y2, z2, block) {
      for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) cells.set(key(x, y, z), block);
      return this;
    },
    read: p => cells.get(key(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))) ?? air,
  };
}

/** y=63 に土の床（x,z は -3..3）を敷いた世界。床の上面は y=64。 */
function flatWorld() {
  return makeWorld().fill(-3, 63, -3, 3, 63, 3, blockOf('dirt'));
}

// --- 形状データ ---------------------------------------------------------------

test('スラブ・階段・フェンス・カーペット・はしご・ツタの形状がレビューの表と一致する', () => {
  const shapes = b => collision.shapesOf(b);
  assert.deepEqual(shapes(blockOf('oak_slab', { 'minecraft:vertical_half': 'bottom' })), [[0, 0, 0, 1, 0.5, 1]]);
  assert.deepEqual(shapes(blockOf('oak_slab', { 'minecraft:vertical_half': 'top' })), [[0, 0.5, 0, 1, 1, 1]]);
  assert.deepEqual(shapes(blockOf('white_carpet')), [[0, 0, 0, 1, 0.0625, 1]]);
  assert.deepEqual(shapes(blockOf('ladder', { facing_direction: 2 })), [[0, 0, 0.8125, 1, 1, 1]]);

  const stairs = dir => shapes(blockOf('stone_brick_stairs', { 'minecraft:corner': 'none', upside_down_bit: 0, weirdo_direction: dir }));
  assert.deepEqual(stairs(0), [[0, 0, 0, 1, 0.5, 1], [0.5, 0.5, 0, 1, 1, 1]]);   // 東向き: 高い段は x 0.5〜1
  assert.deepEqual(stairs(1), [[0, 0, 0, 1, 0.5, 1], [0, 0.5, 0, 0.5, 1, 1]]);   // 西向き
  assert.deepEqual(stairs(2), [[0, 0, 0, 1, 0.5, 1], [0, 0.5, 0.5, 1, 1, 1]]);   // 南向き
  assert.deepEqual(stairs(3), [[0, 0, 0, 1, 0.5, 1], [0, 0.5, 0, 1, 1, 0.5]]);   // 北向き

  const fence = registry.blocksByName.oak_fence;
  for (let id = fence.minStateId; id <= fence.maxStateId; id++) {
    assert.equal(topOf(collision.shapesOf({ name: 'oak_fence', stateId: id })), 1.5, 'フェンスの上面は全状態で 1.5');
  }
  const vine = registry.blocksByName.vine;
  for (let id = vine.minStateId; id <= vine.maxStateId; id++) {
    assert.deepEqual(collision.shapesOf({ name: 'vine', stateId: id }), [], 'ツタは全状態で衝突形状なし');
  }
});

test('レジストリの全 stateId で形状を引ける（データ版ずれの回帰テスト）', () => {
  const c = createCollision(registry);
  let checked = 0;
  for (let id = 0; id < registry.blockStates.length; id++) {
    const state = registry.blockStates[id];
    if (!state) continue;
    const shapes = c.shapesOf({ name: state.name, stateId: id });
    assert.ok(Array.isArray(shapes), `${state.name} (stateId ${id}) の形状を引けません`);
    checked++;
  }
  assert.ok(checked > 20000, `検証した stateId が少なすぎます: ${checked}`);
  assert.equal(c.stats.unknownShape, 0);
});

test('stateId が無いスタブは従来の二値にフォールバックし、件数を数える。形状不明は null', () => {
  const c = createCollision(registry);
  assert.deepEqual(c.shapesOf({ name: 'stone', boundingBox: 'block' }), FULL_CUBE);
  assert.deepEqual(c.shapesOf({ name: 'grass', boundingBox: 'empty' }), []);
  assert.equal(c.stats.legacyFallback, 2);
  assert.equal(c.shapesOf({ name: 'unknown_block', stateId: 1 }), null);
  assert.equal(c.shapesOf(null), null);
  assert.equal(c.stats.unknownShape, 1);
});

test('blockCollisionShapes が無いレジストリは明示的に失敗する', () => {
  assert.throws(() => createCollision({}), /blockCollisionShapes/);
  assert.throws(() => createCollision(undefined), /blockCollisionShapes/);
});

test('configureCollision 前に activeCollision を呼ぶと明示的に失敗する', () => {
  assert.throws(() => activeCollision(), /configureCollision/);   // このファイルでは最後のテストまで configure しない
});

// --- 体の当たり判定 -----------------------------------------------------------

test('フルブロックの床では立てて、壁の中には立てない', () => {
  const w = flatWorld();
  assert.equal(collision.isWalkable(w.read, 0.5, 64, 0.5), true);
  w.put(0, 65, 0, blockOf('stone'));                       // 頭の位置に石
  assert.equal(collision.bodyClear(w.read, 0.5, 64, 0.5), false);
  assert.equal(collision.isWalkable(w.read, 0.5, 64, 0.5), false);
});

test('スラブ: 下付きスラブの上面（y+0.5）には立てるが、スラブと重なる高さには立てない', () => {
  const w = flatWorld().put(0, 64, 0, blockOf('oak_slab', { 'minecraft:vertical_half': 'bottom' }));
  assert.equal(collision.isWalkable(w.read, 0.5, 64.5, 0.5), true, 'スラブの上');
  assert.equal(collision.bodyClear(w.read, 0.5, 64, 0.5), false, 'スラブと重なる');
  assert.equal(collision.isWalkable(w.read, 0.5, 65, 0.5), false, '0.5 浮いていて落ちる');
});

test('フェンス: 上面は1.5なので、フルブロックと同じ高さ（+1）には乗れない', () => {
  const w = flatWorld().put(0, 64, 0, blockOf('oak_fence'));
  assert.equal(collision.bodyClear(w.read, 0.5, 64, 0.5), false);
  assert.equal(collision.bodyClear(w.read, 0.5, 65, 0.5), false, '柱は y=65.5 まであるので y=65 の体と重なる');
  assert.equal(collision.isWalkable(w.read, 0.5, 65, 0.5), false);
  assert.equal(collision.bodyClear(w.read, 0.5, 65.5, 0.5), true, '柱の上面より上なら体は重ならない');
});

test('カーペット: 上面0.0625の足場として歩けて、重なる高さには立てない', () => {
  const w = flatWorld().put(0, 64, 0, blockOf('white_carpet'));
  assert.equal(collision.isWalkable(w.read, 0.5, 64.0625, 0.5), true);
  assert.equal(collision.bodyClear(w.read, 0.5, 64, 0.5), false);
});

test('階段: 隣り合う2段の上段に立てて、低い側（0.5下）の隅は許容される', () => {
  const stairs = blockOf('stone_brick_stairs', { 'minecraft:corner': 'none', upside_down_bit: 0, weirdo_direction: 0 });
  const w = flatWorld().put(0, 64, 0, stairs).put(1, 64, 0, stairs);
  // 階段は y=64 のセルにある（床は y=63 の土）。上段の上面は 65.0、下段の上面は 64.5。
  assert.equal(collision.isWalkable(w.read, 1.0, 65, 0.5), true);
  assert.equal(collision.isWalkable(w.read, 1.0, 64, 0.5), false, '上段と重なる高さには立てない');
});

test('surfaceTopAt: 階段の低い側と高い側で上面が違う', () => {
  const stairs = blockOf('stone_brick_stairs', { 'minecraft:corner': 'none', upside_down_bit: 0, weirdo_direction: 0 });
  const w = flatWorld().put(0, 64, 0, stairs);
  assert.deepEqual(collision.surfaceTopAt(w.read, 0.25, 0.5, 66, 62), { top: 64.5 });
  assert.deepEqual(collision.surfaceTopAt(w.read, 0.75, 0.5, 66, 62), { top: 65 });
});

test('足場の端: 隅の1つが穴・未読込なら立てない', () => {
  const hole = makeWorld().fill(-3, 63, -3, 0, 63, 3, blockOf('dirt'));        // x>=1 側に床が無い
  assert.equal(collision.isWalkable(hole.read, 0.5, 64, 0.5), true, 'x=0.5 の隅は 0.21〜0.79 で全て床の上');
  assert.equal(collision.isWalkable(hole.read, 0.9, 64, 0.5), false, '隅が x>=1 のセル（穴）にはみ出す');

  const unloaded = p => (Math.floor(p.x) >= 1 ? null : flatWorld().read(p));
  assert.equal(collision.isWalkable(unloaded, 0.9, 64, 0.5), false, '未読込（null）は不可');
  assert.equal(collision.bodyClear(unloaded, 0.9, 64, 0.5), false);
});

// --- ツタ・はしご・危険ブロック ---------------------------------------------

test('ツタ: 形状は空でも、プレイヤーの箱が重なると接触・通行不可になる', () => {
  const w = flatWorld().put(1, 64, 0, blockOf('vine'));
  assert.equal(collision.touchesClimbable(w.read, 0.69, 64, 0.5), false, '箱の右端が x=0.989 でセルに届かない');
  assert.equal(collision.touchesClimbable(w.read, 0.8, 64, 0.5), true);
  assert.equal(collision.bodyClear(w.read, 0.8, 64, 0.5), false, '旧実装と同じく登攀可能セルに重なる位置は通行不可');
  assert.equal(collision.bodyClear(w.read, 0.69, 64, 0.5), true);
  assert.equal(collision.isPassable(blockOf('vine')), false, 'ツタを通行可能扱いにしない');
  assert.equal(collision.isSolidFloor(blockOf('vine')), false);
});

test('頭の高さにあるツタにも接触を検知する', () => {
  const w = flatWorld().put(1, 65, 0, blockOf('vine'));       // 体の上半分の高さ
  assert.equal(collision.touchesClimbable(w.read, 0.8, 64, 0.5), true);
  const high = flatWorld().put(1, 66, 0, blockOf('vine'));    // 頭より上（箱は y=65.8 まで）
  assert.equal(collision.touchesClimbable(high.read, 0.8, 64, 0.5), false);
});

test('危険ブロック: 水・溶岩・クモの巣は体にも足場にもできない', () => {
  const w = flatWorld().put(0, 64, 0, blockOf('web'));
  assert.equal(collision.bodyClear(w.read, 0.5, 64, 0.5), false, 'web は衝突形状が空でも通れない扱い');
  const water = makeWorld().fill(-3, 63, -3, 3, 63, 3, blockOf('water')).fill(-3, 62, -3, 3, 62, 3, blockOf('dirt'));
  assert.equal(collision.isWalkable(water.read, 0.5, 64, 0.5), false, '水面の上に立てない');
  assert.equal(collision.isWalkable(water.read, 0.5, 63, 0.5), false, '水の中に立てない');
  const lava = flatWorld().put(0, 64, 0, blockOf('lava'));
  assert.equal(collision.bodyClear(lava.read, 0.5, 64, 0.5), false);
});

test('足元より下のセルにあるツタ・水は、体の判定（bodyClear）には影響しない', () => {
  const w = makeWorld().fill(-3, 63, -3, 3, 63, 3, blockOf('dirt')).put(0, 64, 0, blockOf('vine')).put(1, 64, 0, blockOf('water'));
  assert.equal(collision.bodyClear(w.read, 0.5, 65, 0.5), true, 'y=64 のツタは足元(y=65)より下のセル');
  assert.equal(collision.bodyClear(w.read, 1.5, 65, 0.5), true, '足元より下の水は bodyClear では見ない（足場側で不可になる）');
  assert.equal(collision.isWalkable(w.read, 1.5, 65, 0.5), false, '水面の上には立てない');
});

test('危険ブロックの名前: 旧正規表現との差分を固定する', () => {
  const old = /lava|water|fire|cactus|magma|campfire|berry|powder_snow/;
  const names = Object.keys(registry.blocksByName);
  const addedByNew = names.filter(n => HAZARD.test(n) && !old.test(n));
  assert.deepEqual(addedByNew, ['web']);
  const droppedByNew = names.filter(n => old.test(n) && !HAZARD.test(n));
  for (const n of droppedByNew) {
    assert.match(n, /^(dead_)?fire_coral|^firefly_bush$|^cactus_flower$|^underwater_/, `${n} を危険扱いから外す理由がありません`);
  }
  for (const n of ['water', 'flowing_water', 'lava', 'flowing_lava', 'fire', 'soul_fire', 'cactus', 'magma', 'campfire', 'soul_campfire', 'sweet_berry_bush', 'powder_snow', 'waterlily']) {
    assert.ok(HAZARD.test(n), `${n} は危険扱いのまま`);
  }
  assert.ok(isHazard({ name: 'web' }) && !isHazard({ name: 'stone' }) && !isHazard(null));
});

test('登攀可能ブロックの名前がレジストリに実在する', () => {
  for (const n of CLIMBABLE) assert.ok(registry.blocksByName[n], `${n} がレジストリにありません`);
  assert.equal(isClimbable({ name: 'ladder' }), true);
  assert.equal(isClimbable({ name: 'stone' }), false);
});

// --- 着地 ---------------------------------------------------------------------

test('landing: 落下範囲内で最も高い実際の上面を返す（全セル読込済みなら unknown=false）', () => {
  const slab = blockOf('oak_slab', { 'minecraft:vertical_half': 'bottom' });
  const w = flatWorld().put(0, 64, 0, slab);
  assert.deepEqual(collision.landing(w.read, 0.5, 0.5, 66, 63), { top: 64.5, unknown: false }, 'スラブの上面');
  assert.deepEqual(collision.landing(w.read, 2.5, 0.5, 66, 63), { top: 64, unknown: false }, '土の上面');
  assert.deepEqual(collision.landing(w.read, 2.5, 0.5, 66, 64.5), { top: null, unknown: false }, '範囲内に足場が無い');
  const water = makeWorld().fill(-3, 63, -3, 3, 63, 3, blockOf('water'));
  assert.deepEqual(collision.landing(water.read, 0.5, 0.5, 66, 60), { top: null, unknown: false }, '水には着地しない');
});

test('landing: 未読込のセルは「何も無い」とみなさず unknown を返す', () => {
  // x>=1 のセルは未読込（null）。足元の4隅のうち x=1.19 の隅が未読込セルにかかる。
  const w = flatWorld();
  const partlyLoaded = p => (Math.floor(p.x) >= 1 ? null : w.read(p));
  const result = collision.landing(partlyLoaded, 0.9, 0.5, 66, 63);
  assert.equal(result.unknown, true);
  assert.equal(result.top, 64, '読込済みの側の足場は見つかる。ただし unknown なので呼び出し側は安全側に倒す');
  // 全面が未読込なら top は無く unknown のみ
  assert.deepEqual(collision.landing(() => null, 0.5, 0.5, 66, 63), { top: null, unknown: true });
  // 形状不明のブロックも unknown
  const odd = makeWorld().put(0, 64, 0, { name: 'unknown_block', stateId: 1 });
  assert.equal(collision.landing(odd.read, 0.5, 0.5, 66, 63).unknown, true);
});

test('bodyClear: 足元の1セル下が未読込・形状不明なら通行不可（見落としを防ぐ）', () => {
  const w = flatWorld();
  const belowUnloaded = p => (Math.floor(p.y) === 63 ? null : w.read(p));
  assert.equal(collision.bodyClear(w.read, 0.5, 64, 0.5), true, '全て読込済みなら通れる');
  assert.equal(collision.bodyClear(belowUnloaded, 0.5, 64, 0.5), false, '足元の1セル下が未読込');
  const belowOdd = p => (Math.floor(p.y) === 63 ? { name: 'unknown_block', stateId: 1 } : w.read(p));
  assert.equal(collision.bodyClear(belowOdd, 0.5, 64, 0.5), false, '足元の1セル下が形状不明');
  assert.equal(collision.isWalkable(belowUnloaded, 0.5, 64, 0.5), false);
});

test('STRICT_FLOOR: 整数ノード用。4隅のどれかが低い位置（スラブの縁など）は通さない', () => {
  // 床は y=63 の土（上面 64）。x=1 のセルだけ下付きスラブ（上面 63.5）に置き換える。
  const slab = blockOf('oak_slab', { 'minecraft:vertical_half': 'bottom' });
  const w = flatWorld().put(1, 63, 0, slab);
  assert.equal(collision.isWalkable(w.read, 0.9, 64, 0.5), true, '既定では 0.5 下の隅を許容する');
  assert.equal(collision.isWalkable(w.read, 0.9, 64, 0.5, STRICT_FLOOR), false, 'STRICT_FLOOR では不可');
  assert.equal(collision.isWalkable(w.read, 0.5, 64, 0.5, STRICT_FLOOR), true, '隅が全て土の上なら可');
  // 整数の高さの床でないもの（スラブ・カーペット）の上には、整数の足元高さでは立てない
  const onSlab = flatWorld().put(0, 63, 0, slab);
  assert.equal(collision.isWalkable(onSlab.read, 0.5, 64, 0.5, STRICT_FLOOR), false, 'スラブ上は 63.5 が足元の高さ');
  const onCarpet = flatWorld().put(0, 64, 0, blockOf('white_carpet'));
  assert.equal(collision.isWalkable(onCarpet.read, 0.5, 64, 0.5, STRICT_FLOOR), false, 'カーペットと重なる');
});

// --- 共有インスタンス ---------------------------------------------------------

test('configureCollision で共有インスタンスを設定できる', () => {
  const c = configureCollision(registry);
  assert.equal(activeCollision(), c);
  assert.equal(typeof c.bodyClear, 'function');
  assert.ok(EPS > 0 && EPS < 0.01);
});
