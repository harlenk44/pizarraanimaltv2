const UPSTREAM_BASE = 'https://pizarraanimal.servhm.com';
const UPSTREAM_SYNC_URL = UPSTREAM_BASE + '/api/public/results/sync';

function corsHeaders(extra) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept'
  };
  if (extra) {
    for (const k in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, k)) {
        headers[k] = extra[k];
      }
    }
  }
  return headers;
}

function normalizeImageUrl(rawUrl, useImageProxy) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  if (trimmed.indexOf('data:') === 0) {
    return trimmed;
  }
  let absoluteUrl = trimmed;
  if (trimmed.indexOf('//') === 0) {
    absoluteUrl = 'https:' + trimmed;
  } else if (trimmed.charAt(0) === '/') {
    absoluteUrl = UPSTREAM_BASE + trimmed;
  } else if (trimmed.indexOf('http://') !== 0 && trimmed.indexOf('https://') !== 0) {
    absoluteUrl = UPSTREAM_BASE + '/' + trimmed;
  }
  if (useImageProxy) {
    return '/api/tv-image?url=' + encodeURIComponent(absoluteUrl);
  }
  return absoluteUrl;
}

function cleanSyncPayload(raw, isPoll, useImageProxy) {
  const today = raw && raw.serverLotteryDate ? String(raw.serverLotteryDate).slice(0, 10) : '';

  const rawGames = Array.isArray(raw && raw.games) ? raw.games : [];
  const games = [];
  for (let i = 0; i < rawGames.length; i++) {
    const g = rawGames[i];
    if (!g) continue;
    const item = {
      id: g.id || g.slug || '',
      slug: g.slug || g.id || '',
      name: g.name || g.slug || '',
      is_active: g.is_active !== false,
      display_order: typeof g.display_order === 'number' ? g.display_order : (parseInt(g.display_order, 10) || i + 1),
      category: g.category || 'animalitos'
    };
    if (!isPoll) {
      item.logo_url = normalizeImageUrl(g.logo_url || '', useImageProxy);
    } else if (g.logo_url && typeof g.logo_url === 'string' && g.logo_url.indexOf('data:') !== 0) {
      item.logo_url = normalizeImageUrl(g.logo_url, useImageProxy);
    }
    games.push(item);
  }

  const rawResults = Array.isArray(raw && raw.results) ? raw.results : [];
  const results = [];
  for (let i = 0; i < rawResults.length; i++) {
    const r = rawResults[i];
    if (!r) continue;
    const dDate = r.draw_date ? String(r.draw_date).slice(0, 10) : '';
    if (today && dDate && dDate !== today) continue;
    results.push({
      id: r.id || '',
      game_id: r.game_id || '',
      game_slug: r.game_slug || '',
      draw_date: dDate || today,
      draw_time: r.draw_time || '',
      animal_number: r.animal_number !== undefined && r.animal_number !== null ? r.animal_number : '',
      animal_label: r.animal_label || r.animal_name || '',
      animal_image_url: normalizeImageUrl(r.animal_image_url || '', useImageProxy)
    });
  }

  const rawTriples = Array.isArray(raw && raw.tripleResults) ? raw.tripleResults : [];
  const tripleResults = [];
  for (let i = 0; i < rawTriples.length; i++) {
    const t = rawTriples[i];
    if (!t) continue;
    const tDate = t.draw_date ? String(t.draw_date).slice(0, 10) : '';
    if (today && tDate && tDate !== today) continue;
    tripleResults.push({
      id: t.id || '',
      game_id: t.game_id || t.game_slug || '',
      game_slug: t.game_slug || t.game_id || '',
      draw_date: tDate || today,
      draw_time: t.draw_time || '',
      triple_number: t.triple_number || '',
      extra_value: t.extra_value || '',
      triple_a: t.triple_a || '',
      triple_b: t.triple_b || '',
      triple_c: t.triple_c || '',
      zodiac_sign: t.zodiac_sign || t.zodiac || ''
    });
  }

  let clientLicenses = null;
  if (Array.isArray(raw && raw.clientLicenses)) {
    clientLicenses = [];
    for (let i = 0; i < raw.clientLicenses.length; i++) {
      const lic = raw.clientLicenses[i];
      if (!lic) continue;
      clientLicenses.push({
        id: lic.id || '',
        client_name: lic.client_name || '',
        pin_code: lic.pin_code !== undefined && lic.pin_code !== null ? String(lic.pin_code) : '',
        status: lic.status || 'active',
        expires_at: lic.expires_at || null,
        max_devices: typeof lic.max_devices === 'number' ? lic.max_devices : (parseInt(lic.max_devices, 10) || 1),
        bound_device_ids: Array.isArray(lic.bound_device_ids) ? lic.bound_device_ids : []
      });
    }
  }

  const payload = {
    status: (raw && raw.status) || 'ok',
    poll: isPoll,
    serverTimeMs: Date.now(),
    serverLotteryDate: today,
    logosVersion: raw && raw.logosVersion !== undefined ? raw.logosVersion : null,
    gamesVersion: raw && raw.gamesVersion !== undefined ? raw.gamesVersion : null,
    imagesVersion: raw && raw.imagesVersion !== undefined ? raw.imagesVersion : null,
    settingsVersion: raw && raw.settingsVersion !== undefined ? raw.settingsVersion : null,
    requireLicense: raw && raw.requireLicense !== undefined ? Boolean(raw.requireLicense) : true,
    appSettings: (raw && raw.appSettings) || {},
    clientLicenses: clientLicenses,
    games: games,
    results: results,
    tripleResults: tripleResults
  };

  if (!isPoll) {
    // Include animal images only on full sync to keep 12s poll tiny in RAM
    const rawImages = Array.isArray(raw && raw.animalImages) ? raw.animalImages : [];
    const animalImages = [];
    for (let i = 0; i < rawImages.length; i++) {
      const img = rawImages[i];
      if (!img || !img.image_url) continue;
      animalImages.push({
        game_id: img.game_id || '',
        animal_number: img.animal_number !== undefined && img.animal_number !== null ? img.animal_number : '',
        animal_label: img.animal_label || img.animal_name || '',
        image_url: normalizeImageUrl(img.image_url, useImageProxy)
      });
    }
    payload.animalImages = animalImages;

    // Deduplicate customGameLogos: map each unique key only when not already identical to game.logo_url
    const rawLogos = raw && raw.customGameLogos && typeof raw.customGameLogos === 'object' ? raw.customGameLogos : {};
    const gameLogoById = {};
    const gameIdBySlug = {};
    for (let i = 0; i < games.length; i++) {
      gameLogoById[games[i].id] = games[i].logo_url || '';
      gameIdBySlug[games[i].slug] = games[i].id;
    }

    const customGameLogos = {};
    const logoKeys = Object.keys(rawLogos);
    for (let i = 0; i < logoKeys.length; i++) {
      const k = logoKeys[i];
      const val = normalizeImageUrl(rawLogos[k], useImageProxy);
      if (!val) continue;
      // Skip duplicate base64 entries already attached to game.logo_url
      if (gameLogoById[k] && gameLogoById[k] === val) continue;
      if (gameIdBySlug[k] && gameLogoById[gameIdBySlug[k]] === val) continue;
      // Only keep short URLs or canonical id/slug keys (skip lowercased display-name duplicates with giant data URIs)
      if (val.indexOf('data:') === 0 && k.indexOf(' ') !== -1) continue;
      customGameLogos[k] = val;
    }
    payload.customGameLogos = customGameLogos;
  }

  return payload;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestGet(context) {
  try {
    const reqUrl = new URL(context.request.url);
    const isPoll = reqUrl.searchParams.get('poll') === '1';
    const useImageProxy = reqUrl.searchParams.get('proxyImages') !== '0';
    // Consultamos el endpoint completo en el servidor (upstream ?poll=1 devuelve clientLicenses: null)
    // y recortamos los base64 pesados aquí antes de responder al Smart TV (~36 KB).
    const upstreamUrl = UPSTREAM_SYNC_URL + '?_t=' + Date.now();

    const upstreamRes = await fetch(upstreamUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'no-cache',
        'User-Agent': 'PizarraAnimaltecTV-Proxy/1.0'
      }
    });

    if (!upstreamRes.ok) {
      return new Response(
        JSON.stringify({
          error: 'Error al conectar con el servidor de resultados (HTTP ' + upstreamRes.status + ')'
        }),
        { status: 502, headers: corsHeaders() }
      );
    }

    const rawData = await upstreamRes.json();
    const cleaned = cleanSyncPayload(rawData, isPoll, useImageProxy);

    return new Response(JSON.stringify(cleaned), {
      status: 200,
      headers: corsHeaders()
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: 'No se pudo sincronizar con pizarraanimal.servhm.com',
        detail: err && err.message ? err.message : 'Unknown error'
      }),
      { status: 502, headers: corsHeaders() }
    );
  }
}

