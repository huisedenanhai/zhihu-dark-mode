// ==UserScript==
// @name         知乎暗黑模式
// @namespace    https://github.com/huisedenanhai/zhihu-dark-mode
// @version      1.0.0
// @description  把知乎网页切换为护眼的黑暗模式，支持一键开关与对比度调节
// @author       huisedenanhai
// @match        *://*.zhihu.com/*
// @icon         data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M15.5 3a9 9 0 1 0 0 18 7 7 0 0 1 0-18z' fill='%237aa2ff'/%3E%3C/svg%3E
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-start
// @noframes
// ==/UserScript==

/* ==========================================================================
   知乎暗黑模式 —— 油猴脚本版
   --------------------------------------------------------------------------
   主题思路：
     - 对整个页面「反相 + 色相回正 + contrast() 压低对比度」，白底黑字 → 柔和暗色
     - 图片 / 视频等媒体用一组互为逆运算的滤镜抵消，保持原样
   实现要点：
     - 页面右下角的悬浮控件（Shadow DOM 隔离样式）
     - Tampermonkey 菜单命令
     - 设置用 GM_setValue / GM_getValue 持久化，并用 localStorage 做同步缓存
   ========================================================================== */
(function () {
  'use strict';

  /* -------------------------------- 常量 --------------------------------- */

  const ROOT_CLASS = 'zhihu-dark';
  const UI_ID = 'zhihu-dark-mode-ui';
  const STYLE_ID = 'zhihu-dark-mode-style';

  const KEY_ENABLED = 'enabled';
  const KEY_CONTRAST = 'contrast';
  const DEF_ENABLED = true;
  const DEF_CONTRAST = 0.8;
  const MIN_CONTRAST = 0.5;
  const MAX_CONTRAST = 1;

  const LS_ENABLED = '__zhihu_dark_mode_enabled__';
  const LS_CONTRAST = '__zhihu_dark_mode_contrast__';

  /* ------------------------------ 注入的样式 ------------------------------ */

  const CSS = `
html.${ROOT_CLASS} {
  --zhm-contrast: ${DEF_CONTRAST};
  --zhm-contrast-inverse: 1.25;

  background-color: #f5f6f7 !important;
  color-scheme: light !important;
  filter: invert(1) hue-rotate(180deg) contrast(var(--zhm-contrast));
  scrollbar-color: #5a606a #23262b !important;
}

html.${ROOT_CLASS} body {
  background-color: #f5f6f7 !important;
  min-height: 100vh;
}

/* 媒体内容：与根滤镜互为逆运算，恢复原貌 */
html.${ROOT_CLASS} img,
html.${ROOT_CLASS} picture,
html.${ROOT_CLASS} video,
html.${ROOT_CLASS} canvas,
html.${ROOT_CLASS} iframe,
html.${ROOT_CLASS} embed,
html.${ROOT_CLASS} object,
html.${ROOT_CLASS} svg,
html.${ROOT_CLASS} [style*="background-image"] {
  filter: contrast(var(--zhm-contrast-inverse)) hue-rotate(180deg) invert(1);
}

html.${ROOT_CLASS} [style*="background-image"] > img,
html.${ROOT_CLASS} [style*="background-image"] > svg {
  filter: none;
}

html.${ROOT_CLASS} ::selection {
  background: #3a6ea5 !important;
  color: #fff !important;
}

/* 悬浮控件自身也抵消根滤镜，保持它原本的配色 */
html.${ROOT_CLASS} #${UI_ID} {
  filter: contrast(var(--zhm-contrast-inverse)) hue-rotate(180deg) invert(1) !important;
}

@media print {
  html.${ROOT_CLASS} {
    filter: none !important;
    background: #fff !important;
    color-scheme: light !important;
  }
  html.${ROOT_CLASS} img,
  html.${ROOT_CLASS} picture,
  html.${ROOT_CLASS} video,
  html.${ROOT_CLASS} canvas,
  html.${ROOT_CLASS} iframe,
  html.${ROOT_CLASS} svg,
  html.${ROOT_CLASS} [style*="background-image"] {
    filter: none !important;
  }
}
`;

  /* ------------------------------ 工具函数 ------------------------------- */

  function clampContrast(value) {
    const n = Number(value);
    if (!isFinite(n)) return DEF_CONTRAST;
    return Math.min(MAX_CONTRAST, Math.max(MIN_CONTRAST, n));
  }

  function inverseOf(c) {
    return String(Number((1 / c).toFixed(4)));
  }

  /* ------------------------------ 设置读写 ------------------------------- */

  const hasGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';

  function gmGet(key, fallback) {
    if (!hasGM) return fallback;
    try {
      const r = GM_getValue(key, fallback);
      if (r && typeof r.then === 'function') return fallback; // 异步型 API，先用缓存
      return r;
    } catch (_) {
      return fallback;
    }
  }

  function gmSet(key, value) {
    if (!hasGM) return;
    try {
      GM_setValue(key, value);
    } catch (_) {
      /* 忽略 */
    }
  }

  function lsGet(key, fallback) {
    try {
      const v = window.localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (_) {
      return fallback;
    }
  }

  function lsSet(key, value) {
    try {
      window.localStorage.setItem(key, String(value));
    } catch (_) {
      /* 忽略 */
    }
  }

  /* -------------------------------- 状态 --------------------------------- */

  let enabled = DEF_ENABLED;
  let contrast = DEF_CONTRAST;

  function enforce() {
    const el = document.documentElement;
    if (!el) return;

    if (el.classList.contains(ROOT_CLASS) !== enabled) {
      el.classList.toggle(ROOT_CLASS, enabled);
    }
    const c = String(contrast);
    if (el.style.getPropertyValue('--zhm-contrast') !== c) {
      el.style.setProperty('--zhm-contrast', c);
    }
    const inv = inverseOf(contrast);
    if (el.style.getPropertyValue('--zhm-contrast-inverse') !== inv) {
      el.style.setProperty('--zhm-contrast-inverse', inv);
    }
  }

  /* 首屏：先用 localStorage 缓存同步决定，尽量避免白闪 */
  const cachedEnabled = lsGet(LS_ENABLED, null);
  enabled = cachedEnabled === null ? DEF_ENABLED : cachedEnabled === '1';
  contrast = clampContrast(lsGet(LS_CONTRAST, DEF_CONTRAST));
  enforce();

  /* 再用 GM 存储（跨子域共享）校正 */
  enabled = !!gmGet(KEY_ENABLED, enabled);
  contrast = clampContrast(gmGet(KEY_CONTRAST, contrast));
  enforce();

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function setEnabled(next) {
    enabled = !!next;
    lsSet(LS_ENABLED, enabled ? '1' : '0');
    gmSet(KEY_ENABLED, enabled);
    enforce();
    render();
  }

  function setContrast(next) {
    contrast = clampContrast(next);
    lsSet(LS_CONTRAST, contrast);
    gmSet(KEY_CONTRAST, contrast);
    enforce();
    render();
  }

  /* ------------------------------ 悬浮控件 ------------------------------- */

  let ui = null;

  const UI_HTML = `
<style>
  :host { all: initial; }
  .wrap {
    position: fixed; right: 18px; bottom: 18px; z-index: 2147483647;
    font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI",
      "PingFang SC", "Microsoft YaHei", sans-serif;
    color: #eceef1;
  }
  .panel {
    position: absolute; right: 0; bottom: 52px; width: 216px;
    padding: 14px; border-radius: 12px;
    background: #1c1f24; border: 1px solid #2c3037;
    box-shadow: 0 10px 30px rgba(0,0,0,.5);
  }
  .panel[hidden] { display: none; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .title { font-size: 13px; font-weight: 600; }
  .sub { margin: 2px 0 12px; font-size: 11px; color: #9aa1ac; }
  .lbl { font-size: 12px; }
  .val { font-size: 12px; font-weight: 600; color: #7a97ff; font-variant-numeric: tabular-nums; }
  .row { display: flex; align-items: baseline; justify-content: space-between; margin: 12px 0 6px; }
  input[type="range"] { width: 100%; height: 18px; margin: 0; accent-color: #7a97ff; cursor: pointer; background: transparent; }
  .scale { display: flex; justify-content: space-between; margin-top: 3px; font-size: 10px; color: #9aa1ac; }
  .fab {
    width: 42px; height: 42px; margin-left: auto; padding: 0; cursor: pointer;
    display: grid; place-items: center; border: none; border-radius: 50%;
    color: #cdd6f4; background: #1c1f24; box-shadow: 0 6px 18px rgba(0,0,0,.45);
    border: 1px solid #2c3037;
  }
  .fab:hover { background: #23272e; }
  .fab svg { width: 22px; height: 22px; display: block; }
  .switch { position: relative; width: 42px; height: 24px; flex: none; cursor: pointer; }
  .switch input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
  .track { position: absolute; inset: 0; border-radius: 999px; background: #3a3e46; transition: background .18s; }
  .track::after { content: ""; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform .18s; }
  .switch input:checked + .track { background: #5b7cfa; }
  .switch input:checked + .track::after { transform: translateX(18px); }
</style>
<div class="wrap">
  <section class="panel" hidden>
    <div class="head">
      <div>
        <div class="title">知乎暗黑模式</div>
        <div class="sub">护眼深色主题</div>
      </div>
      <label class="switch" title="开关暗黑模式">
        <input type="checkbox" class="toggle" aria-label="开关暗黑模式" />
        <span class="track"></span>
      </label>
    </div>
    <div class="row"><span class="lbl">对比度</span><span class="val">80%</span></div>
    <input type="range" class="range" min="50" max="100" step="1" value="80" aria-label="对比度" />
    <div class="scale"><span>更柔和</span><span>更强烈</span></div>
  </section>
  <button class="fab" title="知乎暗黑模式（点击展开）" aria-label="知乎暗黑模式">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15.5 3a9 9 0 1 0 0 18 7 7 0 0 1 0-18z" fill="currentColor"/>
    </svg>
  </button>
</div>`;

  function buildUI() {
    if (ui || document.getElementById(UI_ID)) return;
    const host = document.createElement('div');
    host.id = UI_ID;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = UI_HTML;

    const panel = shadow.querySelector('.panel');
    const fab = shadow.querySelector('.fab');
    const toggle = shadow.querySelector('.toggle');
    const range = shadow.querySelector('.range');
    const val = shadow.querySelector('.val');

    fab.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
    });
    toggle.addEventListener('change', () => setEnabled(toggle.checked));

    let saveTimer = null;
    range.addEventListener('input', () => {
      setContrast(Number(range.value) / 100);
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        gmSet(KEY_CONTRAST, contrast);
      }, 80);
    });

    (document.body || document.documentElement).appendChild(host);
    ui = { panel, toggle, range, val };
    render();
  }

  function render() {
    if (!ui) return;
    ui.toggle.checked = enabled;
    const pct = Math.round(contrast * 100);
    ui.range.value = String(pct);
    ui.val.textContent = pct + '%';
  }

  /* -------------------------------- 启动 --------------------------------- */

  injectStyle();
  enforce();

  /* 页面脚本可能改写 html 的 class / style，持续校正 */
  const observer = new MutationObserver(enforce);
  function observeRoot() {
    const el = document.documentElement;
    if (!el) return;
    observer.observe(el, { attributes: true, attributeFilter: ['class', 'style'] });
  }

  function onReady() {
    injectStyle();
    observeRoot();
    enforce();
    buildUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
  } else {
    onReady();
  }
  // 悬浮控件需要 body，body 出现后再建一次
  if (!document.body) {
    const t = setInterval(() => {
      if (document.body) {
        clearInterval(t);
        buildUI();
      }
    }, 50);
  }

  /* ---------------------------- 菜单命令 --------------------------------- */

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('切换暗黑模式', () => setEnabled(!enabled));
    GM_registerMenuCommand('调整对比度…', () => {
      const input = prompt('对比度（50–100，数值越小越柔和）：', String(Math.round(contrast * 100)));
      if (input !== null && input.trim() !== '') setContrast(Number(input) / 100);
    });
  }
})();
