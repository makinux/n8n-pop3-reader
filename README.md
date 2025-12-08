![Banner image](https://user-images.githubusercontent.com/10284570/173569848-c624317f-42b1-45a6-ab09-f0ea3c247648.png)

# n8n-pop3-reader

POP3 サーバーを定期ポーリングし、新着メールをトリガーとしてワークフローを起動する n8n コミュニティノードです。`Pop3Trigger` ノードは UID 管理による重複防止、初回の既存メールスキップ、取得後削除のオプションを備えています。

## 概要

- ノード: `Pop3Trigger` (`nodes/Pop3Trigger/Pop3Trigger.node.ts`)
- 認証: `Pop3ServerApi` 資格情報 (`credentials/Pop3ServerApi.credentials.ts`)
- 出力: `uid`, `index`, `raw`（RFC822 形式テキスト）, `retrievedAt`（ISO 文字列）
- ポーリング: 指定間隔で `UIDL` 取得 → 未知 UID のみ `RETR` で取得 → オプションで `DELE`

## インストール

```bash
npm install
```

Node.js 22 以上を推奨します。依存に含まれる `@n8n/node-cli` が開発用の n8n を提供します。

## 使い方

1. 開発サーバーを起動  
   ```bash
   npm run dev
   ```
   ブラウザで起動した n8n にこのノードが読み込まれます（ホットリロード対応）。

2. 資格情報を作成  
   - 種類: `POP3 Server API`
   - 項目: `host` / `port` / `secure`（TLS）/ `allowUnauthorized`（自己署名許可）/ `username` / `password`

3. ワークフローに `POP3 Trigger` を追加し、パラメータを設定  
   - `Emit Existing Messages`: 初回に既存メールも流すか  
   - `Delete After Emit`: 取得後にサーバーから削除するか  
   - `Max Messages Per Poll`: 1 回のポーリングで処理する最大件数  
   - `Polling Interval (seconds)`: ポーリング間隔  
   - `Command Timeout (seconds)`: POP3 コマンドのタイムアウト

4. 実行すると、新着メールが到着するたびにノードが `json` データとしてメール本文を出力します。後段にパーサー（例: IMAP/メールパーサー、文字列処理）を接続して処理してください。

## 動作のポイント

- UID を `staticData` に保存し、既知の UID は再発火しません。`Emit Existing Messages=false` の場合、初回は既存メールを既知として記録するだけで流しません。
- `Delete After Emit=true` では `DELE` を送信してサーバーから削除します。安全のためテスト環境で挙動を確認してください。
- 複数ポーリングが重ならないよう内部でロックしています。タイムアウトはコマンドごとに適用されます。

## スクリプト

| コマンド            | 説明                                     |
| ------------------- | ---------------------------------------- |
| `npm run dev`       | n8n を起動しノードをホットリロード      |
| `npm run build`     | TypeScript を `dist/` へビルド          |
| `npm run build:watch` | 変更を監視しビルド                     |
| `npm run lint`      | ESLint チェック                          |
| `npm run lint:fix`  | ESLint 自動修正                         |
| `npm run release`   | `n8n-node release` によるリリース準備   |

## トラブルシュート

- ノードが表示されない: `npm install` 実行、`package.json` の `n8n.nodes` に `dist/Pop3Trigger/Pop3Trigger.node.js` が含まれているか確認し、`npm run dev` を再起動。
- 接続エラー: ホスト/ポート、TLS 設定（`secure`/`allowUnauthorized`）、資格情報を確認。`Command Timeout` を増やすと改善する場合があります。
- 重複発火する: ワークフローのバージョンを変更した場合などは `Emit Existing Messages` の設定を見直し、必要に応じて一時的に `knownUids` をクリアする（新しいワークフローとして保存）ことで解消できます。

## ライセンス

MIT
