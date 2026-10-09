// ==UserScript==
// @name         知乎暗黑模式
// @namespace    https://github.com/huisedenanhai/zhihu-dark-mode
// @version      1.1.0
// @description  把知乎网页切换为护眼的黑暗模式
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
   知乎暗黑模式 —— 油猴脚本
   --------------------------------------------------------------------------
   主题思路：
     - 对整个页面「反相 + 色相回正 + contrast() 压低对比度」，白底黑字 → 柔和暗色
     - 图片 / 视频等媒体用一组互为逆运算的滤镜抵消，保持原样
   控制方式：脚本管理器菜单命令（切换暗黑模式 / 调整对比度）
   设置：GM_setValue 持久化（跨子域共享），localStorage 作同步缓存避免白闪
   ========================================================================== */
(function () {
  'use strict';

  const ROOT_CLASS = 'zhihu-dark';
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

  /* -------------------------------- 工具 --------------------------------- */
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
      const value = GM_getValue(key, fallback);
      return value && typeof value.then === 'function' ? fallback : value;
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
    el.classList.toggle(ROOT_CLASS, enabled);
    el.style.setProperty('--zhm-contrast', String(contrast));
    el.style.setProperty('--zhm-contrast-inverse', inverseOf(contrast));
  }

  function setEnabled(next) {
    enabled = !!next;
    lsSet(LS_ENABLED, enabled ? '1' : '0');
    gmSet(KEY_ENABLED, enabled);
    enforce();
  }

  function setContrast(next) {
    contrast = clampContrast(next);
    lsSet(LS_CONTRAST, contrast);
    gmSet(KEY_CONTRAST, contrast);
    enforce();
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  /* -------------------------------- 启动 --------------------------------- */
  // 先用 localStorage 缓存同步决定（避免白闪），再用 GM 存储校正（跨子域一致）
  const cached = lsGet(LS_ENABLED, null);
  enabled = cached === null ? DEF_ENABLED : cached === '1';
  contrast = clampContrast(lsGet(LS_CONTRAST, DEF_CONTRAST));
  enabled = !!gmGet(KEY_ENABLED, enabled);
  contrast = clampContrast(gmGet(KEY_CONTRAST, contrast));

  injectStyle();
  enforce();

  // 页面脚本可能改写 html 的 class，持续校正
  if (document.documentElement) {
    new MutationObserver(enforce).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  // head 尚未就绪时兜底再注入一次
  document.addEventListener('DOMContentLoaded', () => {
    injectStyle();
    enforce();
  }, { once: true });

  /* ------------------------------ 菜单命令 ------------------------------- */
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('切换暗黑模式', () => setEnabled(!enabled));
    GM_registerMenuCommand('调整对比度…', () => {
      const input = prompt('对比度（50–100，数值越小越柔和）：', String(Math.round(contrast * 100)));
      if (input === null) return;
      const n = Number(input);
      if (isFinite(n)) setContrast(n / 100);
    });
  }
})();
