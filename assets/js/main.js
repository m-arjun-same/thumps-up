/* Videotheque — Indie Video & Vinyl. Own-code interaction engine.
/* GSAP + ScrollTrigger + Lenis drive everything. */
(function () {
  "use strict";
  gsap.registerPlugin(ScrollTrigger);
  const isDesktop = () => window.matchMedia("(min-width: 1025px)").matches;
  const $ = (s, c) => (c || document).querySelector(s);
  const $$ = (s, c) => Array.from((c || document).querySelectorAll(s));

  /* ---------- viewport vars (dossier §3.0: JS-measured --svh/--dvh) ---------- */
  const root = document.documentElement;
  function setViewportVars() {
    root.style.setProperty("--svh", root.clientHeight + "px");
    root.style.setProperty("--dvh", window.innerHeight + "px");
  }
  setViewportVars();
  if ("ResizeObserver" in window) new ResizeObserver(setViewportVars).observe(root);
  window.addEventListener("resize", setViewportVars);

  /* ---------- Lenis scroller on the GSAP ticker (dossier §1.4) ---------- */
  const lenis = new Lenis({
    smoothWheel: isDesktop(),
    syncTouch: false,
    lerp: 0.1,
  });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  lenis.stop(); // released when the preloader exits

  /* top controls (sidebar removed) — hidden until the preloader exits */
  const topControls = $("#topControls");
  if (topControls) gsap.set(topControls, { autoAlpha: 0 });

  /* anchor navigation through Lenis */
  function scrollToTarget(sel) {
    const el = $(sel);
    if (el) lenis.scrollTo(el, { duration: 1.4, easing: (t) => 1 - Math.pow(1 - t, 4) });
  }
  $$("[data-scrollto]").forEach((link) => {
    link.addEventListener("click", (ev) => {
      ev.preventDefault();
      const target = link.getAttribute("data-scrollto");
      if (menuOpen) closeMenu(() => scrollToTarget(target));
      else scrollToTarget(target);
    });
  });

  /* ---------- Split text (dossier §4.2) ---------- */
  function splitWords(el) {
    const walk = (node) => {
      Array.from(node.childNodes).forEach((child) => {
        if (child.nodeType === 3) {
          const frag = document.createDocumentFragment();
          child.textContent.split(/(\s+)/).forEach((part) => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(" ")); return; }
            const wrap = document.createElement("span");
            wrap.className = "part-container";
            const word = document.createElement("span");
            word.className = "word";
            word.textContent = part;
            wrap.appendChild(word);
            frag.appendChild(wrap);
          });
          node.replaceChild(frag, child);
        } else if (child.nodeType === 1 && child.tagName !== "BR") walk(child);
      });
    };
    walk(el);
    return $$(".word", el);
  }
  const splitAnims = [];
  $$(".split-text").forEach((el) => {
    const words = splitWords(el);
    gsap.set(words, { yPercent: 110 });
    const delay = parseFloat(el.getAttribute("data-anim-delay") || "0");
    const tl = gsap.timeline({ paused: true })
      .to(words, { yPercent: 0, duration: 0.85, stagger: 0.035, ease: "power3.out", delay });
    splitAnims.push(tl);
  });

  /* ---------- Clock bars (dossier §3.8 — mechanism kept, zone is the shop's Los Angeles time) ---------- */
  const tzFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit", hour12: true,
  });
  function tickClock() {
    const now = tzFmt.format(new Date());
    $$("[data-timezone]").forEach((bar) => {
      const h = $(".tz-hour", bar); const g = $(".tz-gmt", bar);
      if (h) h.textContent = now;
      if (g) g.textContent = "LA"; // static "GMT" label overwritten, as in the reference
    });
    setTimeout(tickClock, 1000 - (Date.now() % 1000));
  }
  tickClock();

  /* ---------- Custom cursor (dossier §5.1) ---------- */
  const cursor = $("#cursor");
  const cursorLabel = $("#cursorLabel");
  const mouse = { x: innerWidth / 2, y: innerHeight / 2, sx: innerWidth / 2, sy: innerHeight / 2 };
  window.addEventListener("pointermove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
  window.addEventListener("pointerdown", () => cursor.classList.add("is-pressing"));
  window.addEventListener("pointerup", () => cursor.classList.remove("is-pressing"));
  gsap.ticker.add(() => {
    mouse.sx += (mouse.x - mouse.sx) * 0.05; // 2-D lerp tracker, lerp .05
    mouse.sy += (mouse.y - mouse.sy) * 0.05;
    cursor.style.transform = "translate(" + mouse.sx + "px," + mouse.sy + "px)";
  });
  function setCursor(state, label) {
    cursor.classList.remove("is-play", "is-pause", "is-drag", "is-close");
    if (!state) { cursor.classList.remove("is-show"); return; }
    cursor.classList.add("is-show", "is-" + state);
    if (label) cursorLabel.textContent = label;
  }
  function bindCursorZones(scope) {
    $$("[data-cursor-zone]", scope).forEach((zone) => {
      zone.addEventListener("pointerenter", () => {
        const trailer = zone.closest(".trailer");
        const playing = trailer && trailer.classList.contains("is-playing");
        setCursor(playing ? "close" : "play", playing ? "CLOSE" : "VIEW");
      });
      zone.addEventListener("pointerleave", () => setCursor(null));
    });
    $$(".contact-forms__bg, .contact-form__close", scope).forEach((el) => {
      el.addEventListener("pointerenter", () => setCursor("close", "CLOSE"));
      el.addEventListener("pointerleave", () => setCursor(null));
    });
    $$(".collection__list", scope).forEach((el) => {
      el.addEventListener("pointerenter", () => setCursor("drag", "VIEW"));
      el.addEventListener("pointerleave", () => setCursor(null));
    });
  }

  /* ---------- Pin variables from data attributes (dossier §2.1 table) ---------- */
  $$(".sticky-root").forEach((rootEl) => {
    rootEl.style.setProperty("--pin-spacing", rootEl.dataset.pinSpacing || "0");
    rootEl.style.setProperty("--pin", rootEl.dataset.pin || "0");
    if (rootEl.dataset.gap) rootEl.style.setProperty("--gap", rootEl.dataset.gap + "vh");
  });

  /* ---------- Sticky wipe + progress system (dossier §2.2 / §2.3) ---------- */
  function stickyScrollFX(rootEl, wrapper, opts) {
    const spacing = parseFloat(rootEl.dataset.pinSpacing || "1");
    const st = {
      trigger: rootEl, start: "top top",
      end: () => "+=" + window.innerHeight * spacing,
      scrub: true, invalidateOnRefresh: true,
    };
    if (opts && opts.snap) {
      st.snap = {
        snapTo: (p) => (lenis.isStopped ? (p > 0.35 ? 1 : 0) : p),
        duration: 1.25, ease: "power1.inOut",
      };
    }
    const tl = gsap.timeline({ scrollTrigger: st });
    tl.fromTo(rootEl, { "--p": 0 }, { "--p": 1, duration: 1, ease: "none" }, 0);
    if (opts && opts.wipe === "8") {
      /* Wipe IN only: the top edge (y1..y4) sweeps 100% -> 0% during the
         first ~45% of the pin span, then the section HOLDS full-screen.
         The bottom edge (y5..y8) stays at 100% so the wrapper always
         covers the full viewport — the next section wipes in OVER this
         one. (Animating y5..y8 to 0% collapses the polygon to a band
         and leaves the page background showing through the middle.) */
      gsap.set(wrapper, { "--y5": "100%", "--y6": "100%", "--y7": "100%", "--y8": "100%" });
      const order = opts.mirror
        ? ["--y4", "--y3", "--y2", "--y1"] : ["--y1", "--y2", "--y3", "--y4"];
      order.forEach((v, i) => tl.fromTo(wrapper,
        { [v]: "100%" }, { [v]: "0%", duration: 0.32, ease: "none" }, i * 0.045));
    } else if (opts && opts.wipe === "flat") {
      tl.fromTo(wrapper, { "--y1": "100%" }, { "--y1": "0%", duration: 0.9, ease: "none" }, 0);
    } else if (opts && opts.wipe === "footer") {
      ["--fy1", "--fy2", "--fy3", "--fy4"].forEach((v, i) =>
        tl.fromTo(wrapper, { [v]: "100%" }, { [v]: "0%", duration: 0.6, ease: "none" }, i * 0.12));
    }
    return tl;
  }
  if (isDesktop()) {
    stickyScrollFX($(".hero"), $(".hero__wrapper"), {});
    $$(".trailer").forEach((t, i) =>
      stickyScrollFX(t, $(".trailer__wrapper", t), { wipe: "8", mirror: i % 2 === 1, snap: true }));
    stickyScrollFX($("#contact"), $(".contact__wrapper"), { wipe: "flat" });
    stickyScrollFX($(".footer"), $(".footer__wrapper"), { wipe: "footer" });
  } else {
    /* mobile: progress vars only, no wipes (dossier §6) */
    $$(".sticky-root").forEach((rootEl) => {
      gsap.fromTo(rootEl, { "--p": 0 }, {
        "--p": 1, ease: "none",
        scrollTrigger: { trigger: rootEl, start: "top bottom", end: "bottom top", scrub: true },
      });
    });
  }

  /* ---------- Menu overlay (dossier §4.5) ---------- */
  let menuOpen = false;
  const menuWrapper = $("#menuWrapper");
  const menuToggle = $("#menuToggle");
  const menuTl = gsap.timeline({ paused: true })
    .set(menuWrapper, { visibility: "visible" })
    .to(".navbar__bg", { opacity: 1, duration: 0.7, ease: "power2.inOut" }, 0)
    .to(".navbar__box--left", { clipPath: "inset(0 0% 0 0)", duration: 1, ease: "power2.inOut" }, 0)
    .to(".navbar__box--right", { clipPath: "inset(0 0 0 0%)", duration: 1, ease: "power2.inOut" }, 0)
    .to(".navbar__box--right img", { scale: 1, duration: 1, ease: "power2.inOut" }, 0)
    .fromTo(".navbar__main .navbar__link",
      { yPercent: -110 }, { yPercent: 0, duration: 0.6, ease: "power3.out", stagger: 0.075 }, 0.65)
    .fromTo(".navbar__social .navbar__link",
      { yPercent: 110 }, { yPercent: 0, duration: 0.6, ease: "power3.out", stagger: -0.075 }, 0.8);
  function openMenu() {
    menuOpen = true; menuToggle.classList.add("is-x");
    menuToggle.setAttribute("aria-expanded", "true");
    menuWrapper.setAttribute("aria-hidden", "false");
    lenis.stop(); menuTl.timeScale(1.25).play();
  }
  function closeMenu(after) {
    menuOpen = false; menuToggle.classList.remove("is-x");
    menuToggle.setAttribute("aria-expanded", "false");
    menuWrapper.setAttribute("aria-hidden", "true");
    menuTl.timeScale(1).reverse();
    if (!formsOpen) lenis.start();
    if (after) gsap.delayedCall(0.9, after);
  }
  menuToggle.addEventListener("click", () => (menuOpen ? closeMenu() : openMenu()));

  /* ---------- Trailer inline play / pause (dossier §4.3) ---------- */
  $$(".trailer").forEach((section) => {
    const trailerVideo = $(".trailer__video img, .trailer__video video", section);
    const layer = $(".trailer__video", section);
    const btn = $("[data-play-toggle]", section);
    const btnLabel = $(".circle-play-bt__label", btn);
    let playing = false;
    const playTl = gsap.timeline({ paused: true })
      .to(section, { "--play-progress": 1, duration: 0.75, ease: "power3.inOut" }, 0)
      .to(layer, { opacity: 1, duration: 0.75, ease: "power3.inOut" }, 0)
      .to(topControls, { autoAlpha: 0, duration: 0.75, ease: "power3.inOut" }, 0)
      .eventCallback("onComplete", () => { if (trailerVideo && typeof trailerVideo.play === "function") trailerVideo.play().catch(() => {}); })
      .eventCallback("onReverseComplete", () => {
        try { if (typeof trailerVideo.pause === "function") { trailerVideo.pause(); trailerVideo.currentTime = 0; } } catch (e) {}
        gsap.set(topControls, { autoAlpha: 1 });
      });
    function toggle() {
      playing = !playing;
      section.classList.toggle("is-playing", playing);
      btnLabel.textContent = playing ? "close" : "see inside";
      if (playing) { trailerVideo.muted = false; playTl.timeScale(1).play(); }
      else playTl.timeScale(1.35).reverse();
      if (document.activeElement === document.body) setCursor(playing ? "close" : "play", playing ? "CLOSE" : "VIEW");
    }
    btn.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
    layer.addEventListener("click", () => { if (playing) toggle(); });
  });

  /* ---------- Collection cards: hover video preview (dossier §5.3) ---------- */
  $$(".card").forEach((card) => {
    const vid = $(".card__figure video", card);
    card.addEventListener("pointerenter", () => { if (vid) vid.play().catch(() => {}); });
    card.addEventListener("pointerleave", () => { if (vid) { vid.pause(); } });
  });

  /* entrance fades for cards + collection header */
  gsap.utils.toArray(".card").forEach((card, i) => {
    gsap.fromTo(card, { y: 60, opacity: 0 }, {
      y: 0, opacity: 1, duration: 0.9, ease: "power3.out", delay: (i % 2) * 0.08,
      scrollTrigger: { trigger: card, start: "top 92%" },
    });
  });
  gsap.fromTo(".collection__header", { y: 80, opacity: 0 }, {
    y: 0, opacity: 1, duration: 1, ease: "power3.out",
    scrollTrigger: { trigger: ".collection__header", start: "top 88%" },
  });

  /* ---------- Contact accordion (dossier §3.6) ---------- */
  const bands = $$("[data-band]");
  const contactList = $("#contactList");
  function layoutBands() {
    if (!contactList) return;
    const total = contactList.clientHeight || window.innerHeight;
    const open = $(".contact__item.is-open", contactList);
    bands.forEach((band) => {
      if (band === open) {
        const inner = $(".contact__content", band);
        const titleH = $(".contact__title", band).offsetHeight || 120;
        const expanded = Math.max(total / 4, titleH * 1.25) + 130;
        band.style.minHeight = Math.min(expanded, total * 0.62) + "px";
      } else {
        band.style.minHeight = Math.max(total / 6, (total - (open ? parseFloat(open.style.minHeight) || total * 0.5 : total / 3)) / 2) + "px";
      }
    });
  }
  function activateBand(band) {
    bands.forEach((b) => b.classList.toggle("is-open", b === band));
    layoutBands();
  }
  bands.forEach((band) => {
    band.addEventListener("click", () => activateBand(band));
    band.addEventListener("pointerenter", () => { if (isDesktop()) activateBand(band); });
  });
  window.addEventListener("resize", layoutBands);

  /* ---------- Contact forms overlay (dossier §3.7 / §4.5) ---------- */
  let formsOpen = false;
  const formsRoot = $("#contactForms");
  /* wrapper is parked off-canvas right (CSS translate:100%); GSAP x takes it from there */
  gsap.set("#contactFormsWrapper", { x: "100%" });
  const formsTl2 = gsap.timeline({ paused: true })
    .set(formsRoot, { visibility: "visible" })
    .to(".contact-forms__bg", { opacity: 1, duration: 0.5, ease: "power2.inOut" }, 0)
    .to("#contactFormsWrapper", { x: "0%", duration: 0.75, ease: "power3.inOut" }, 0);
  void formsTl2;
  function openForm(name) {
    $$(".contact-form", formsRoot).forEach((f) => { f.hidden = f.dataset.form !== name; });
    formsOpen = true;
    formsRoot.setAttribute("aria-hidden", "false");
    lenis.stop(); formsTl2.timeScale(1).play();
  }
  function closeForms() {
    formsOpen = false;
    formsRoot.setAttribute("aria-hidden", "true");
    formsTl2.timeScale(1.3).reverse();
    if (!menuOpen) lenis.start();
  }
  $$("[data-open-form]").forEach((btn) =>
    btn.addEventListener("click", (e) => { e.stopPropagation(); openForm(btn.getAttribute("data-open-form")); }));
  $$("[data-close-forms]").forEach((el) => el.addEventListener("click", closeForms));
  /* deliberately no Escape handler — matches the reference (dossier §3.7) */

  /* form validation + submit (dossier §5.5; static build: local handling, no endpoint) */
  $$(".contact-form").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      let valid = true;
      $$(".contact-form__field", form).forEach((field) => {
        const input = $("input, textarea", field);
        const bad = !input.value.trim() || (input.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value));
        field.classList.toggle("is-error", bad);
        if (bad) valid = false;
      });
      const note = $("[data-form-note]", form);
      if (!valid) { note.textContent = "Please fill every field with a valid value."; return; }
      const btn = $('button[type="submit"]', form);
      btn.setAttribute("disabled", "");
      note.textContent = "Sending…";
      setTimeout(() => {
        btn.removeAttribute("disabled");
        form.reset();
        note.textContent = "Received — the Videotheque crew will get back to you.";
      }, 700);
    });
    $$("input, textarea", form).forEach((input) =>
      input.addEventListener("input", () => input.closest(".contact-form__field").classList.remove("is-error")));
  });

  /* ---------- Footer intro (dossier §3.10) ---------- */
  gsap.fromTo(".footer__top, .footer__bottom",
    { x: 120, opacity: 0 },
    {
      x: 0, opacity: 1, duration: 1.15, ease: "power2.inOut", stagger: 0.05,
      scrollTrigger: { trigger: ".footer", start: "top 75%" },
    });

  /* ---------- Cookie consent (dossier §3.11) ---------- */
  const consent = $("#cookieConsent");
  function cookieGet(name) {
    const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function cookieSet(name, val) {
    document.cookie = name + "=" + encodeURIComponent(val) + "; max-age=" + 60 * 60 * 24 * 180 + "; path=/";
  }
  if (cookieGet("cookie.videotheque")) {
    consent.remove();
  } else {
    gsap.delayedCall(1.2, () => consent.classList.add("is-shown"));
    const main = $("[data-cookie-main]", consent), prefs = $("[data-cookie-prefs]", consent);
    $("[data-cookie-manage]", consent).addEventListener("click", () => { main.hidden = true; prefs.hidden = false; });
    $("[data-cookie-back]", consent).addEventListener("click", () => { prefs.hidden = true; main.hidden = false; });
    $$("[data-cookie-toggle]", consent).forEach((sw) =>
      sw.addEventListener("click", () => sw.classList.toggle("is-on")));
    const saveAndHide = (val) => { cookieSet("cookie.videotheque", val); consent.classList.remove("is-shown"); };
    $("[data-cookie-accept]", consent).addEventListener("click", () => saveAndHide("all"));
    $("[data-cookie-decline]", consent).addEventListener("click", () => saveAndHide("essential"));
    $("[data-cookie-save]", consent).addEventListener("click", () => {
      const on = $$("[data-cookie-toggle]", consent).filter((s) => s.classList.contains("is-on")).length;
      saveAndHide("custom:" + on);
    });
  }

  bindCursorZones(document);

  /* ---------- Preloader (dossier §4.1) ---------- */
  const preloader = $("#preloader");
  const preBg = $("#preloaderBg");
  const preLogo = $("#preloaderLogo");
  const preText = $("#preloaderText");
  const preProgress = $("#preloaderProgress");
  document.body.style.overflow = "hidden";

  const counter = { v: 0 };
  function setProgress(p) {
    preProgress.textContent = Math.floor(p * 100) + "%";
    const m25 = Math.min(1, p / 0.25), m50 = Math.min(1, Math.max(0, (p - 0.25) / 0.25)), m100 = Math.min(1, Math.max(0, (p - 0.5) / 0.5));
    preBg.style.setProperty("--wy1", (0.15 * m25 + 0.27 * m50 + 0.58 * m100).toFixed(3));
    preBg.style.setProperty("--wy2", (0.22 * m25 + 0.36 * m50 + 0.42 * m100).toFixed(3));
    preBg.style.setProperty("--wy3", (0.23 * m25 + 0.24 * m50 + 0.53 * m100).toFixed(3));
    preBg.style.setProperty("--wy4", (0.20 * m25 + 0.35 * m50 + 0.45 * m100).toFixed(3));
    preBg.style.setProperty("--wy5", (0.22 * m25 + 0.26 * m50 + 0.52 * m100).toFixed(3));
    preBg.style.setProperty("--x1", (25 - 5 * m50 + 5 * m100) + "%");
    preBg.style.setProperty("--x3", (75 - 3 * m50 + 3 * m100) + "%");
  }
  /* intro fade: texts + logo, .35s after 300ms */
  gsap.to([preText, preProgress], { opacity: 1, duration: 0.35, delay: 0.3, ease: "power2.inOut" });
  gsap.to(preLogo, { opacity: 1, duration: 0.35, delay: 0.3, ease: "power2.inOut" });

  const heroVideo = $(".hero__bg video");
  let assetsReady = false;
  function markReady() { assetsReady = true; }
  if (heroVideo && heroVideo.readyState >= 3) markReady();
  else if (heroVideo) heroVideo.addEventListener("canplaythrough", markReady, { once: true });
  window.addEventListener("load", markReady);
  setTimeout(markReady, 4000); // never trap the user behind the loader

  const progressTween = gsap.to(counter, {
    v: 1, duration: 2.2, ease: "power2.inOut", delay: 0.75,
    onUpdate: () => setProgress(counter.v * (assetsReady ? 1 : 0.92)),
    onComplete: finishPreload,
  });
  void progressTween;

  let finished = false;
  function finishPreload() {
    if (finished) return; finished = true;
    setProgress(1);
    const exit = gsap.timeline({
      onComplete: () => {
        preloader.remove();
        document.body.style.overflow = "";
        lenis.start();
        layoutBands();
        ScrollTrigger.refresh();
      },
    });
    exit.to([preText, preProgress], { opacity: 0, duration: 0.3, ease: "power2.inOut" }, 0)
      .to(preLogo, {
        clipPath: "inset(50% 0% 50% 0%)", opacity: 0.9, duration: 0.5, ease: "power3.inOut",
      }, 0.2);
    if (isDesktop()) {
      exit.fromTo(preBg,
        { clipPath: "polygon(-20% 0%, 100% 0%, 100% 100%, 0% 100%)" },
        { clipPath: "polygon(100% 0%, 100% 0%, 100% 100%, 105% 100%)", duration: 1.75, ease: "power3.inOut" }, 0.55)
        .to(preloader, { autoAlpha: 0, duration: 0.25 }, 2.25);
    } else {
      exit.fromTo(preBg,
        { clipPath: "polygon(0% 0%, 100% -20%, 100% 100%, 0% 100%)" },
        { clipPath: "polygon(0% 100%, 100% 100%, 100% 100%, 0% 100%)", duration: 1.5, ease: "power3.inOut" }, 0.55)
        .to(preloader, { autoAlpha: 0, duration: 0.25 }, 1.95);
    }
    /* app start: top controls reveal + hero split titles */
    exit.fromTo(topControls, { autoAlpha: 0, y: -16 }, { autoAlpha: 1, y: 0, duration: 0.75, ease: "power3.out" }, 1.15)
      .add(() => splitAnims.forEach((tl) => tl.play()), 1.3);
  }

  window.addEventListener("load", () => ScrollTrigger.refresh());
})();
