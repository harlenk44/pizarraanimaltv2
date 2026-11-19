/* ==========================================================================
   Pizarra Animaltec TV - Cliente ES5 Puro para Smart TVs Antiguos
   Reglas estrictas: solo var, function, XMLHttpRequest, JSON, setInterval/setTimeout.
   Cero dependencias externas, cero fugas de memoria.
   ========================================================================== */
(function () {
  "use strict";

  var POLL_INTERVAL_MS = 12000;
  var XHR_TIMEOUT_MS = 12000;
  var PIN_LENGTH = 6;
  var COOKIE_PIN = "pizarra_tv_pin";
  var COOKIE_DEVICE = "pizarra_tv_device_id";
  var COOKIE_DAYS = 3650;

  var DEFAULT_THEME = {
    background_color: "#080c16",
    surface_color: "#0f172a",
    primary_color: "#2563eb",
    text_color: "#f8fafc",
    card_color: "#111827",
    result_row_color: "#1b2538"
  };

  var DAYS_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  var MONTHS_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

  var state = {
    screen: "loading", // "loading" | "pin" | "board"
    modalOpen: false,
    modalFocusIdx: 0, // 0 cancel, 1 confirm

    deviceId: "",
    savedPin: "",
    pinInput: "",
    pinSubmitting: false,
    pinRow: 0,
    pinCol: 0,

    headerFocusIdx: -1, // -1 none, 0..3 header buttons

    hasLoadedAssets: false,
    logosVersion: null,
    imagesVersion: null,
    syncInFlight: false,
    offline: false,
    clockOffsetMs: 0,

    // Datos cacheados del servidor
    serverLotteryDate: "",
    requireLicense: true,
    appSettings: {},
    clientLicenses: [],
    games: [],
    results: [],
    tripleResults: [],
    logoCache: {},        // key (id o slug) -> url
    animalImageCache: {}, // key (game_id + ":" + num) -> url

    // Licencia y configuración activa
    activeLicense: null,
    activeConfig: null,
    appliedThemeKey: "",

    // Paginación y rotación
    filteredGames: [],
    cardsPerPage: 4,
    transitionSeconds: 15,
    currentPage: 0,
    totalPages: 1,
    pageElapsedSec: 0,
    lastBoardSignature: "",

    // Timers (siempre limpios antes de reasignar)
    syncTimer: null,
    clockTimer: null,
    rotationTimer: null
  };

  // Referencias DOM estáticas
  var dom = {};

  /* ========================================================================
     UTILIDADES ES5 SEGURAS
     ======================================================================== */

  function byId(id) {
    return document.getElementById(id);
  }

  function trimStr(val) {
    if (val === null || val === undefined) {
      return "";
    }
    return String(val).replace(/^\s+|\s+$/g, "");
  }

  function isArr(val) {
    return Object.prototype.toString.call(val) === "[object Array]";
  }

  function hasOwn(obj, key) {
    return obj && Object.prototype.hasOwnProperty.call(obj, key);
  }

  function pad2(n) {
    var num = parseInt(n, 10);
    if (isNaN(num)) {
      return "00";
    }
    return num < 10 ? "0" + num : String(num);
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) {
      return "";
    }
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function addClass(el, cls) {
    if (!el) return;
    var cur = " " + (el.className || "") + " ";
    if (cur.indexOf(" " + cls + " ") === -1) {
      el.className = trimStr((el.className || "") + " " + cls);
    }
  }

  function removeClass(el, cls) {
    if (!el || !el.className) return;
    var parts = el.className.split(/\s+/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] && parts[i] !== cls) {
        out.push(parts[i]);
      }
    }
    el.className = out.join(" ");
  }

  function sanitizeHex(val, fallback) {
    if (typeof val === "string") {
      var s = trimStr(val);
      if (/^#[0-9a-fA-F]{6}$/.test(s) || /^#[0-9a-fA-F]{3}$/.test(s)) {
        return s;
      }
    }
    return fallback;
  }

  /* ========================================================================
     PERSISTENCIA DUAL (localStorage + COOKIE DE LARGA DURACIÓN)
     ======================================================================== */

  function setCookie(name, value, days) {
    try {
      var d = new Date();
      d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
      var expires = "expires=" + d.toUTCString();
      var maxAge = "max-age=" + String(days * 24 * 60 * 60);
      document.cookie = name + "=" + encodeURIComponent(value) + "; " + expires + "; " + maxAge + "; path=/; SameSite=Lax";
    } catch (_e) {
      // Ignorar si el navegador restringe cookies
    }
  }

  function getCookie(name) {
    try {
      var prefix = name + "=";
      var parts = document.cookie ? document.cookie.split(";") : [];
      for (var i = 0; i < parts.length; i++) {
        var c = trimStr(parts[i]);
        if (c.indexOf(prefix) === 0) {
          return decodeURIComponent(c.substring(prefix.length));
        }
      }
    } catch (_e) {
      // Ignorar
    }
    return "";
  }

  function deleteCookie(name) {
    try {
      document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0; path=/; SameSite=Lax";
    } catch (_e) {
      // Ignorar
    }
  }

  function persistSet(key, value) {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(key, value);
      }
    } catch (_e) {
      // Muchos Smart TV bloquean o limpian localStorage
    }
    setCookie(key, value, COOKIE_DAYS);
  }

  function persistGet(key) {
    var val = "";
    try {
      if (window.localStorage) {
        val = window.localStorage.getItem(key) || "";
      }
    } catch (_e) {
      val = "";
    }
    if (!val) {
      val = getCookie(key) || "";
      if (val) {
        // Re-sincronizar en localStorage si se recuperó desde cookie
        try {
          if (window.localStorage) {
            window.localStorage.setItem(key, val);
          }
        } catch (_e2) {}
      }
    } else {
      // Asegurar cookie fresca también
      if (!getCookie(key)) {
        setCookie(key, val, COOKIE_DAYS);
      }
    }
    return trimStr(val);
  }

  function persistRemove(key) {
    try {
      if (window.localStorage) {
        window.localStorage.removeItem(key);
      }
    } catch (_e) {}
    deleteCookie(key);
  }

  function ensureDeviceId() {
    var existing = persistGet(COOKIE_DEVICE);
    if (existing) {
      return existing;
    }
    var rand1 = Math.floor(Math.random() * 0x1000000).toString(16);
    var rand2 = Math.floor(Math.random() * 0x1000000).toString(16);
    var ts = (new Date().getTime()).toString(36);
    var id = ("TV-" + rand1 + rand2 + "-" + ts).toUpperCase().substring(0, 24);
    persistSet(COOKIE_DEVICE, id);
    return id;
  }

  /* ========================================================================
     XMLHttpRequest PURO (ES5, SIN FUGAS DE MEMORIA)
     ======================================================================== */

  function httpRequest(method, url, bodyObj, callback) {
    var xhr = new XMLHttpRequest();
    var done = false;

    function finish(err, status, data) {
      if (done) return;
      done = true;
      xhr.onreadystatechange = null;
      xhr.onerror = null;
      xhr.ontimeout = null;
      callback(err, status, data);
    }

    try {
      xhr.open(method, url, true);
      xhr.timeout = XHR_TIMEOUT_MS;
      xhr.setRequestHeader("Accept", "application/json");
      if (method === "POST") {
        xhr.setRequestHeader("Content-Type", "application/json; charset=utf-8");
      }

      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        var parsed = null;
        if (xhr.responseText) {
          try {
            parsed = JSON.parse(xhr.responseText);
          } catch (_e) {
            parsed = null;
          }
        }
        if (xhr.status >= 200 && xhr.status < 300 && parsed) {
          finish(null, xhr.status, parsed);
        } else {
          var errMsg = (parsed && parsed.error) ? parsed.error : ("Error HTTP " + xhr.status);
          finish(errMsg, xhr.status, parsed);
        }
      };

      xhr.onerror = function () {
        finish("Error de conexión con el servidor", 0, null);
      };

      xhr.ontimeout = function () {
        finish("Tiempo de espera agotado al conectar", 0, null);
      };

      if (bodyObj) {
        xhr.send(JSON.stringify(bodyObj));
      } else {
        xhr.send(null);
      }
    } catch (e) {
      finish("Error al iniciar solicitud HTTP", 0, null);
    }
  }

  /* ========================================================================
     INTERPRETACIÓN DE LICENCIA Y CONFIGURACIÓN EN client_name ("Nombre||{JSON}")
     ======================================================================== */

  function parseLicenseClientConfig(license) {
    var result = {
      visibleName: "",
      allowedLotteries: null, // null = todas, "NINGUNA" = ninguna, Array = slugs/IDs exactos
      cardsPerScreen: 4,
      showAllCards: false,
      transitionSeconds: 15,
      designConfig: null
    };

    var appRot = state.appSettings && state.appSettings.rotation_interval_seconds
      ? parseInt(state.appSettings.rotation_interval_seconds, 10)
      : 15;
    if (!isNaN(appRot) && appRot >= 4) {
      result.transitionSeconds = appRot;
    }

    if (!license || !license.client_name) {
      return result;
    }

    var rawName = String(license.client_name);
    var parts = rawName.split("||");
    result.visibleName = trimStr(parts[0]);

    if (parts.length < 2) {
      return result;
    }

    var jsonStr = trimStr(parts.slice(1).join("||"));
    if (!jsonStr) {
      return result;
    }

    var cfg = null;
    try {
      cfg = JSON.parse(jsonStr);
    } catch (_e) {
      cfg = null;
    }

    if (!cfg || typeof cfg !== "object") {
      return result;
    }

    // 1. loterias / allowedLotteries
    var rawLots = hasOwn(cfg, "loterias") ? cfg.loterias : (hasOwn(cfg, "allowedLotteries") ? cfg.allowedLotteries : undefined);
    if (rawLots === null || rawLots === undefined) {
      result.allowedLotteries = null;
    } else if (typeof rawLots === "string") {
      var upLots = trimStr(rawLots).toUpperCase();
      if (upLots === "NINGUNA" || upLots === "NONE" || upLots === "") {
        result.allowedLotteries = "NINGUNA";
      } else if (upLots === "TODAS" || upLots === "ALL") {
        result.allowedLotteries = null;
      } else {
        result.allowedLotteries = [trimStr(rawLots).toLowerCase()];
      }
    } else if (isArr(rawLots)) {
      if (rawLots.length === 0) {
        result.allowedLotteries = "NINGUNA";
      } else {
        var cleanList = [];
        for (var i = 0; i < rawLots.length; i++) {
          var item = trimStr(rawLots[i]).toLowerCase();
          if (item) {
            cleanList.push(item);
          }
        }
        result.allowedLotteries = cleanList.length > 0 ? cleanList : "NINGUNA";
      }
    }

    // 2. tarjetasPorPantalla / cardsPerScreen
    var rawCards = hasOwn(cfg, "tarjetasPorPantalla")
      ? cfg.tarjetasPorPantalla
      : (hasOwn(cfg, "cardsPerScreen") ? cfg.cardsPerScreen : undefined);

    if (typeof rawCards === "string") {
      var upCards = trimStr(rawCards).toUpperCase();
      if (upCards === "TODAS" || upCards === "ALL") {
        result.showAllCards = true;
        result.cardsPerScreen = 999;
      } else {
        var parsedCards = parseInt(upCards, 10);
        if (!isNaN(parsedCards) && parsedCards > 0) {
          result.cardsPerScreen = parsedCards;
        }
      }
    } else if (typeof rawCards === "number" && rawCards > 0) {
      result.cardsPerScreen = Math.floor(rawCards);
    }

    // 3. tiempoTransicion / transitionSeconds
    var rawTrans = hasOwn(cfg, "tiempoTransicion")
      ? cfg.tiempoTransicion
      : (hasOwn(cfg, "transitionSeconds") ? cfg.transitionSeconds : undefined);

    if (rawTrans !== undefined && rawTrans !== null) {
      var parsedSec = parseInt(rawTrans, 10);
      if (!isNaN(parsedSec) && parsedSec > 0) {
        result.transitionSeconds = parsedSec < 4 ? 4 : parsedSec;
      }
    }

    // 4. diseno / designConfig
    var rawDesign = cfg.diseno || cfg.designConfig || null;
    if (rawDesign && typeof rawDesign === "object") {
      result.designConfig = rawDesign;
    }

    return result;
  }

  function findLicenseByPin(pin) {
    var target = trimStr(pin);
    if (!target || !isArr(state.clientLicenses)) {
      return null;
    }
    for (var i = 0; i < state.clientLicenses.length; i++) {
      var lic = state.clientLicenses[i];
      if (lic && trimStr(lic.pin_code) === target) {
        return lic;
      }
    }
    return null;
  }

  function parseIsoMs(str) {
    if (!str) return NaN;
    var s = trimStr(str);
    var parsed = Date.parse(s);
    if (!isNaN(parsed)) {
      return parsed;
    }
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
    if (!m) return NaN;
    return Date.UTC(
      parseInt(m[1], 10),
      parseInt(m[2], 10) - 1,
      parseInt(m[3], 10),
      parseInt(m[4] || "0", 10),
      parseInt(m[5] || "0", 10),
      parseInt(m[6] || "0", 10)
    );
  }

  function isLicenseExpired(license) {
    if (!license || !license.expires_at) {
      return false;
    }
    // Licencia maestra sin vencimiento (fechas anteriores a 2000 usadas como comodín)
    if (license.id === "lic-master-admin" || (license.max_devices && license.max_devices >= 999)) {
      var checkYear = parseInt(String(license.expires_at).substring(0, 4), 10);
      if (!isNaN(checkYear) && checkYear < 2000) {
        return false;
      }
    }
    var expMs = parseIsoMs(license.expires_at);
    if (isNaN(expMs)) {
      return false;
    }
    var nowMs = new Date().getTime() + state.clockOffsetMs;
    return expMs < nowMs;
  }

  function validateCurrentLicense() {
    if (!state.requireLicense) {
      // Si el servidor no exige licencia, aún podemos aplicar diseño/filtros si hay un PIN válido guardado
      var optionalLic = state.savedPin ? findLicenseByPin(state.savedPin) : null;
      if (optionalLic && optionalLic.status === "active" && !isLicenseExpired(optionalLic)) {
        return { ok: true, license: optionalLic, reason: "" };
      }
      return { ok: true, license: null, reason: "" };
    }

    if (!state.savedPin) {
      return { ok: false, license: null, reason: "" };
    }

    var lic = findLicenseByPin(state.savedPin);
    if (!lic) {
      return { ok: false, license: null, reason: "Licencia eliminada o PIN no encontrado. Ingrese un PIN válido." };
    }

    var st = trimStr(lic.status).toLowerCase();
    if (st && st !== "active") {
      if (st === "paused") {
        return { ok: false, license: null, reason: "Licencia pausada por el administrador." };
      }
      return { ok: false, license: null, reason: "Licencia inactiva (" + lic.status + ")." };
    }

    if (isLicenseExpired(lic)) {
      return { ok: false, license: null, reason: "Su licencia ha vencido. Contacte al administrador." };
    }

    // Verificar límite de dispositivos vinculados si el servidor ya registró otros dispositivos
    var bound = isArr(lic.bound_device_ids) ? lic.bound_device_ids : [];
    var maxDev = parseInt(lic.max_devices, 10) || 1;
    if (bound.length > 0 && bound.indexOf(state.deviceId) === -1 && bound.length >= maxDev) {
      return { ok: false, license: null, reason: "Este PIN alcanzó el límite máximo de dispositivos vinculados." };
    }

    return { ok: true, license: lic, reason: "" };
  }

  /* ========================================================================
     APLICACIÓN DINÁMICA DE COLORES (#HEX PURO, SIN VARIABLES CSS)
     ======================================================================== */

  function applyThemeColors(designCfg, appSettings) {
    var d = designCfg || {};
    var a = appSettings || {};

    var bg = sanitizeHex(d.background_color, sanitizeHex(a.background_color, DEFAULT_THEME.background_color));
    var surface = sanitizeHex(d.surface_color, sanitizeHex(a.surface_color, DEFAULT_THEME.surface_color));
    var primary = sanitizeHex(d.primary_color, sanitizeHex(a.primary_color, DEFAULT_THEME.primary_color));
    var text = sanitizeHex(d.text_color, sanitizeHex(a.text_color, DEFAULT_THEME.text_color));
    var card = sanitizeHex(d.card_color, sanitizeHex(a.card_color, DEFAULT_THEME.card_color));
    var row = sanitizeHex(d.result_row_color, sanitizeHex(a.result_row_color, DEFAULT_THEME.result_row_color));

    var key = bg + "|" + surface + "|" + primary + "|" + text + "|" + card + "|" + row;
    if (key === state.appliedThemeKey) {
      return;
    }
    state.appliedThemeKey = key;

    var css = ""
      + "html, body, .screen-board, .screen-center { background-color: " + bg + "; color: " + text + "; }\n"
      + ".board-header { background-color: " + surface + "; border-bottom-color: " + primary + "; }\n"
      + ".game-card, .pin-panel, .loading-box, .modal-box, .board-empty-box { background-color: " + card + "; }\n"
      + ".game-card-header { background-color: " + surface + "; }\n"
      + ".draws-cell, .triples-row { background-color: " + row + "; }\n"
      + ".draws-cell-latest { border-color: " + primary + "; }\n"
      + ".animal-num-badge { border-color: " + primary + "; }\n"
      + ".draws-cell-latest .animal-num-badge, .rotation-bar-fill, .btn-primary, .key-btn-submit { background-color: " + primary + "; border-color: " + primary + "; }\n"
      + ".board-title, .board-date, .game-name, .draw-animal-name, .pin-title, .triples-cell { color: " + text + "; }\n";

    var styleEl = byId("dynamic-theme-style");
    if (styleEl) {
      if (styleEl.styleSheet) {
        styleEl.styleSheet.cssText = css;
      } else {
        styleEl.textContent = css;
      }
    }
  }

  /* ========================================================================
     FORMATEO DE FECHA Y HORA OFICIAL DE VENEZUELA (UTC-4)
     ======================================================================== */

  function formatVenezuelaDate(ymd) {
    if (!ymd || ymd.length < 10) {
      return "---";
    }
    var parts = ymd.substring(0, 10).split("-");
    if (parts.length !== 3) {
      return ymd;
    }
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10) - 1;
    var d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) {
      return ymd;
    }
    var dt = new Date(Date.UTC(y, m, d, 12, 0, 0));
    var dayName = DAYS_ES[dt.getUTCDay()] || "";
    var monthName = MONTHS_ES[m] || "";
    return dayName + " " + pad2(d) + " " + monthName + " " + y;
  }

  function updateVenezuelaClock() {
    if (!dom.boardClock) return;
    // Venezuela siempre es UTC-4 sin horario de verano
    var nowUtcMs = new Date().getTime() + state.clockOffsetMs;
    var vetMs = nowUtcMs - (4 * 60 * 60 * 1000);
    var vet = new Date(vetMs);
    var hours24 = vet.getUTCHours();
    var mins = vet.getUTCMinutes();
    var secs = vet.getUTCSeconds();
    var ampm = hours24 >= 12 ? "PM" : "AM";
    var hours12 = hours24 % 12;
    if (hours12 === 0) {
      hours12 = 12;
    }
    dom.boardClock.innerHTML = pad2(hours12) + ":" + pad2(mins) + ":" + pad2(secs) + " " + ampm;
  }

  function formatDrawTime(rawTime) {
    var s = trimStr(rawTime);
    if (!s) return "--:--";
    var parts = s.split(":");
    if (parts.length < 2) return s;
    var h24 = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    if (isNaN(h24) || isNaN(m)) return s;
    var ampm = h24 >= 12 ? "PM" : "AM";
    var h12 = h24 % 12;
    if (h12 === 0) h12 = 12;
    return pad2(h12) + ":" + pad2(m) + " " + ampm;
  }

  function timeToSortableMinutes(rawTime) {
    var s = trimStr(rawTime);
    var parts = s.split(":");
    if (parts.length < 2) return 0;
    var h = parseInt(parts[0], 10) || 0;
    var m = parseInt(parts[1], 10) || 0;
    return h * 60 + m;
  }

  function formatAnimalNumber(num) {
    if (num === null || num === undefined || num === "") {
      return "--";
    }
    var str = trimStr(num);
    if (str === "00" || str === "-1") {
      return "00";
    }
    if (str === "0") {
      return "0";
    }
    var n = parseInt(str, 10);
    if (isNaN(n)) {
      return str;
    }
    if (n < 0) {
      return "00";
    }
    if (n === 0) {
      return "0";
    }
    if (n < 10) {
      return "0" + n;
    }
    return String(n);
  }

  function formatTripleGameName(slug) {
    var s = trimStr(slug).replace(/[-_]+/g, " ");
    if (!s) return "Triples";
    var words = s.split(" ");
    var out = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w) {
        out.push(w.charAt(0).toUpperCase() + w.substring(1).toLowerCase());
      }
    }
    return out.join(" ");
  }

  function getGameInitials(name) {
    var clean = trimStr(name);
    if (!clean) return "PA";
    var words = clean.split(/\s+/);
    if (words.length >= 2) {
      return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
    }
    return clean.substring(0, 2).toUpperCase();
  }

  /* ========================================================================
     CONSTRUCCIÓN DE LISTA DE JUEGOS, FILTRADO EXACTO Y RESULTADOS DEL DÍA
     ======================================================================== */

  function isGameAllowed(game, allowedLotteries) {
    if (allowedLotteries === null || allowedLotteries === undefined) {
      return true;
    }
    if (allowedLotteries === "NINGUNA") {
      return false;
    }
    if (!isArr(allowedLotteries)) {
      return true;
    }
    var gSlug = trimStr(game.slug).toLowerCase();
    var gId = trimStr(game.id).toLowerCase();
    // Comparación EXACTA para nunca confundir lotto-activo con lotto-activo-internacional
    for (var i = 0; i < allowedLotteries.length; i++) {
      var allowed = allowedLotteries[i];
      if (allowed && (gSlug === allowed || gId === allowed)) {
        return true;
      }
    }
    return false;
  }

  function buildPreparedGames(allowedLotteries) {
    var today = state.serverLotteryDate;
    var activeGames = [];
    var existingKeys = {};
    var i;

    // 1. Juegos activos del servidor ordenados por display_order
    for (i = 0; i < state.games.length; i++) {
      var g = state.games[i];
      if (!g || g.is_active === false) continue;
      var logo = state.logoCache[g.id] || state.logoCache[g.slug] || g.logo_url || "";
      var obj = {
        id: g.id,
        slug: g.slug,
        name: g.name,
        category: g.category || "animalitos",
        display_order: typeof g.display_order === "number" ? g.display_order : (parseInt(g.display_order, 10) || 999),
        logo_url: logo,
        isTriple: (trimStr(g.category).toLowerCase() === "triples"),
        draws: []
      };
      activeGames.push(obj);
      existingKeys[trimStr(g.id).toLowerCase()] = obj;
      existingKeys[trimStr(g.slug).toLowerCase()] = obj;
    }

    // 2. Juegos virtuales de tripleResults del día (si no están ya en games[])
    var tripleOrder = 1000;
    for (i = 0; i < state.tripleResults.length; i++) {
      var tr = state.tripleResults[i];
      if (!tr) continue;
      var tDate = tr.draw_date ? String(tr.draw_date).substring(0, 10) : today;
      if (today && tDate && tDate !== today) continue;

      var tSlug = trimStr(tr.game_slug || tr.game_id);
      if (!tSlug) continue;
      var tKey = tSlug.toLowerCase();
      var targetGame = existingKeys[tKey];
      if (!targetGame) {
        tripleOrder += 1;
        targetGame = {
          id: tr.game_id || tSlug,
          slug: tSlug,
          name: formatTripleGameName(tSlug),
          category: "triples",
          display_order: tripleOrder,
          logo_url: state.logoCache[tSlug] || state.logoCache[tr.game_id] || "",
          isTriple: true,
          draws: []
        };
        activeGames.push(targetGame);
        existingKeys[tKey] = targetGame;
      }
    }

    // Ordenar por display_order ascendente
    activeGames.sort(function (a, b) {
      if (a.display_order !== b.display_order) {
        return a.display_order - b.display_order;
      }
      return a.name > b.name ? 1 : (a.name < b.name ? -1 : 0);
    });

    // 3. Asignar resultados de animalitos del día serverLotteryDate
    for (i = 0; i < state.results.length; i++) {
      var r = state.results[i];
      if (!r) continue;
      var rDate = r.draw_date ? String(r.draw_date).substring(0, 10) : today;
      if (today && rDate && rDate !== today) continue;

      var rKeyId = trimStr(r.game_id).toLowerCase();
      var rKeySlug = trimStr(r.game_slug).toLowerCase();
      var gameRef = existingKeys[rKeyId] || existingKeys[rKeySlug];
      if (!gameRef) continue;

      var rawNum = r.animal_number;
      var rawLabel = r.animal_label || r.animal_name || "";
      var imgUrl = r.animal_image_url || "";
      if (!imgUrl) {
        var keyExact = gameRef.id + ":" + String(rawNum);
        var keyPad = gameRef.id + ":" + formatAnimalNumber(rawNum);
        var keyLabel = rawLabel ? (gameRef.id + ":label:" + trimStr(rawLabel).toLowerCase()) : "";
        imgUrl = state.animalImageCache[keyExact]
          || state.animalImageCache[keyPad]
          || (keyLabel ? state.animalImageCache[keyLabel] : "")
          || "";
      }

      gameRef.draws.push({
        type: "animal",
        draw_time: r.draw_time || "",
        sortMin: timeToSortableMinutes(r.draw_time),
        animal_number: formatAnimalNumber(rawNum),
        animal_label: rawLabel,
        image_url: imgUrl
      });
    }

    // 4. Asignar resultados de triples del día serverLotteryDate
    for (i = 0; i < state.tripleResults.length; i++) {
      var t = state.tripleResults[i];
      if (!t) continue;
      var td = t.draw_date ? String(t.draw_date).substring(0, 10) : today;
      if (today && td && td !== today) continue;

      var tkSlug = trimStr(t.game_slug).toLowerCase();
      var tkId = trimStr(t.game_id).toLowerCase();
      var tGame = existingKeys[tkSlug] || existingKeys[tkId];
      if (!tGame) continue;

      tGame.isTriple = true;
      tGame.draws.push({
        type: "triple",
        draw_time: t.draw_time || "",
        sortMin: timeToSortableMinutes(t.draw_time),
        triple_number: trimStr(t.triple_number),
        extra_value: trimStr(t.extra_value),
        triple_a: trimStr(t.triple_a),
        triple_b: trimStr(t.triple_b),
        triple_c: trimStr(t.triple_c),
        zodiac_sign: trimStr(t.zodiac_sign)
      });
    }

    // 5. Filtrar por licencia y ordenar sorteos de cada juego por hora
    var filtered = [];
    for (i = 0; i < activeGames.length; i++) {
      var item = activeGames[i];
      if (!isGameAllowed(item, allowedLotteries)) {
        continue;
      }
      item.draws.sort(function (a, b) {
        return a.sortMin - b.sortMin;
      });
      filtered.push(item);
    }

    return filtered;
  }

  /* ========================================================================
     RENDERIZADO DE LA PIZARRA (DOM EFICIENTE CON DIFERENCIACIÓN)
     ======================================================================== */

  function computeGridLayout(count) {
    if (count <= 1) return { cols: 1, rows: 1, density: "density-1" };
    if (count === 2) return { cols: 2, rows: 1, density: "density-2" };
    if (count === 3) return { cols: 3, rows: 1, density: "density-2" };
    if (count === 4) return { cols: 2, rows: 2, density: "density-4" };
    if (count <= 6) return { cols: 3, rows: 2, density: "density-6" };
    if (count <= 8) return { cols: 4, rows: 2, density: "density-many" };
    if (count === 9) return { cols: 3, rows: 3, density: "density-many" };
    if (count <= 12) return { cols: 4, rows: 3, density: "density-many" };
    return { cols: 4, rows: Math.ceil(count / 4), density: "density-many" };
  }

  function computeDrawColumns(cardCols, drawCount) {
    if (cardCols === 1) {
      return drawCount > 8 ? 4 : 3;
    }
    if (cardCols === 2) {
      return drawCount > 8 ? 3 : 2;
    }
    if (cardCols === 3) {
      return 2;
    }
    return drawCount > 6 ? 2 : 1;
  }

  function renderAnimalDrawsHtml(draws, cardCols) {
    if (!draws || draws.length === 0) {
      return '<div class="game-empty">Esperando resultados del día</div>';
    }
    var cols = computeDrawColumns(cardCols, draws.length);
    var rows = Math.ceil(draws.length / cols);
    var latestIdx = draws.length - 1;
    var html = ['<div class="draws-table">'];

    for (var r = 0; r < rows; r++) {
      html.push('<div class="draws-row">');
      for (var c = 0; c < cols; c++) {
        var idx = r * cols + c;
        if (idx >= draws.length) {
          html.push('<div class="draws-cell-empty"></div>');
          continue;
        }
        var d = draws[idx];
        var cellCls = idx === latestIdx ? "draws-cell draws-cell-latest" : "draws-cell";
        var numEsc = escapeHtml(d.animal_number);
        var labelEsc = escapeHtml(d.animal_label || "Sin nombre");
        var timeEsc = escapeHtml(formatDrawTime(d.draw_time));

        html.push('<div class="' + cellCls + '">');
        html.push('<div class="draw-inner">');

        // Imagen del animal o insignia numérica de alto contraste (con fallback seguro sin imagen rota)
        html.push('<div class="draw-media-cell">');
        if (d.image_url) {
          html.push('<div class="animal-img-box">');
          html.push('<img class="animal-img" src="' + escapeHtml(d.image_url) + '" alt="' + labelEsc + '" onerror="this.style.display=\'none\';if(this.nextSibling){this.nextSibling.style.display=\'inline-block\';}" />');
          html.push('<span class="animal-num-badge" style="display:none;">' + numEsc + '</span>');
          html.push('</div>');
        } else {
          html.push('<span class="animal-num-badge">' + numEsc + '</span>');
        }
        html.push('</div>');

        html.push('<div class="draw-info-cell">');
        html.push('<div class="draw-top-line">');
        html.push('<span class="draw-time">' + timeEsc + '</span>');
        if (d.image_url) {
          html.push('<span class="draw-num-inline">#' + numEsc + '</span>');
        }
        html.push('</div>');
        html.push('<div class="draw-animal-name">' + labelEsc + '</div>');
        html.push('</div>');

        html.push('</div></div>');
      }
      html.push('</div>');
    }

    html.push('</div>');
    return html.join("");
  }

  function renderTripleDrawsHtml(draws) {
    if (!draws || draws.length === 0) {
      return '<div class="game-empty">Esperando sorteos de hoy</div>';
    }

    // Detectar si los resultados usan columnas A/B/C o un número único
    var hasMultiCols = false;
    var hasExtra = false;
    var i;
    for (i = 0; i < draws.length; i++) {
      if (draws[i].triple_b || draws[i].triple_c) {
        hasMultiCols = true;
      }
      if (draws[i].zodiac_sign || draws[i].extra_value) {
        hasExtra = true;
      }
    }

    var latestIdx = draws.length - 1;
    var html = ['<div class="triples-table">'];

    html.push('<div class="triples-head-row">');
    html.push('<div class="triples-head-cell triples-head-left">Hora</div>');
    if (hasMultiCols) {
      html.push('<div class="triples-head-cell">A</div>');
      html.push('<div class="triples-head-cell">B</div>');
      html.push('<div class="triples-head-cell">C</div>');
    } else {
      html.push('<div class="triples-head-cell">Número</div>');
    }
    if (hasExtra) {
      html.push('<div class="triples-head-cell">Extra</div>');
    }
    html.push('</div>');

    for (i = 0; i < draws.length; i++) {
      var d = draws[i];
      var rowCls = i === latestIdx ? "triples-row triples-row-latest" : "triples-row";
      var mainVal = d.triple_number || d.triple_a || "---";
      var extraVal = d.zodiac_sign || d.extra_value || "";

      html.push('<div class="' + rowCls + '">');
      html.push('<div class="triples-cell triples-time-cell">' + escapeHtml(formatDrawTime(d.draw_time)) + '</div>');
      if (hasMultiCols) {
        html.push('<div class="triples-cell">' + escapeHtml(d.triple_a || d.triple_number || "--") + '</div>');
        html.push('<div class="triples-cell">' + escapeHtml(d.triple_b || "--") + '</div>');
        html.push('<div class="triples-cell">' + escapeHtml(d.triple_c || "--") + '</div>');
      } else {
        html.push('<div class="triples-cell">' + escapeHtml(mainVal) + '</div>');
      }
      if (hasExtra) {
        html.push('<div class="triples-cell triples-extra-cell">' + escapeHtml(extraVal || "-") + '</div>');
      }
      html.push('</div>');
    }

    html.push('</div>');
    return html.join("");
  }

  function renderGameCardHtml(game, cardCols) {
    var nameEsc = escapeHtml(game.name);
    var initialsEsc = escapeHtml(getGameInitials(game.name));
    var countText = game.draws.length === 1 ? "1 sorteo hoy" : (game.draws.length + " sorteos hoy");
    var html = [];

    html.push('<div class="game-card">');
    html.push('<div class="game-card-header">');

    html.push('<div class="game-logo-cell"><div class="game-logo-wrap">');
    if (game.logo_url) {
      html.push('<img class="game-logo-img" src="' + escapeHtml(game.logo_url) + '" alt="' + nameEsc + '" onerror="this.style.display=\'none\';if(this.nextSibling){this.nextSibling.style.display=\'inline-block\';}" />');
      html.push('<span class="game-logo-fallback" style="display:none;">' + initialsEsc + '</span>');
    } else {
      html.push('<span class="game-logo-fallback">' + initialsEsc + '</span>');
    }
    html.push('</div></div>');

    html.push('<div class="game-title-cell">');
    html.push('<div class="game-name">' + nameEsc + '</div>');
    html.push('<div class="game-meta">' + escapeHtml(countText) + '</div>');
    html.push('</div>');

    html.push('</div>');

    html.push('<div class="game-card-body">');
    if (game.isTriple) {
      html.push(renderTripleDrawsHtml(game.draws));
    } else {
      html.push(renderAnimalDrawsHtml(game.draws, cardCols));
    }
    html.push('</div>');
    html.push('</div>');

    return html.join("");
  }

  function buildPageSignature(pageGames, layout) {
    var parts = [
      state.serverLotteryDate,
      state.currentPage,
      state.totalPages,
      layout.cols,
      layout.rows,
      layout.density,
      state.appliedThemeKey
    ];
    for (var i = 0; i < pageGames.length; i++) {
      var g = pageGames[i];
      parts.push(g.id + ":" + g.name + ":" + (g.logo_url ? g.logo_url.length : 0) + ":" + g.draws.length);
      for (var j = 0; j < g.draws.length; j++) {
        var d = g.draws[j];
        if (d.type === "animal") {
          parts.push(d.draw_time + "=" + d.animal_number + "=" + d.animal_label + "=" + (d.image_url ? d.image_url.length : 0));
        } else {
          parts.push(d.draw_time + "=" + d.triple_number + "=" + d.triple_a + "=" + d.triple_b + "=" + d.triple_c + "=" + d.zodiac_sign + "=" + d.extra_value);
        }
      }
    }
    return parts.join("|");
  }

  function renderBoard(forceRebuild) {
    // Encabezado
    var titleText = (state.appSettings && state.appSettings.board_title)
      ? trimStr(state.appSettings.board_title)
      : "Pizarra Animaltec TV";
    dom.boardTitle.innerHTML = escapeHtml(titleText);

    var clientVisible = state.activeConfig && state.activeConfig.visibleName
      ? state.activeConfig.visibleName
      : "";
    if (clientVisible) {
      dom.boardClientName.innerHTML = escapeHtml(clientVisible);
      removeClass(dom.boardClientSep, "hidden");
      removeClass(dom.boardClientName, "hidden");
    } else {
      addClass(dom.boardClientSep, "hidden");
      addClass(dom.boardClientName, "hidden");
    }

    dom.boardDate.innerHTML = escapeHtml(formatVenezuelaDate(state.serverLotteryDate));

    if (state.offline) {
      removeClass(dom.boardOfflineNote, "hidden");
    } else {
      addClass(dom.boardOfflineNote, "hidden");
    }

    // Calcular paginación
    var totalGames = state.filteredGames.length;
    var perPage = state.cardsPerPage > 0 ? state.cardsPerPage : 4;
    if (state.activeConfig && state.activeConfig.showAllCards) {
      perPage = totalGames > 0 ? totalGames : 1;
    }
    state.totalPages = totalGames > 0 ? Math.ceil(totalGames / perPage) : 1;
    if (state.currentPage >= state.totalPages) {
      state.currentPage = 0;
    }

    dom.boardPageIndicator.innerHTML = "Página " + (state.currentPage + 1) + " / " + state.totalPages;

    if (state.totalPages > 1) {
      removeClass(dom.btnPrevPage, "hidden");
      removeClass(dom.btnNextPage, "hidden");
      removeClass(dom.rotationBarWrap, "hidden");
      addClass(dom.boardStage, "board-stage-with-bar");
    } else {
      addClass(dom.btnPrevPage, "hidden");
      addClass(dom.btnNextPage, "hidden");
      addClass(dom.rotationBarWrap, "hidden");
      removeClass(dom.boardStage, "board-stage-with-bar");
    }

    // Estado vacío (por ejemplo loterias === "NINGUNA" o 0 juegos activos)
    if (totalGames === 0) {
      var emptySig = "EMPTY|" + (state.activeConfig && state.activeConfig.allowedLotteries === "NINGUNA" ? "NONE" : "ZERO");
      if (forceRebuild || state.lastBoardSignature !== emptySig) {
        state.lastBoardSignature = emptySig;
        var emptyMsg = (state.activeConfig && state.activeConfig.allowedLotteries === "NINGUNA")
          ? "Esta licencia no tiene loterías habilitadas actualmente."
          : "No hay loterías activas configuradas en el servidor.";
        dom.boardStage.className = "board-stage";
        dom.boardStage.innerHTML = ''
          + '<div class="board-empty-wrap"><div class="board-empty-cell">'
          + '<div class="board-empty-box">'
          + '<div class="board-empty-title">Sin loterías para mostrar</div>'
          + '<div class="board-empty-desc">' + escapeHtml(emptyMsg) + '</div>'
          + '</div></div></div>';
      }
      return;
    }

    var startIdx = state.currentPage * perPage;
    var endIdx = startIdx + perPage;
    if (endIdx > totalGames) {
      endIdx = totalGames;
    }
    var pageGames = state.filteredGames.slice(startIdx, endIdx);
    var layout = computeGridLayout(pageGames.length);

    var sig = buildPageSignature(pageGames, layout);
    if (!forceRebuild && sig === state.lastBoardSignature) {
      return;
    }
    state.lastBoardSignature = sig;

    var stageCls = "board-stage " + layout.density;
    if (state.totalPages > 1) {
      stageCls += " board-stage-with-bar";
    }
    dom.boardStage.className = stageCls;

    var rowHeightPct = (100 / layout.rows).toFixed(2) + "%";
    var colWidthPct = (100 / layout.cols).toFixed(2) + "%";

    var html = ['<div class="cards-grid-table">'];
    for (var r = 0; r < layout.rows; r++) {
      html.push('<div class="cards-grid-row" style="height:' + rowHeightPct + ';">');
      for (var c = 0; c < layout.cols; c++) {
        var idx = r * layout.cols + c;
        if (idx >= pageGames.length) {
          html.push('<div class="cards-grid-cell cards-grid-cell-empty" style="width:' + colWidthPct + ';"></div>');
        } else {
          html.push('<div class="cards-grid-cell" style="width:' + colWidthPct + ';">');
          html.push(renderGameCardHtml(pageGames[idx], layout.cols));
          html.push('</div>');
        }
      }
      html.push('</div>');
    }
    html.push('</div>');

    dom.boardStage.innerHTML = html.join("");
  }

  /* ========================================================================
     GESTIÓN DE TIMERS DE ROTACIÓN Y RELOJ
     ======================================================================== */

  function stopRotationTimer() {
    if (state.rotationTimer) {
      clearInterval(state.rotationTimer);
      state.rotationTimer = null;
    }
  }

  function updateRotationBar() {
    if (!dom.rotationBarFill || state.totalPages <= 1) return;
    var pct = Math.floor((state.pageElapsedSec / state.transitionSeconds) * 100);
    if (pct > 100) pct = 100;
    if (pct < 0) pct = 0;
    dom.rotationBarFill.style.width = pct + "%";
  }

  function startRotationTimer() {
    stopRotationTimer();
    state.pageElapsedSec = 0;
    updateRotationBar();

    if (state.screen !== "board" || state.totalPages <= 1) {
      return;
    }

    state.rotationTimer = setInterval(function () {
      if (state.screen !== "board" || state.modalOpen || state.totalPages <= 1) {
        return;
      }
      state.pageElapsedSec += 1;
      if (state.pageElapsedSec >= state.transitionSeconds) {
        state.pageElapsedSec = 0;
        state.currentPage = (state.currentPage + 1) % state.totalPages;
        renderBoard(false);
      }
      updateRotationBar();
    }, 1000);
  }

  function goToPageOffset(delta) {
    if (state.totalPages <= 1) return;
    state.currentPage = (state.currentPage + delta + state.totalPages) % state.totalPages;
    state.pageElapsedSec = 0;
    renderBoard(false);
    updateRotationBar();
  }

  /* ========================================================================
     CAMBIO DE PANTALLAS Y PANTALLA DE PIN
     ======================================================================== */

  function showScreen(name) {
    state.screen = name;
    addClass(dom.screenLoading, "hidden");
    addClass(dom.screenPin, "hidden");
    addClass(dom.screenBoard, "hidden");

    if (name === "loading") {
      removeClass(dom.screenLoading, "hidden");
      stopRotationTimer();
    } else if (name === "pin") {
      removeClass(dom.screenPin, "hidden");
      stopRotationTimer();
      closePinModal();
      renderPinDigits();
      updateKeypadFocus();
    } else if (name === "board") {
      removeClass(dom.screenBoard, "hidden");
      state.headerFocusIdx = -1;
      updateHeaderFocus();
      startRotationTimer();
    }
  }

  function setPinAlert(msg, isInfo) {
    if (!msg) {
      addClass(dom.pinAlert, "hidden");
      dom.pinAlert.innerHTML = "";
      return;
    }
    dom.pinAlert.className = isInfo ? "info-banner" : "error-banner";
    dom.pinAlert.innerHTML = escapeHtml(msg);
  }

  function renderPinDigits() {
    for (var i = 0; i < PIN_LENGTH; i++) {
      var slot = byId("pin-slot-" + i);
      if (!slot) continue;
      if (i < state.pinInput.length) {
        slot.innerHTML = escapeHtml(state.pinInput.charAt(i));
        slot.className = "pin-slot pin-slot-filled";
      } else if (i === state.pinInput.length) {
        slot.innerHTML = "_";
        slot.className = "pin-slot pin-slot-active";
      } else {
        slot.innerHTML = "-";
        slot.className = "pin-slot";
      }
    }
    if (dom.btnPinSubmit) {
      if (state.pinSubmitting) {
        dom.btnPinSubmit.innerHTML = "Validando...";
      } else {
        dom.btnPinSubmit.innerHTML = "Activar";
      }
    }
  }

  function updateKeypadFocus() {
    var btns = dom.pinKeypad.getElementsByTagName("button");
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var r = parseInt(b.getAttribute("data-row"), 10);
      var c = parseInt(b.getAttribute("data-col"), 10);
      if (r === state.pinRow && c === state.pinCol) {
        addClass(b, "tv-focus");
      } else {
        removeClass(b, "tv-focus");
      }
    }
  }

  function handlePinKey(keyVal) {
    if (state.pinSubmitting) return;

    if (keyVal === "CLEAR") {
      if (state.pinInput.length > 0) {
        state.pinInput = state.pinInput.substring(0, state.pinInput.length - 1);
        setPinAlert("", false);
        renderPinDigits();
      }
      return;
    }

    if (keyVal === "SUBMIT") {
      submitPinActivation();
      return;
    }

    if (/^[0-9]$/.test(keyVal)) {
      if (state.pinInput.length < PIN_LENGTH) {
        state.pinInput += keyVal;
        setPinAlert("", false);
        renderPinDigits();
        if (state.pinInput.length === PIN_LENGTH) {
          // Mover foco al botón Activar para confirmar con OK inmediatamente
          state.pinRow = 3;
          state.pinCol = 2;
          updateKeypadFocus();
        }
      }
    }
  }

  function submitPinActivation() {
    if (state.pinSubmitting) return;
    if (state.pinInput.length < PIN_LENGTH) {
      setPinAlert("Debe ingresar los " + PIN_LENGTH + " dígitos de su PIN.", false);
      return;
    }

    state.pinSubmitting = true;
    renderPinDigits();
    setPinAlert("Validando PIN con el servidor...", true);

    httpRequest(
      "POST",
      "/api/tv-sync",
      {
        pin_code: state.pinInput,
        device_id: state.deviceId
      },
      function (err, _status, data) {
        state.pinSubmitting = false;
        renderPinDigits();

        if (err && (!data || data.valid !== true)) {
          setPinAlert(err, false);
          return;
        }

        if (!data || data.valid !== true) {
          setPinAlert((data && data.error) ? data.error : "PIN inválido o licencia inactiva.", false);
          return;
        }

        // Activación exitosa: guardar PIN en localStorage + Cookie
        state.savedPin = state.pinInput;
        persistSet(COOKIE_PIN, state.savedPin);
        setPinAlert("", false);

        // Actualizar licencia en memoria inmediatamente si vino en la respuesta
        if (data.license) {
          var replaced = false;
          for (var i = 0; i < state.clientLicenses.length; i++) {
            if (state.clientLicenses[i] && state.clientLicenses[i].id === data.license.id) {
              state.clientLicenses[i] = data.license;
              replaced = true;
              break;
            }
          }
          if (!replaced) {
            state.clientLicenses.push(data.license);
          }
        }

        // Hacer sincronización completa para asegurar logos e imágenes
        performSync(true);
      }
    );
  }

  /* ========================================================================
     MODAL DE CAMBIO DE PIN (CONTROL REMOTO + CLIC)
     ======================================================================== */

  function openPinModal() {
    state.modalOpen = true;
    state.modalFocusIdx = 0;
    dom.modalDeviceId.innerHTML = escapeHtml(state.deviceId);
    removeClass(dom.pinModal, "hidden");
    updateModalFocus();
  }

  function closePinModal() {
    state.modalOpen = false;
    addClass(dom.pinModal, "hidden");
  }

  function updateModalFocus() {
    removeClass(dom.btnModalCancel, "tv-focus");
    removeClass(dom.btnModalConfirm, "tv-focus");
    if (state.modalFocusIdx === 0) {
      addClass(dom.btnModalCancel, "tv-focus");
    } else {
      addClass(dom.btnModalConfirm, "tv-focus");
    }
  }

  function confirmChangePin() {
    closePinModal();
    state.savedPin = "";
    state.pinInput = "";
    state.activeLicense = null;
    state.activeConfig = null;
    state.lastBoardSignature = "";
    persistRemove(COOKIE_PIN);
    setPinAlert("Ingrese el nuevo PIN de 6 dígitos.", true);
    showScreen("pin");
  }

  /* ========================================================================
     SINCRONIZACIÓN CON /api/tv-sync
     ======================================================================== */

  function ingestSyncPayload(data, wasFullSync) {
    if (!data || typeof data !== "object") return;

    if (typeof data.serverTimeMs === "number") {
      state.clockOffsetMs = data.serverTimeMs - new Date().getTime();
    }

    if (data.serverLotteryDate) {
      state.serverLotteryDate = String(data.serverLotteryDate).substring(0, 10);
    }

    if (typeof data.requireLicense === "boolean") {
      state.requireLicense = data.requireLicense;
    }

    if (data.appSettings && typeof data.appSettings === "object") {
      state.appSettings = data.appSettings;
      if (dom.pinBrandTitle && data.appSettings.board_title) {
        dom.pinBrandTitle.innerHTML = escapeHtml(data.appSettings.board_title);
      }
    }

    if (isArr(data.clientLicenses)) {
      state.clientLicenses = data.clientLicenses;
    }

    if (isArr(data.games)) {
      // Conservar logos previos si estamos en poll=1
      for (var i = 0; i < data.games.length; i++) {
        var g = data.games[i];
        if (!g) continue;
        if (g.logo_url) {
          state.logoCache[g.id] = g.logo_url;
          if (g.slug) state.logoCache[g.slug] = g.logo_url;
        } else if (state.logoCache[g.id]) {
          g.logo_url = state.logoCache[g.id];
        } else if (g.slug && state.logoCache[g.slug]) {
          g.logo_url = state.logoCache[g.slug];
        }
      }
      state.games = data.games;
    }

    if (isArr(data.results)) {
      state.results = data.results;
    }

    if (isArr(data.tripleResults)) {
      state.tripleResults = data.tripleResults;
    }

    // Cachear logos e imágenes de animalitos en sincronización completa
    if (data.customGameLogos && typeof data.customGameLogos === "object") {
      for (var k in data.customGameLogos) {
        if (hasOwn(data.customGameLogos, k) && data.customGameLogos[k]) {
          state.logoCache[k] = data.customGameLogos[k];
        }
      }
    }

    if (isArr(data.animalImages)) {
      for (var j = 0; j < data.animalImages.length; j++) {
        var img = data.animalImages[j];
        if (!img || !img.image_url) continue;
        var mapKey = String(img.game_id) + ":" + String(img.animal_number);
        var mapKeyPad = String(img.game_id) + ":" + formatAnimalNumber(img.animal_number);
        state.animalImageCache[mapKey] = img.image_url;
        state.animalImageCache[mapKeyPad] = img.image_url;
        if (img.animal_label) {
          state.animalImageCache[String(img.game_id) + ":label:" + trimStr(img.animal_label).toLowerCase()] = img.image_url;
        }
      }
    }

    var needAssetRefresh = false;
    if (wasFullSync) {
      state.hasLoadedAssets = true;
      state.logosVersion = data.logosVersion;
      state.imagesVersion = data.imagesVersion;
    } else if (state.hasLoadedAssets) {
      if (
        (data.logosVersion !== null && data.logosVersion !== undefined && data.logosVersion !== state.logosVersion) ||
        (data.imagesVersion !== null && data.imagesVersion !== undefined && data.imagesVersion !== state.imagesVersion)
      ) {
        needAssetRefresh = true;
      }
    }

    // Evaluar licencia continuamente
    var check = validateCurrentLicense();
    if (!check.ok) {
      var prevPin = state.savedPin;
      state.activeLicense = null;
      state.activeConfig = null;
      state.lastBoardSignature = "";
      applyThemeColors(null, state.appSettings);

      if (check.reason && prevPin) {
        // Licencia pausada, vencida o eliminada: bloquear y volver a pedir PIN
        state.savedPin = "";
        state.pinInput = "";
        persistRemove(COOKIE_PIN);
        setPinAlert(check.reason, false);
      } else if (state.screen !== "pin") {
        setPinAlert("", false);
      }
      showScreen("pin");
      return;
    }

    // Licencia válida (o no requerida)
    var prevTransition = state.transitionSeconds;
    var prevTotalPages = state.totalPages;

    state.activeLicense = check.license;
    state.activeConfig = parseLicenseClientConfig(check.license);
    state.cardsPerPage = state.activeConfig.cardsPerScreen;
    state.transitionSeconds = state.activeConfig.transitionSeconds;

    applyThemeColors(state.activeConfig.designConfig, state.appSettings);
    state.filteredGames = buildPreparedGames(state.activeConfig.allowedLotteries);

    var wasBoard = state.screen === "board";
    if (!wasBoard) {
      state.currentPage = 0;
      renderBoard(true);
      showScreen("board");
    } else {
      renderBoard(false);
      if (prevTransition !== state.transitionSeconds || prevTotalPages !== state.totalPages) {
        startRotationTimer();
      }
    }

    // Si cambiaron logos o imágenes en el admin, refrescar completo suavemente
    if (needAssetRefresh) {
      setTimeout(function () {
        performSync(true);
      }, 500);
    }
  }

  function performSync(forceFull) {
    if (state.syncInFlight) return;
    state.syncInFlight = true;

    var useFull = Boolean(forceFull || !state.hasLoadedAssets);
    var url = "/api/tv-sync" + (useFull ? "" : "?poll=1");

    httpRequest("GET", url, null, function (err, _status, data) {
      state.syncInFlight = false;

      if (err || !data) {
        state.offline = true;
        if (state.screen === "loading") {
          dom.loadingStatus.innerHTML = "No se pudo conectar con el servidor.";
          dom.loadingError.innerHTML = escapeHtml(err || "Sin respuesta del servidor.");
          removeClass(dom.loadingError, "hidden");
          removeClass(dom.loadingActions, "hidden");
        } else if (state.screen === "board") {
          removeClass(dom.boardOfflineNote, "hidden");
        }
        return;
      }

      state.offline = false;
      addClass(dom.loadingError, "hidden");
      addClass(dom.loadingActions, "hidden");

      ingestSyncPayload(data, useFull);
    });
  }

  function startSyncLoop() {
    if (state.syncTimer) {
      clearInterval(state.syncTimer);
      state.syncTimer = null;
    }
    state.syncTimer = setInterval(function () {
      if (state.screen === "board" || state.screen === "pin") {
        performSync(false);
      }
    }, POLL_INTERVAL_MS);
  }

  /* ========================================================================
     NAVEGACIÓN CON CONTROL REMOTO DE TV Y TECLADO
     ======================================================================== */

  function getVisibleHeaderButtons() {
    var all = [dom.btnPrevPage, dom.btnNextPage, dom.btnReload, dom.btnChangePin];
    var vis = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i] && (" " + all[i].className + " ").indexOf(" hidden ") === -1) {
        vis.push(all[i]);
      }
    }
    return vis;
  }

  function updateHeaderFocus() {
    var all = [dom.btnPrevPage, dom.btnNextPage, dom.btnReload, dom.btnChangePin];
    var i;
    for (i = 0; i < all.length; i++) {
      removeClass(all[i], "tv-focus");
    }
    var vis = getVisibleHeaderButtons();
    if (state.headerFocusIdx >= 0 && state.headerFocusIdx < vis.length) {
      addClass(vis[state.headerFocusIdx], "tv-focus");
    }
  }

  function executeHeaderAction(action) {
    if (action === "prev") {
      goToPageOffset(-1);
    } else if (action === "next") {
      goToPageOffset(1);
    } else if (action === "reload") {
      performSync(true);
    } else if (action === "pin") {
      openPinModal();
    }
  }

  function onKeyDown(e) {
    var evt = e || window.event;
    var code = evt.keyCode || evt.which;

    // 1. Si está abierto el modal de cambio de PIN
    if (state.modalOpen) {
      if (code === 37 || code === 38) { // Left / Up
        state.modalFocusIdx = 0;
        updateModalFocus();
        if (evt.preventDefault) evt.preventDefault();
      } else if (code === 39 || code === 40) { // Right / Down
        state.modalFocusIdx = 1;
        updateModalFocus();
        if (evt.preventDefault) evt.preventDefault();
      } else if (code === 13) { // Enter / OK
        if (state.modalFocusIdx === 1) {
          confirmChangePin();
        } else {
          closePinModal();
        }
        if (evt.preventDefault) evt.preventDefault();
      } else if (code === 27 || code === 8 || code === 461 || code === 10009) {
        closePinModal();
        if (evt.preventDefault) evt.preventDefault();
      }
      return;
    }

    // 2. Pantalla de carga con error
    if (state.screen === "loading") {
      if (code === 13) {
        dom.loadingStatus.innerHTML = "Reintentando conexión...";
        addClass(dom.loadingError, "hidden");
        addClass(dom.loadingActions, "hidden");
        performSync(true);
      }
      return;
    }

    // 3. Pantalla de activación por PIN
    if (state.screen === "pin") {
      // Teclas numéricas físicas / control remoto (0-9 y Numpad 0-9)
      if (code >= 48 && code <= 57) {
        handlePinKey(String(code - 48));
        if (evt.preventDefault) evt.preventDefault();
        return;
      }
      if (code >= 96 && code <= 105) {
        handlePinKey(String(code - 96));
        if (evt.preventDefault) evt.preventDefault();
        return;
      }
      if (code === 8 || code === 46 || code === 461 || code === 10009) {
        handlePinKey("CLEAR");
        if (evt.preventDefault) evt.preventDefault();
        return;
      }
      if (code === 37) { // Izquierda
        state.pinCol = (state.pinCol + 2) % 3;
        updateKeypadFocus();
        if (evt.preventDefault) evt.preventDefault();
        return;
      }
      if (code === 39) { // Derecha
        state.pinCol = (state.pinCol + 1) % 3;
        updateKeypadFocus();
        if (evt.preventDefault) evt.preventDefault();
        return;
      }
      if (code === 38) { // Arriba
        state.pinRow = (state.pinRow + 3) % 4;
        updateKeypadFocus();
        if (evt.preventDefault) evt.preventDefault();
        return;
      }
      if (code === 40) { // Abajo
        state.pinRow = (state.pinRow + 1) % 4;
        updateKeypadFocus();
        if (evt.preventDefault) evt.preventDefault();
        return;
      }
      if (code === 13) { // OK / Enter
        var btns = dom.pinKeypad.getElementsByTagName("button");
        for (var i = 0; i < btns.length; i++) {
          var r = parseInt(btns[i].getAttribute("data-row"), 10);
          var c = parseInt(btns[i].getAttribute("data-col"), 10);
          if (r === state.pinRow && c === state.pinCol) {
            handlePinKey(btns[i].getAttribute("data-key"));
            break;
          }
        }
        if (evt.preventDefault) evt.preventDefault();
        return;
      }
      return;
    }

    // 4. Pantalla de pizarra diaria
    if (state.screen === "board") {
      var visBtns = getVisibleHeaderButtons();

      if (code === 38) { // Arriba: enfocar controles del encabezado
        if (visBtns.length > 0) {
          state.headerFocusIdx = visBtns.length - 1;
          updateHeaderFocus();
        }
        if (evt.preventDefault) evt.preventDefault();
        return;
      }
      if (code === 40 || code === 27) { // Abajo / Esc: quitar foco del encabezado
        state.headerFocusIdx = -1;
        updateHeaderFocus();
        if (evt.preventDefault) evt.preventDefault();
        return;
      }
      if (code === 37) { // Izquierda
        if (state.headerFocusIdx >= 0 && visBtns.length > 0) {
          state.headerFocusIdx = (state.headerFocusIdx - 1 + visBtns.length) % visBtns.length;
          updateHeaderFocus();
        } else {
          goToPageOffset(-1);
        }
        if (evt.preventDefault) evt.preventDefault();
        return;
      }
      if (code === 39) { // Derecha
        if (state.headerFocusIdx >= 0 && visBtns.length > 0) {
          state.headerFocusIdx = (state.headerFocusIdx + 1) % visBtns.length;
          updateHeaderFocus();
        } else {
          goToPageOffset(1);
        }
        if (evt.preventDefault) evt.preventDefault();
        return;
      }
      if (code === 13) { // Enter / OK
        if (state.headerFocusIdx >= 0 && state.headerFocusIdx < visBtns.length) {
          executeHeaderAction(visBtns[state.headerFocusIdx].getAttribute("data-action"));
        } else if (state.totalPages > 1) {
          goToPageOffset(1);
        }
        if (evt.preventDefault) evt.preventDefault();
        return;
      }
      if (code === 82 || code === 403) { // R o botón rojo TV -> Recargar
        performSync(true);
        return;
      }
      if (code === 80 || code === 406) { // P o botón azul TV -> Cambiar PIN
        openPinModal();
        return;
      }
    }
  }

  /* ========================================================================
     EVENTOS DELEGADOS (UNA SOLA VEZ AL INICIAR, SIN FUGAS)
     ======================================================================== */

  function bindEvents() {
    if (document.addEventListener) {
      document.addEventListener("keydown", onKeyDown, false);
    } else if (document.attachEvent) {
      document.attachEvent("onkeydown", onKeyDown);
    }

    dom.btnRetryBoot.onclick = function () {
      dom.loadingStatus.innerHTML = "Reintentando conexión...";
      addClass(dom.loadingError, "hidden");
      addClass(dom.loadingActions, "hidden");
      performSync(true);
    };

    dom.pinKeypad.onclick = function (e) {
      var evt = e || window.event;
      var target = evt.target || evt.srcElement;
      while (target && target !== dom.pinKeypad && target.tagName !== "BUTTON") {
        target = target.parentNode;
      }
      if (target && target.tagName === "BUTTON") {
        var r = parseInt(target.getAttribute("data-row"), 10);
        var c = parseInt(target.getAttribute("data-col"), 10);
        if (!isNaN(r) && !isNaN(c)) {
          state.pinRow = r;
          state.pinCol = c;
          updateKeypadFocus();
        }
        handlePinKey(target.getAttribute("data-key"));
      }
    };

    dom.headerControls.onclick = function (e) {
      var evt = e || window.event;
      var target = evt.target || evt.srcElement;
      while (target && target !== dom.headerControls && target.tagName !== "BUTTON") {
        target = target.parentNode;
      }
      if (target && target.tagName === "BUTTON") {
        executeHeaderAction(target.getAttribute("data-action"));
      }
    };

    dom.modalActions.onclick = function (e) {
      var evt = e || window.event;
      var target = evt.target || evt.srcElement;
      while (target && target !== dom.modalActions && target.tagName !== "BUTTON") {
        target = target.parentNode;
      }
      if (target && target.tagName === "BUTTON") {
        var act = target.getAttribute("data-modal");
        if (act === "confirm") {
          confirmChangePin();
        } else {
          closePinModal();
        }
      }
    };
  }

  /* ========================================================================
     ARRANQUE DE LA APLICACIÓN
     ======================================================================== */

  function init() {
    dom.screenLoading = byId("screen-loading");
    dom.loadingStatus = byId("loading-status");
    dom.loadingError = byId("loading-error");
    dom.loadingActions = byId("loading-actions");
    dom.btnRetryBoot = byId("btn-retry-boot");

    dom.screenPin = byId("screen-pin");
    dom.pinBrandTitle = byId("pin-brand-title");
    dom.pinAlert = byId("pin-alert");
    dom.pinKeypad = byId("pin-keypad");
    dom.btnPinSubmit = byId("btn-pin-submit");
    dom.pinDeviceId = byId("pin-device-id");

    dom.screenBoard = byId("screen-board");
    dom.boardTitle = byId("board-title");
    dom.boardClientSep = byId("board-client-sep");
    dom.boardClientName = byId("board-client-name");
    dom.boardDate = byId("board-date");
    dom.boardClock = byId("board-clock");
    dom.boardOfflineNote = byId("board-offline-note");
    dom.boardPageIndicator = byId("board-page-indicator");
    dom.headerControls = byId("header-controls");
    dom.btnPrevPage = byId("btn-prev-page");
    dom.btnNextPage = byId("btn-next-page");
    dom.btnReload = byId("btn-reload");
    dom.btnChangePin = byId("btn-change-pin");
    dom.rotationBarWrap = byId("rotation-bar-wrap");
    dom.rotationBarFill = byId("rotation-bar-fill");
    dom.boardStage = byId("board-stage");

    dom.pinModal = byId("pin-modal");
    dom.modalDeviceId = byId("modal-device-id");
    dom.modalActions = byId("modal-actions");
    dom.btnModalCancel = byId("btn-modal-cancel");
    dom.btnModalConfirm = byId("btn-modal-confirm");

    state.deviceId = ensureDeviceId();
    state.savedPin = persistGet(COOKIE_PIN);

    dom.pinDeviceId.innerHTML = escapeHtml(state.deviceId);
    dom.modalDeviceId.innerHTML = escapeHtml(state.deviceId);

    bindEvents();
    updateVenezuelaClock();

    if (state.clockTimer) {
      clearInterval(state.clockTimer);
    }
    state.clockTimer = setInterval(updateVenezuelaClock, 1000);

    showScreen("loading");
    performSync(true);
    startSyncLoop();
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    init();
  } else if (document.addEventListener) {
    document.addEventListener("DOMContentLoaded", init, false);
  } else if (window.attachEvent) {
    window.attachEvent("onload", init);
  }
})();
