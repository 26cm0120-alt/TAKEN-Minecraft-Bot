# TAKEN Bot レビュー・改修指示書（Codex向け）v2

対象: `TAKEN-source-20261118.zip`（`C:\mc-server\AI\aibot-realms` の本体直下スナップショット、2026-11-18）
前提文書: `AI_REVIEW_HANDOFF.md`（構成・作業ルール）。この文書はその続きとして、**地形認識・移動・自律行動の精度**に絞った所見と作業指示をまとめる。
同梱物: `collision.js`（参考実装）、`collision.test.js`（23件）。両ファイルは現在リポジトリに収録済み。

- **Realms（統合版）で遊び続ける。** Java/Paper/Geyser/Bedrock Dedicated Server への移行は行わない。
- 目標: 地形視認と移動の信頼性を上げ、その上で自律行動（探索・採掘・回収）の成功率を数字で追えるようにする。
- 行番号は 2026-11-18 のスナップショット基準。ずれた場合は関数名で検索すること。

**2026-11-26現在：手順1〜3は完了、手順4のログ採取中。** §3の所見は11月18日の変更前コードを対象とする。現在の実装と試行結果は[引き継ぎ §7](AI_REVIEW_HANDOFF.md)、試験方法は[採取手順書](WP0-計測とベースライン採取.md)を参照。

## 0. v1 からの変更点（Codex の指摘の反映）

1. **WP0 の記録設計を修正。** `server_post_move` は位置しか持たない（tick・時刻なし）。Bot も受信時刻を持たない。そのため、受信時刻・ラグ推定・古さの扱いを計測の中核にした（WP0）。
2. **WP2 の「差が 0.3 を超えたら同期」を撤回。** 1〜2tick の遅れだけで正常な移動でも超えうる。WP0 のデータが出るまで保留し、要件だけ定めた（WP2）。
3. **WP1 を 1a / 1b に分割。** 経路探索のノードが整数の y なので、`collision.js` を差し替えるだけでは半ブロック（スラブ・階段）を経路に使えない。1a は整数ノードのまま安全側に倒し、1b でノードに立つ高さを持たせる。
4. **未読込の扱いを「無い」から「不明」へ。** `collision.js` の `landingTop`（未読込を読み飛ばしていた）を `landing`（`{top, unknown}` を返す）に置き換え、`bodyClear` も足元の1セル下が未読込なら不可にした。既存コード側の同種の判定も対処項目にした（F7）。
5. **作業順を固定。** WP0（計測）→ ベースライン採取 → WP1a。ベースライン採取前に移動挙動を変えない。
6. **テスト件数を訂正。** 手順1で273件を実測。WP0反映直後は312件、直近は313件成功（Node v26.13.0）。

## 1. 作業の進め方（この順で）

| 手順 | 内容 | 担当 | 次へ進む条件 |
|---|---|---|---|
| 1 | ベースライン: Node 24 以降で `run-tests.js` を実行し、変更前のテスト件数・成否を記録する | Codex | 件数と成否を記録した |
| 2 | `collision.js` / `collision.test.js` を本体直下に置く（既存ファイルは変更しない）。`node --test collision.test.js` が通ることを確認 | Codex | 23件成功 |
| 3 | WP0 を実装する（計測のみ。挙動は変えない） | Codex | 受け入れ条件（WP0）を満たす |
| 4 | **変更前のベースラインログ**を実Realmで採取する（§6 のシナリオ1〜3）。起動ログの `[移動方式]` の行を含める | ユーザー | ログを入手した |
| 5 | ログを判定する（WP0 の判定基準）。WP2 の要否と閾値を決める | ユーザー＋Claude＋Codex | 判定が出た |
| 6 | WP1a を組み込む。同じシナリオで変更後のログを採取し、手順4と比較する | Codex / ユーザー | 補正が増えていない |
| 7 | 結果に応じて WP2 → WP1b → WP3 → WP4 → WP5 | Codex | 各 WP の受け入れ条件 |

**ゲート:** 手順4が済む前に移動の挙動を変えない（定数・経路・判定の変更を含む）。ベースラインが汚れると、改善の効果を測れなくなる。

## 2. 検証の範囲

