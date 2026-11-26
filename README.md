# TAKEN Minecraft Bot

Minecraft統合版のRealmsに参加し、チャットの `!TAKEN` 指示を受けるNode.js製Botです。ローカルAIにはOllamaを使用します。

- [接続の準備](準備手順.md)
- [チャットでの使い方](AIの使い方.md)
- [移動の計測手順](WP0-計測とベースライン採取.md)

Node.js 24以降で `npm ci`、テストは `npm test`。設定は `.env.example` を `.env` にコピーして入力してください。Windows用起動スクリプトは、隣の `local-ai` フォルダの `runtime/ollama.exe` と `models/` を使用します。認証キャッシュは各PCの `auth/` に保存されます。
