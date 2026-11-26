# TAKEN Minecraft Bot — 他AI向けレビュー・開発引き継ぎ

最終確認: 2026-11-18（日本時間）。この文書は現状説明です。実装と矛盾する場合は、実際の起動元・設定・コードを確認してください。

## 1. 目的と現在地

WindowsのMinecraft統合版Realmsへ、ユーザーとは別のMicrosoftアカウントで参加するBot。チャットの自然言語指示を操作計画に変換し、移動・採掘・クラフトなどを実行する。

最終目標は、生存しながら材料を集め、失敗時に再計画できる自律的な相棒。ただし現状は試験実装であり、人間同等の地形把握・完全なエンドラ自動討伐を実現していない。

直近のユーザー報告:

- ジャングルの伐採でツタを登り、予定の経路を外れる。
- 死亡後に復活準備の返答が来ず、再接続で復活するが繰り返すと再接続上限で止まる。
- 自由な指示の解釈に失敗する。以前は存在しない「木のナイフ」などを回答した。
- 採掘数と実際の回収数が一致しないことがある。
- モデル読み込みに時間がかかり、応答が遅い。

## 2. 作業対象を間違えないためのパス

| 用途 | 絶対パス |
|---|---|
| **現在実行しているBot本体** | `C:\mc-server\AI\aibot-realms` |
| 起動バッチ | `C:\mc-server\AI\aibot-realms\RealmsAI起動.bat` |
| 接続確認のみ | `C:\mc-server\AI\aibot-realms\Realms接続確認.bat` |
| ローカルAI本体・モデル | `C:\mc-server\AI\local-ai` |
| Ollama実行ファイル | `C:\mc-server\AI\local-ai\runtime\ollama.exe` |
| Ollamaモデル保存先 | `C:\mc-server\AI\local-ai\models` |
| 開発作業フォルダ | `C:\Users\stake\Documents\Codex\2026-10-08\minecraft-forge-1-20-1-aibot` |
| 過去の作業・ステージング | 上記開発フォルダの `outputs` / `work` |
| 利用者向け説明 | `C:\mc-server\AI\aibot-realms\AIの使い方.md` |

開発フォルダ名にForge/Java版とあるが、現在の対象はBedrock Realms向けNode.js Bot。過去のPaper/Geyser構成やoutputs内の古いコードを、現在の実行コードと混同しないこと。

このMD単体にソースコードは含まれない。別PC・クラウド上のAIによるレビューには、後述の共有用ファイルも必要。

## 3. 実行環境・依存関係

- Windows / PowerShell / Node.js。コードはES Modules（package.jsonのtype=module）。
- package: `taken-bedrock-realms` / `0.1.0`。
- 接続設定のBedrockバージョン: `1.26.60`。現在の最新版対応を保証する情報ではない。
- bedrock-protocol: `3.61.0`、minecraft-data: `3.119.0`。
- prismarine-chunk: `^1.41.0`、prismarine-registry: `^1.12.0`、vec3: `^0.2.0`。厳密な解決版はpackage-lock.jsonを確認。
- prismarine-xbox-servicesはpackage.jsonのoverridesで特定Gitコミットを使用。依存を一括更新すると認証や接続へ影響する可能性がある。
- PC: Ryzen 7 5800H、RAM 16GB、RTX 3050 Ti Laptopの専用VRAM 4GB。内蔵GPUの2GBと合算して6GBの単一VRAMと扱わない。

現在の非機密AI設定:

```dotenv
AI_PROVIDER=ollama
OLLAMA_MODEL=qwen3.5:2b
```

以前の `qwen3:4b-instruct` は削除せず残してある。OpenAI API方式への移行は実施していない。現在はOpenAI APIキーもAPI残高もBotの推論には不要。

## 4. 処理の流れ

```text
RealmsAI起動.bat
  → start-local-ai.ps1（Ollama確認・必要なら起動）
  → index.js（Microsoft認証、Realm選択、接続）
  → ai-chat.js（発言者・コマンド受付、待機列、停止、状態確認）
  → action-agent.js（直接解釈、必要ならLLM、計画検証）
  → realm-controls.js / 機能別モジュール（実行）
  → サーバーの座標・ブロック・所持品更新で結果を確認
  → チャットで結果報告
```