| 区分 | 内容 |
|---|---|
| 確認済み | ソースの静的読解、`npm ci --ignore-scripts` 後の minecraft-data / prismarine-registry の実データ確認、`collision.js` の単体テスト |
| テスト内訳（レビュー環境 Node 22） | 既存260件（下記2ファイルを除く）は全成功。`realm-crafting.test.js` と `session-survival.test.js` は、個々のテスト6件は成功するが、ファイル単位で `Unable to deserialize cloned data due to invalid or unsupported version.` の例外が出る（`collision.js` を外しても同じ。Node 22 のテストランナー由来とみられる）。新規 `collision.test.js` は23件成功。`run-tests.js` は `--test-isolation=none` が Node 22.23 で使えず未実行 |
| **未検証** | **実Realmでの所定の試験一式とH1の判定。** Realmの移動方式（`[移動方式]` ログの `authority` 値）、補正の頻度、通信遅延の分布、ジャングルでの実地形 |

以降、**事実**（コード・データで確認）と**仮説**（実機計測が必要）を区別して書く。

## 3. 所見

### F1. 衝突判定が粗い【事実】

- 該当: `step-movement.js:2`（`solid`）、`:11`（`bodyClear`）、`:15`（`safeBelow`）、`:17`（`landing`）、`realm-controls.js:319-326`（`walkable`）。
- 現状は minecraft-data の `boundingBox`（`'block'` か `'empty'` の二値）だけで判定している。`boundingBox` を直接見ている箇所は他にも多い:
  `realm-controls.js:323, 556, 557, 558, 630, 696, 711` / `branch-mining.js:43` / `dragon-planner.js:28` / `action-agent.js:150` / `resource-search.js:22` / `surface-swimming.js:2, 14`
- 二値の結果（`bedrock_1.26.60` で確認）:
  - `'block'`（フルブロック扱い）: `oak_slab`, `stone_brick_stairs`, `oak_fence`, `white_carpet`, `bamboo`, `cocoa`, `farmland`, `waterlily`, `candle`, `lantern`, `chest`, `soul_sand`, `mud`, `cauldron`, `campfire`
  - `'empty'`（空気扱い）: `web`, `snow_layer`, `sweet_berry_bush`, `scaffolding`, `small_dripleaf_block`, `vine`, `ladder`
- **同じデータに正確な形状がある。** `blockCollisionShapes`（`registry.blockCollisionShapes`）は 1480 ブロック全てに定義があり（形状460種）、Bot は使っていない。

検証済みの形状（ブロック内座標 `[x1,y1,z1,x2,y2,z2]`）:

| ブロック（状態） | 形状 | 上面の高さ |
|---|---|---|
| `oak_slab`（bottom） | `[[0,0,0,1,0.5,1]]` | 0.5 |
| `oak_slab`（top） | `[[0,0.5,0,1,1,1]]` | 1.0 |
| `stone_brick_stairs`（`weirdo_direction`=0） | `[[0,0,0,1,0.5,1],[0.5,0.5,0,1,1,1]]` | 1.0（段あり） |
| `oak_fence`（全状態） | 柱 `[0.375,0,0.375,0.625,1.5,0.625]` ほか | **1.5** |
| `white_carpet` | `[[0,0,0,1,0.0625,1]]` | 0.0625 |
| `ladder`（`facing_direction`=2） | `[[0,0,0.8125,1,1,1]]` | 薄板 |
| `vine`（全16状態） | `[]`（衝突なし） | なし |

**状態インデックスの注意（検証済み）:** 形状は `shapes[ blocks[name][ stateId - minStateId ] ]` で引く。ただし **`prismarine-block` の Block オブジェクトに `minStateId` は無い**（`undefined` になり `NaN` → 空配列を返す）。`minStateId` は `registry.blocksByName[name].minStateId` から取ること。slab・stairs・ladder で、状態プロパティと形状の対応が正しいことを確認済み。

### F2. 自己位置が開ループ（推測航法）【事実】＋ 因果は【仮説H1】

