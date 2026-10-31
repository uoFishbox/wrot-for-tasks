# Wrot for Tasks

> **Wrot for Tasks**: [Wrot](https://github.com/villyoshioka/Wrot)をベースにタスク機能を追加したforkです。[このforkのリリース](https://github.com/uoFishbox/wrot-for-tasks/releases)またはBRAT（`uoFishbox/wrot-for-tasks`）から導入してください。[バージョン命名とリリース手順](../FORK_RELEASES.md)も参照してください。

[English](https://github.com/uoFishbox/wrot-for-tasks/blob/main/README.md) ・ **日本語**

**Obsidian で、つぶやくように日々を記録するプラグイン。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](https://opensource.org/licenses/MIT)
[![release](https://img.shields.io/github/v/release/uoFishbox/wrot-for-tasks)](https://github.com/uoFishbox/wrot-for-tasks/releases/latest)

![メインエリアに開いた Wrot for Tasks のタイムライン](https://raw.githubusercontent.com/uoFishbox/wrot-for-tasks/main/docs/images/timeline-desktop-ja.png)

---

## Wrot for Tasks とは？

**Wrot for Tasks** は、Vill Yoshioka 氏のマイクロジャーナリング・プラグイン [Wrot](https://github.com/villyoshioka/Wrot) に、未完了タスク一覧・時間付きタスク入力・カレンダーのタスク表示を追加したforkです。

SNS のような気軽さで書けて、書いたものは誰にも見られず、勝手に整理もされません。思考の断片や日々のつぶやきを気兼ねなく残せる、あなただけの空間をつくります。

投稿内容はそのままデイリーノートへ保存されるため、Obsidian 本来の検索性やリンク構造、振り返りのワークフローを損なうことなくシームレスに活用できます。

<p align="center">
  <img src="https://raw.githubusercontent.com/uoFishbox/wrot-for-tasks/main/docs/images/posting-mobile.gif" alt="iPhone の Wrot for Tasks から投稿する様子" width="280">
  <img src="https://raw.githubusercontent.com/uoFishbox/wrot-for-tasks/main/docs/images/timeline-mobile.png" alt="iPhone での Wrot for Tasks のタイムライン" width="280">
</p>

---

## 主な機能

- **SNS ライクな使い心地とリッチなエディタ**  
  タイムライン形式で素早く振り返れます。投稿フォームは Markdown の記号を隠して、太字やリストを仕上がりの見た目のまま書けます（[詳細](https://github.com/uoFishbox/wrot-for-tasks/blob/main/docs/ja/Ver3.0.0%E4%BB%A5%E9%99%8D%E3%81%AE%E6%8A%95%E7%A8%BF%E3%83%95%E3%82%A9%E3%83%BC%E3%83%A0%E3%81%AB%E3%81%A4%E3%81%84%E3%81%A6.md)）。ツールバーで書式設定・リスト・引用・リンクなどを手軽に扱え、ボタン表示や並び順は自由にカスタマイズ可能です（[詳細](https://github.com/uoFishbox/wrot-for-tasks/blob/main/docs/ja/%E3%83%84%E3%83%BC%E3%83%AB%E3%83%90%E3%83%BC%E3%81%AE%E4%BD%BF%E3%81%84%E6%96%B9.md)）。
- **埋もれさせないピン留め機能**  
  重要なメモや直近のタスクをタイムライン上部に固定表示できます。日付を指定して、その日が来たら自動でピン留めする予約にも対応しています（[詳細](https://github.com/uoFishbox/wrot-for-tasks/blob/main/docs/ja/%E3%83%94%E3%83%B3%E7%95%99%E3%82%81%E3%81%AE%E4%BD%BF%E3%81%84%E6%96%B9.md)）。
- **Obsidian 本体のタグシステムと完全連携**  
  メモ内のタグは通常のタグと同様にグラフビューへ反映され、タグ検索の対象になります。クリックひとつで Obsidian 本体の検索から辿ることも可能です（[詳細](https://github.com/uoFishbox/wrot-for-tasks/blob/main/docs/ja/%E3%82%BF%E3%82%B0%E3%81%AE%E6%9C%AC%E4%BD%93%E7%B5%B1%E5%90%88%E3%81%AE%E4%BD%BF%E3%81%84%E6%96%B9.md)）。
- **タグの入力補完**  
  投稿フォームで `#` を入力すると、過去に使用したタグが自動で候補表示され、入力の手間を減らせます（[詳細](https://github.com/uoFishbox/wrot-for-tasks/blob/main/docs/ja/%E3%82%BF%E3%82%B0%E5%85%A5%E5%8A%9B%E8%A3%9C%E5%AE%8C%E3%81%AE%E4%BD%BF%E3%81%84%E6%96%B9.md)）。
- **タグルール（自動カラー分け）**  
  特定のタグに対して背景色・文字色を指定できます。トピックや気分、重要度に応じてタイムラインを視覚的に整理できます（[詳細](https://github.com/uoFishbox/wrot-for-tasks/blob/main/docs/ja/%E3%82%BF%E3%82%B0%E3%83%AB%E3%83%BC%E3%83%AB%E3%81%AE%E4%BD%BF%E3%81%84%E6%96%B9.md)）。
- **リンクと URL プレビュー**  
  リンクボタンから Vault 内のノートや Web ページへのリンクを付けられます。外部 URL の OGP カード表示にも対応し、参照先を直感的に把握できます（[詳細](https://github.com/uoFishbox/wrot-for-tasks/blob/main/docs/ja/%E7%94%BB%E5%83%8F%E3%83%BB%E3%83%AA%E3%83%B3%E3%82%AF%E3%83%BB%E5%9F%8B%E3%82%81%E8%BE%BC%E3%81%BF%E3%81%AE%E4%BD%BF%E3%81%84%E6%96%B9.md)）。
- **テンプレートの見出しに投稿**  
  デイリーノートのテンプレートにある見出しを選んでおくと、投稿がその見出しの下に追加されます。Templater を使ったテンプレートにも対応しています（[詳細](https://github.com/uoFishbox/wrot-for-tasks/blob/main/docs/ja/%E3%83%86%E3%83%B3%E3%83%97%E3%83%AC%E3%83%BC%E3%83%88%E3%81%AE%E8%A6%8B%E5%87%BA%E3%81%97%E6%8C%87%E5%AE%9A%E3%81%AE%E4%BD%BF%E3%81%84%E6%96%B9.md)）。
- **スムーズな画像添付**  
  クリップボードからの貼り付け、ドラッグ＆ドロップ、ボタンからの選択に対応しています。投稿前にサムネイルでプレビューでき、添付の取り消しもできます。
- **自由度の高い外観カスタマイズ**  
  テーマに合わせたカラーリングの変更、投稿ボタンのアイコンやテキストの変更など、好みに合わせた調整が可能です。

---

## メモの保存仕様

メモはすべて、Obsidian の「デイリーノート」設定で指定されたノート内に ` ```wr ` コードブロックとして記録されます。独自の外部データベースは使用せず、データは Vault 内のローカルファイルとして完結します。

タイムライン上から直接作成・編集・削除ができるほか、Markdown ファイルを直接開いて編集することも可能です。

デイリーノートの日付フォーマットを週次（例: `GGGG年WW週`）や月次（例: `YYYY年MM月`）に設定すれば、ウィークリー / マンスリーログとしても使えます。

> **注意**: Wrot for Tasks を使用するには、Obsidian コアプラグインの「デイリーノート」を有効化しておく必要があります。

---

## 動作要件

- Obsidian **v1.14.4** 以降
- 対応プラットフォーム
  - macOS
  - iOS / iPadOS
  - Windows（動作未確認）
  - Linux（動作未確認）
  - Android（動作未確認）

---

## 対応言語

Wrot for Tasks は **11 言語 12 ロケール** に対応しています。Obsidian の言語設定に自動で追従し、未対応言語の場合は英語で表示されます。

| 言語         | ロケール | 言語         | ロケール |
| :----------- | :------- | :----------- | :------- |
| 日本語       | `ja`     | フランス語   | `fr`     |
| 英語（US）   | `en`     | ドイツ語     | `de`     |
| 英語（UK）   | `en-GB`  | イタリア語   | `it`     |
| 韓国語       | `ko`     | ロシア語     | `ru`     |
| スペイン語   | `es`     | 繁体字中国語 | `zh-TW`  |
| ポルトガル語 | `pt`     | 簡体字中国語 | `zh-CN`  |

---

## クイックスタート

1. BRATまたは手動で、Wrot for Tasks をインストールします。
2. リボンアイコンをクリックするか、コマンドパレットから「Open」を実行して、タイムラインを表示します。
3. 入力欄にテキストを書き、投稿ボタン（または `Ctrl / Cmd + Enter`）を押すだけで記録が完了します。

### インストール手順

**BRATから**

1. ObsidianにBRATをインストールして有効化します。
2. BRATの「Add a beta plugin」で `uoFishbox/wrot-for-tasks` を指定します。
3. 「設定 → コミュニティプラグイン」で **Wrot for Tasks** を有効化します。

**手動インストール**

1. [Releases](https://github.com/uoFishbox/wrot-for-tasks/releases) から最新の `main.js`、`manifest.json`、`styles.css` をダウンロードします。
2. お使いの Vault の `.obsidian/plugins/wrot-for-tasks/` ディレクトリに 3 つのファイルを配置します。フォルダが存在しない場合は、先に新規作成してください。
3. Obsidian の設定から「コミュニティプラグイン」を開き、リロードアイコンを押して Wrot for Tasks を有効化します。

> プラグインIDは `wrot-for-tasks` です。旧fork版のIDは `wrot` で、設定や開いているビューの自動移行は行いません。同じノートを二重に処理しないよう、従来のWrotを無効化してからこのforkを有効化してください。

> **ヒント**: `.obsidian` は隠しフォルダです。表示されない場合は、macOS では `Cmd + Shift + .` を押し、Windows ではエクスプローラーの「表示 → 隠しファイル」にチェックを入れてください。

---

## カスタマイズ項目

設定画面から以下の項目などを柔軟に変更できます。

- ビューの配置場所: 左右のサイドバー、またはメインエリア
- カラーテーマ: ライト／ダークモード別の配色設定
- タグルール: タグごとの背景色・文字色設定
- ピン留め設定: 最大件数の設定（1 / 3 / 5件）、スクロール時の上部固定表示
- ボタン設定: 投稿・更新ボタンのラベル／アイコン変更、投稿メニュー内の削除ボタン表示切り替え
- フォーマット: タイムスタンプの表示形式（例: `YYYY/MM/DD HH:mm:ss`）
- プレビュー機能: OGP カードプレビューの有効化／無効化

![右サイドバーに置いた Wrot for Tasks のタイムライン](https://raw.githubusercontent.com/uoFishbox/wrot-for-tasks/main/docs/images/sidebar-desktop-ja.png)

---

## プライバシー

データ収集やトラッキングは一切行われません。すべてのデータ処理はローカル環境で完結します。

_※ URL プレビュー機能を有効にしている場合のみ、OGP 情報を取得するために、該当するリンク先のサーバーへアクセスします。_

---

## ライセンス

[MIT License](https://github.com/villyoshioka/Wrot/blob/main/LICENSE)

フォークを公開される方は [フォークについて](https://github.com/villyoshioka/Wrot/blob/main/docs/ja/FORKING.md) もご覧ください。

---

## 謝辞

Wrot for Tasks は [uoFishbox](https://github.com/uoFishbox) が管理し、Vill Yoshioka 氏の [Wrot](https://github.com/villyoshioka/Wrot) をベースにしています。元のWrotは、以下のプロジェクトに着想を得て開発されました。

- [Obsidian Memos](https://github.com/Quorafind/Obsidian-Memos)（現: [Thino](https://github.com/Quorafind/Obsidian-Thino)）by [Quorafind](https://github.com/Quorafind)
- [Mobile First Daily Interface (MFDI)](https://github.com/tadashi-aikawa/mobile-first-daily-interface) by [tadashi-aikawa](https://github.com/tadashi-aikawa)

多言語対応の翻訳には [Nani](https://nani.now/ja) を活用しています。有用なツールを提供してくださっている [catnose](https://x.com/catnose99) 氏（Kioku LLC）に感謝申し上げます。

---

## fork元の開発体制

本プラグインは、開発者が設計および品質管理を行いながら、Anthropic 社の Claude を補助的に用いて開発しています。詳細は [AI 利用ポリシー](https://github.com/uoFishbox/wrot-for-tasks/blob/main/docs/ja/AI_POLICY.md) をご参照ください。

**fork元の作者**: Vill Yoshioka ([@villyoshioka](https://github.com/villyoshioka))