LLMが歩行を毎tick決める構造ではない。LLMは会話と高水準の操作計画を生成し、移動などはローカルの制御コードが実行する。モデル変更だけで物理・経路探索・通信同期の不具合は直らない。

## 5. 主なファイルと修正箇所

以下のファイル名はすべてBot本体フォルダ基準。

| ファイル | 責務・レビュー時の着眼点 |
|---|---|
| `index.js` | 起動、接続、認証案内、イベント登録、終了。過去の26.51用入力番号補正があるため版別条件を確認 |
| `bedrock-version.js` | 接続版の選択・表記の正規化 |
| `ai-chat.js` | 日本語チャット、権限、即時状態確認、通常作業と生存行動の連携 |
| `request-queue.js` | 受付順の待機列、失敗時停止、取消・再開 |
| `action-agent.js` | `directPlan`、LLM用JSONスキーマ、`validatePlan`、実行と結果整形 |
| `planning-prompt.js` | モデルへの指示、現在状態・所持品の伝達 |
| `local-ai-request.js` | Ollama HTTP呼び出し、取消、タイムアウト、応答時間ログ |
| `capabilities.js` | 操作上限、日本語名変換、機能説明。説明文と実処理の一致も確認 |
| `item-dictionary.js` / `minecraft-dictionary.json` | アイテム・ブロックの日本語名とID |
| `realm-controls.js` | パケット状態管理、座標、地形キャッシュ、移動、採掘、戦闘、食事、実行分岐 |
| `step-movement.js` | 足場・身体空間、1段の段差、経路探索、移動予測、ツタ接触 |
| `long-travel.js` / `surface-swimming.js` / `auto-sprint.js` | 区間移動、水面移動、ダッシュ切替 |
| `resource-search.js` | 原木・露出鉱石の探索、接近候補、経路失敗の限定的な見直し |
| `realm-pickup.js` | 落下物追跡、接近、所持品増加の確認 |
| `realm-crafting.js` / `realm-furnace.js` | クラフト、装備等の所持品操作、精錬 |
| `mining-tools.js` / `mining-speed.js` | 道具選択・採掘時間 |
| `branch-mining.js` | 直線・枝道採掘と帰還 |
| `bed-control.js` / `realm-boat.js` | 就寝・起床、ボート乗降 |
| `auto-survival.js` | 食事、防衛、安全地点への退避、通常作業への割込み |
| `autonomous-goal.js` / `adaptive-goal.js` / `goal-evidence.js` | 自律指示、材料からの目標計画、結果に基づく再計画 |
| `food-supply.js` / `resource-management.js` / `tool-condition.js` | 食料調達・調理、道具補充・耐久判定 |
| `dragon-planner.js` / `dragon-iron.js` / `dragon-progress.js` | 討伐準備の段階1・2と進捗 |
| `realm-recovery.js` | 復活待機超過等からの限定的な再接続 |
| `run-tests.js` | 本体直下の `*.test.js` のみ実行。backups内は対象外 |

## 6. 実装済み機能と限界

- `!TAKEN 指示`、`!stop`。全Realm参加者を許可する設定で運用してきたが、実際の許可はMC_OWNERSを確認。
- 通常作業は1つずつ。他の質問・指示は原則待機。状態確認は即時。
- 待機列: 全体5件、1人2件。作業失敗時は停止し、`!TAKEN 待機再開`。
- 移動・探索: 開始地点から256ブロック以内。既知の安全な短区間に分割。1段の段差に試験対応。
- 採掘64ブロック、クラフト完成品64個、建築256ブロック（各寸法16以内）。
- 探索: 最大48地点・経路768歩分・600秒。露出資源を探す。gather自体は地下を掘り進まない。
- 通常かまどの精錬・調理は1指示合計16個まで。燃料・設備が必要。
- 近距離戦闘、食事、所持防具、道具作成、落下回収、受け渡し、ベッド、ボート乗降。
- 自動食事は空腹時や低体力時。体力12以下かつ満腹度20未満なら食事優先。食料が必要。
- 自動退避は安全地点の登録が必要。同ディメンション24ブロック以内などの制限がある。再接続後に再登録。
- エンドラ準備は石道具・鉄装備等の段階1・2。エンドラ討伐全体は未実装。
- 階段・ハーフブロック、複雑な穴越え、潜水、ツタからの自動脱出などは一般化されていない。
- 現実世界の天気検索機能はない。過去ログの天気質問への不自然な返答を、情報取得成功と解釈しない。

