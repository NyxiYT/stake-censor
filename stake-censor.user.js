// ==UserScript==
// @name         Stake Censor
// @namespace    https://github.com/NyxiYT/stake-censor
// @version      1.0.0
// @description  Blurs all Stake logos, badges and branding across Stake sites. Built for streamers and YouTubers who must hide gambling branding to stay within platform rules. Toggle on/off with one click.
// @author       NyxiYT
// @match        *://*.stake.com/*
// @match        *://*.stake.us/*
// @match        *://*.stake.bet/*
// @match        *://*.stake.games/*
// @grant        GM_addStyle
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------
  const BLUR      = 'blur(8px)'; // strength for logos / images
  const TEXT_BLUR = 'blur(4px)'; // strength for the word "Stake" in text
  const ORIG_ATTR = 'data-sc-orig';
  const STAKE_RE  = /stake/i;

  // Functional UI icons that share the "Stake*" naming but must stay sharp,
  // otherwise the site becomes hard to use (game controls, sidebar, nav).
  const SAFE_ICONS = new Set([
    'FullscreenView','ViewDefault','Stats','Popout','Fairness',
    'EuropeanUnion','ChevronDown','Fire','Burst','Poker','Races',
    'StakeBlackjack','StakeBaccarat','StakePlinko','StakeKeno',
    'StakeMines','StakeDice','Play','Heart','Star','Search',
    'ArrowLeft','ArrowRight','ChevronLeft','ChevronRight','ChevronUp',
    'Menu','Close','Check','Info','Warning','Error',
    'Home','Casino','Sport','Promotions','Blog',
  ]);

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let active      = true;  // censoring enabled?
  let ownMutation = false; // set while we mutate the DOM, so the observer ignores it
  let navPending  = false; // set while SvelteKit is navigating between pages
  let mutTimer    = null;

  // ---------------------------------------------------------------------------
  // Static CSS
  //
  // Most of the work is done here. Injecting CSS up front is the fastest path:
  // logos are hidden before the first paint, with no flash of un-censored
  // branding. The JS passes below only handle the cases CSS can't target
  // (dynamic alt text, the literal word "Stake", SvelteKit re-renders).
  // ---------------------------------------------------------------------------
  GM_addStyle(`
    /* Blurred "Stake" text spans */
    .sc-blur-word {
      filter: ${TEXT_BLUR} !important;
      display: inline-block;
      user-select: none;
      pointer-events: none;
    }

    /* Logo images (matched by alt / src) */
    img[alt="Stake logo"],  img[alt="Stake Logo"],
    img[alt="Stake.us logo"], img[alt="Stake.us Logo"],
    img[alt*="stake.us" i],
    img[alt="Stake Originals"], img[alt="Stake Exclusive"],
    img[src*="stake"][src*="logo"],
    img[src*="stakelogo"] {
      filter: ${BLUR} !important;
    }

    /* Anything with "logo" in its class name */
    [class*="logo" i], [class*="logo" i] img,
    [class*="logo" i]:hover, [class*="logo" i]:hover img {
      filter: ${BLUR} !important;
    }

    /* Game-tile / provider "Stake Exclusive" badges */
    .tag-badge, .tag-badge .inner-circle,
    .tag-badge [data-ds-icon="StakeExclusive"] {
      filter: ${BLUR} !important;
    }

    /* Footer brand icon */
    footer [data-ds-icon="StakeWorld"] {
      filter: ${BLUR} !important;
    }

    /* In-game footer: blur only the logo image, never the controls */
    .game-footer img[alt="Stake logo"],
    .game-footer img[alt*="stake" i][alt*="logo" i] {
      filter: ${BLUR} !important;
    }

    /* Animated "Only on Stake" SVG logo in the footer bar */
    #oos-animation,
    #oos-animation svg,
    [id*="oos"] svg {
      filter: ${BLUR} !important;
    }

    /* Footer certification / license images */
    footer img[alt*="certification" i],
    footer img[alt*="certificate" i],
    [class*="certification" i] img,
    [class*="certificate" i] img,
    [class*="license" i] img {
      filter: ${BLUR} !important;
    }

    /* Logos rendered inside the game wrapper / iframe shell */
    .game-wrapper [class*="logo" i],
    .game-wrapper [data-ds-icon="StakeWorld"],
    .game-content [class*="logo" i],
    .iframe-wrap [class*="logo" i] {
      filter: ${BLUR} !important;
    }

    /* Partnership / ambassador / sponsorship logos */
    [class*="drake" i]       [class*="logo" i],
    [class*="partnership" i] [class*="logo" i],
    [class*="ambassador" i]  [class*="logo" i],
    [class*="sponsorship" i] [class*="logo" i] {
      filter: ${BLUR} !important;
    }

    /* Loading / splash-screen logos */
    [class*="loading" i] img,
    [class*="splash" i]  img,
    [class*="preload" i] img,
    [class*="intro" i]   img,
    [class*="loader" i]  img,
    [class*="loading-logo" i],
    .loading-screen img,
    .loading-container img,
    .splash-screen img {
      filter: ${BLUR} !important;
    }

    /* Keep in-game action controls sharp (override the rules above) */
    .game-footer button, .game-footer button *,
    .game-footer .dropdown, .game-footer .dropdown *,
    .game-footer .right *, .game-footer .theater-mode *,
    .game-footer .mini-player *,
    .game-footer [data-ds-icon="FullscreenView"],
    .game-footer [data-ds-icon="ViewDefault"],
    .game-footer [data-ds-icon="Stats"],
    .game-footer [data-ds-icon="Popout"],
    .game-footer [data-ds-icon="Fairness"],
    .game-footer [data-ds-icon="EuropeanUnion"],
    .game-footer [data-ds-icon="ChevronDown"] {
      filter: none !important;
    }

    /* Keep sidebar game icons sharp */
    [data-ds-icon="Fire"],       [data-ds-icon="Burst"],
    [data-ds-icon="Poker"],      [data-ds-icon="Races"],
    [data-ds-icon="StakeBlackjack"], [data-ds-icon="StakeBaccarat"],
    [data-ds-icon="StakePlinko"],    [data-ds-icon="StakeKeno"],
    [data-ds-icon="StakeMines"],     [data-ds-icon="StakeDice"] {
      filter: none !important;
    }

    /* When toggled OFF, html.sc-off undoes every blur rule above */
    html.sc-off .sc-blur-word                             { filter: none !important; display: inline; }
    html.sc-off [class*="logo" i],
    html.sc-off [class*="logo" i] img,
    html.sc-off img[alt="Stake logo"],
    html.sc-off img[alt="Stake Logo"],
    html.sc-off img[alt="Stake.us logo"],
    html.sc-off img[alt="Stake.us Logo"],
    html.sc-off img[alt*="stake.us" i],
    html.sc-off img[alt="Stake Originals"],
    html.sc-off img[alt="Stake Exclusive"],
    html.sc-off img[src*="stake"][src*="logo"],
    html.sc-off img[src*="stakelogo"],
    html.sc-off .tag-badge,
    html.sc-off .tag-badge .inner-circle,
    html.sc-off .tag-badge [data-ds-icon="StakeExclusive"],
    html.sc-off footer [data-ds-icon="StakeWorld"],
    html.sc-off .game-footer img[alt="Stake logo"],
    html.sc-off .game-footer img[alt*="stake" i][alt*="logo" i],
    html.sc-off #oos-animation,
    html.sc-off #oos-animation svg,
    html.sc-off [id*="oos"] svg,
    html.sc-off footer img[alt*="certification" i],
    html.sc-off footer img[alt*="certificate" i],
    html.sc-off [class*="certification" i] img,
    html.sc-off [class*="certificate" i] img,
    html.sc-off [class*="license" i] img,
    html.sc-off .game-wrapper [class*="logo" i],
    html.sc-off .game-wrapper [data-ds-icon="StakeWorld"],
    html.sc-off .game-content [class*="logo" i],
    html.sc-off .iframe-wrap  [class*="logo" i],
    html.sc-off [class*="drake" i]       [class*="logo" i],
    html.sc-off [class*="partnership" i] [class*="logo" i],
    html.sc-off [class*="ambassador" i]  [class*="logo" i],
    html.sc-off [class*="sponsorship" i] [class*="logo" i],
    html.sc-off [class*="loading" i] img,
    html.sc-off [class*="splash" i]  img,
    html.sc-off [class*="preload" i] img,
    html.sc-off [class*="intro" i]   img,
    html.sc-off [class*="loader" i]  img,
    html.sc-off [class*="loading-logo" i],
    html.sc-off .loading-screen img,
    html.sc-off .loading-container img,
    html.sc-off .splash-screen img     { filter: none !important; }
  `);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  // Does this <img> actually carry Stake branding? Used to avoid blurring
  // unrelated images (e.g. game thumbnails) that merely mention "stake".
  function isStakeBrandedImg(img) {
    const alt = (img.getAttribute('alt') || '').toLowerCase().replace(/█+/g, 'stake');
    if (alt.startsWith('hero ')) return false;
    if (alt.includes('stake logo') || alt.includes('stake.us logo') ||
        alt === 'stake originals'  || alt === 'stake exclusive') return true;
    const src = (img.getAttribute('src') || '').toLowerCase();
    return (src.includes('stake') && src.includes('logo')) || src.includes('stakelogo');
  }

  // Is this element a functional control we must leave alone?
  function isFooterSafe(el) {
    if (!el.closest) return false;
    if (el.closest('.game-footer button'))    return true;
    if (el.closest('.game-footer .dropdown')) return true;
    if (el.closest('.game-footer .right'))    return true;
    if (el.closest('.game-footer .theater-mode')) return true;
    if (el.closest('.game-footer .mini-player'))  return true;
    const icon = el.getAttribute && el.getAttribute('data-ds-icon');
    if (icon && SAFE_ICONS.has(icon))         return true;
    return false;
  }

  function applyBlur(el) {
    if (!el || el.id === 'sc-toggle') return;
    if (isFooterSafe(el)) return;
    if (!el.hasAttribute(ORIG_ATTR)) {
      const orig = el.hasAttribute('alt') ? { alt: el.getAttribute('alt') } : {};
      el.setAttribute(ORIG_ATTR, JSON.stringify(orig));
    }
    el.style.setProperty('filter', BLUR, 'important');
  }

  function removeBlur(el) {
    if (!el) return;
    el.style.removeProperty('filter');
    if (el.hasAttribute(ORIG_ATTR)) {
      try {
        const orig = JSON.parse(el.getAttribute(ORIG_ATTR));
        if (orig.alt !== undefined) el.setAttribute('alt', orig.alt);
      } catch (_) {}
      el.removeAttribute(ORIG_ATTR);
    }
  }

  // ---------------------------------------------------------------------------
  // Text censoring
  //
  // Wraps each literal "Stake" word in a blurred <span>. We split the text node
  // rather than blurring the whole element so surrounding copy stays readable.
  // Guards skip detached or already-processed nodes.
  // ---------------------------------------------------------------------------

  function censorTextNode(node) {
    if (!node || node._scDone) return;
    if (!node.parentElement || !document.contains(node.parentElement)) return;
    const text = node.textContent;
    if (!STAKE_RE.test(text)) return;

    const parts = text.split(/(stake)/i);
    if (parts.length < 2) return;

    const frag = document.createDocumentFragment();
    for (const part of parts) {
      if (/^stake$/i.test(part)) {
        const span = document.createElement('span');
        span.className = 'sc-blur-word';
        span.setAttribute('data-sc-text', '1');
        span.textContent = part;
        frag.appendChild(span);
      } else {
        frag.appendChild(document.createTextNode(part));
      }
    }

    node._scDone = true;
    ownMutation = true;
    try {
      node.parentElement.replaceChild(frag, node);
    } finally {
      ownMutation = false;
    }
  }

  // Walk text nodes under root, skipping safe zones and money/balance fields
  // (we never want to obscure a balance the user is reading).
  function walkText(root) {
    if (!root || !document.contains(root)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (p.classList.contains('sc-blur-word')) return NodeFilter.FILTER_REJECT;
        const cls = typeof p.className === 'string' ? p.className : '';
        if (/balance|amount|value|wallet|currency|price|bet-amount/i.test(cls))
          return NodeFilter.FILTER_REJECT;
        if (/balance|amount|value|wallet/i.test(p.id || ''))
          return NodeFilter.FILTER_REJECT;
        if (isFooterSafe(p)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(censorTextNode);
  }

  // Reverse censorTextNode: unwrap blurred spans back into plain text.
  function restoreTextSpans(root) {
    if (!root) return;
    root.querySelectorAll('[data-sc-text="1"]').forEach(span => {
      if (!span.parentElement) return;
      ownMutation = true;
      try {
        span.parentElement.replaceChild(document.createTextNode(span.textContent), span);
      } finally {
        ownMutation = false;
      }
    });
    try { root.normalize(); } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // Censor passes (each targets one family of branding)
  // ---------------------------------------------------------------------------

  function censorImages() {
    document.querySelectorAll('img').forEach(img => {
      if (isStakeBrandedImg(img)) applyBlur(img);
    });
  }

  function censorNavLogo() {
    const selectors = [
      'img[alt="Stake logo"]', 'img[alt="Stake Logo"]',
      'img[alt="Stake.us logo"]', 'img[alt="Stake.us Logo"]',
      'img[alt*="stake.us" i]', 'img[alt="Stake Originals"]',
    ];
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(img => {
        if (!img.closest('.game-footer')) applyBlur(img);
      });
    });
  }

  // Blur the alt text too, so screen readers / page source don't leak the brand.
  function censorAltAttributes() {
    document.querySelectorAll('img').forEach(img => {
      if (img.getAttribute('alt')?.startsWith('hero ')) return;
      const alt = img.getAttribute('alt') || '';
      if (STAKE_RE.test(alt) && isStakeBrandedImg(img)) {
        if (!img.hasAttribute(ORIG_ATTR)) {
          img.setAttribute(ORIG_ATTR, JSON.stringify({ alt }));
        }
        img.setAttribute('alt', alt.replace(/stake/gi, '█████'));
      }
    });
  }

  function censorSVGIcons() {
    document.querySelectorAll('.tag-badge [data-ds-icon="StakeExclusive"]').forEach(applyBlur);
    document.querySelectorAll('footer [data-ds-icon="StakeWorld"]').forEach(applyBlur);
  }

  // #oos-animation is the inline animated SVG Stake logo in the "Only on Stake" bar.
  function censorOosAnimation() {
    document.querySelectorAll('#oos-animation, [id*="oos"]').forEach(el => {
      if (el.tagName === 'BUTTON' || isFooterSafe(el)) return;
      el.style.setProperty('filter', BLUR, 'important');
    });
  }

  function censorGameFooter() {
    const footer = document.querySelector('.game-footer');
    if (!footer) return;
    footer.querySelectorAll('img').forEach(img => {
      const alt = (img.getAttribute('alt') || '').replace(/█+/g, 'Stake');
      if (STAKE_RE.test(alt) && /logo/i.test(alt)) applyBlur(img);
    });
    restoreFooterButtons(footer);
  }

  function censorLoadingLogos() {
    const sels = [
      '[class*="loading" i] img', '[class*="splash" i] img',
      '[class*="preload" i] img', '[class*="intro" i] img',
      '[class*="loader" i] img',  '.loading-screen img',
      '.loading-container img',   '.splash-screen img',
    ];
    sels.forEach(sel => {
      document.querySelectorAll(sel).forEach(img => {
        const src = (img.getAttribute('src') || '').toLowerCase();
        const alt = (img.getAttribute('alt') || '').toLowerCase();
        if (src.includes('stake') || alt.includes('stake') ||
            src.includes('logo')  || alt.includes('logo')) applyBlur(img);
      });
    });
  }

  // Blur the brand name where it appears as on-page copy (titles, badges, etc).
  function censorPageText() {
    const sels = [
      // exclusive / "only on Stake" badge labels (EN + DE)
      '[class*="exclusive" i]', '[class*="only-on" i]', '[class*="onlyon" i]',
      '[class*="nur-auf" i]',   '[class*="nurauf" i]',
      '[class*="badge" i]',     '[class*="ribbon" i]',
      // provider / collection pages
      '[class*="provider" i]', '[class*="collection" i]',
      // general headings and body copy
      '.is-truncate', '.ds-body-md-strong', '.ds-display-sm',
      'h1', 'h2', 'h3', 'h4',
      '[class*="title" i]',  '[class*="header" i]',
      '[class*="game-info" i]', '.game-title', '.game-name',
      '.ds-body-sm', '.ds-body-md',
    ];
    sels.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        if (STAKE_RE.test(el.textContent)) walkText(el);
      });
    });
  }

  function censorPlaceholders() {
    document.querySelectorAll('input[placeholder]').forEach(inp => {
      const ph = inp.getAttribute('placeholder') || '';
      if (!STAKE_RE.test(ph)) return;
      if (!inp._scOrigPh) inp._scOrigPh = ph;
      inp.setAttribute('placeholder',
        ph.replace(/Stake\.com/gi, '█████.com').replace(/\bStake\b/gi, '█████'));
    });
  }

  // Re-sharpen in-game controls in case a pass blurred them by accident.
  function restoreFooterButtons(footer) {
    footer = footer || document.querySelector('.game-footer');
    if (!footer) return;
    const safeEls = footer.querySelectorAll(
      'button, button *, .dropdown, .dropdown *, ' +
      '.right *, .theater-mode *, .mini-player *, ' +
      '[data-ds-icon="FullscreenView"],[data-ds-icon="ViewDefault"],' +
      '[data-ds-icon="Stats"],[data-ds-icon="Popout"],' +
      '[data-ds-icon="Fairness"],[data-ds-icon="EuropeanUnion"],' +
      '[data-ds-icon="ChevronDown"]'
    );
    safeEls.forEach(el => el.style.removeProperty('filter'));
  }

  // ---------------------------------------------------------------------------
  // Master on / off
  // ---------------------------------------------------------------------------

  function censorAll() {
    if (navPending) return; // never mutate mid-navigation
    document.documentElement.classList.remove('sc-off');
    censorAltAttributes();
    censorNavLogo();
    censorImages();
    censorSVGIcons();
    censorOosAnimation();
    censorGameFooter();
    censorLoadingLogos();
    censorPageText();
    censorPlaceholders();
    restoreFooterButtons();
  }

  function disableAll() {
    document.documentElement.classList.add('sc-off');
    // restore alt attributes
    document.querySelectorAll(`[${ORIG_ATTR}]`).forEach(el => {
      try {
        const orig = JSON.parse(el.getAttribute(ORIG_ATTR));
        if (orig.alt !== undefined) el.setAttribute('alt', orig.alt);
      } catch (_) {}
      el.removeAttribute(ORIG_ATTR);
    });
    // restore placeholders
    document.querySelectorAll('input[placeholder]').forEach(inp => {
      if (inp._scOrigPh) { inp.setAttribute('placeholder', inp._scOrigPh); delete inp._scOrigPh; }
    });
    // drop every inline blur we added
    document.querySelectorAll('[style*="blur"]').forEach(el => el.style.removeProperty('filter'));
    // unwrap text spans
    restoreTextSpans(document.body);
  }

  // ---------------------------------------------------------------------------
  // Navigation guard
  //
  // Stake is a SvelteKit app using client-side routing. If our injected spans
  // are still in the tree when Svelte re-renders, its reconciler can choke and
  // blank the page. So we strip our mutations before each navigation and
  // re-apply them once the new page has settled.
  // ---------------------------------------------------------------------------

  function onBeforeNavigate() {
    navPending = true;
    restoreTextSpans(document.body);
    document.querySelectorAll(`[${ORIG_ATTR}]`).forEach(el => {
      try {
        const orig = JSON.parse(el.getAttribute(ORIG_ATTR));
        if (orig.alt !== undefined) el.setAttribute('alt', orig.alt);
      } catch (_) {}
      el.removeAttribute(ORIG_ATTR);
    });
  }

  function onAfterNavigate() {
    navPending = false;
    if (active) {
      setTimeout(censorAll, 300); // let Svelte finish rendering first
    }
  }

  window.addEventListener('sveltekit:navigation-start', onBeforeNavigate);
  window.addEventListener('sveltekit:navigation-end',   onAfterNavigate);

  // Browser back/forward has no reliable "done" event, so we poll briefly.
  window.addEventListener('popstate', () => {
    onBeforeNavigate();
    let attempts = 0;
    const poll = setInterval(() => {
      attempts++;
      if (document.readyState === 'complete' || attempts > 20) {
        clearInterval(poll);
        onAfterNavigate();
      }
    }, 100);
  });

  // ---------------------------------------------------------------------------
  // Mutation observer
  //
  // Re-runs the censor passes when Stake injects new content. Skips our own
  // edits (ownMutation) and anything during a navigation (navPending), and
  // debounces so rapid bursts collapse into a single pass.
  // ---------------------------------------------------------------------------
  const observer = new MutationObserver(() => {
    if (ownMutation || navPending || !active) return;
    clearTimeout(mutTimer);
    mutTimer = setTimeout(censorAll, 250);
  });

  // ---------------------------------------------------------------------------
  // Toggle button
  //
  // A small eye button injected next to Stake's support widget. It mimics the
  // size/shape of the adjacent support button so it blends into the UI.
  // ---------------------------------------------------------------------------
  const TOGGLE_CSS = `
    #sc-toggle {
      position: absolute; right: 0; bottom: calc(100% + 10px);
      box-sizing: border-box; display: inline-flex;
      align-items: center; justify-content: center;
      padding: var(--spacing-2,.5rem) var(--spacing-3,.75rem);
      border: none; cursor: pointer;
      color: var(--ds-color-white,#fff);
      box-shadow: 0 0 5px #1b171780;
      border-radius: var(--ds-radius-md,8px);
      transition: filter .12s, transform .12s, background .12s;
      z-index: 9999;
    }
    #sc-toggle:hover  { filter: brightness(1.1) !important; }
    #sc-toggle:active { transform: scale(.96); }
    #sc-toggle svg    { width: 20px; height: 20px; display: block; }
    #sc-toggle .ico-off { display: none; }
    #sc-toggle.on  { background: var(--ds-color-green-500,#01d612); color: #0f212e; }
    #sc-toggle.on .ico-on  { display: none; }
    #sc-toggle.on .ico-off { display: block; }
    #sc-toggle.off { background: var(--ds-color-base-neutral,#395565); }
    #sc-toggle .sc-tip {
      position: absolute; bottom: calc(100% + 12px); right: 0;
      white-space: nowrap;
      background: var(--ds-color-base-neutral,#395565); color: #fff;
      border-radius: var(--ds-radius-md,8px);
      padding: .75rem 1rem; font-size: .875rem; font-weight: 600; line-height: 1;
      opacity: 0; pointer-events: none; transform: translateY(4px);
      transition: opacity .15s, transform .15s;
    }
    #sc-toggle:hover .sc-tip { opacity: 1; transform: translateY(0); }
  `;

  function buildToggle() {
    const btn = document.createElement('button');
    btn.id = 'sc-toggle';
    // ico-on  = eye-with-slash (shown while censoring is ON)
    // ico-off = open eye        (shown while censoring is OFF)
    btn.innerHTML = `
      <span class="ico-on">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>
      </span>
      <span class="ico-off">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      </span>
      <span class="sc-tip"></span>`;
    btn.className = 'off';
    btn.addEventListener('click', () => {
      active = !active;
      refreshToggle(btn);
      active ? censorAll() : disableAll();
    });
    return btn;
  }

  function refreshToggle(btn) {
    btn.className = active ? 'on' : 'off';
    btn.querySelector('.sc-tip').textContent = active ? 'Censor ON' : 'Censor OFF';
  }

  let btnEl = null;

  // Park the toggle inside Stake's support widget and match its dimensions.
  function placeToggle() {
    if (!btnEl) return;
    const wrap = document.querySelector('.support-wrap');
    const ref  = wrap?.querySelector('button, a');
    if (!wrap || !ref) { btnEl.style.display = 'none'; return; }
    if (btnEl.parentElement !== wrap) wrap.appendChild(btnEl);
    btnEl.style.display = 'inline-flex';
    const { borderRadius } = getComputedStyle(ref);
    const w = ref.offsetWidth, h = ref.offsetHeight;
    if (w && h) { btnEl.style.width = w + 'px'; btnEl.style.height = h + 'px'; }
    btnEl.style.borderRadius = borderRadius;
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  function boot() {
    const styleEl = document.createElement('style');
    styleEl.textContent = TOGGLE_CSS;
    document.head.appendChild(styleEl);

    btnEl = buildToggle();
    refreshToggle(btnEl);
    placeToggle();
    setInterval(placeToggle, 1000); // re-place after support widget re-renders

    if (active) censorAll();

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.addEventListener('load', placeToggle);
})();