事実（移動）:
- `realm-controls.js:183` で 50ms ごとに `step()` を実行。1tickの水平移動量は `step-movement.js:55` で歩行 0.1 / ダッシュ 0.13（`realm-controls.js:343` にも同値）。前進入力（`move_vector.z=1`）は常に最大値で送信している。
- バニラの一般的な値は歩行 約0.216、走行 約0.28 ブロック/tick（4.317 / 5.612 ブロック/秒）。**Botの自己計算の移動量は、前進入力に対して約半分。** 一般的な値であり、Realmでの実測は未確認。
- 計画・採掘・到着判定は `this.position`（自己計算）を基準にする。サーバーが返す `server_post_move` の位置（`realm-controls.js:122-129`）は `serverPosition` に保存されるだけで、歩行ループ（`goto`、`:429-432`）では使われない。
- サーバー位置との照合は、歩行完了後の2秒確認（`:444-450`）と `correct_player_move_prediction` 受信時（`:134-140`）だけ。

事実（`serverPosition` の信頼性。Codex の指摘で追加）:
- `server_post_move` パケットは **`position`（vec3f）しか持たない。tick も時刻も無い。** `correct_player_move_prediction` と `player_auth_input` には `tick` がある。
- Bot は権威位置（`serverPosition` / `lastAuthoritativePosition`）を、受信時刻なしで保存している。`lastAuthoritativeSource` で更新元だけは分かる。
- `serverPosition` の代入箇所は `start_game`、`server_post_move`、`respawn` の3か所で、`change_dimension` では `null` にする。**補正（`correct_player_move_prediction`）を受けても更新されない**（代入箇所の grep による。Codex も再確認すること）。
- したがって「現在の内部位置と `serverPosition` の差」には、(1) 通信遅延による見かけの差、(2) 古い値、(3) 補正後の取り残し、が混ざる。1〜2tick の遅れで 0.1〜0.4 ブロック程度の見かけの差が出うる（見積もり）。

**仮説H1:** Realmがサーバー権威移動で入力から位置を計算している場合、実体のアバターは内部位置より先を歩く。Botは「まだ手前」と判断したまま、実体がツタ等に接触していても気づけない。ユーザー報告「ツタを登り予定経路を外れる」の説明になりうる。
- 検証は WP0 の「ラグ補正後の差」で行う。**現在値との単純な差で判断してはならない。**

### F3. 経路探索の分散と失敗記憶の欠如【事実】

- `planStepPath`（`step-movement.js:22`）: 4方向BFS、高低差 {0,+1,-1} のみ、開始点から半径24・±8・5000ノードまで、コスト無し（危険箇所の近傍にペナルティが無い）。斜め移動なし。**ノードの y は整数。**
- `resource-search.js:58-60` に、同種の探索の別実装がある。`long-travel.js`・`realm-pickup.js`・`branch-mining.js` は独自の `walkable` 判定と `goto` を使う。
- `resource-search.js` の `visited` / `blocked`（半径3）は探索1回の間だけ有効。補正・ツタ接触・スタックの記録は、モジュール間で共有されない。
- これが `AI_REVIEW_HANDOFF.md` §8-1「後段で危険な地点を選び直さないか」の根拠。

### F4. LLM出力の実在確認がない【事実】

- `action-agent.js:144`: `item` / `block` / `tool` は `{type:'string'}`（自由文字列）。`validatePlan`（`:131-135`）は `^[a-z0-9_]{1,64}$` の**形式**しか見ない。**`wooden_knife` は検証を通る。**
- `planning-prompt.js` の「木のナイフは存在しない」は個別対処であり、同種の誤りは再発する。
- 良い点: `type`・`direction`・`mode`・`target` は enum 制約済み。
- `local-ai-request.js:8`: `AI_GAME_PRIORITY` が `'0'` 以外なら `keep_alive:0`（毎回アンロード、初回ロード約16秒）。`'0'` のときは `'5m'`。

### F5. `update_subchunk_blocks` が未処理【事実。影響は未確認】

- `realm-controls.js` は `update_block` / `update_block_synced` のみ処理。`update_subchunk_blocks` は 0 件。
- プロトコル定義: `{x, y, z（zigzag32）, blocks: BlockUpdate[], extra: BlockUpdate[]}`。`BlockUpdate` の項目名は未確認（`node_modules/minecraft-data/minecraft-data/data/bedrock/1.26.60/protocol.json` で確認すること）。
- 実Realmでどの程度届くかは不明。WP0 で受信件数を取る。