## 7. 直近の変更と検証の強さ

### モデル変更（11月16日までに反映）

Qwen3.5 2Bを導入し.envを変更。実際の `requestLocalAI` で「オークの原木を3個掘って」をJSON化できた。初回約17秒、うち約16秒がロードだった。これは単一指示のスモークテストであり、自律行動全般の精度保証ではない。

`local-ai-request.js` は既定のゲーム優先時に `keep_alive:0`、`num_ctx:4096`、`num_thread:4`、`think:false` を指定する。毎回のアンロードはロード待ちを増やす一方、GPUメモリをゲームに返す意図がある。常駐化はゲームのFPSとVRAMも測って判断する。

### レビュー修正（11月17日）

1. 復活準備後に体力0が再通知されても、作業を禁止したまま静止入力確認を継続する。
2. 非同期再接続途中に終了した場合、後から返った接続を閉じる。
3. 中止済みAI要求は通信開始前に中止する。

回帰テスト: `review-20261117.test.js`。バックアップ: `backups\review-20261117`。

### リスポーン通信順序修正（11月17日）

旧実装はstate=0受信時にplayer_action:respawn、state=1受信時にrespawn:state=2を送っていた。現在は次の順序へ修正:

```text
server respawn state=0
→ client respawn state=2（ClientReadyToSpawn）
→ server respawn state=1
→ client player_action respawn
→ server health > 0を受信して復活確認
```

参照: https://levimc.org/bedboo/reference/differences/survival
同じ接続で2回死亡・復活する模擬シーケンスと、シリアライズを含む既存テストを確認。実Realmで解消したとのユーザー確認はまだない。
テスト: `respawn-order.test.js` / `session-regression.test.js`。
バックアップ: `backups\respawn-order-20261117`。

### ツタ・地形判定修正（11月18日）

- ツタ・はしご・足場等を、通常の歩行で通過する空間から除外。
- `walkable` と移動処理の `bodyClear` を共有し、足元・胴体・頭の確認を統一。
- ジャンプ中を含め、登れるブロックへ前進入力を押し続けない。
- `correct_player_move_prediction`でツタ接触が判明したら前進を停止。既存gotoの限定的な再計画へ戻す。

テスト: `vine-navigation.test.js`（迂回・入力抑止・座標補正・身体空間の4件）。
バックアップ: `backups\vine-navigation-20261118`。
**最後の全体テスト: 273件成功、失敗0。実Realmでの伐採改善は未確認。**

## 8. 今後のレビューで優先する論点

1. **ツタ回避が採掘まで一貫するか。** 探索の接近地点、mineの再移動、回収の接近が別々に経路を決める。迂回があっても後段で危険な地点を選び直さないか確認。
2. **ツタ接触後の復旧。** 現状は進入回避と停止。すでに登っている・押し込まれた場合に安全な脱出ができるわけではない。空中から予測座標を地面へ書き換えて成功扱いしない。
3. **移動予測とサーバー位置。** 足座標と目線座標（現在の変換差1.62）の混在、段差・補正後の到着判定を検証。
4. **探索の再計画。** 読込待ち、到達不能、登攀、道具不足、通信未確認を区別する。無制限再試行や同じ失敗地点への往復を防ぐ。
5. **復活の実通信。** 模擬サーバーが正しい順序を返すことと、Realmが実際に受理することは別。state、runtime ID、体力更新の順序をログで確認。
6. **成功条件。** 採掘した数、持ち物に増えた数、相手に渡った数を混同しない。投棄確認だけで相手の受領成功を報告しない。
7. **モデル精度と応答速度。** 同一状態・同一指示でJSONの正しさ、実在ID、禁止操作、応答時間を比較。曖昧な指示は質問へ戻す。
8. **認証エラー。** prismarine-auth内部のLiveTokenManagerはinvalid_grantを捕捉して同じコードでポーリングを続ける。index.jsのerrorイベントだけでは内部ループを直ちに停止できない。過去の説明で「正常な承認待ち」としたが、invalid_grantを一律に正常扱いしない。直近は認証成功済み。