export async function onRequestPost(context) {
  try {
    let body = null;
    try {
      body = await context.request.json();
    } catch (_e) {
      return new Response(
        JSON.stringify({ valid: false, license: null, error: 'Solicitud JSON inválida' }),
        { status: 400, headers: corsHeaders() }
      );
    }

    const pinCode = body && body.pin_code !== undefined && body.pin_code !== null
      ? String(body.pin_code).replace(/\s+/g, '')
      : '';
    const deviceId = body && body.device_id !== undefined && body.device_id !== null
      ? String(body.device_id).trim()
      : '';

    if (!pinCode || pinCode.length < 4) {
      return new Response(
        JSON.stringify({ valid: false, license: null, error: 'Ingrese un PIN válido de 6 dígitos' }),
        { status: 400, headers: corsHeaders() }
      );
    }

    if (!deviceId) {
      return new Response(
        JSON.stringify({ valid: false, license: null, error: 'Falta identificador de dispositivo' }),
        { status: 400, headers: corsHeaders() }
      );
    }

    const upstreamRes = await fetch(UPSTREAM_SYNC_URL, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Cache-Control': 'no-cache',
        'User-Agent': 'PizarraAnimaltecTV-Proxy/1.0'
      },
      body: JSON.stringify({
        licenseAction: {
          type: 'activate_pin',
          pin_code: pinCode,
          device_id: deviceId
        }
      })
    });

    const text = await upstreamRes.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch (_e) {
      parsed = null;
    }

    if (!parsed || typeof parsed !== 'object') {
      return new Response(
        JSON.stringify({
          valid: false,
          license: null,
          error: 'Respuesta inesperada del servidor de licencias (HTTP ' + upstreamRes.status + ')'
        }),
        { status: upstreamRes.ok ? 200 : 502, headers: corsHeaders() }
      );
    }

    // La API de pizarraanimal devuelve el resultado dentro de parsed.licenseActivation
    const act = (parsed.licenseActivation && typeof parsed.licenseActivation === 'object')
      ? parsed.licenseActivation
      : parsed;

    const isValid = Boolean(
      act.valid === true ||
      parsed.valid === true ||
      (act.ok === true && act.license) ||
      (parsed.ok === true && parsed.license)
    );

    let license = act.license || parsed.license || null;
    if (!license && isValid && Array.isArray(parsed.clientLicenses)) {
      for (let i = 0; i < parsed.clientLicenses.length; i++) {
        const item = parsed.clientLicenses[i];
        if (item && String(item.pin_code || '').trim() === pinCode) {
          license = item;
          break;
        }
      }
    }

    const errorMsg = isValid
      ? null
      : (act.reason || act.error || parsed.reason || parsed.error || 'PIN inválido o licencia no disponible');

    return new Response(
      JSON.stringify({
        valid: isValid,
        license: license,
        error: errorMsg
      }),
      { status: 200, headers: corsHeaders() }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        valid: false,
        license: null,
        error: 'Error de red al validar el PIN: ' + (err && err.message ? err.message : 'desconocido')
      }),
      { status: 502, headers: corsHeaders() }
    );
  }
}