### F6. 棄却された仮説

- 「ブロックIDのずれ」: minecraft-data 3.119.0 に `bedrock_1.26.60` のデータがある（1480ブロック、protocol 2225、`blockHashes` 対応）。データ上は接続版と一致。
- ただし実機で未知IDが出ると、`loadChunk` / `loadSubchunks` は例外を catch してログ（`チャンク読取:` / `地形読取:`）に出し、そのサブチャンクを読込済みにしない。**地形の穴の原因になりうるため、件数を WP0 で集計する。**

### F7. 未読込の地形を「無い」とみなす判定【事実（コードの読み）。Codex が全箇所を確認すること】

- `step-movement.js` の `landing`（`:17`）は `solid(read(...))` で足場を探す。`solid` は `b && ...` なので、未読込（`read` が `null`）は「足場なし」として扱われ、落下が続く。`safeBelow`（`:15`）ほか、`null` を黙って読み飛ばす判定がないか grep で洗い出すこと（`bodyClear` は `null` で `false` を返すので問題ない）。
- 未読込は、サブチャンクの境界や、読込直後に起こりうる。足場がある地形を「無い」と誤認して落ちる原因になりうる。
- 方針: 未読込は「不明」として扱い、**停止して地形を再要求（`requestNearby`）し、一定時間で失敗として報告**する。`collision.js` の `landing` は `unknown` を返すので、呼び出し側でこの方針を実装する。

## 4. 作業パッケージ

### WP0. 計測ログ（挙動を変えない）

目的: (1) H1 の検証、(2) 通信遅延（ラグ）の推定、(3) 補正の発生条件の特定、(4) 未処理パケットと地形エラーの量の把握。

記録の仕組み:
1. **予測位置の履歴。** 毎tick（`player_auth_input` を送るたび）に `{localTick, authInputTick, t(ms), position}` をリングバッファ（例: 直近40tick）へ保存する。
2. **権威位置イベント。** 次の各受信で `{t(ms), source, position}` を記録する: `server_post_move`、`correct_player_move_prediction`（`tick` も）、`move_player`（テレポート）、`respawn`、`start_game`、`change_dimension`。既存の `serverPosition` / `lastAuthoritativePosition` の意味は変えず、**追加フィールド**として持つ。
3. **ラグ補正後の差。** `server_post_move` を受信するたびに、履歴の各ラグ k = 0〜10tick の予測位置との水平距離を計算し、`driftNow`（k=0）、`bestLagTicks`（距離が最小の k）、`driftAtBestLag` を記録する。
4. **補正の誤差。** `correct_player_move_prediction` は `tick` を持つので、**その tick の予測位置**（履歴を `authInputTick` で引く）との差を記録する。ラグ推定が要らず、最も正確な誤差測定になる。
5. **古さ。** 前回の `server_post_move` からの経過 `ageMs` を記録し、歩行中に閾値（例: 200ms）を超えたら `stale:true` を付ける。
6. **抑制窓。** 補正・テレポート・`respawn`・`change_dimension` の直後 N tick（例: 20）は、比較を記録しつつ `suppressed:true` を付ける。

出力と制御:
- 出力は `console.log('[移動計測]', JSON.stringify({...}))` の1行1イベント。歩行中は5tickに1回に間引き、補正時は全件。
- 環境変数 `TAKEN_TELEMETRY=0` で無効化できること。
- **計測コードは、送信パケット・位置・タイマー・ブロック状態を一切変更しない。**

そのほかの記録項目:
- 補正時: 内部位置、補正位置、`delta`、足元・体・頭のブロック名と `stateId`、直前の入力フラグ、直近の補正回数
- 地形: 未知ブロックID例外の件数、サブチャンクdecode失敗の件数、`update_subchunk_blocks` の受信件数（`client.on` で数えるだけ）、`collision.stats`（`legacyFallback` / `unknownShape`。手順6以降）
- 移動1回ごとのサマリ: 歩数、補正数、`driftAtBestLag` の平均と最大、`bestLagTicks` の中央値

