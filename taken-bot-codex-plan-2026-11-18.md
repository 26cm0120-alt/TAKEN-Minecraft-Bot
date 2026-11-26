# TAKEN Bot 改修計画書（Codex実行用・統合版）
作成: 2026-11-18 / 対象: Minecraft統合版 Realms Bot「TAKEN」（Node.js、実行元 `C:\mc-server\AI\aibot-realms`）

## 0. この文書の使い方
- Codex は着手前に `AI_REVIEW_HANDOFF.md`（構成・作業ルール）と本書を読むこと。本書が作業指示の正本。背景レビューは `taken-bot-code-review-2026-11-18.md` と `TAKEN_REVIEW_FOR_CODEX.md`（所見の詳細）。
- 作業は WP 単位で進める。**1回の依頼では1つの WP だけ**を実行し、報告して止まること。依存とゲートは §2 の表に従う。
- 行番号は 2026-11-18 スナップショット基準。ずれている場合は関数名で検索すること。
- テストの基準値: 本番環境（Node 24以降）で `node run-tests.js` を実行し **273件全成功** が変更前の基準。Node 22 ではプロジェクトの runner が使えないため、数字を混ぜないこと。

## 1. 全WP共通ルール
1. `.env`、`auth/`、認証コード・トークンを読まない・出力しない。
2. 変更するファイルは、本体の `backups\` 配下へ日付付きフォルダを作ってコピーしてから変更する（既存バックアップは上書きしない）。
3. 変更は対象WPの範囲だけ。新機能の追加、依存関係の更新、`package.json` の overrides 変更はしない。
4. 既存テストの期待値を変える場合は、理由を変更メモと報告に必ず書く。
5. 変更後は対象テスト＋全体テスト（`node run-tests.js`）を実行し、件数と成否を報告する。
6. 模擬テストの成功を実Realmでの成功として報告しない。実Realm確認は利用者が §6 のシナリオで別途行う。
7. 本体へ反映したのか試作だけなのかを報告に明示する。

## 2. 作業パッケージ一覧と実行順
| WP | 内容 | 依存・ゲート |
|---|---|---|
| WP0 | 計測ログの追加（挙動を変えない） | なし。最初に実施 |
| WP1 | 衝突判定を形状データへ置換（新規 collision.js） | なし（WP0と並行可） |
| WP2 | 位置の閉ループ化 | **WP0の実Realmログで仮説H1が支持された場合のみ**。判定は利用者側で行う。支持されなければ実施しない |
| WP3 | ナビゲーション統一と失敗記憶の共有 | WP1 完了後 |
| WP4 | LLM出力の実在確認と評価セット | なし（いつでも可） |
| WP5 | update_subchunk_blocks の処理 | WP0で受信が確認された場合のみ |
| WP6 | 計画検証の残りと小物修正 | なし（WP4と同梱可） |
| WP7 | 地形要約の計画接続・永続化・失敗分類 | WP3完了後に別途指示書を作る。**本書では実施しない** |

対応表: 先行の「Phase 1 指示書」（codex-request-phase1-2026-11-18.md）の内容は WP4＋WP6 に統合済み。本書を使う場合はそちらは不要。

## 3. 検証済みリファレンス（実データで確認済み。そのまま使ってよい）
### 3.1 形状データの取得（bedrock_1.26.60、全23,960状態で配列が返ることを確認済み）
```js
export function shapesOf(registry, block) {
  const t = registry.blockCollisionShapes, v = t.blocks[block.name];
  if (v === undefined) return null;                          // 未知 → 呼び出し側で安全側（歩行不可）
  const base = registry.blocksByName[block.name].minStateId; // prismarine-block の Block には minStateId は無い
  const id = Array.isArray(v) ? v[block.stateId - base] : v;
  return t.shapes[id] ?? [];                                 // [[x1,y1,z1,x2,y2,z2], ...] ブロック内座標
}
```
代表値: oak_slab bottom=[[0,0,0,1,0.5,1]] / top=[[0,0.5,0,1,1,1]]、stone_brick_stairs（方向0）=[[0,0,0,1,0.5,1],[0.5,0.5,0,1,1,1]]、oak_fence=[[0.375,0,0.375,0.625,1.5,0.625]]（上面1.5）、white_carpet=[[0,0,0,1,0.0625,1]]、vine=[]（衝突なし）。
注意: Bot の `block()`（realm-controls.js:299）が返すオブジェクトには stateId が含まれる。テスト用スタブ（name と boundingBox のみ）では stateId が無いので、その場合だけ従来の二値へフォールバックし、実ブロックで起きたら件数をログに出す。

### 3.2 update_subchunk_blocks のプロトコル定義（protocol.json で確認済み）
```text
packet_update_subchunk_blocks: { x, y, z: zigzag32, blocks: BlockUpdate[], extra: BlockUpdate[] }
BlockUpdate: { position: BlockCoordinates, runtime_id: varint, flags: varint, entity_unique_id: zigzag64, transition_type: varint }
```
既存の update_block ハンドラ（realm-controls.js:94-95）は layer 0 のみを `this.updates` に反映している。WP5 では `blocks` 配列を同じ扱いにし、`extra`（第2レイヤー相当）は反映しない。

### 3.3 移動まわりの現行値（事実）
- tick は 50ms（realm-controls.js:183）。1tickの自己計算移動量は歩行0.1 / ダッシュ0.13（step-movement.js advanceStep）。バニラの一般値は歩行 約0.216 / 走行 約0.28。
- `server_post_move` は serverPosition に保存されるだけ（realm-controls.js:122-124）で、歩行ループは予測座標のみで判定する。
- 移動方式は起動時に `[移動方式] {authority: ...}` とログに出る（realm-controls.js:82-84）。WP0 のログ採取ではこの行を必ず含めること。

## 4. 作業パッケージ詳細

### WP0. 計測ログ（挙動を変えない）
- 対象: realm-controls.js に計測フックを追加。出力は `[移動計測]` の1行JSON。環境変数 `TAKEN_TELEMETRY=0` で無効化できること。
- **禁止: 送信パケット・位置・タイマー・ブロック状態を一切変更しない。**
- 記録項目:
  1. 歩行中5tickに1回: tick、内部 position、serverPosition、水平/垂直差、walkTarget、足元と体のブロック名、ダッシュ有無
  2. correct_player_move_prediction 受信時: 内部位置、補正位置、delta、足元・体・頭のブロック名と stateId、直近の補正回数
  3. 地形: 未知ブロックID例外の件数、サブチャンク decode 失敗の件数、update_subchunk_blocks の受信件数（数えるだけ）
  4. 移動1回ごとのサマリ: 歩数、補正数、差の平均と最大
- 受け入れ条件: 既存テスト全通過。`TAKEN_TELEMETRY=0` で出力が消える。計測の有無でテスト結果が変わらない。
- 判定基準（利用者側）: 平地で差の最大が0.3を超え距離とともに増える → H1支持 → WP2実施。補正が特定ブロック種に集中 → WP1優先。

### WP1. 衝突形状の導入
- **実装は既にある。** Claude 作成の `collision.js` / `collision.test.js` が検品済み（2026-11-19、collision-review-2026-11-19.md）。全体テスト293件成功を確認済みの版を正とし、書き直さずに本体直下へ置いて組み込みから始めること。API は createCollision(registry) が返す shapesOf / bodyClear / isWalkable / landingTop / surfaceTopAt / touchesClimbable / isSolidFloor / isPassable。§3.1 の shapesOf はその中核部分。
- 組み込み時の注意（検品メモ §3）: プランナーのY整数グリッドとスラブ上面（x.5）の扱い、landingTop と surfaceTopAt の取り違え禁止、stats.unknownShape の監視、既存テストのスタブ更新。
- 置換対象（boundingBox の二値判定をしている箇所）: step-movement.js の solid / bodyClear / safeBelow / landing、realm-controls.js の walkable と床判定（:319-326 ほか :556-558, :630, :696, :711）、branch-mining.js:43、dragon-planner.js:28、resource-search.js:22、surface-swimming.js。step-movement.js の関数シグネチャ `(read,x,y,z)` は変えない。
- 床の高さは足元セルの形状の最大上面。段差の初期値は「上面の差0.5以下を1段」とし、WP0 の補正ログで見直す。
- ツタ等は形状が空でも「触れると登る」ため、touchesClimbable は名前ベースで維持する。ツタを通行可能にしてはならない。
- `web`（クモの巣）は boundingBox が 'empty' だが移動を妨げる。ハザード扱いに追加する。
- 新規 `collision.test.js`: slab bottom/top の上面 0.5/1.0、stairs 4方向、fence（上面1.5）にジャンプで乗れない、carpet を床として歩行できる、vine/ladder の形状と登攀検知、全1480ブロックで shapesOf が配列を返す（回帰）。
- 受け入れ条件: vine-navigation.test.js を含む既存テスト全通過。

### WP2. 位置の閉ループ化（条件付き。WP0の判定前は実施しない）
- 歩行中に serverPosition と内部位置の水平差が閾値（WP0計測で決定。仮の目安0.3）を超えたら内部位置を serverPosition に同期し、経路からの偏差が大きければ goto の再計画に戻す。
- **移動量の定数（0.1 / 0.13）は、サーバー側の実移動量を測るまで変更しない。**
- 禁止: 空中・補正中に予測座標を地面へ書き換えて成功扱いにすること。
- テスト: 擬似サーバーが server_post_move でズレを作り、同期と再計画が起きること。

### WP3. ナビゲーション統一と失敗記憶
- 新規 `navigation.js`: `planPath(controls, goal, {costOf})` を A* で実装。初期は4方向・段差±1を維持し、斜め移動と落下は扱わない（後続改善）。
- 共有ハザードマップ: `Map<"x,y,z", {count, lastTs, reason}>`。記録の契機は補正受信時の位置セルと進行方向セル、スタック検知、登攀可能ブロックへの接触。近傍（半径1）にコスト加算、時間で減衰（例: 10分で半減）。セッション内のみ。
- 統一する呼び出し元: resource-search.js（:58-60 の探索コピーを削除）、long-travel.js、realm-pickup.js、branch-mining.js、realm-controls.js の goto。
- スタック検知と復旧: 40tickで進捗0.3ブロック未満かつ目標未達 → ジャンプ → ハザード追加して再計画 → 最後の安全地点（サーバー位置で確認済みかつ walkable なセル）へ戻る → 失敗として報告。再試行に上限を設ける。ツタからの脱出はこの「安全地点へ戻る」で扱う。
- テスト: 同じ失敗地点を2回選ばない。探索→採掘→回収でハザードマップが共有される。無制限に再試行しない。

### WP4. LLM出力の実在確認と評価セット
- validatePlan の検証に、item / block / tool の実在照合を追加する。照合先は registry.itemsByName / blocksByName（`minecraft:` プレフィックス除去後）。**adaptive-goal.js の validateAction が既に同じ照合をしているので、それを共通化する形が最小変更。**
- 掘削禁止ブロック（岩盤など）の denylist もここに置く。smelt は realm-furnace.js の smelts 表にある材料だけを許可する。
- 特殊値（`wood`、`raw_iron` など gather 用の語）は許可リストで先に処理する。使われている特殊値は capabilities.js と action-agent.js を grep して洗い出すこと。
- 不一致時: item-dictionary.js で近い名前を探し、候補があれば確認質問（question）に変換。候補がなければ「存在しない/未対応」と返して actions=[] にする。
- 評価セット: `llm-eval.json`（指示→期待JSON、50〜100件。存在しない道具・曖昧な指示を含む）と `eval-llm.js`（モデルごとの正答率・実在ID率・応答時間を出力）。実Ollamaが必要なため run-tests.js には含めない。比較対象は qwen3.5:2b と qwen3:4b-instruct。ロード込み/なしの時間も記録する。
- 受け入れ条件: wooden_knife や存在しないブロックが実行計画に到達しない。free-prompt.test.js ほか既存テスト通過。

### WP5. update_subchunk_blocks の処理（WP0で受信確認後のみ）
- §3.2 の定義に従い、`blocks` 配列の各要素を update_block と同様に `this.updates.set(key(position), runtime_id)` へ反映する。`extra` は反映しない。
- テスト: 模擬パケットで updates が更新されること。

### WP6. 計画検証の残りと小物修正（WP4と同梱可）
1. move/build 座標の距離検証: 現在位置から水平256ブロック・高低差8を超える計画は reject して確認質問にする（現状は有限値チェックのみで、上限はプロンプト宣言だけ）。
2. ai-chat.js のモデル既定値 `qwen3:4b-instruct` を現行 `qwen3.5:2b` に合わせる（呼び出し側が渡す値を優先する仕組みは壊さない）。
3. action-agent.js の「LLMが空計画＋指示に動作動詞あり」の経路でも `{clarification}` を返し、ai-chat 側の確認保持（5分）に乗せる。
4. request-queue.js: 失敗時の全体 pause を実行系の失敗に限定する。LLMタイムアウト等のBot側失敗は当該指示だけを失敗扱いにする。
- テスト: 現在地から300ブロック先への move が実行されず確認質問になること。ほか各項目に対応する既存テストの拡張。

### WP7. 長期（本書では実施しない。WP3完了後に別途指示書を作る）
- 計画コンテクトへの地形要約（nearbySummary の機械可読版）の接続。座標候補はローカル計算のリストから選ばせる。
- 地形キャッシュの永続化（列単位の保存/復元、復元分は「古い可能性あり」と区別）。
- 失敗理由の分類（chunk_unloaded / unreachable / tool_missing / climbing / unconfirmed）と、自律目標での限定リトライ。
- adaptive-goal 実行中の keep_alive 延長と、[AI応答時間] ログによる loadMilliseconds の A/B 実測。

## 5. WPごとの報告形式（Codex → 利用者）
```text
対象WP: WP○
変更ファイル: （本体へ反映 / 試作のみ、を明記）
変更内容: （ファイルごとに1〜2行）
追加・変更したテスト: （期待値を変えた場合は理由も）
全体テスト結果: ○○件中 ○○件成功（node run-tests.js、Node バージョン）
残る未確認事項: （実Realmでしか分からない点）
```

## 6. 実Realm確認シナリオ（利用者が実施）
Realm内に試験場を作る: 平地20×20、ツタ付き原木の柱、階段、スラブ、フェンス、カーペットを並べた区画。各シナリオ10〜20回、成功数・補正数・所要時間・ログを記録する。ログには起動時の `[移動方式]` 行を必ず含める。認証コード・トークンは除く。

| シナリオ | 見る点 |
|---|---|
| S1 平地を20ブロック移動 | 到着成功率、1回あたりの補正数、内部位置とサーバー位置の差（WP0/H1判定） |
| S2 スラブ・階段の昇降 | 段差での補正の有無（WP1の効果） |
| S3 フェンス・カーペットを含む往復 | 誤認による停止・補正の有無 |
| S4 ツタ付き原木へ接近 | 登攀状態に入らないこと |
| S5 平地で単木の伐採（オーク） | 採掘数と所持品増加数の一致 |
| S6 ジャングルでの伐採 | WP0〜WP3の後に実施 |
