const UPSTREAM_BASE = 'https://pizarraanimal.servhm.com';

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS'
    }
  });
}

export async function onRequestGet(context) {
  try {
    const reqUrl = new URL(context.request.url);
    let target = reqUrl.searchParams.get('url') || '';
    target = target.trim();

    if (!target) {
      return new Response('Missing url parameter', { status: 400 });
    }

    if (target.charAt(0) === '/') {
      target = UPSTREAM_BASE + target;
    }

    let parsed;
    try {
      parsed = new URL(target);
    } catch (_e) {
      return new Response('Invalid url parameter', { status: 400 });
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return new Response('Unsupported protocol', { status: 400 });
    }

    // Block localhost / private IP targets
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host.indexOf('192.168.') === 0 ||
      host.indexOf('10.') === 0 ||
      host.indexOf('169.254.') === 0
    ) {
      return new Response('Forbidden host', { status: 403 });
    }

    const upstreamRes = await fetch(parsed.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'image/*,*/*;q=0.8',
        'User-Agent': 'PizarraAnimaltecTV-ImageProxy/1.0'
      }
    });

    if (!upstreamRes.ok) {
      return new Response('Image upstream error', { status: upstreamRes.status });
    }

    const contentType = upstreamRes.headers.get('content-type') || 'image/png';
    const buffer = await upstreamRes.arrayBuffer();

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (_err) {
    return new Response('Image proxy failed', { status: 502 });
  }
}
