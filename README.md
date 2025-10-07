# Google Calendar & Tasks MCP Server

Google Calendar と Google Tasks を統合的に操作できる Model Context Protocol (MCP) サーバーです。Claude や MCP 対応クライアントから、カレンダー予定と ToDo を一覧・作成・更新・削除できます。

## 主な機能

- カレンダー一覧取得と予定検索・作成・更新・削除
- 拡張検索フィルタ (複数カレンダー横断 / 拡張プロパティ検索 / ページング対応)
- 繰り返し予定の作成・インスタンス一覧・個別編集/削除
- タスクリスト一覧取得・タスク管理 (作成 / 更新 / 完了 / 削除)
- OAuth2 デスクトップ アプリ認証フロー & トークンキャッシュ
- シンプルな stdio トランスポート

## 必要条件

1. Google Cloud Console で Calendar API と Tasks API を有効化したプロジェクト
2. OAuth 2.0 クライアント (アプリ種別: デスクトップ) の認証情報 JSON
3. Node.js 18 以上

## セットアップ

```bash
npm install
```

`GOOGLE_OAUTH_CREDENTIALS` 環境変数に OAuth クライアント JSON のパスを設定してください。初回は認証フローが自動的に実行され、既定では `~/.config/google-calendar-todo-mcp/token.json` にトークンが保存されます。保存先は `GOOGLE_CALENDAR_MCP_TOKEN_PATH` で変更できます。

### 認証のみを事前に実行

```bash
GOOGLE_OAUTH_CREDENTIALS=/path/to/oauth.json npm run auth
```

### MCP サーバーの起動 (stdio)

Claude Desktop などの設定例:

```json
{
  "mcpServers": {
    "google-calendar-todo": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"],
      "env": {
        "GOOGLE_OAUTH_CREDENTIALS": "/path/to/oauth.json"
      }
    }
  }
}
```

開発中は次のコマンドで TypeScript を監視実行できます。

```bash
GOOGLE_OAUTH_CREDENTIALS=/path/to/oauth.json npm run dev
```

## 提供ツール一覧

| ツール名 | 説明 |
| --- | --- |
| `list-calendars` | 利用可能なカレンダー一覧 |
| `list-events` | 指定カレンダーの予定一覧。時間帯絞り込み・拡張プロパティフィルタ・ページング対応 |
| `search-events` | 複数カレンダーを跨いだキーワード検索と高度なフィルタリング |
| `create-event` / `update-event` / `delete-event` | 予定の追加・更新・削除 (繰り返し設定・リマインダー・通知オプションに対応) |
| `list-event-instances` | 繰り返し予定の各インスタンス一覧 |
| `update-event-instance` / `delete-event-instance` | 繰り返し予定の個別インスタンス編集・削除 |
| `list-tasklists` | タスクリスト (Google Tasks) 一覧 |
| `list-tasks` | 指定タスクリストのタスク一覧 |
| `create-task` / `update-task` / `complete-task` / `delete-task` | タスクの追加・更新・完了・削除 |

各ツールの引数は JSON Schema 互換の形で定義されており、MCP クライアントから自動的に補助されます。

## 開発・ビルド

```bash
npm run build
```

生成物は `dist/` 配下に出力されます。`npm run lint` で型チェックを実行できます。

## トラブルシューティング

- `GOOGLE_OAUTH_CREDENTIALS` が未設定の場合、サーバー起動時にエラーになります。
- テストユーザーに自分のアカウントが追加されていないと認証時にエラーになります。
- トークン破損時は `rm ~/.config/google-calendar-todo-mcp/token.json` で削除し、`npm run auth` を再実行してください。

## ライセンス

MIT
