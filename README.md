# TAKEN — Minecraft Realms AI Bot

Minecraft統合版（Bedrock）のRealmsに、プレイヤーとして参加するAI Bot「TAKEN」です。
Bot用MicrosoftアカウントでRealmsに接続し、ゲーム内チャットの指示を受けて、移動・採掘・クラフトなどの行動を実行します。

## 仕組み

- 接続：Node.js + bedrock-protocol で、通常のプレイヤーとしてRealmsに参加
- AI：ローカルで動くOllama（qwen3.5:2b）が会話と高水準の計画を担当
- 行動：移動・採掘・クラフトなどの実際の制御はローカルの制御コードが担当（LLMに直接操作させない設計）

## できること（抜粋）

- チャット指示 `!TAKEN` への応答、プレイヤーへの追従・移動
- 採掘、資源探索、クラフト、かまど操作
- 食事・体力に応じた自動対応、落下アイテムの回収 など

詳しい使い方は [AIの使い方](AIの使い方.md) と、ルートにある各「使い方」ドキュメントを見てください。

## 動作環境

- Windows
- Node.js 24以降
- Ollama（ローカルLLM）
- Minecraft統合版 Realms（Bot用MicrosoftアカウントとRealmsの契約が必要）

## セットアップ

1. `.env.example` を `.env` にコピーし、Bot用アカウントやRealmの情報を入力
2. `npm ci`
3. 起動は `RealmsAI起動.bat`、または手順ドキュメントを参照

詳しくは [準備手順](準備手順.md) を見てください。認証キャッシュは各PCの `auth/` に保存され、リポジトリには含まれません。

## テスト

```sh
npm test
```

（`node run-tests.js` で単体テスト一式を実行します）

## 開発状況

趣味のコミュニティ向けに開発・運用しながら改修中です。改修は作業パッケージ（WP）単位で進めており、方針と進捗は [TAKEN_REVIEW_FOR_CODEX.md](TAKEN_REVIEW_FOR_CODEX.md) と [AGENTS.md](AGENTS.md) にまとめています。

- [接続の準備](準備手順.md)
- [チャットでの使い方](AIの使い方.md)
- [移動の計測手順](WP0-計測とベースライン採取.md)

## 開発について

AI支援ツールを活用して開発しています。設計方針や安全側の判断（読み込めていない地形は通行不可として扱うなど）はドキュメントに明記し、テストで検証しながら進めています。
