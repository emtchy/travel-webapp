/**
 * shell.js — what every page has in common.
 *
 * The navigation bar (and the tab bar on phones), the name field, the language
 * switch, the status toast, the API helper, and a few formatters. A page puts
 * `<div id="shell" data-page="sights"></div>` where the bar goes and imports
 * this module; the bar is drawn before the page's own script runs.
 *
 * Which trip this is comes from the address: /t/<id>/plan is trip <id>. Every
 * API call the pages make goes through `api()` here, which puts the trip into
 * the path, so a page never needs to know its own trip. The brand shows
 * whatever the trip is called once the page has loaded it — `setTrip()` — and
 * says "Trip" until then.
 */

export const $ = (s, r = document) => r.querySelector(s);

/* ------------------------------------------------------------- the trip */

/** Trip id from the address, or 1 for the old un-prefixed pages. */
export const TRIP = (() => {
  const m = location.pathname.match(/^\/t\/(\d+)(?:\/|$)/);
  return m ? Number(m[1]) : 1;
})();

/** A page's address inside this trip: pageHref("/plan") → "/t/3/plan". */
export const pageHref = (page) => `/t/${TRIP}${page}`;

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
        name: "Your name", lang: "Language",
        signIn: "Sign in", signOut: "Sign out", account: "Account",
        signInTitle: "Sign in", signInLede: "Enter your email and we'll send you a link. No password to remember.",
        email: "Email", sendLink: "Send me a link", sending: "Sending…",
        sentTitle: "Check your email", sentLede: (e) => `We sent a sign-in link to ${e}. It works once and lasts 15 minutes.`,
        devLink: "Local development: no email is sent. Open the link:",
        signedInAs: (n) => `Signed in as ${n}`, close: "Close",
        sendFail: "That didn't go through. Try again in a moment.",
        whoName: "Your name",
        onTrip: (n, r) => `On this trip as ${n} (${r})`, notOnTrip: "Not on this trip",
        privateTitle: "This trip is private",
        privateSignIn: "Sign in with the address you were invited with to see it.",
        privateNotMember: (e) => `You're signed in as ${e}, but that address isn't on this trip. Ask whoever runs it for an invitation, or sign in with a different address.`,
        roleOwner: "owner", roleEditor: "editor", roleViewer: "viewer" },
  de: { details: "Details", sights: "Orte", bookings: "Buchungen", plan: "Plan",
        name: "Dein Name", lang: "Sprache",
        signIn: "Anmelden", signOut: "Abmelden", account: "Konto",
        signInTitle: "Anmelden", signInLede: "E-Mail-Adresse eingeben, wir schicken dir einen Link. Kein Passwort nötig.",
        email: "E-Mail", sendLink: "Link schicken", sending: "Wird gesendet…",
        sentTitle: "Schau in dein Postfach", sentLede: (e) => `Wir haben einen Anmeldelink an ${e} geschickt. Er funktioniert einmal und gilt 15 Minuten.`,
        devLink: "Lokale Entwicklung: es wird keine E-Mail verschickt. Link öffnen:",
        signedInAs: (n) => `Angemeldet als ${n}`, close: "Schließen",
        sendFail: "Das hat nicht geklappt. Versuch es gleich noch einmal.",
        whoName: "Dein Name",
        onTrip: (n, r) => `Auf dieser Reise als ${n} (${r})`, notOnTrip: "Nicht auf dieser Reise",
        privateTitle: "Diese Reise ist privat",
        privateSignIn: "Melde dich mit der Adresse an, mit der du eingeladen wurdest.",
        privateNotMember: (e) => `Du bist als ${e} angemeldet, aber diese Adresse ist nicht auf der Reise. Bitte wen, der sie verwaltet, um eine Einladung – oder melde dich mit einer anderen Adresse an.`,
        roleOwner: "Verwaltung", roleEditor: "Bearbeiten", roleViewer: "Ansehen" },
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
    `<a href="${pageHref(href)}" data-nav="${key}"${key === current ? ' aria-current="page"' : ""}>${
      withIcons ? ICONS[icon] : ""}<span>${esc(NAV[lang][key])}</span></a>`).join("");
}

if (mount) {
  mount.outerHTML = `
  <nav class="nav">
    <div class="nav-inner">
      <a class="brand" href="${pageHref("/")}"><span class="mark">${ICONS.mark}</span><span class="name" id="brand-name">Trip</span></a>
      <div class="nav-tabs" id="nav-tabs">${linksHTML(false)}</div>
      <div class="nav-tools">
        <div class="seg" role="group" aria-label="${esc(NAV[lang].lang)}" id="langs">
          <button type="button" data-lang="en" aria-pressed="${lang === "en"}">EN</button>
          <button type="button" data-lang="de" aria-pressed="${lang === "de"}">DE</button>
        </div>
        <button type="button" class="btn btn-sm btn-tint" id="account" hidden></button>
      </div>
    </div>
  </nav>
  <nav class="tabbar" id="tabbar" aria-label="Pages">${linksHTML(true)}</nav>
  <div class="toast" id="status" role="status" aria-live="polite"></div>
  <div class="sheet-back" id="auth-sheet" hidden role="dialog" aria-modal="true" aria-labelledby="auth-title">
    <div class="sheet" style="width:min(440px,100%)">
      <header><h2 id="auth-title"></h2>
        <button class="sheet-close" id="auth-close" type="button">${ICONS.close}</button></header>
      <div class="sheet-body" id="auth-body"></div>
    </div>
  </div>`;
}

