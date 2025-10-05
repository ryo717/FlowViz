# FlowViz

FlowVizは、MermaidライクなMarkdown（`graph` / `flowchart`）を読み込み、
システムやデータパイプラインの依存関係を可視化するスタンドアロンアプリです。

## 特徴
- 完全オフライン対応
- D3.jsによるインタラクティブな依存関係描画
- Python + Vanilla JS 構成（追加インストール不要）
- 300〜1000ノード規模のグラフを高速レンダリング

## 主なコマンド
```bash
FlowViz.exe --selftest   # 単体テストを実行
FlowViz.exe              # ビューアを起動（既定ブラウザ）
```

## ディレクトリ構成
- `docs/` : 要件定義・設計資料
- `app/` : HTML/JS/CSSなど静的資産
- `samples/` : テスト用Markdown
- `logs/` : 実行時ログ・テスト結果
- `config/` : 起動設定

## サンプルの表示手順
1. リポジトリ直下で `python -m http.server 8000 --directory app` を実行して簡易サーバーを立ち上げます。
2. ブラウザで `http://127.0.0.1:8000/viewer.html` を開きます。
3. 左側の FlowMD エディタに `samples/demo-large.md` の内容を貼り付け、「エディタから描画」を押下します。
4. ノードが描画されたら、ツールバーから PNG/CSV のエクスポートやノード検索を試せます。

`FlowVizLauncher.py` を利用する場合は `python launcher/FlowVizLauncher.py` で同様にビューアを起動できます。

## ライセンス
MIT License