受け入れ条件:
- 既存テスト全通過（手順1のベースラインと比較）。
- リングバッファとラグ推定の単体テスト（合成データ: 既知のラグ・欠落・古い値を与えて推定できること）。
- 計測の有無で、送信パケット列が同一であることを確かめるテスト。
- `TAKEN_TELEMETRY=0` で出力が消える。

判定基準（手順5）:

| 観測 | 解釈 | 次の一手 |
|---|---|---|
| 平地歩行で `driftAtBestLag` の最大が小さく（目安 0.1 未満）、`bestLagTicks` が安定 | H1 棄却。速度差は問題でない | WP2 は不要。補正の原因を WP1 に絞る |
| `driftAtBestLag` が歩行距離とともに増える | H1 支持。実体が内部位置より先を歩いている | WP2 を設計する。速度は実測値から決める |
| `driftNow` は大きいが `driftAtBestLag` は小さい | 差はラグ由来。**現在値との単純比較で同期してはならない** | WP2 の比較をラグ補正後に限る |
| 補正が特定のブロック種・段差・水に集中 | 地形モデルの誤り | WP1 の優先度を上げる |

実Realmでの採取（ユーザーが実施）は §6。ログを渡すときは認証コード・トークンを除く。

### WP1. 衝突形状の導入（同梱の `collision.js` を使う）

同梱: `collision.js`（本体）と `collision.test.js`（23件）。`createCollision(registry)` が返すオブジェクトを使う（`configureCollision(registry)` / `activeCollision()` で共有インスタンスも使える）。

| 関数・定数 | 役割 | 置換対象（旧） |
|---|---|---|
| `shapesOf(block)` | 衝突形状。引けなければ `null`（安全側で不可扱い） | `boundingBox` 直接参照 |
| `bodyClear(read,x,y,z)` | 足元(x,y,z)に立った体（0.6×1.8）が何にも当たらないか。足元の1セル下が未読込・形状不明でも不可 | `step-movement.js` の `bodyClear` |
| `isWalkable(read,x,y,z,opts)` | 体が空いていて、4隅に足場があり、いずれかの隅が y で支える。`opts.maxDrop`（既定 0.5）で隅の許容段差を変える | `realm-controls.js` の `walkable` |
| `STRICT_FLOOR` | `isWalkable` に渡す `{maxDrop: 0}`。整数ノード用（WP1a）。4隅のどれかが y より低ければ不可 | — |
| `landing(read,x,z,from,to)` | 足が着く最も高い上面。**`{top, unknown}` を返す**。未読込・形状不明があれば `unknown:true` | `step-movement.js` の `landing` |
| `surfaceTopAt(read,px,pz,yHigh,yLow)` | 点の真下の最初の足場の上面（水・溶岩なら `hazard`、未読込なら `unknown`） | `safeBelow` の下地 |
| `touchesClimbable(read,x,y,z)` | プレイヤーの箱が登攀可能ブロックのセルに重なるか。未読込は「接触なし」なので、通行可否には `bodyClear` / `isWalkable` と併用する | 既存の登攀判定 |
| `isSolidFloor(block)` / `isPassable(block)` | 床にできるか / 体が通れるか | 各所の `boundingBox` 判定 |
| `stats` | `legacyFallback`（`stateId` 無しで二値に落ちた回数）、`unknownShape`（形状不明の回数） | WP0 のログに出す |

