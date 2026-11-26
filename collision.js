// collision.js — Bedrock の衝突形状（minecraft-data の blockCollisionShapes）に基づく当たり判定。
//
// 既存の boundingBox（'block' / 'empty' の二値）判定を置き換えるための新規モジュール。
// 既存ファイルは変更しない。組み込み手順は TAKEN_REVIEW_FOR_CODEX.md の WP1 を参照。
//
// 使い方:
//   const collision = createCollision(registry);        // registry は prismarine-registry の bedrock_<version>
//   collision.bodyClear(read, feetX, feetY, feetZ)      // read(p) は controls.block と同じ形（{name, stateId, ...} か null）
//
// 座標: x,y,z は「足元」の座標。read には小数座標を渡す（block() 側で floor される）。
//       本モジュールはセルの中心で read を呼ぶ。
// 形状: registry.blockCollisionShapes.shapes の [x1,y1,z1,x2,y2,z2]（ブロック内座標、0〜1）。

export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;           // 立位。スニーク・水泳姿勢は扱わない
export const FOOT_OFFSET = 0.29;            // 足元判定の幅（step-movement.js の offsets と同じ値）
export const EPS = 1e-3;                    // 浮動小数点誤差の許容。面が接するだけなら重なりとみなさない
export const FULL_CUBE = Object.freeze([Object.freeze([0, 0, 0, 1, 1, 1])]);
const EMPTY = Object.freeze([]);

// Bedrock 1.26.60 のレジストリに存在する登攀可能ブロック。接触すると登攀状態になる。
export const CLIMBABLE = new Set([
  'vine', 'ladder', 'scaffolding', 'weeping_vines', 'twisting_vines',
  'cave_vines', 'cave_vines_head_with_berries', 'cave_vines_body_with_berries',
]);

// 危険ブロック。旧実装の正規表現（lava|water|fire|cactus|magma|campfire|berry|powder_snow）は
// 部分一致で fire_coral* / firefly_bush / cactus_flower なども危険扱いしていたため、名前を明示する。
// 旧実装との差分: 追加 = web（衝突形状が空でも移動を妨げる）。除外 = fire_coral*, firefly_bush, cactus_flower 等。
// waterlily（スイレン）は水面上にあるため、従来どおり危険扱いにする。
export const HAZARD = /^(flowing_)?(water|lava)$|^waterlily$|^(soul_)?fire$|^cactus$|^magma$|^(soul_)?campfire$|^sweet_berry_bush$|^powder_snow$|^web$/;

// 整数ノードの経路探索（WP1a）用。足場の上面が足元の高さ y とほぼ一致する床だけを通す。
// 4隅のどれかが y より低い（スラブ・階段の低い側・段差の縁など）位置は通行不可になる。
// 使い方: collision.isWalkable(read, x, y, z, STRICT_FLOOR)
export const STRICT_FLOOR = Object.freeze({ maxDrop: 0 });

export const isClimbable = block => CLIMBABLE.has(block?.name);
export const isHazard = block => HAZARD.test(block?.name ?? '');

/** 形状の最も高い上面（ブロック内座標）。形状が空なら null。 */
export function topOf(shapes) {
  if (!shapes || !shapes.length) return null;
  let top = -Infinity;
  for (const s of shapes) if (s[4] > top) top = s[4];
  return top;
}

