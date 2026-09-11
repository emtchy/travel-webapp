/**
 * shell.js — what every page has in common.
 *
 * The navigation bar (and the tab bar on phones), the name field, the language
 * switch, the status toast, the API helper, and a few formatters. A page puts
 * `<div id="shell" data-page="sights"></div>` where the bar goes and imports
 * this module; the bar is drawn before the page's own script runs.
 *
 * Nothing in here knows what trip this is. The brand shows whatever the trip
 * is called once the page has loaded it — `setTrip()` — and says "Trip" until
 * then.
 */

export const $ = (s, r = document) => r.querySelector(s);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ------------------------------------------------------------- storage */

// Keys were once "london-vote-*". Old values are read once so nobody loses
// their name or language on the day the keys changed.
const KEYS = { name: "trip-name", code: "trip-code", lang: "trip-lang" };
const OLD = { name: "london-vote-name", code: "london-vote-code", lang: "london-vote-lang" };

export function store(key, value) {
  try {
    if (value === undefined) {
      const v = localStorage.getItem(KEYS[key]);
      if (v != null) return v;
      const old = localStorage.getItem(OLD[key]);
      if (old != null) { localStorage.setItem(KEYS[key], old); return old; }
      return null;
    }
    if (value === null) localStorage.removeItem(KEYS[key]);
    else localStorage.setItem(KEYS[key], value);
  } catch { /* private mode, or storage blocked */ }
  return value ?? null;
}

/* ------------------------------------------------------------- language */

let lang = store("lang") ||
  ((navigator.language || "").toLowerCase().startsWith("de") ? "de" : "en");
if (!["en", "de"].includes(lang)) lang = "en";

const langListeners = new Set();
export const getLang = () => lang;
export const isDE = () => lang === "de";
export const locale = () => (lang === "de" ? "de-DE" : "en-GB");

/** Run `cb(lang)` now and again whenever the language changes. */
export function onLang(cb) { langListeners.add(cb); cb(lang); }

export function setLang(next) {
  lang = next === "de" ? "de" : "en";
  store("lang", lang);
  document.documentElement.lang = lang;
  paintNav();
  for (const cb of langListeners) cb(lang);
}

/* ------------------------------------------------------------- icons */
/* Stroke icons in the manner of SF Symbols: 24-unit grid, 1.8 stroke. */
const I = (d, extra = "") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;

export const ICONS = {
  mark: I(`<path d="M12 2.5l2.6 6.3 6.9.6-5.2 4.5 1.6 6.7L12 17l-5.9 3.6 1.6-6.7L2.5 9.4l6.9-.6z" fill="currentColor" stroke="none"/>`),
  person: I(`<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c1.2-3.6 4.1-5.4 7.5-5.4s6.3 1.8 7.5 5.4"/>`),
  info: I(`<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.2"/>`),
  compass: I(`<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z" fill="currentColor" stroke="none"/>`),
  ticket: I(`<path d="M3.5 8.5v-2a1 1 0 0 1 1-1h15a1 1 0 0 1 1 1v2a2.5 2.5 0 0 0 0 5v2a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-2a2.5 2.5 0 0 0 0-5z"/><path d="M10 6v12" stroke-dasharray="2 2.2"/>`),
  calendar: I(`<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>`),
  heart: I(`<path d="M12 20.3S3.5 15.2 3.5 9.3A4.4 4.4 0 0 1 12 7a4.4 4.4 0 0 1 8.5 2.3c0 5.9-8.5 11-8.5 11z"/>`),
  heartFill: I(`<path d="M12 20.3S3.5 15.2 3.5 9.3A4.4 4.4 0 0 1 12 7a4.4 4.4 0 0 1 8.5 2.3c0 5.9-8.5 11-8.5 11z" fill="currentColor"/>`),
  bubble: I(`<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V16H6.5A2.5 2.5 0 0 1 4 13.5z"/>`),
  plus: I(`<path d="M12 5v14M5 12h14"/>`),
  close: I(`<path d="M6 6l12 12M18 6L6 18"/>`),
  check: I(`<path d="M5 12.5l4.5 4.5L19 7.5"/>`),
  chevron: I(`<path d="M9 6l6 6-6 6"/>`),
  arrowUp: I(`<path d="M12 19V5M6 11l6-6 6 6"/>`),
  external: I(`<path d="M14 5h5v5M19 5l-8 8M10 6H6.5A1.5 1.5 0 0 0 5 7.5v10A1.5 1.5 0 0 0 6.5 19h10a1.5 1.5 0 0 0 1.5-1.5V14"/>`),
  pin: I(`<path d="M12 21s-6.5-5.6-6.5-11A6.5 6.5 0 0 1 18.5 10c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>`),
  route: I(`<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.2 16.5L15.8 7.5M6 15.5V12a3 3 0 0 1 3-3h1"/>`),
  pencil: I(`<path d="M4 20l4.2-.9L19.4 7.9a1.6 1.6 0 0 0 0-2.3l-1-1a1.6 1.6 0 0 0-2.3 0L4.9 15.8z"/>`),
  search: I(`<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>`),
  trash: I(`<path d="M5 7h14M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7M7 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h5.4a1.5 1.5 0 0 0 1.5-1.4L17 7"/>`),
  clock: I(`<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>`),
  home: I(`<path d="M4 11l8-6.5L20 11v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z"/><path d="M10 20.5v-6h4v6"/>`),
  locate: I(`<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="7.5"/>`),
  minus: I(`<path d="M5 12h14"/>`),
};