実装上の判断（変更する場合は理由を残すこと）:
- **足元の1セル下の形状も重なり判定に含める。** フェンス・壁の形状は高さ1.5で、置かれたセルの1つ上へはみ出す。単体テストで実際にこの見落としが見つかり修正した。足元の1セル下では形状の重なりだけを見て、危険・登攀可能の判定は行わない。
- **未読込・形状不明は安全側。** `bodyClear` と `isWalkable` は不可、`landing` は `unknown:true`。`touchesClimbable` のみ「接触なし」。
- **危険ブロックの正規表現を名前の完全一致に変更した。** 旧 `lava|water|fire|cactus|magma|campfire|berry|powder_snow` は部分一致のため `fire_coral*`・`firefly_bush`・`cactus_flower`・`underwater_*` も危険扱いしていた。新実装は `web` を追加し、`waterlily` は従来どおり危険扱い。差分はテストで固定してある。
- 登攀可能ブロックは Bedrock 1.26.60 に実在する8種（`vine`, `ladder`, `scaffolding`, `weeping_vines`, `twisting_vines`, `cave_vines`, `cave_vines_head_with_berries`, `cave_vines_body_with_berries`）。旧セットの `*_plant` は Bedrock に存在しない。
- `block()` が返す値には `stateId` と `name` が含まれる（チャンク経路は `{...b, name, ...}`、`update_block` 経路は `prismarine-registry` が作る `{stateId, ...}`）。そのまま渡せる。
- 既存テストのスタブは `stateId` が無いので、その場合のみ二値にフォールバックする。ただし既存スタブの一部は小数のサンプル点（例: `y+0.9`）に依存しており、本モジュールはセル中心で `read` を呼ぶため、**組み込み時に一部スタブの更新が必要になる**。
- 性能: `isWalkable` 約0.9μs/回、`landing` 約2.4μs/回（Node 22、平地・全読込）。

#### WP1a. 整数ノードのまま安全側に倒す（手順6）

経路のノード（整数の `cx, cy, cz`）は、足元 `(cx+0.5, cy, cz+0.5)` と読み替える。

- `walkable(x,y,z)` → `collision.isWalkable(read, cx+0.5, cy, cz+0.5, STRICT_FLOOR)`
- `bodyClear` → `collision.bodyClear`、`landing` → `collision.landing`
- `boundingBox` の直接参照（F1 の一覧）→ `isSolidFloor` / `isPassable`
- `touchesClimbable` は、歩行中のツタ接触の検知に使う（既存の登攀判定と置き換え）。ツタを「通行可能」にしてはならない。
- 未読込（`unknown:true` / `bodyClear` の `false`）は F7 の方針（停止 → 地形再要求 → 時間切れで失敗報告）。

効果: 現状「全て block 扱い」でスラブ・階段・フェンスを足場と誤認する問題を止める。
副作用: スラブ・階段・カーペット・フェンスの上や、低い側の縁は通れなくなる。経路が遠回りになるか「経路なし」になる。これは WP1b で解消する。

受け入れ条件: 既存テスト全通過（スタブの更新は根拠を残す）。手順6の変更後ログで、補正が手順4のベースラインより増えていない。

#### WP1b. ノードに立つ高さを持たせる（手順7）

- ノードを `{cx, cz, standY}`（立つ高さの小数）にする。隣接の条件は、`standY` の差が自動段差高さ以内なら歩行、それを超えて +1 以下ならジャンプ、落下は従来どおり ±1 まで。
- **自動段差高さは未確認。** 初期値は 0.5 とし、WP0 の補正ログ（スラブ・階段）で確かめる。
- `advanceStep` の着地（`landing`）と、ノードの `standY` を整合させる。
- ノードの `y` を使う全箇所（`planStepPath`、`resource-search.js:58-60` の探索コピー、`long-travel.js`、`realm-pickup.js`、`branch-mining.js`、`goto`）を洗い出して更新する。
- 受け入れ条件: スラブ・階段・カーペットを含む往復（§6 シナリオ3）が、補正なしで成功する。

テスト（同梱の `collision.test.js`、23件）:
- スラブ・階段4方向・フェンス・カーペット・はしご・ツタの形状が §3 F1 の表と一致する
- 全23,960の `stateId` で形状を引ける（データ版ずれの回帰テスト）
- `stateId` 無しのスタブの二値フォールバックと件数、形状不明は `null`
- フルブロック・スラブ・フェンス・カーペット・階段の立てる・立てない判定
- 隅の1つが穴・未読込なら立てない
- ツタの接触判定（頭の高さ・体の高さ・足元より下）
- 水・溶岩・クモの巣、危険ブロック名の旧正規表現との差分
- `landing` の正常系と、未読込・形状不明の `unknown`
- `bodyClear` が足元の1セル下の未読込・形状不明で不可になる
- `STRICT_FLOOR`（スラブの縁・スラブ上・カーペットで不可）

### WP2. 位置の閉ループ化（**WP0の判定後に設計。v1 の固定閾値案は撤回**）

