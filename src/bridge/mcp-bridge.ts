/**
 * MCP server that routes through the bridge WebSocket to the Chrome extension,
 * instead of calling SunoApi directly.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { WebSocketManager } from './ws-manager';

const SUNO_MODELS = {
  V3_5: 'chirp-v3-5',
  V4: 'chirp-v4',
  V4_5_PLUS: 'chirp-bluejay',
  V4_5_PRO: 'chirp-auk',
  V5: 'chirp-crow',
} as const;

const DEFAULT_MODEL = SUNO_MODELS.V5;

/** Check if captcha is required */
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

/** Check captcha and add token to payload if needed */
async function addCaptchaIfNeeded(wsManager: WebSocketManager, payload: any): Promise<void> {
  const captchaRequired = await checkCaptcha(wsManager);
  if (captchaRequired) {
    console.log('[MCP] Captcha required, requesting token from page...');
    const captchaToken = await getCaptchaToken(wsManager);
    if (captchaToken) {
      payload.token = captchaToken;
      console.log('[MCP] Got captcha token');
    } else {
      console.log('[MCP] No captcha token available');
    }
  }
}

export function createBridgeMcpServer(wsManager: WebSocketManager) {
  const server = new McpServer(
    { name: 'suno-api-bridge', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  // --- get_credits ---
  server.tool(
    'get_credits',
    'Get the remaining credits and usage limits for the Suno account',
    {},
    async () => {
      try {
        const resp = await wsManager.sendRequest('api_call', {
          url: '/api/billing/info/',
          method: 'GET',
        });
        if (resp.error) throw new Error(resp.error.message);
        const data = resp.result!.data;
        const credits = {
          credits_left: data.total_credits_left,
          period: data.period,
          monthly_limit: data.monthly_limit,
          monthly_usage: data.monthly_usage,
        };
        return { content: [{ type: 'text' as const, text: JSON.stringify(credits, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // --- generate ---
  server.tool(
    'generate',
    'Generate music from a text prompt using Suno AI',
    {
      prompt: z.string().describe('Text description of the music to generate'),
      make_instrumental: z.boolean().optional().default(false).describe('Generate instrumental only'),
      model: z.string().optional().describe(`Model version. Options: ${Object.values(SUNO_MODELS).join(', ')}. Default: ${DEFAULT_MODEL}`),
      wait_audio: z.boolean().optional().default(false).describe('Wait for generation to complete'),
    },
    async ({ prompt, make_instrumental, model, wait_audio }) => {
      try {
        const payload = buildPayload({ prompt, make_instrumental, model }, false);
        await addCaptchaIfNeeded(wsManager, payload);
        const resp = await wsManager.sendRequest('api_call', {
          url: '/api/generate/v2/',
          method: 'POST',
          body: payload,
        });
        if (resp.error) throw new Error(resp.error.message);
        let result = resp.result!.data;

        if (wait_audio && result.clips) {
          result = await pollClips(wsManager, result.clips.map((c: any) => c.id));
        } else if (result.clips) {
          result = result.clips.map(normalizeClip);
        }

        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // --- custom_generate ---
  server.tool(
    'custom_generate',
    'Generate music with fine-grained control over lyrics, style tags, and title',
    {
      prompt: z.string().describe('Lyrics or detailed description'),
      tags: z.string().describe('Style tags, e.g. "pop, upbeat"'),
      title: z.string().describe('Title for the song'),
      make_instrumental: z.boolean().optional().default(false).describe('Generate instrumental only'),
      model: z.string().optional().describe(`Model version. Default: ${DEFAULT_MODEL}`),
      wait_audio: z.boolean().optional().default(false).describe('Wait for generation to complete'),
      negative_tags: z.string().optional().describe('Styles to avoid'),
    },
    async ({ prompt, tags, title, make_instrumental, model, wait_audio, negative_tags }) => {
      try {
        const payload = buildPayload({ prompt, tags, title, make_instrumental, model, negative_tags }, true);
        await addCaptchaIfNeeded(wsManager, payload);
        const resp = await wsManager.sendRequest('api_call', {
          url: '/api/generate/v2/',
          method: 'POST',
          body: payload,
        });
        if (resp.error) throw new Error(resp.error.message);
        let result = resp.result!.data;

        if (wait_audio && result.clips) {
          result = await pollClips(wsManager, result.clips.map((c: any) => c.id));
        } else if (result.clips) {
          result = result.clips.map(normalizeClip);
        }

        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // --- generate_lyrics ---
  server.tool(
    'generate_lyrics',
    'Generate song lyrics from a topic or theme',
    {
      prompt: z.string().describe('Topic or theme for the lyrics'),
    },
    async ({ prompt }) => {
      try {
        const initResp = await wsManager.sendRequest('api_call', {
          url: '/api/generate/lyrics/',
          method: 'POST',
          body: { prompt },
        });
        if (initResp.error) throw new Error(initResp.error.message);
        const generateId = initResp.result!.data.id;

        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const pollResp = await wsManager.sendRequest('api_call', {
            url: `/api/generate/lyrics/${generateId}`,
            method: 'GET',
          });
          if (pollResp.result?.data?.status === 'complete') {
            return { content: [{ type: 'text' as const, text: JSON.stringify(pollResp.result.data, null, 2) }] };
          }
        }
        throw new Error('Lyrics generation timed out');
      } catch (error: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // --- get_audio ---
  server.tool(
    'get_audio',
    'Get status and details for audio clips by their IDs, or list recent generations',
    {
      ids: z.string().optional().describe('Comma-separated audio clip IDs'),
      page: z.string().optional().describe('Page number for pagination'),
    },
    async ({ ids, page }) => {
      try {
        let url = '/api/feed/v2';
        const params = new URLSearchParams();
        if (ids) params.set('ids', ids);
        if (page) params.set('page', page);
        const qs = params.toString();
        if (qs) url += `?${qs}`;

        const resp = await wsManager.sendRequest('api_call', { url, method: 'GET' });
        if (resp.error) throw new Error(resp.error.message);
        const clips = resp.result!.data.clips?.map(normalizeClip) || resp.result!.data;
        return { content: [{ type: 'text' as const, text: JSON.stringify(clips, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // --- extend_audio ---
  server.tool(
    'extend_audio',
    'Extend an existing audio clip from a specific timestamp',
    {
      audio_id: z.string().describe('ID of the audio clip to extend'),
      prompt: z.string().optional().default('').describe('New lyrics for the extension'),
      continue_at: z.number().describe('Timestamp in seconds where extension starts'),
      tags: z.string().optional().default('').describe('Style tags'),
      negative_tags: z.string().optional().default('').describe('Styles to avoid'),
      title: z.string().optional().default('').describe('Title for the extended version'),
      model: z.string().optional().describe(`Model version. Default: ${DEFAULT_MODEL}`),
      wait_audio: z.boolean().optional().default(false).describe('Wait for generation to complete'),
    },
    async ({ audio_id, prompt, continue_at, tags, negative_tags, title, model, wait_audio }) => {
      try {
        const payload = buildPayload({ prompt, tags, title, make_instrumental: false, model, negative_tags }, true);
        payload.task = 'extend';
        payload.continue_clip_id = audio_id;
        payload.continue_at = continue_at;

        await addCaptchaIfNeeded(wsManager, payload);
        const resp = await wsManager.sendRequest('api_call', {
          url: '/api/generate/v2/',
          method: 'POST',
          body: payload,
        });
        if (resp.error) throw new Error(resp.error.message);
        let result = resp.result!.data;

        if (wait_audio && result.clips) {
          result = await pollClips(wsManager, result.clips.map((c: any) => c.id));
        } else if (result.clips) {
          result = result.clips.map(normalizeClip);
        }

        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // --- generate_stems ---
  server.tool(
    'generate_stems',
    'Separate an audio clip into individual stem tracks',
    {
      audio_id: z.string().describe('ID of the audio clip to separate'),
    },
    async ({ audio_id }) => {
      try {
        const resp = await wsManager.sendRequest('api_call', {
          url: `/api/edit/stems/${audio_id}`,
          method: 'POST',
          body: {},
        });
        if (resp.error) throw new Error(resp.error.message);
        return { content: [{ type: 'text' as const, text: JSON.stringify(resp.result!.data, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // --- concat ---
  server.tool(
    'concat',
    'Concatenate extended audio segments into a single complete song',
    {
      clip_id: z.string().describe('ID of the final clip in an extension chain'),
    },
    async ({ clip_id }) => {
      try {
        const resp = await wsManager.sendRequest('api_call', {
          url: '/api/generate/concat/v2/',
          method: 'POST',
          body: { clip_id },
        });
        if (resp.error) throw new Error(resp.error.message);
        return { content: [{ type: 'text' as const, text: JSON.stringify(resp.result!.data, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  return server;
}

/** Build the Suno API generate payload */
function buildPayload(opts: any, isCustom: boolean) {
  const payload: any = {
    make_instrumental: opts.make_instrumental || false,
    mv: opts.model || DEFAULT_MODEL,
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
    payload.tags = opts.tags || '';
    payload.title = opts.title || '';
    payload.negative_tags = opts.negative_tags || '';
    payload.prompt = opts.prompt || '';
  } else {
    payload.gpt_description_prompt = opts.prompt || '';
  }

  return payload;
}

/** Poll clips until done */
async function pollClips(wsManager: WebSocketManager, clipIds: string[], timeoutMs = 100_000) {
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
