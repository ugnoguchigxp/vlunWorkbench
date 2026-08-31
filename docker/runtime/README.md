# Isolated runtime image registration

画面の `Runtime Settings` で `Auto-configure local runtime` を押すと、現在のサーバー上で次の処理を順番に行います。

1. 利用可能な固定基底イメージを選ぶ
2. `docker/runtime/Dockerfile` をビルドする
3. UID 1000 のNode/npm実行、UID 65532のnamespace owner、read-only実行、`wget`/`curl`、npmレジストリ中継を検証する
4. 完成イメージをローカルの固定ダイジェストで登録する
5. 8個の必須設定をSQLiteへ一括保存する

途中で失敗した場合、SQLiteは変更しません。一時コンテナ、ネットワーク、ビルドタグは削除します。

## イメージ作成時に登録する場合

アプリを停止した状態、または次回再起動前のビルド・配備工程では次のコマンドを使えます。

```sh
bun run runtime-isolation:auto-configure
```

このコマンドは画面ボタンと同じビルド・資格確認を行い、成功した場合だけ対象のSQLiteへ登録します。起動中のアプリへ即時反映したい場合は画面ボタンを使ってください。CLIで登録した設定はアプリの次回起動時に読み込まれます。

複数ホストへ配備する場合、イメージのregistry digestはビルド工程で確定できますが、`dockerDaemonIdentityHash` と最終的な `qualificationHash` は配備先固有です。ビルドホストの2つのハッシュを別ホストへコピーせず、各配備先で資格確認とSQLite登録を実行してください。