着手条件: 手順5で H1 が支持された場合のみ。要件:
- 比較は**ラグ補正後**（`bestLagTicks` の予測位置）で行う。「現在の内部位置との単純な差」では同期しない。
- 閾値は WP0 のデータ分布（`driftAtBestLag`）から決める。固定値を先に決めない。
- `ageMs` が閾値を超えた権威位置（`stale`）では同期しない。補正・テレポート・`respawn`・`change_dimension` の直後の抑制窓でも同期しない。
- 連続 N 回の超過でのみ同期する（ヒステリシス）。同期イベントはログに出す。
- 経路からの偏差が大きければ `goto` の再計画に戻す。
- **移動量の定数（0.1 / 0.13）は、WP0 でサーバー側の実移動量を測るまで変更しない。**
- 禁止: 空中・補正中に、予測座標を地面へ書き換えて成功扱いにすること（`AI_REVIEW_HANDOFF.md` §8-2）。
- テスト: 擬似サーバー（遅延と欠落を含む）で、(a) 正常歩行では誤って同期しない、(b) 実際のズレでは同期する、(c) 古い値では同期しない。

### WP3. ナビゲーション統一と失敗記憶（WP1a の後）

新規 `navigation.js`:
- `planPath(controls, goal, {costOf})` を A* で実装する。初期は4方向を維持する（斜め移動と落下は後続の改善）。ノード表現は WP1 の段階に合わせる。
- **共有ハザードマップ** `Map<"x,y,z", {count, lastTs, reason}>`。記録の契機は、補正受信時の位置セルと進行方向セル（WP0 の `tick` 対応の誤差を使う）、スタック検知、登攀可能ブロックへの接触。近傍（半径1）にコストを加算し、時間で減衰させる（例: 10分で半減）。セッション内のみ。
- 全呼び出し元を統一する: `resource-search.js`（`:58-60` の探索コピーを削除）、`long-travel.js`、`realm-pickup.js`、`branch-mining.js`、`realm-controls.js` の `goto`。

スタック検知と復旧（ブロック種に依存しない汎用処理）:
- 一定時間（例: 40tick）で進捗が 0.3 ブロック未満かつ目標未達 → ジャンプ → ハザードを追加して横ずらし再計画 → 最後の安全地点へ戻る → 失敗として報告。再試行には上限を設ける。
- 「最後の安全地点」は、権威位置で確認済みかつ `isWalkable` なセルとする。

テスト:
- 同じ失敗地点を2回選ばない。
- 探索 → 採掘 → 回収でハザードマップが共有される（`AI_REVIEW_HANDOFF.md` §8-1 の確認）。
- 無制限に再試行しない。

### WP4. LLM出力の検証と評価セット

- `validatePlan` の後（または前）で、`item` / `block` / `tool` を `registry.itemsByName` / `blocksByName`（`minecraft:` 除去後）と照合する。特殊値（`wood`、`raw_iron` など `gather` 用の語）は許可リストで先に処理する。使われている特殊値は `capabilities.js` と `action-agent.js` を grep して洗い出すこと。
- 不一致の場合は `item-dictionary.js` で近い名前を探し、候補があれば確認質問（`question`）に変換する。候補がなければ「存在しない/未対応」と返答して `actions=[]` にする。
- 評価セット `llm-eval.json`（指示 → 期待JSON、50〜100件。存在しない道具・曖昧な指示を含める）と、`eval-llm.js`（モデルごとの正答率・実在ID率・応答時間を出力）。実Ollamaが必要なため通常の `run-tests.js` には含めない。
- 比較対象: 現行の `qwen3.5:2b` と、残してある `qwen3:4b-instruct`。ロード込み/なしの応答時間も記録し、`keep_alive` の方針（`AI_GAME_PRIORITY`）はユーザーが選べるようにする。

受け入れ条件: `wooden_knife` や存在しないブロックが実行計画に到達しない。`free-prompt.test.js` ほか既存テスト通過。

### WP5. `update_subchunk_blocks`