function paintNav() {
  const L = NAV[lang];
  paintAccount();
  if (!$("#auth-sheet")?.hidden) paintAuthSheet();
  for (const a of document.querySelectorAll("[data-nav]"))
    a.querySelector("span").textContent = L[a.dataset.nav];
  for (const b of document.querySelectorAll("#langs button"))
    b.setAttribute("aria-pressed", String(b.dataset.lang === lang));
}

$("#langs")?.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-lang]");
  if (b) setLang(b.dataset.lang);
});

/* ------------------------------------------------------------- account */
/* Sign in by email link. The button in the bar says "Sign in" or shows who
   you are; the sheet asks for an address and then says to check the inbox.
   Nothing about a trip changes yet — that is the next step — but the session
   is real, so the rest can build on it. */

let user = null;
let member = null;      // this account's name and role on this trip, or null
const userListeners = new Set();
export const getUser = () => user;
export function onUser(cb) { userListeners.add(cb); cb(user); }
const announce = () => { for (const cb of userListeners) cb(user); for (const cb of nameListeners) cb(nameOf()); };

let authView = "form";   // form | sent
let sentTo = "";
let devLink = null;

function paintAccount() {
  const L = NAV[lang];
  const btn = $("#account");
  if (!btn) return;
  btn.hidden = false;
  const label = member ? member.name : user ? user.displayName : L.signIn;
  btn.innerHTML = `${ICONS.person}<span>${esc(label)}</span>`;
  btn.title = member ? L.onTrip(member.name, roleLabel(member.role)) : user ? L.notOnTrip : L.signIn;
  btn.classList.toggle("btn-quiet", !!member);
  btn.classList.toggle("btn-tint", !member);
}

function paintAuthSheet() {
  const L = NAV[lang];
  const title = $("#auth-title"), body = $("#auth-body");
  if (!title || !body) return;
  $("#auth-close").setAttribute("aria-label", L.close);
  if (user) {
    title.textContent = L.account;
    body.innerHTML = `<div class="srow"><span class="slabel">${esc(L.email)}</span>
        <span class="sval">${esc(user.email)}</span></div>
      <div class="srow"><span class="slabel">${esc(L.whoName)}</span>
        <span class="sval">${member ? `${esc(member.name)} <span class="tag tag-sm tag-neutral">${esc(roleLabel(member.role))}</span>` : `<span class="muted">${esc(L.notOnTrip)}</span>`}</span></div>
      <div class="sfoot"><button class="btn btn-quiet" type="button" id="auth-logout">${esc(L.signOut)}</button></div>`;
    return;
  }
  if (authView === "sent") {
    title.textContent = L.sentTitle;
    body.innerHTML = `<p class="sval">${esc(L.sentLede(sentTo))}</p>` +
      (devLink ? `<p class="note">${esc(L.devLink)}</p><a class="btn btn-sm btn-tint" href="${esc(devLink)}" style="align-self:start">${esc(L.signIn)}</a>` : "");
    return;
  }
  title.textContent = L.signInTitle;
  body.innerHTML = `<p class="sval muted">${esc(L.signInLede)}</p>
    <form id="auth-form" class="stack">
      <label class="field"><span>${esc(L.email)}</span>
        <input class="input" id="auth-email" type="email" required autocomplete="email" inputmode="email" placeholder="you@example.com"></label>
      <p class="err" id="auth-err" hidden></p>
      <div><button class="btn btn-primary" type="submit" id="auth-send">${esc(L.sendLink)}</button></div>
    </form>`;
}

function openAuth() { authView = "form"; devLink = null; paintAuthSheet(); $("#auth-sheet").hidden = false;
  setTimeout(() => $("#auth-email")?.focus(), 0); }

export const roleLabel = (r) => NAV[lang][{ owner: "roleOwner", editor: "roleEditor", viewer: "roleViewer" }[r]] ?? r;

/**
 * Someone who is not on the trip sees nothing of it: the page's own content
 * is hidden and a short notice takes its place, with the one thing they can
 * do — sign in, or sign in as someone else.
 */