/* ------------------------------------------------------------- the bar */

const NAV = {
  en: { details: "Details", sights: "Sights", bookings: "Bookings", plan: "Plan",
        name: "Your name", lang: "Language" },
  de: { details: "Details", sights: "Orte", bookings: "Buchungen", plan: "Plan",
        name: "Dein Name", lang: "Sprache" },
};

const PAGES = [
  ["details", "/details", "info"],
  ["sights", "/", "compass"],
  ["bookings", "/bookings", "ticket"],
  ["plan", "/plan", "calendar"],
];

const mount = document.getElementById("shell");
const current = mount?.dataset.page || "sights";

function linksHTML(withIcons) {
  return PAGES.map(([key, href, icon]) =>
    `<a href="${href}" data-nav="${key}"${key === current ? ' aria-current="page"' : ""}>${
      withIcons ? ICONS[icon] : ""}<span>${esc(NAV[lang][key])}</span></a>`).join("");
}

if (mount) {
  mount.outerHTML = `
  <nav class="nav">
    <div class="nav-inner">
      <a class="brand" href="/"><span class="mark">${ICONS.mark}</span><span class="name" id="brand-name">Trip</span></a>
      <div class="nav-tabs" id="nav-tabs">${linksHTML(false)}</div>
      <div class="nav-tools">
        <label class="who" id="who">
          <span class="visually-hidden" id="name-label">${esc(NAV[lang].name)}</span>
          ${ICONS.person}
          <input id="name" type="text" maxlength="32" placeholder="${esc(NAV[lang].name)}"
                 autocomplete="off" spellcheck="false" list="members" aria-labelledby="name-label">
          <datalist id="members"></datalist>
        </label>
        <div class="seg" role="group" aria-label="${esc(NAV[lang].lang)}" id="langs">
          <button type="button" data-lang="en" aria-pressed="${lang === "en"}">EN</button>
          <button type="button" data-lang="de" aria-pressed="${lang === "de"}">DE</button>
        </div>
      </div>
    </div>
  </nav>
  <nav class="tabbar" id="tabbar" aria-label="Pages">${linksHTML(true)}</nav>
  <div class="toast" id="status" role="status" aria-live="polite"></div>`;
}

function paintNav() {
  const L = NAV[lang];
  for (const a of document.querySelectorAll("[data-nav]"))
    a.querySelector("span").textContent = L[a.dataset.nav];
  const name = $("#name");
  if (name) name.placeholder = L.name;
  const lbl = $("#name-label");
  if (lbl) lbl.textContent = L.name;
  for (const b of document.querySelectorAll("#langs button"))
    b.setAttribute("aria-pressed", String(b.dataset.lang === lang));
}

$("#langs")?.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-lang]");
  if (b) setLang(b.dataset.lang);
});

document.documentElement.lang = lang;

