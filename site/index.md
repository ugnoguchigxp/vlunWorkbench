---
layout: default
title: 診断結果を証跡から確かめるローカルワークベンチ
description: vulnWorkbenchは、複数のセキュリティスキャナーによる検査結果と証跡をまとめ、何をどこまで調べたかが分かるレポートをローカル環境に残します。
permalink: /
image: /assets/img/og-image.jpg
body_class: lp-body
preload_hero: true
twitter_image_alt: vulnWorkbenchのセキュリティスキャン画面
og_image_alt: vulnWorkbenchのセキュリティスキャン画面
---

<main class="lp">
  <section class="hero">
    <picture class="hero-bg" aria-hidden="true">
      <source srcset="{{ '/assets/img/vulnworkbench-hero.webp' | relative_url }}" type="image/webp">
      <img
        src="{{ '/assets/img/vulnworkbench-hero.png' | relative_url }}"
        alt=""
        width="1572"
        height="1001"
        loading="eager"
        decoding="async"
        fetchpriority="high"
      >
    </picture>
    <div class="hero-shade" aria-hidden="true"></div>

    <div class="shell hero-shell">
      <header class="topbar">
        <a class="brand" href="{{ '/' | relative_url }}">vulnWorkbench</a>
        <div class="topbar-actions">
          <a class="topbar-link" href="{{ '/plans/archive/' | relative_url }}">設計書一覧</a>
          <div class="chip">ローカルを中心に運用 / 証跡に基づく / 異常時は停止</div>
        </div>
      </header>

      <div class="hero-copy">
        <p class="eyebrow">ローカルで使える脆弱性診断ワークベンチ</p>
        <h1>
          診断結果を、<br>
          証跡から<br>
          確かめる。
        </h1>
        <p class="lead">
          vulnWorkbenchは、ソースコードの静的解析、依存ライブラリ、埋め込まれた機密情報、動的検査（DAST）などの結果をまとめ、
          何をどこまで調べたかが分かる証跡とともに、診断結果とレポートを残すローカルワークベンチです。
        </p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="https://github.com/ugnoguchigxp/vlunWorkbench">GitHubで見る</a>
          <a class="btn btn-secondary" href="{{ '/plans/archive/' | relative_url }}">設計書・実装計画を見る</a>
          <a class="btn btn-secondary" href="https://github.com/ugnoguchigxp/vlunWorkbench/blob/main/README.md">READMEを読む</a>
        </div>
      </div>

      <div class="status-strip" aria-label="vulnWorkbenchの主な特徴">
        <div><strong>複数のスキャナーを一括実行</strong><span>対象と制限をプロファイルで管理</span></div>
        <div><strong>検出結果と証跡を保存</strong><span>検査範囲と未検証の範囲も記録</span></div>
        <div><strong>再確認できるレポート</strong><span>必要に応じてAI（LLM）が証跡に基づきレビュー</span></div>
      </div>
    </div>
  </section>

  <section class="section intro">
    <div class="shell section-grid">
      <div>
        <p class="section-kicker">vulnWorkbenchが解決すること</p>
        <h2>ツールの出力を、根拠をたどれる診断結果に。</h2>
      </div>
      <p class="section-lead">
        セキュリティツールを増やしても、実行できなかった検査や重複した指摘、
        根拠を確かめにくい要約がばらばらに残っていては、結果を判断できません。
        vulnWorkbenchは、実行前の条件確認から証跡の保存、検査範囲の記録、レポートの作成までを一回のスキャンに結び付けます。
        確認できた事実と、まだ検証できていない範囲を分けて表示します。
      </p>
    </div>
  </section>

  <section class="section">
    <div class="shell">
      <div class="section-heading">
        <p class="section-kicker">主な機能</p>
        <h2>スキャンからレビューまで、一つの流れで管理。</h2>
      </div>
      <div class="cards">
        <article class="card">
          <h3>対象と実行内容を設定</h3>
          <p>ローカルのプロジェクトを登録し、何をどこまで検査するかを定めたプロファイルから診断を始めます。</p>
        </article>
        <article class="card">
          <h3>スキャナーの結果を統合</h3>
          <p>Gitleaks、OSV-Scanner、Trivyなどの結果を、共通の形式にそろえます。</p>
        </article>
        <article class="card">
          <h3>検査範囲と証跡を保存</h3>
          <p>実行済み、未実行、対象外、失敗を区別し、スキャナーの出力と情報の出どころを追跡できるようにします。</p>
        </article>
        <article class="card">
          <h3>レポートとレビュー</h3>
          <p>同じ入力から同じ内容を生成できるレポートを必ず残します。必要な場合だけ、AI（LLM）が保存した証跡に基づいて内容をレビューします。</p>
        </article>
      </div>
    </div>
  </section>

  <section class="section section-flow">
    <div class="shell">
      <div class="section-heading">
        <p class="section-kicker">診断の流れ</p>
        <h2>対象の登録からレポートまで、経過を記録。</h2>
      </div>
      <div class="flow">
        <article class="flow-step"><span>01</span><p>プロジェクトと検査範囲を登録</p></article>
        <article class="flow-step"><span>02</span><p>検査を始められる状態か確認</p></article>
        <article class="flow-step"><span>03</span><p>制限を設けてスキャナーを実行</p></article>
        <article class="flow-step"><span>04</span><p>検出結果と証跡の形式を統一</p></article>
        <article class="flow-step"><span>05</span><p>検査範囲が分かるレポートを確認</p></article>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="shell">
      <div class="section-heading">
        <p class="section-kicker">診断結果の信頼性</p>
        <h2>「検出なし」と「安全」を区別する。</h2>
      </div>
      <div class="compare">
        <article class="compare-box">
          <h3>断片的なスキャン運用</h3>
          <ul>
            <li>スキャナーごとに結果と形式がばらばら</li>
            <li>失敗や未実行も「検出0件」に見えやすい</li>
            <li>要約から元の証跡までたどりにくい</li>
          </ul>
        </article>
        <article class="compare-box active">
          <h3>vulnWorkbench</h3>
          <ul>
            <li>スキャン、各ツールの実行、検出結果、出力ファイルを関連付けて保存</li>
            <li>検査できなかった範囲と、結論を出せない結果を明示</li>
            <li>判断と、その根拠になった証跡を結び付けて保存</li>
          </ul>
        </article>
      </div>
    </div>
  </section>

  <section class="cta">
    <div class="shell">
      <div class="cta-panel">
        <p class="section-kicker">ローカルを中心に管理</p>
        <h2>あとから確かめられる診断結果を残す。</h2>
        <p>
          スキャナーの実行条件、出力ファイル、検査範囲、レポートを一つの流れで管理し、
          ローカル環境に保存します。
        </p>
        <a class="btn btn-primary" href="https://github.com/ugnoguchigxp/vlunWorkbench">GitHubで詳しく見る</a>
      </div>
    </div>
  </section>
</main>

<footer class="footer">
  <div class="shell">vulnWorkbench · ローカルで使える脆弱性診断ワークベンチ</div>
</footer>
