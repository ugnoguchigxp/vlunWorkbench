---
layout: default
title: vulnWorkbench | 証跡を中心にしたローカルAppSecワークベンチ
description: vulnWorkbenchは、複数のセキュリティスキャナー、検出結果、カバレッジ、再現証跡、レポートを一つのローカルワークフローにまとめます。
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
        <div class="chip">local-first / evidence-bound / fail-closed</div>
      </header>

      <div class="hero-copy">
        <p class="eyebrow">Local AppSec Evidence Workbench</p>
        <h1>
          脆弱性診断を、<br>
          証跡から<br>
          判断する。
        </h1>
        <p class="lead">
          vulnWorkbenchは、静的解析、依存関係、シークレット、DASTの結果を集約し、
          検証可能な証跡とカバレッジを保ったまま、診断とレポートへつなぐローカルワークベンチです。
        </p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="https://github.com/ugnoguchigxp/vlunWorkbench">GitHubで見る</a>
          <a class="btn btn-secondary" href="https://github.com/ugnoguchigxp/vlunWorkbench/blob/main/README.md">READMEを読む</a>
        </div>
      </div>

      <div class="status-strip" aria-label="vulnWorkbench capability highlights">
        <div><strong>Scanner Orchestration</strong><span>bounded profiles and adapters</span></div>
        <div><strong>Evidence Integrity</strong><span>findings, artifacts, coverage</span></div>
        <div><strong>Deterministic Reports</strong><span>optional evidence-bound LLM review</span></div>
      </div>
    </div>
  </section>

  <section class="section intro">
    <div class="shell section-grid">
      <div>
        <p class="section-kicker">Why vulnWorkbench</p>
        <h2>ツールの出力を、判断できる診断結果へ。</h2>
      </div>
      <p class="section-lead">
        セキュリティツールを増やすだけでは、実行できなかった検査、重複するfinding、
        根拠の弱い要約が残ります。vulnWorkbenchは実行前のpreflightからartifact、coverage、
        reportまでを同じscanに結び付け、観測できた事実と未検証領域を分けて表示します。
      </p>
    </div>
  </section>

  <section class="section">
    <div class="shell">
      <div class="section-heading">
        <p class="section-kicker">Core Surfaces</p>
        <h2>スキャン、証跡、レビューを一つの流れで扱う。</h2>
      </div>
      <div class="cards">
        <article class="card">
          <h3>Project & Profile</h3>
          <p>ローカルprojectを登録し、対象と実行境界が明示されたprofileから診断を開始します。</p>
        </article>
        <article class="card">
          <h3>Scanner Aggregation</h3>
          <p>Gitleaks、OSV-Scanner、Trivyなどの結果を共通finding contractへ正規化します。</p>
        </article>
        <article class="card">
          <h3>Coverage & Evidence</h3>
          <p>実行済み、未実行、適用外、失敗を区別し、artifactとprovenanceを追跡します。</p>
        </article>
        <article class="card">
          <h3>Report & Review</h3>
          <p>決定論的レポートを必ず残し、必要な場合だけ証跡制約付きLLMレビューを重ねます。</p>
        </article>
      </div>
    </div>
  </section>

  <section class="section section-flow">
    <div class="shell">
      <div class="section-heading">
        <p class="section-kicker">Assessment Flow</p>
        <h2>対象登録からレポートまで、状態を失わない。</h2>
      </div>
      <div class="flow">
        <article class="flow-step"><span>01</span><p>Projectと対象範囲を登録</p></article>
        <article class="flow-step"><span>02</span><p>Preflightで実行条件を検証</p></article>
        <article class="flow-step"><span>03</span><p>Scannerを隔離・制限して実行</p></article>
        <article class="flow-step"><span>04</span><p>Findingとevidenceを正規化</p></article>
        <article class="flow-step"><span>05</span><p>Coverage付きreportを確認</p></article>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="shell">
      <div class="section-heading">
        <p class="section-kicker">Trust Boundary</p>
        <h2>見つからなかったことを、安全だったことにしない。</h2>
      </div>
      <div class="compare">
        <article class="compare-box">
          <h3>断片的なスキャン運用</h3>
          <ul>
            <li>scannerごとに結果と形式が分かれる</li>
            <li>失敗や未実行が0件として見えやすい</li>
            <li>要約から元の証跡を追いにくい</li>
          </ul>
        </article>
        <article class="compare-box active">
          <h3>vulnWorkbench</h3>
          <ul>
            <li>scan、tool run、finding、artifactを関連付ける</li>
            <li>coverage gapとinconclusiveを明示する</li>
            <li>判断を保存済みevidenceへ結び付ける</li>
          </ul>
        </article>
      </div>
    </div>
  </section>

  <section class="cta">
    <div class="shell">
      <div class="cta-panel">
        <p class="section-kicker">Local-first by design</p>
        <h2>診断結果を、再確認できる形で残す。</h2>
        <p>
          スキャナーの実行制御、artifact保存、カバレッジ、決定論的レポートを、
          ローカル環境で一つのワークフローとして扱えます。
        </p>
        <a class="btn btn-primary" href="https://github.com/ugnoguchigxp/vlunWorkbench">GitHubプロジェクトを見る</a>
      </div>
    </div>
  </section>
</main>

<footer class="footer">
  <div class="shell">vulnWorkbench · GitHub Pages + Jekyll</div>
</footer>
