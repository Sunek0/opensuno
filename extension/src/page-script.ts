/**
 * Page script — injected into the MAIN world of suno.com.
 * Only responsibility: provide JWT tokens from window.Clerk.
 */

import type { BridgeResponse } from './protocol';
import { CONTENT_TO_PAGE, PAGE_TO_CONTENT } from './protocol';

/** Get a fresh JWT from Clerk */
async function getToken(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const clerk = (window as any).Clerk;
    if (clerk?.session) {
      const token = await clerk.session.getToken();
      if (token) return token;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Clerk session not available — are you logged into suno.com?');
}

/** Get an hCaptcha token from the page */
async function getCaptchaToken(): Promise<string | null> {
  const hcaptcha = (window as any).hcaptcha;
  if (!hcaptcha) {
    console.log('[Suno Bridge] hCaptcha not loaded on page');
    return null;
  }

  try {
    // Find the hCaptcha sitekey from the page
    const widget = document.querySelector('[data-sitekey]');
    const sitekey = widget?.getAttribute('data-sitekey');

    if (sitekey) {
      console.log('[Suno Bridge] Executing hCaptcha with sitekey:', sitekey);
      const resp = await hcaptcha.execute(sitekey, { async: true });
      return resp.response || resp;
    }

    // Try executing without explicit sitekey (uses first widget)
    console.log('[Suno Bridge] Executing hCaptcha (default widget)');
    const resp = await hcaptcha.execute({ async: true });
    return resp.response || resp;
  } catch (err: any) {
    console.error('[Suno Bridge] hCaptcha execution failed:', err);
    return null;
  }
}

// Listen for messages from the content script
window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  if (event.data?.source !== CONTENT_TO_PAGE) return;

  const { id, method } = event.data.payload;
  let response: BridgeResponse;

  if (method === 'get_token') {
    try {
      const token = await getToken();
      response = { id, result: { status: 200, data: { token } } };
    } catch (err: any) {
      response = { id, error: { code: -1, message: err.message } };
    }
  } else if (method === 'get_captcha') {
    try {
      const captchaToken = await getCaptchaToken();
      response = { id, result: { status: 200, data: { captchaToken } } };
    } catch (err: any) {
      response = { id, error: { code: -1, message: err.message } };
    }
  } else if (method === 'get_status') {
    const clerk = (window as any).Clerk;
    response = {
      id,
      result: {
        status: 200,
        data: { loggedIn: !!clerk?.session, userId: clerk?.user?.id, url: window.location.href },
      },
    };
  } else {
    return;
  }

  window.postMessage({ source: PAGE_TO_CONTENT, payload: response }, '*');
});

// Signal ready
window.postMessage(
  { source: PAGE_TO_CONTENT, payload: { type: 'connected', data: { pageScript: true } } },
  '*'
);

console.log('[Suno Bridge] Page script loaded');