- WP0 の受信件数で頻度を確認する。受信が確認されたら、`update_block` と同様に `this.updates.set(...)` へ反映する。`BlockUpdate` の項目名は `protocol.json` で確認すること（本書は未確認）。
- テスト: 模擬パケットで `updates` が更新される。

## 5. 共通ルール

- `.env`、`auth/`、認証コード、トークンを読まない・出力しない。
- 変更するファイルは本体の `backups\` 配下へ日付付きでバックアップする（既存を上書きしない）。
- 本体（`aibot-realms`）へ反映したのか、`outputs` の試作だけなのかを明示する。
- **模擬テストの成功を、実Realmでの成功として報告しない。**
- 作業の報告には、変更したファイル、テスト結果（Node のバージョンと件数）、本体反映の有無、**未検証の項目**を必ず含める。
- 新機能を足す場合は `directPlan`・JSONスキーマ・`validatePlan`・実行分岐・結果整形・`capabilities.js`・利用ガイド・テストを一貫して更新する（`AI_REVIEW_HANDOFF.md` §10）。
- 既存テストの期待値を変える場合は、根拠を残す。

## 6. 実Realmでの確認手順（ユーザーが実施）

Realm内に試験場を作る。平地20×20、ツタ付き原木の柱、階段、スラブ、フェンス、カーペットを並べた区画。

**採取は2回行う。** 手順4（変更前のベースライン）と手順6（WP1a 組み込み後）で、同じシナリオを同じ回数だけ試し、結果を並べて比べる。毎回、起動ログの `[移動方式]` の行を含める。

| シナリオ | 内容 | 見る点 | 採取 |
|---|---|---|---|
| 1 | 平地を20ブロック移動（5回） | 到着成功率、1回あたりの補正数、`driftAtBestLag` | 手順4・6 |
| 2 | ツタ付き原木のそばで伐採（1〜3回） | 補正の発生位置、ツタへの接触、スタック | 手順4・6 |
| 3 | 階段・スラブ・フェンス・カーペットを含む往復（各1回以上） | 補正の有無とブロック名 | 手順4・6 |
| 4 | ツタ付き原木へ接近（10回） | 登攀状態に入らないこと | 手順6以降 |
| 5 | 平地で単木の伐採（オーク、10〜20回） | 採掘数と所持品増加数の一致 | 手順6以降 |
| 6 | ジャングルでの伐採 | 成功率 | WP0〜3の後 |

記録: 試行回数・成功数・補正数・所要時間・ログ。ログを渡すときは認証コード・トークンを除く。

## 7. 未確認事項

- Realm の移動方式（`[移動方式]` の `authority`）と、`server_post_move` が毎tick届くか。
- 通信遅延（ラグ）の実際の分布。
- Bedrock の自動段差高さ（スラブ・階段を歩いて上がれる最大の高さ）。初期値 0.5 は仮。
- `update_subchunk_blocks` の `BlockUpdate` の項目名と、実Realmでの受信頻度。
- ジャングルの実地形での挙動。


## 8. 付録: 再現環境と確認コマンド

- `bedrock-protocol@3.61.0` は Node `>=24` を要求する。レビュー環境は Node 22 で、`npm ci --ignore-scripts`（`raknet-native` のビルドを回避）、`node --test *.test.js` を直接実行した。
- `run-tests.js` は `--test-isolation=none` を使うため、Node 22.23 では使えなかった。本体のNode v26.13.0で実行を確認済み。
- 依存の更新は行っていない。`prismarine-xbox-services` の固定コミット（`package.json` の `overrides`）は変更しないこと。

形状の確認（`npm ci --ignore-scripts` 後、プロジェクト直下で）:

```js
const reg=require('prismarine-registry')('bedrock_1.26.60');
const Block=require('prismarine-block')(reg);
function shapesOf(b){const t=reg.blockCollisionShapes,v=t.blocks[b.name];if(v===undefined)return null;
  const id=Array.isArray(v)?v[b.stateId-reg.blocksByName[b.name].minStateId]:v;return t.shapes[id]??[];}
const d=reg.blocksByName.oak_slab;
for(let s=d.minStateId;s<=d.maxStateId;s++){const b=Block.fromStateId(s);console.log(JSON.stringify(b.getProperties()),JSON.stringify(shapesOf(b)));}
```
