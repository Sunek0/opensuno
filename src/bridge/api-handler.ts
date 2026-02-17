/**
 * REST API handler — maps local endpoints to Suno API calls
 * routed through the Chrome extension via WebSocket.
 */

import type { WebSocketManager } from './ws-manager';

const SUNO_API_BASE = 'https://studio-api.prod.suno.com';

/** Route an incoming HTTP request to the extension */
export async function handleApiRequest(
  req: Request,
  wsManager: WebSocketManager
): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  try {
    // Status endpoint
    if (path === '/api/status') {
      return json(wsManager.getStatus());
    }

    // Diagnostic: test token retrieval
    if (path === '/api/test') {
      if (!wsManager.isConnected) {
        return json({ error: 'No extension connected' }, 503);
      }
      console.log('[API] Testing token retrieval...');
      try {
        const tokenResp = await wsManager.sendRequest('get_token', {
          url: '', method: 'GET',
        });
        console.log('[API] Token response:', JSON.stringify(tokenResp).slice(0, 200));
        return json({ success: true, hasToken: !!tokenResp.result?.data?.token });
      } catch (err: any) {
        console.log('[API] Token test failed:', err.message);
        return json({ error: err.message }, 500);
      }
    }

    // GET /api/captcha_check — test if captcha is required
    if (method === 'GET' && path === '/api/captcha_check') {
      if (!wsManager.isConnected) return json({ error: 'No extension connected' }, 503);
      const resp = await wsManager.sendRequest('api_call', {
        url: '/api/c/check',
        method: 'POST',
        body: { ctype: 'generation' },
      });
      if (resp.error) return json({ error: resp.error.message }, 500);
      return json(resp.result!.data);
    }

    if (!wsManager.isConnected) {
      return json(
        { error: 'No extension connected. Open suno.com with the extension installed.' },
        503
      );
    }

    // POST /api/generate — simple generation
    if (method === 'POST' && path === '/api/generate') {
      const body = await req.json();
      return await proxyGenerate(wsManager, body, false);
    }

    // POST /api/custom_generate — custom generation with lyrics/tags/title
    if (method === 'POST' && path === '/api/custom_generate') {
      const body = await req.json();
      return await proxyGenerate(wsManager, body, true);
    }

    // POST /api/generate_lyrics
    if (method === 'POST' && path === '/api/generate_lyrics') {
      const body = await req.json();
      return await proxyLyrics(wsManager, body);
    }

    // GET /api/get — get audio feed / status
    if (method === 'GET' && path === '/api/get') {
      const ids = url.searchParams.get('ids');
      const page = url.searchParams.get('page');
      let sunoUrl = '/api/feed/v2';
      const params = new URLSearchParams();
      if (ids) params.set('ids', ids);
      if (page) params.set('page', page);
      const qs = params.toString();
      if (qs) sunoUrl += `?${qs}`;

      const resp = await wsManager.sendRequest('api_call', {
        url: sunoUrl,
        method: 'GET',
      });
      if (resp.error) return json({ error: resp.error.message }, 500);
      return json(resp.result!.data);
    }

    // GET /api/get_limit — billing info
    if (method === 'GET' && path === '/api/get_limit') {
      console.log('[API] get_limit: sending request to extension...');
      const resp = await wsManager.sendRequest('api_call', {
        url: '/api/billing/info/',
        method: 'GET',
      });
      console.log('[API] get_limit: got response', JSON.stringify(resp).slice(0, 300));
      if (resp.error) return json({ error: resp.error.message }, 500);
      return json(resp.result!.data);
    }

    // POST /api/extend_audio
    if (method === 'POST' && path === '/api/extend_audio') {
      const body = await req.json();
      return await proxyExtend(wsManager, body);
    }

    // POST /api/generate_stems
    if (method === 'POST' && path === '/api/generate_stems') {
      const body = await req.json();
      const songId = body.audio_id || body.song_id;
      if (!songId) return json({ error: 'audio_id is required' }, 400);

      const resp = await wsManager.sendRequest('api_call', {
        url: `/api/edit/stems/${songId}`,
        method: 'POST',
        body: {},
      });
      if (resp.error) return json({ error: resp.error.message }, 500);
      return json(resp.result!.data);
    }

    // POST /api/concat
    if (method === 'POST' && path === '/api/concat') {
      const body = await req.json();
      const resp = await wsManager.sendRequest('api_call', {
        url: '/api/generate/concat/v2/',
        method: 'POST',
        body: { clip_id: body.clip_id },
      });
      if (resp.error) return json({ error: resp.error.message }, 500);
      return json(resp.result!.data);
    }

    return json({ error: 'Not found' }, 404);
  } catch (err: any) {
    console.error('[API] Error:', err.message);
    return json({ error: err.message }, 500);
  }
}