export function createCollision(registry) {
  const table = registry?.blockCollisionShapes;
  if (!table?.blocks || !table?.shapes) {
    throw new Error('レジストリに blockCollisionShapes がありません。minecraft-data / prismarine-registry の版を確認してください。');
  }
  // legacyFallback: stateId が無いブロック（テストのスタブ）を従来の二値で扱った回数。実ブロックで増えたら要調査。
  // unknownShape: 形状を引けなかった回数。安全側（通行・足場とも不可）に倒している。
  const stats = { legacyFallback: 0, unknownShape: 0 };
  const cache = new Map();                  // stateId → shapes

  /**
   * ブロックの衝突形状を返す。形状を引けない場合は null（呼び出し側は安全側＝歩行不可として扱う）。
   * 形状の引き方: shapes[ blocks[name][stateId - minStateId] ]。
   * prismarine-block の Block に minStateId は無いので、registry.blocksByName[name].minStateId を使う。
   */
  function shapesOf(block) {
    if (!block) return null;
    if (block.stateId === undefined || block.stateId === null) {
      stats.legacyFallback++;
      if (block.boundingBox === 'block') return FULL_CUBE;
      if (block.boundingBox === 'empty') return EMPTY;
      stats.unknownShape++;
      return null;
    }
    const hit = cache.get(block.stateId);
    if (hit !== undefined) return hit;
    const definition = registry.blocksByName[block.name];
    const entry = table.blocks[block.name];
    let shapes;
    if (definition && entry !== undefined) {
      const id = Array.isArray(entry) ? entry[block.stateId - definition.minStateId] : entry;
      shapes = id === undefined ? undefined : table.shapes[id];
    }
    if (!shapes) {
      stats.unknownShape++;
      return null;
    }
    cache.set(block.stateId, shapes);
    return shapes;
  }

  const cellBlock = (read, cx, cy, cz) => read({ x: cx + 0.5, y: cy + 0.5, z: cz + 0.5 });

  /** 床として使えるブロックか（形状があり、危険でない）。 */
  function isSolidFloor(block) {
    if (!block || isHazard(block)) return false;
    const shapes = shapesOf(block);
    return Boolean(shapes && shapes.length);
  }

  /** 体が通れるブロックか（形状が空で、危険でも登攀可能でもない）。 */
  function isPassable(block) {
    if (!block || isHazard(block) || isClimbable(block)) return false;
    const shapes = shapesOf(block);
    return Boolean(shapes && shapes.length === 0);
  }

  // 足元(x,y,z)に置いたプレイヤーの当たり判定を、EPS だけ縮めた箱で返す。
  function playerBox(x, y, z, { width = PLAYER_WIDTH, height = PLAYER_HEIGHT } = {}) {
    const half = width / 2;
    return { x1: x - half + EPS, x2: x + half - EPS, y1: y + EPS, y2: y + height - EPS, z1: z - half + EPS, z2: z + half - EPS };
  }

  // 箱が重なるセルを列挙する。extraBelow=true のときは足元の1セル下も含める（below=true で区別）。
  // フェンスや壁の衝突形状は高さ1.5で、置かれたセルの1つ上まではみ出すため。
  function* overlappedCells(box, extraBelow = false) {
    const yFeet = Math.floor(box.y1);
    for (let cx = Math.floor(box.x1); cx <= Math.floor(box.x2); cx++)
      for (let cy = yFeet - (extraBelow ? 1 : 0); cy <= Math.floor(box.y2); cy++)
        for (let cz = Math.floor(box.z1); cz <= Math.floor(box.z2); cz++) yield [cx, cy, cz, cy < yFeet];
  }

  /**
   * 足元(x,y,z)にプレイヤーを置いたとき、体が何にも当たらないか。
   * 未読込（read が null）、形状不明、危険ブロック、登攀可能ブロックのセルに重なる場合は false。
   * 足元の1セル下も、未読込・形状不明なら false（上にはみ出す形状を見落とさないため）。
   */
  function bodyClear(read, x, y, z, options) {
    const box = playerBox(x, y, z, options);
    for (const [cx, cy, cz, below] of overlappedCells(box, true)) {
      const block = cellBlock(read, cx, cy, cz);
      if (below) {
        // 足元より下のセルは、上にはみ出す形状（フェンス等）の重なりだけを見る。
        // 危険・登攀可能の判定は足場側（surfaceTopAt / isWalkable）が行う。
        // 未読込（null）や形状不明は「何も無い」とみなさず、安全側（通行不可）に倒す。
        const lower = block && shapesOf(block);
        if (!lower) return false;
        for (const s of lower) {
          if (cx + s[0] < box.x2 && cx + s[3] > box.x1 && cy + s[1] < box.y2 && cy + s[4] > box.y1 && cz + s[2] < box.z2 && cz + s[5] > box.z1) return false;
        }
        continue;
      }
      if (!block || isHazard(block) || isClimbable(block)) return false;
      const shapes = shapesOf(block);
      if (shapes === null) return false;
      for (const s of shapes) {
        if (cx + s[0] < box.x2 && cx + s[3] > box.x1 && cy + s[1] < box.y2 && cy + s[4] > box.y1 && cz + s[2] < box.z2 && cz + s[5] > box.z1) return false;
      }
    }
    return true;
  }

  /**
   * プレイヤーの箱が登攀可能ブロックのセルに重なっているか（形状は空でも接触すれば登攀状態になる）。
   * 未読込のセルは「接触なし」として扱う。通行可否の判定には使わず、bodyClear / isWalkable（未読込は不可）と併用すること。
   */
  function touchesClimbable(read, x, y, z, options) {
    const box = playerBox(x, y, z, options);
    for (const [cx, cy, cz] of overlappedCells(box)) {
      if (isClimbable(cellBlock(read, cx, cy, cz))) return true;
    }
    return false;
  }

  /**
   * 点(px,pz)の真下で、yHigh 以下にある最初の足場の上面（ワールド座標）を探す。
   * 戻り値: { top: number } / { top: null, hazard: true } / { top: null, unknown: true } / { top: null }
   * 上から順に見るので、足場より先に危険ブロック（水・溶岩など）が見つかれば hazard になる。
   */
  function surfaceTopAt(read, px, pz, yHigh, yLow) {
    const cx = Math.floor(px), cz = Math.floor(pz);
    const lx = px - cx, lz = pz - cz;
    for (let cy = Math.floor(yHigh); cy >= Math.floor(yLow); cy--) {
      const block = cellBlock(read, cx, cy, cz);
      if (!block) return { top: null, unknown: true };
      if (isHazard(block)) return { top: null, hazard: true };
      const shapes = shapesOf(block);
      if (shapes === null) return { top: null, unknown: true };
      let best = null;
      for (const s of shapes) {
        if (lx < s[0] - EPS || lx > s[3] + EPS || lz < s[2] - EPS || lz > s[5] + EPS) continue;
        const top = cy + s[4];
        if (top <= yHigh + EPS && (best === null || top > best)) best = top;
      }
      if (best !== null) return { top: best };
    }
    return { top: null };
  }

  /**
   * 足元(x,y,z)に立てるか。
   * - 体が何にも当たらない（bodyClear）
   * - 足元の4隅すべてに足場がある（穴・危険ブロック・未読込は不可。旧 walkable と同じく崖際には立たない）
   * - 4隅の足場の上面は y から maxDrop 以内（階段の低い側などは許容）
   * - 少なくとも1隅が y ちょうどで支えている
   */
  function isWalkable(read, x, y, z, options = {}) {
    const { maxDrop = 0.5, tolerance = 0.05 } = options;
    if (!bodyClear(read, x, y, z, options)) return false;
    let supported = false;
    for (const ox of [-FOOT_OFFSET, FOOT_OFFSET]) {
      for (const oz of [-FOOT_OFFSET, FOOT_OFFSET]) {
        const { top } = surfaceTopAt(read, x + ox, z + oz, y + EPS, y - 1.01);
        if (top === null || y - top > maxDrop + EPS) return false;
        if (Math.abs(top - y) <= tolerance) supported = true;
      }
    }
    return supported;
  }

  /**
   * from から to へ落ちる（または立っている）とき、足が着く最も高い上面を探す。
   * 旧 step-movement.js の landing と同じ意味だが、形状の実際の上面を使い、未読込を「不明」として返す。
   * 戻り値: { top: number | null, unknown: boolean }
   *  - top: 範囲 [to, from] にある最も高い上面。無ければ null。水・溶岩などの危険ブロックは着地面にしない。
   *  - unknown: 走査したセルに未読込（read が null）または形状不明のものがあった。
   *    旧実装は未読込を「何も無い」とみなして落下を続けた。unknown が true のときは、
   *    呼び出し側が停止・地形の再要求など安全側に倒すこと（top が見つかっていても、より高い足場が未読込側にあり得る）。
   */
  function landing(read, x, z, from, to) {
    let best = null;
    let unknown = false;
    for (const ox of [-FOOT_OFFSET, FOOT_OFFSET]) {
      for (const oz of [-FOOT_OFFSET, FOOT_OFFSET]) {
        const px = x + ox, pz = z + oz;
        const cx = Math.floor(px), cz = Math.floor(pz);
        const lx = px - cx, lz = pz - cz;
        for (let cy = Math.floor(from + EPS); cy >= Math.floor(to - EPS) - 1; cy--) {
          const block = cellBlock(read, cx, cy, cz);
          if (!block) { unknown = true; continue; }
          if (isHazard(block)) continue;
          const shapes = shapesOf(block);
          if (!shapes) { unknown = true; continue; }
          for (const s of shapes) {
            if (lx < s[0] - EPS || lx > s[3] + EPS || lz < s[2] - EPS || lz > s[5] + EPS) continue;
            const top = cy + s[4];
            if (top >= to - EPS && top <= from + EPS && (best === null || top > best)) best = top;
          }
        }
      }
    }
    return { top: best, unknown };
  }

  return {
    stats, shapesOf, isSolidFloor, isPassable, isClimbable, isHazard,
    bodyClear, touchesClimbable, surfaceTopAt, isWalkable, landing,
  };
}

// RealmControls のコンストラクタで一度だけ設定し、step-movement.js などから参照するための共有インスタンス。
let active = null;
export function configureCollision(registry) {
  active = createCollision(registry);
  return active;
}
export function activeCollision() {
  if (!active) throw new Error('configureCollision(registry) が呼ばれていません。');
  return active;
}