/* ------------------------------------------------------------- identity */

const nameInput = $("#name");
const nameListeners = new Set();
export const nameOf = () => (nameInput?.value ?? "").trim();
export const nameKey = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function paintWho() { $("#who")?.classList.toggle("set", !!nameOf()); }

if (nameInput) {
  nameInput.value = store("name") || "";
  paintWho();
  nameInput.addEventListener("input", () => {
    store("name", nameOf());
    paintWho();
    for (const cb of nameListeners) cb(nameOf());
  });
}

/** Run `cb(name)` whenever the name in the bar changes. */
export function onName(cb) { nameListeners.add(cb); }

/** Put the caret in the name field — the polite way to say "who are you?". */
export function askName() { nameInput?.focus(); }

/** Everyone on the trip, offered as suggestions on the name box. Still free
 *  text, so nobody is locked out for not being on the list yet. */
export function fillMembers(list) {
  const box = document.getElementById("members");
  if (!box) return;
  box.innerHTML = (list ?? []).map((m) =>
    `<option value="${String(m.name).replace(/"/g, "&quot;")}"></option>`).join("");
}

/* ------------------------------------------------------------- status */

let toastTimer = 0;
/**
 * A short message at the bottom of the screen. Goes away on its own unless it
 * is an error, which stays until the next message replaces it.
 */
export function setStatus(message, kind = "") {
  const el = $("#status");
  if (!el) return;
  clearTimeout(toastTimer);
  if (!message) { el.classList.remove("show"); return; }
  el.textContent = message;
  el.classList.toggle("err", kind === "err");
  el.classList.add("show");
  if (kind !== "err" && kind !== "sticky")
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

/* ------------------------------------------------------------- the trip */

/** The bar shows the trip's name; the tab shows page and trip. */
export function setTrip(trip, pageTitle) {
  const name = trip?.name && trip.name !== "Trip" ? trip.name : (trip?.destination || trip?.name || "Trip");
  const el = $("#brand-name");
  if (el) el.textContent = name;
  if (pageTitle) document.title = `${pageTitle} · ${name}`;
}

/** "London · 11 – 16 September" — the line above a page's title. */
export function tripKicker(trip) {
  if (!trip) return "";
  const fmt = (iso) => iso
    ? new Date(iso + "T12:00:00Z").toLocaleDateString(locale(),
        { day: "numeric", month: "long", timeZone: "UTC" })
    : "";
  const when = trip.startDate && trip.endDate
    ? `${fmt(trip.startDate)} – ${fmt(trip.endDate)}` : "";
  const place = trip.destination && trip.destination !== trip.name ? trip.destination : "";
  return [place, when].filter(Boolean).join(" · ");
}

/* ------------------------------------------------------------- dates */

export const fmtDate = (iso, opts) => iso
  ? new Date(iso + "T12:00:00Z").toLocaleDateString(locale(), { timeZone: "UTC", ...opts })
  : "";
export const dayShort = (iso) => fmtDate(iso, { weekday: "short", day: "numeric", month: "short" });
export const dayLong = (iso) => fmtDate(iso, { day: "numeric", month: "long" });
export const weekday = (iso) => fmtDate(iso, { weekday: "long" });
export const weekdayShort = (iso) => fmtDate(iso, { weekday: "short" });

/* ------------------------------------------------------------- api */

let accessCode = store("code") || "";

/** fetch() with the JSON headers, the access code, and one retry after a 401. */
export async function api(path, options, retried = false) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(accessCode ? { "x-access-code": accessCode } : {}),
      ...(options?.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !retried) {
    const entered = window.prompt("Access code / Zugangscode:");
    if (entered) {
      accessCode = entered.trim();
      store("code", accessCode);
      return api(path, options, true);
    }
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ------------------------------------------------------------- back to top */

export function backToTop(label) {
  let btn = $("#totop");
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "totop"; btn.type = "button"; btn.className = "fab";
    btn.innerHTML = ICONS.arrowUp;
    document.body.appendChild(btn);
    btn.addEventListener("click", () => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    });
    const onScroll = () => btn.classList.toggle("show", window.scrollY > 600);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }
  btn.title = label; btn.setAttribute("aria-label", label);
}