function paintPrivate() {
  const L = NAV[lang];
  let box = $("#private");
  const main = document.querySelector("main");
  if (member || !main) { if (box) box.hidden = true; main?.removeAttribute("hidden"); document.body.dataset.locked = ""; return; }
  document.body.dataset.locked = "1";
  main.hidden = true;
  if (!box) { box = document.createElement("section"); box.id = "private"; box.className = "page"; main.after(box); }
  box.hidden = false;
  box.innerHTML = `<div class="card" style="max-width:480px;margin:56px auto 0"><div class="card-body" style="padding:28px 24px;text-align:center">
      <div style="width:44px;height:44px;border-radius:50%;background:var(--tint-soft);color:var(--tint);display:grid;place-items:center;margin:0 auto 14px">${ICONS.person}</div>
      <h1 class="title-2" style="margin-bottom:8px">${esc(L.privateTitle)}</h1>
      <p class="footnote" style="margin-bottom:18px">${esc(user ? L.privateNotMember(user.email) : L.privateSignIn)}</p>
      <button type="button" class="btn btn-primary" id="private-cta">${esc(user ? L.signOut : L.signIn)}</button>
    </div></div>`;
}
document.addEventListener("click", async (e) => {
  if (!e.target.closest("#private-cta")) return;
  if (user) { try { await api("/api/auth/logout", { method: "POST" }); } catch {} user = null; member = null; paintAccount(); paintPrivate(); announce(); }
  else openAuth();
});
function closeAuth() { $("#auth-sheet").hidden = true; }

$("#account")?.addEventListener("click", openAuth);
$("#auth-close")?.addEventListener("click", closeAuth);
$("#auth-sheet")?.addEventListener("click", (e) => { if (e.target.id === "auth-sheet") closeAuth(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#auth-sheet")?.hidden) closeAuth(); });

document.addEventListener("submit", async (e) => {
  const form = e.target.closest("#auth-form");
  if (!form) return;
  e.preventDefault();
  const L = NAV[lang];
  const email = $("#auth-email").value.trim();
  const send = $("#auth-send"), err = $("#auth-err");
  send.disabled = true; send.textContent = L.sending; err.hidden = true;
  try {
    const d = await api("/api/auth/request", { method: "POST",
      body: JSON.stringify({ email, next: location.pathname + location.search, lang }) });
    sentTo = email; devLink = d.devLink ?? null; authView = "sent";
    paintAuthSheet();
  } catch (ex) {
    err.textContent = ex.message || L.sendFail; err.hidden = false;
    send.disabled = false; send.textContent = L.sendLink;
  }
});

document.addEventListener("click", async (e) => {
  if (!e.target.closest("#auth-logout")) return;
  try { await api("/api/auth/logout", { method: "POST" }); } catch {}
  user = null; member = null; closeAuth(); paintAccount(); paintPrivate(); announce();
});

async function loadUser() {
  try {
    const d = await api("/api/me");
    user = d.user ?? null; member = d.member ?? null;
    if (d.trip?.name) setTrip(d.trip);
  } catch { user = null; member = null; }
  paintAccount();
  paintPrivate();
  announce();
}

document.documentElement.lang = lang;
paintAccount();

/* ------------------------------------------------------------- identity */

/* Identity used to be a name typed into the bar. It is the claimed member
   now, and these keep the same names so the pages did not have to change:
   nameOf() is who you are on this trip, askName() opens the sheet that sorts
   that out, onName() fires when it changes. */

const nameListeners = new Set();
export const nameOf = () => member?.name ?? "";
export const nameKey = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Run `cb(name)` whenever who you are changes. */
export function onName(cb) { nameListeners.add(cb); }

/** Sign in, or claim a name — whichever is the missing step. */
export function askName() { openAuth(); }

/** Kept for the pages that call it; the bar no longer lists members. */
export function fillMembers() {}

/** Your role on this trip: "owner" | "editor" | "viewer" | null. */
export const roleOf = () => member?.role ?? null;

/* ------------------------------------------------------------- status */

let toastTimer = 0;
/**
 * A short message at the bottom of the screen. Goes away on its own unless it
 * is an error, which stays until the next message replaces it.
 */
export function setStatus(message, kind = "") {
  const el = $("#status");
  if (!el) return;
  if (document.body.dataset.locked === "1") return;   // the private notice says it all
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

/**
 * fetch() with the JSON headers, the access code, and one retry after a 401.
 * A path like "/api/plan/set" is sent as "/api/t/<trip>/plan/set", so pages
 * keep writing the endpoint and the shell supplies the trip.
 */
export async function api(path, options, retried = false) {
  // Accounts are not part of any trip, so /api/auth/… is left as it is.
  const scoped = path.startsWith("/api/") && !path.startsWith("/api/t/") && !path.startsWith("/api/auth/")
    ? `/api/t/${TRIP}${path.slice(4)}` : path;
  const res = await fetch(scoped, {
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

/* ------------------------------------------------------------- maps */

/**
 * Which maps app "Open in Maps" means. Apple devices get Apple Maps, everything
 * else Google, unless this browser has said otherwise. A per-account setting
 * will replace the storage lookup once accounts exist; the call stays the same.
 */
export function mapsApp() {
  try {
    const pref = localStorage.getItem("trip-maps");
    if (pref === "apple" || pref === "google") return pref;
  } catch {}
  const ua = navigator.userAgent || "";
  const apple = /iPhone|iPad|iPod|Macintosh/.test(ua) && !/Android/.test(ua);
  return apple ? "apple" : "google";
}

/** The one link out of a routeLinks() result that matches the preference. */
export const mapLink = (r) => (r ? r[mapsApp()] : null);

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

loadUser();
