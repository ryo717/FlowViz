🧠 FlowViz AGENTS.MD（for GPT-CLI / Codex / ExaBase）

対象: GPT-CLI／Codex／Claude Code／ExaBase などのエージェント実行環境
目的: FlowViz の要件定義に基づき、コード生成・検証・ビルドを自動化するための仕様を定義する。

⸻

📘 要件定義との整合

本書は docs/FlowViz_Requirements.md（v1.0）を参照する。
各エージェントは生成物を下記マッピングに基づき検証すること。

要件章	対応Agent	検証内容
6. アーキ方針	LauncherAgent	Python構成・CSP・HTTPサーバ整合
7. 入出力仕様	ParserAgent / ExportAgent	FlowMD入出力整合
8. 機能要件	全Agent	MVP機能カバレッジ確認
8.2 テスト要件	UITestAgent	テストスキーマ整合
9. 非機能要件	LauncherAgent	性能・オフライン確認
13. 構成	PackAgent	PyInstaller成果物検証
15. 方針決定	SpecAgent	Mermaid対応範囲・描画方針

Single Source of Truth: 要件定義は docs/FlowViz_Requirements.md を唯一の真実源とし、AGENTSは常にこれと同期する。

⸻

🤖 エージェント概要

Agent	目的	出力	検証
SpecAgent	要件定義整合・仕様更新	/docs/FlowViz_Requirements.md	要件差分チェック
ParserAgent	FlowMDパーサ生成	/app/assets/js/parser.js	JSONテスト通過
RenderAgent	D3描画制御	/app/assets/js/viewer.js	性能閾値
HighlightAgent	下流DFS/BFS処理	/app/assets/js/highlight.js	T01〜T03合格
ExportAgent	CSV/PNG出力	/app/assets/js/export.js	E01〜E02通過
UITestAgent	テスト生成・検証	/app/assets/test/	100%合格
LauncherAgent	Pythonランチャ生成	/launcher/	CSPヘッダ検証
PackAgent	exeビルド	/scripts/	zip構成整合

各Agentは明確な責務を持ち、生成物は上表の出力先に配置すること。

⸻

⚙️ 実行フロー

SpecAgent → ParserAgent → HighlightAgent → RenderAgent → ExportAgent → UITestAgent → LauncherAgent → PackAgent

	1.	SpecAgent が要件定義を解析し、仕様の差分を抽出。
	2.	担当エージェントがJS/Pythonモジュールを生成。
	3.	UITestAgent が /app/assets/test/testcases/*.json に基づき検証。
	4.	LauncherAgent が HTTPサーバとCSP設定を確認。
	5.	PackAgent が exe 化とZIP生成を実施。

⸻

🧩 開発・ビルド手順

# 自己診断（単体テスト）
FlowViz.exe --selftest

# ログ確認
cat logs/test-report.json

# exeパッケージ化
scripts/selftest.bat && pyinstaller FlowViz.spec

# 配布ZIP生成
scripts/build.bat → FlowViz-<ver>-win-x64.zip


⸻

🔒 運用ポリシー
	•	外部通信禁止（CSP + localhost）
	•	npm/pip不使用
	•	追加ランタイム導入禁止
	•	FlowViz.exe 単体で動作確認必須
	•	CI/CD では selftest 合格後に ZIP 生成

⸻

🧠 ランチャー実装仕様（参考）

from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import os, json, webbrowser

class FlowVizHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:;")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()

if __name__ == '__main__':
    with open('config/appsettings.json', encoding='utf-8') as f:
        cfg = json.load(f)
    port = cfg.get('port', 0)
    os.chdir('app')
    srv = ThreadingHTTPServer(('127.0.0.1', port), FlowVizHandler)
    webbrowser.open(f"http://127.0.0.1:{srv.server_port}/viewer.html")
    print(f"FlowViz started at port {srv.server_port}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        srv.server_close()
        print('Stopped.')


⸻

🚀 テスト体系（要約）
	•	/app/assets/test/runner.html によるブラウザ実行
	•	/app/assets/test/testcases/*.json による構造化ケース定義
	•	合格率 100% で MVP 受入
	•	ログ出力：logs/test-report.json

⸻

🧭 改訂指針

バージョン	改訂内容	対応Agent
v1.1	TypeScript移行（型安全強化）	Parser / UITest
v1.2	深さ制限・テーマ切替	Render
v1.3	差分比較機能	GraphModel
v2.0	WebSocketリアルタイム同期（フレームワーク再評価）	Launcher


⸻

📄 付録：ディレクトリ構成要約

FlowViz/
  AGENTS.md
  README.md
  LICENSE
  docs/
    FlowViz_Requirements.md
    ARCHITECTURE.md
  app/
    viewer.html
    assets/
      js/
      css/
      test/
  config/
  logs/
  samples/
  scripts/


⸻

開発指針:
「要件定義 → コード生成 → 自動テスト → exe化」を完全ローカル環境で一貫させること。
SpecAgent は常に docs/FlowViz_Requirements.md を基準とし、全エージェントの同期整合を保証すること。