/** Check if captcha is required, return null if not */
async function checkCaptcha(wsManager: WebSocketManager): Promise<boolean> {
  try {
    const resp = await wsManager.sendRequest('api_call', {
      url: '/api/c/check',
      method: 'POST',
      body: { ctype: 'generation' },
    });
    if (resp.result?.data?.required !== undefined) {
      return resp.result.data.required;
    }
    return false;
  } catch {
    return false;
  }
}

/** Get a captcha token from the page script's hCaptcha */
async function getCaptchaToken(wsManager: WebSocketManager): Promise<string | null> {
  try {
    const resp = await wsManager.sendRequest('get_captcha', {
      url: '', method: 'GET',
    }, 15_000);
    return resp.result?.data?.captchaToken || null;
  } catch {
    return null;
  }
}

/** Build and proxy a generation request */
async function proxyGenerate(
  wsManager: WebSocketManager,
  body: any,
  isCustom: boolean
): Promise<Response> {
  const payload = buildGeneratePayload(body, isCustom);

  // Check captcha and get token if needed
  const captchaRequired = await checkCaptcha(wsManager);
  if (captchaRequired) {
    console.log('[API] Captcha required, requesting token from page...');
    const captchaToken = await getCaptchaToken(wsManager);
    if (captchaToken) {
      payload.token = captchaToken;
      console.log('[API] Got captcha token');
    } else {
      console.log('[API] No captcha token available');
    }
  }

  const resp = await wsManager.sendRequest('api_call', {
    url: '/api/generate/v2/',
    method: 'POST',
    body: payload,
  });

  if (resp.error) return json({ error: resp.error.message }, 500);

  const data = resp.result!.data;

  // If wait_audio was requested, poll for completion
  if (body.wait_audio && data.clips) {
    const clipIds = data.clips.map((c: any) => c.id);
    return json(await pollForCompletion(wsManager, clipIds));
  }

  // Return normalized response
  if (data.clips) {
    return json(data.clips.map(normalizeClip));
  }
  return json(data);
}

/** Build the Suno API payload matching SunoApi.ts format */
function buildGeneratePayload(body: any, isCustom: boolean) {
  const payload: any = {
    make_instrumental: body.make_instrumental || false,
    mv: body.model || body.mv || 'chirp-crow',
    prompt: '',
    generation_type: 'TEXT',
    metadata: {
      web_client_pathname: '/create',
      is_max_mode: false,
      is_mumble: false,
      create_mode: isCustom ? 'custom' : 'simple',
      create_session_token: crypto.randomUUID(),
      disable_volume_normalization: false,
      can_control_sliders: ['weirdness_constraint', 'style_weight'],
    },
    user_uploaded_images_b64: null,
    override_fields: [],
    cover_clip_id: null,
    cover_start_s: null,
    cover_end_s: null,
    persona_id: null,
    artist_clip_id: null,
    artist_start_s: null,
    artist_end_s: null,
    continued_aligned_prompt: null,
    transaction_uuid: crypto.randomUUID(),
  };

  if (isCustom) {
    payload.tags = body.tags || '';
    payload.title = body.title || '';
    payload.negative_tags = body.negative_tags || '';
    payload.prompt = body.prompt || '';
  } else {
    payload.gpt_description_prompt = body.prompt || '';
  }

  return payload;
}