## 9. テストと起動

PowerShell:

```powershell
Set-Location 'C:\mc-server\AI\aibot-realms'
& 'C:\Program Files\nodejs\node.exe' run-tests.js
```

個別テスト:

```powershell
& 'C:\Program Files\nodejs\node.exe' --test vine-navigation.test.js
& 'C:\Program Files\nodejs\node.exe' --test respawn-order.test.js
```

Nodeの場所・バージョンが違う環境では読み替える。`run-tests.js` のNodeテスト引数が使える版かも確認する。

実プレイ確認はBotをCtrl+Cで終了してから `RealmsAI起動.bat` を1つだけ起動する。起動ログで `qwen3.5:2b` と実行元を確認。最初は `!TAKEN 状態`、`!TAKEN 持ち物`、`!TAKEN 周囲`。ツタ回避は安全な地面から `!TAKEN ジャングルの原木を3個探して集めて`。停止は `!stop`。

自動テストのためにRealmへ接続したり、Botを意図的に死亡させたりする必要はない。実プレイ結果と模擬テスト結果を報告で区別する。

## 10. 作業・実装方法

1. 起動元・現在コード・作業ルール（AGENTS.md等）の有無を確認する。
2. .env全体や認証ファイルを出力せず、必要な非機密設定だけ確認する。
3. 再現条件を言語化し、該当する既存テストと関数を読む。
4. 変更ファイルを本体のbackups配下へ日付付きでバックアップする。既存バックアップを上書きしない。
5. 狭い範囲で修正し、症状を再現するテストを追加する。既存テストの期待値変更には根拠を残す。
6. 個別テストと必要な全体テストを実行。Realm上の成功をテストだけで断言しない。
7. 本体へ反映したか、outputsの試作だけかを明示する。反映には実行環境の書込権限が必要な場合がある。
8. ユーザーへ変更内容・確認結果・再起動方法・残る制限を短く伝える。

新機能を増やす場合は、必要に応じて `directPlan`、JSONスキーマ、`validatePlan`、実行分岐、結果整形、能力説明、利用ガイド、テストを一貫して更新する。プロンプトだけに書いて、実行処理がない機能を「対応済み」にしない。

## 11. 別AIへの共有物と除外物

共有用コピーに含めるもの:

- このMD、Bot本体直下の `.js`（テスト含む）、`package.json`、`package-lock.json`。
- `minecraft-dictionary.json`、利用ガイド、起動バッチ、`start-local-ai.ps1`。
- 非機密項目だけにした設定例。`.env.example`も内容を確認してから共有する。
- 必要なら、認証コード・トークン・個人情報を除いた症状ログ。

**共有しないもの:** `.env`、`auth`、`backups`全体、認証キャッシュ、秘密鍵、APIキー、認証コード。`node_modules`とOllamaのモデル本体も通常不要。`progress`にはプレイ情報があるため必要部分だけ確認して共有。

## 12. 他AIへ渡す依頼文

> 添付の引き継ぎMDとソースを読み、現在の実装をレビューしてください。優先課題はジャングル伐採時の地形認識・ツタ回避・採掘位置選択・失敗時の再計画です。次にリスポーン通信と回収確認を確認してください。問題ごとに再現条件、原因、影響、修正案、検証方法を示してください。模擬テストだけで実Realmの成功を断言せず、認証情報を読んだり出力したりしないでください。実行元は C:\mc-server\AI\aibot-realms で、outputs内の旧版とは区別してください。