/** Build and proxy an extend request */
async function proxyExtend(wsManager: WebSocketManager, body: any): Promise<Response> {
  const payload = buildGeneratePayload(
    { ...body, make_instrumental: false },
    true
  );
  payload.task = 'extend';
  payload.continue_clip_id = body.audio_id;
  payload.continue_at = body.continue_at;

  // Check captcha and get token if needed
  const captchaRequired = await checkCaptcha(wsManager);
  if (captchaRequired) {
    console.log('[API] Captcha required for extend, requesting token from page...');
    const captchaToken = await getCaptchaToken(wsManager);
    if (captchaToken) {
      payload.token = captchaToken;
      console.log('[API] Got captcha token for extend');
    } else {
      console.log('[API] No captcha token available for extend');
    }
  }

  const resp = await wsManager.sendRequest('api_call', {
    url: '/api/generate/v2/',
    method: 'POST',
    body: payload,
  });

  if (resp.error) return json({ error: resp.error.message }, 500);

  const data = resp.result!.data;
  if (body.wait_audio && data.clips) {
    const clipIds = data.clips.map((c: any) => c.id);
    return json(await pollForCompletion(wsManager, clipIds));
  }
  if (data.clips) {
    return json(data.clips.map(normalizeClip));
  }
  return json(data);
}

/** Proxy lyrics generation with polling */
async function proxyLyrics(wsManager: WebSocketManager, body: any): Promise<Response> {
  const initResp = await wsManager.sendRequest('api_call', {
    url: '/api/generate/lyrics/',
    method: 'POST',
    body: { prompt: body.prompt },
  });

  if (initResp.error) return json({ error: initResp.error.message }, 500);

  const generateId = initResp.result!.data.id;

  // Poll for completion
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));

    const pollResp = await wsManager.sendRequest('api_call', {
      url: `/api/generate/lyrics/${generateId}`,
      method: 'GET',
    });

    if (pollResp.error) continue;
    if (pollResp.result!.data.status === 'complete') {
      return json(pollResp.result!.data);
    }
  }

  return json({ error: 'Lyrics generation timed out' }, 504);
}

/** Poll audio clips until complete or timeout */
async function pollForCompletion(
  wsManager: WebSocketManager,
  clipIds: string[],
  timeoutMs = 100_000
): Promise<any[]> {
  const start = Date.now();
  await new Promise((r) => setTimeout(r, 5000));

  while (Date.now() - start < timeoutMs) {
    const resp = await wsManager.sendRequest('api_call', {
      url: `/api/feed/v2?ids=${clipIds.join(',')}`,
      method: 'GET',
    });

    if (resp.result?.data?.clips) {
      const clips = resp.result.data.clips;
      const allDone = clips.every(
        (c: any) => c.status === 'streaming' || c.status === 'complete' || c.status === 'error'
      );
      if (allDone) return clips.map(normalizeClip);
    }

    await new Promise((r) => setTimeout(r, 4000));
  }

  return [];
}

/** Normalize a clip to AudioInfo format */
function normalizeClip(clip: any) {
  return {
    id: clip.id,
    title: clip.title,
    image_url: clip.image_url,
    lyric: clip.metadata?.prompt || '',
    audio_url: clip.audio_url,
    video_url: clip.video_url,
    created_at: clip.created_at,
    model_name: clip.model_name,
    status: clip.status,
    gpt_description_prompt: clip.metadata?.gpt_description_prompt,
    prompt: clip.metadata?.prompt,
    type: clip.metadata?.type,
    tags: clip.metadata?.tags,
    negative_tags: clip.metadata?.negative_tags,
    duration: clip.metadata?.duration,
    error_message: clip.metadata?.error_message,
  };
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
