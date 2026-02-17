"use client";

import { useState, useEffect, useCallback } from "react";
import Section from "../components/Section";

interface CookieStatus {
  has_cookie: boolean;
  has_session_token: boolean;
  has_client_id: boolean;
  cookie_preview?: string;
  message: string;
}

interface SaveResult {
  success?: boolean;
  error?: string;
  message?: string;
  has_session_token?: boolean;
  has_client_id?: boolean;
}

// Generate the console script that users paste into suno.com DevTools
function getConsoleScript(apiBase: string): string {
  return `(async()=>{try{console.log("%c--- Suno Cookie Extractor ---","color:#a855f7;font-weight:bold;font-size:1.2em");if(!window.Clerk||!window.Clerk.session){console.error("Clerk not found. Make sure you are logged in to suno.com");return}const token=await window.Clerk.session.getToken();if(!token){console.error("Failed to get JWT token");return}console.log("%c✓ JWT Token extracted","color:#22c55e;font-weight:bold");const dc=document.cookie;const parts=["__session="+token];if(dc)parts.push(dc);const cookie=parts.join("; ");console.log("%c✓ Cookie assembled ("+cookie.length+" chars)","color:#22c55e;font-weight:bold");let saved=false;try{const c=new AbortController();const t=setTimeout(()=>c.abort(),3000);const r=await fetch("${apiBase}/api/cookie",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token,cookie}),signal:c.signal});clearTimeout(t);const d=await r.json();if(d.success){console.log("%c✓ "+d.message,"color:#22c55e;font-weight:bold");saved=true}}catch(e){}if(!saved){await navigator.clipboard.writeText(JSON.stringify({token,cookie}));console.log("%c✓ Copied to clipboard!","color:#22c55e;font-weight:bold;font-size:1.1em");console.log("Go to ${apiBase}/cookie and paste (Ctrl+V / Cmd+V) into the Cookie field, then click Save.")}console.log("%c--- Done ---","color:#a855f7;font-weight:bold")}catch(e){console.error("Error:",e)}})();`;
}

// Pretty version for display
function getConsoleScriptReadable(apiBase: string): string {
  return `// Suno Cookie Extractor — paste in DevTools Console on suno.com
(async () => {
  // 1. Extract JWT token via Clerk SDK
  const token = await window.Clerk.session.getToken();

  // 2. Assemble cookie string
  const cookie = "__session=" + token + "; " + document.cookie;

  // 3. Try sending to your suno-api server
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch("${apiBase}/api/cookie", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, cookie }),
      signal: ctrl.signal,
    });
    const data = await res.json();
    if (data.success) { console.log("Saved!", data.message); return; }
  } catch (e) { /* server unreachable, use clipboard */ }

  // 4. Fallback: copy to clipboard
  await navigator.clipboard.writeText(JSON.stringify({ token, cookie }));
  console.log("Copied to clipboard! Paste it on the Cookie Settings page.");
})();`;
}

export default function CookiePage() {
  const [token, setToken] = useState("");
  const [rawCookie, setRawCookie] = useState("");
  const [status, setStatus] = useState<CookieStatus | null>(null);
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [scriptCopied, setScriptCopied] = useState(false);
  const [showManualSteps, setShowManualSteps] = useState(false);
  const [apiBase, setApiBase] = useState("http://localhost:3000");

  useEffect(() => {
    setApiBase(window.location.origin);
    checkStatus();
  }, []);

  // Listen for clipboard paste of JSON data (from fallback mode)
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const text = e.clipboardData.getData("text");
      try {
        const parsed = JSON.parse(text);
        if (parsed.token && parsed.cookie) {
          e.preventDefault();
          setToken(parsed.token);
          setRawCookie(parsed.cookie);
        }
      } catch {
        // Not JSON, let normal paste happen
      }
    },
    []
  );

  async function checkStatus() {
    try {
      const res = await fetch("/api/cookie");
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus(null);
    }
  }

  async function handleSave() {
    setLoading(true);
    setSaveResult(null);
    try {
      const res = await fetch("/api/cookie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: token.trim() || undefined,
          cookie: rawCookie.trim() || undefined,
        }),
      });
      const data = await res.json();
      setSaveResult(data);
      if (data.success) {
        checkStatus();
        setVerifyResult(null);
      }
    } catch (err) {
      setSaveResult({ error: "Network error: " + err });
    }
    setLoading(false);
  }

  async function handleVerify() {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await fetch("/api/get_limit");
      const data = await res.json();
      if (data.credits_left !== undefined) {
        setVerifyResult({ success: true, data });
      } else {
        setVerifyResult({
          success: false,
          error: data.error || "Unexpected response",
        });
      }
    } catch (err) {
      setVerifyResult({ success: false, error: "Connection failed: " + err });
    }
    setVerifying(false);
  }

  async function copyScript() {
    const script = getConsoleScript(apiBase);
    await navigator.clipboard.writeText(script);
    setScriptCopied(true);
    setTimeout(() => setScriptCopied(false), 2000);
  }

  const manualSteps = [
    {
      title: "Open Suno Website",
      content: (
        <p>
          Open{" "}
          <a
            href="https://suno.com/create"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-600 underline font-medium"
          >
            suno.com/create
          </a>{" "}
          in your browser and log in to your account.
        </p>
      ),
    },
    {
      title: "Open Developer Tools",
      content: (
        <>
          <p>Open the browser Developer Tools:</p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-gray-600">
            <li>
              <strong>Windows/Linux:</strong> Press{" "}
              <kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-xs font-mono">F12</kbd> or{" "}
              <kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-xs font-mono">Ctrl + Shift + I</kbd>
            </li>
            <li>
              <strong>Mac:</strong> Press{" "}
              <kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-xs font-mono">Cmd + Option + I</kbd>
            </li>
          </ul>
        </>
      ),
    },
    {
      title: "Switch to Network Tab",
      content: (
        <>
          <p>
            Click the <strong>Network</strong> tab. If empty, refresh the page
            (<kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-xs font-mono">F5</kbd>).
          </p>
        </>
      ),
    },
    {
      title: "Find a Suno API Request",
      content: (
        <>
          <p>Filter for <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm">studio-api.prod.suno.com</code> or{" "}
            <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm">client?_clerk_js_version</code>.</p>
        </>
      ),
    },
    {
      title: "Copy Cookie & Authorization",
      content: (
        <>
          <p>Click the request &rarr; <strong>Headers</strong> &rarr; <strong>Request Headers</strong>:</p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-gray-600">
            <li>Copy the full <code className="bg-gray-100 px-1 rounded">Cookie</code> value</li>
            <li>Copy the <code className="bg-gray-100 px-1 rounded">Authorization</code> value (after <code className="bg-gray-100 px-1 rounded">Bearer </code>)</li>
          </ul>
          <p className="mt-2 text-gray-500 text-sm">Paste both into the form below.</p>
        </>
      ),
    },
  ];

  return (
    <>
      <Section>
        <div className="flex flex-col m-auto py-12 text-center items-center justify-center gap-3 my-8 lg:px-20 px-4 bg-indigo-900/90 rounded-2xl border shadow-2xl hover:shadow-none duration-200">
          <span className="px-5 py-1 text-xs font-light border rounded-full border-white/20 uppercase text-white/50">
            Cookie Management
          </span>
          <h1 className="font-bold text-4xl lg:text-5xl flex text-white/90">
            Cookie Settings
          </h1>
          <p className="text-white/70 text-base">
            Configure your Suno authentication cookie to use the API
          </p>
        </div>
      </Section>

      {/* Current Status */}
      <Section className="mt-8">
        <div className="bg-white border rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Current Status</h2>
          {status ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className={`w-3 h-3 rounded-full ${status.has_cookie ? "bg-green-500" : "bg-red-400"}`} />
                <span className="text-gray-700">
                  Cookie: {status.has_cookie ? "Configured" : "Not configured"}
                </span>
              </div>
              {status.has_cookie && (
                <>
                  <div className="flex items-center gap-3 ml-6">
                    <span className={`w-2 h-2 rounded-full ${status.has_session_token ? "bg-green-500" : "bg-yellow-400"}`} />
                    <span className="text-sm text-gray-600">
                      JWT Token (__session): {status.has_session_token ? "Present" : "Not found"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 ml-6">
                    <span className={`w-2 h-2 rounded-full ${status.has_client_id ? "bg-green-500" : "bg-yellow-400"}`} />
                    <span className="text-sm text-gray-600">
                      Client ID (__client): {status.has_client_id ? "Present" : "Not found"}
                    </span>
                  </div>
                  {status.cookie_preview && (
                    <div className="ml-6 mt-2">
                      <p className="text-xs text-gray-400 font-mono break-all">{status.cookie_preview}</p>
                    </div>
                  )}
                </>
              )}
              {status.has_cookie && (
                <div className="mt-4 pt-4 border-t">
                  <button
                    onClick={handleVerify}
                    disabled={verifying}
                    className="px-4 py-2 bg-indigo-100 text-indigo-700 rounded-lg text-sm font-medium hover:bg-indigo-200 disabled:opacity-50 transition-colors"
                  >
                    {verifying ? "Verifying..." : "Verify Cookie"}
                  </button>
                  {verifyResult && (
                    <div className={`mt-3 p-3 rounded-lg text-sm ${verifyResult.success ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"}`}>
                      {verifyResult.success ? (
                        <div>
                          <p className="font-medium">Cookie is valid!</p>
                          <p className="mt-1">Credits remaining: {verifyResult.data.credits_left} / {verifyResult.data.monthly_limit}</p>
                        </div>
                      ) : (
                        <p>Verification failed: {verifyResult.error}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-gray-500">Loading...</p>
          )}
        </div>
      </Section>

      {/* Quick Extract - Primary method */}
      <Section className="mt-8">
        <div className="bg-white border-2 border-indigo-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs font-bold rounded-full uppercase">Recommended</span>
            <h2 className="text-lg font-semibold text-gray-800">Quick Extract (One-Click)</h2>
          </div>
          <p className="text-sm text-gray-500 mb-5">
            Run a script in your browser console to extract and save the cookie automatically.
            No manual copying needed.
          </p>

          <div className="space-y-4">
            {/* Step 1 */}
            <div className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 bg-indigo-600 text-white rounded-full flex items-center justify-center text-sm font-bold">1</span>
              <div className="flex-1">
                <p className="font-medium text-gray-800">
                  Open{" "}
                  <a href="https://suno.com/create" target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline">
                    suno.com/create
                  </a>{" "}
                  and make sure you are logged in
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 bg-indigo-600 text-white rounded-full flex items-center justify-center text-sm font-bold">2</span>
              <div className="flex-1">
                <p className="font-medium text-gray-800 mb-2">
                  Open DevTools Console (
                  <kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-xs font-mono">F12</kbd> &rarr; Console tab)
                  and paste this script:
                </p>
                <div className="relative">
                  <pre className="bg-gray-900 text-green-400 rounded-lg p-4 text-xs overflow-x-auto font-mono leading-relaxed max-h-48 overflow-y-auto">
                    {getConsoleScriptReadable(apiBase)}
                  </pre>
                  <button
                    onClick={copyScript}
                    className={`absolute top-2 right-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      scriptCopied
                        ? "bg-green-500 text-white"
                        : "bg-white/90 text-gray-700 hover:bg-white"
                    }`}
                  >
                    {scriptCopied ? "Copied!" : "Copy Script"}
                  </button>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  The script uses the Clerk SDK built into the Suno page to extract a fresh JWT token,
                  then sends it directly to your suno-api server at <code className="bg-gray-100 px-1 rounded">{apiBase}</code>.
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 bg-indigo-600 text-white rounded-full flex items-center justify-center text-sm font-bold">3</span>
              <div className="flex-1">
                <p className="font-medium text-gray-800">
                  Press <kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-xs font-mono">Enter</kbd> &mdash;
                  the cookie is saved automatically. Come back here and click &quot;Verify Cookie&quot; above.
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  If direct save fails (e.g. CORS blocked), the script copies the data to your clipboard instead.
                  Paste it into the Cookie field below.
                </p>
              </div>
            </div>
          </div>

          {/* Refresh button after quick extract */}
          <div className="mt-5 pt-4 border-t">
            <button
              onClick={() => { checkStatus(); setVerifyResult(null); }}
              className="px-4 py-2 bg-indigo-50 text-indigo-700 rounded-lg text-sm font-medium hover:bg-indigo-100 transition-colors"
            >
              Refresh Status
            </button>
          </div>
        </div>
      </Section>

      {/* Manual method toggle */}
      <Section className="mt-8">
        <button
          onClick={() => setShowManualSteps(!showManualSteps)}
          className="w-full bg-white border rounded-xl p-4 shadow-sm text-left hover:bg-gray-50 transition-colors flex items-center justify-between"
        >
          <div>
            <h2 className="text-base font-semibold text-gray-700">Manual Method (Alternative)</h2>
            <p className="text-sm text-gray-400">Step-by-step guide to copy cookie from Network tab</p>
          </div>
          <span className="text-gray-400 text-xl">{showManualSteps ? "\u2212" : "+"}</span>
        </button>

        {showManualSteps && (
          <div className="bg-white border border-t-0 rounded-b-xl p-6 shadow-sm -mt-1 space-y-3">
            {manualSteps.map((step, index) => (
              <div key={index} className="border rounded-lg overflow-hidden">
                <button
                  onClick={() => setActiveStep(activeStep === index ? null : index)}
                  className="w-full flex items-center gap-3 p-4 text-left hover:bg-gray-50 transition-colors"
                >
                  <span className="flex-shrink-0 w-7 h-7 bg-gray-100 text-gray-600 rounded-full flex items-center justify-center text-sm font-bold">
                    {index + 1}
                  </span>
                  <span className="font-medium text-gray-700">{step.title}</span>
                  <span className="ml-auto text-gray-400 text-lg">{activeStep === index ? "\u2212" : "+"}</span>
                </button>
                {activeStep === index && (
                  <div className="px-4 pb-4 pl-14 text-sm text-gray-700">{step.content}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Cookie input form */}
      <Section className="mt-8 mb-8">
        <div className="bg-white border rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Paste Cookie</h2>
          <p className="text-sm text-gray-500 mb-6">
            Paste manually, or paste the JSON from the clipboard fallback mode
          </p>

          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Cookie <span className="text-red-400">*</span>
              </label>
              <textarea
                value={rawCookie}
                onChange={(e) => setRawCookie(e.target.value)}
                onPaste={handlePaste}
                placeholder='Paste Cookie header value or JSON from the extractor script...'
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent placeholder:text-gray-400 resize-none"
              />
              <p className="mt-1 text-xs text-gray-400">
                Accepts raw Cookie string or JSON <code className="bg-gray-100 px-1 rounded">{`{"token":"...","cookie":"..."}`}</code>
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                JWT Token (Authorization) <span className="text-gray-400 font-normal">Optional</span>
              </label>
              <textarea
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="eyJhbGciOi..."
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent placeholder:text-gray-400 resize-none"
              />
              <p className="mt-1 text-xs text-gray-400">
                If provided, replaces <code className="bg-gray-100 px-1 rounded">__session</code> in the cookie
              </p>
            </div>

            <div className="bg-gray-50 border rounded-lg p-4 text-sm text-gray-600 space-y-2">
              <p className="font-medium text-gray-700">Authentication Modes:</p>
              <ul className="space-y-1.5 ml-4">
                <li className="flex gap-2">
                  <span className="text-indigo-500 font-bold">&bull;</span>
                  <span><strong>JWT Token mode</strong> (via Quick Extract): Uses the token directly. Simple and reliable.</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-indigo-500 font-bold">&bull;</span>
                  <span><strong>Clerk session mode</strong> (via manual Cookie copy): Provides <code className="bg-gray-200 px-1 rounded">__client</code> for auto-refresh. Lasts longer.</span>
                </li>
              </ul>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleSave}
                disabled={loading || (!rawCookie.trim() && !token.trim())}
                className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? "Saving..." : "Save Cookie"}
              </button>
              {saveResult && (
                <span className={`text-sm ${saveResult.success ? "text-green-600" : "text-red-600"}`}>
                  {saveResult.success ? saveResult.message : saveResult.error}
                </span>
              )}
            </div>
          </div>
        </div>
      </Section>

      {/* Tips */}
      <Section className="mb-16">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <h3 className="font-semibold text-amber-800 mb-3">Important Notes</h3>
          <ul className="space-y-2 text-sm text-amber-700">
            <li className="flex gap-2">
              <span>1.</span>
              <span>
                JWT Tokens expire after a few hours. When API calls fail, re-run the Quick Extract script to get a fresh token.
              </span>
            </li>
            <li className="flex gap-2">
              <span>2.</span>
              <span>
                For longer-lasting auth, use the Manual Method to copy the full Cookie (including <code className="bg-amber-100 px-1 rounded">__client</code>) which enables auto-refresh.
              </span>
            </li>
            <li className="flex gap-2">
              <span>3.</span>
              <span>
                The cookie is saved to <code className="bg-amber-100 px-1 rounded">.env</code> on the server.
                For Vercel deployments, set <code className="bg-amber-100 px-1 rounded">SUNO_COOKIE</code> in the Vercel dashboard instead.
              </span>
            </li>
            <li className="flex gap-2">
              <span>4.</span>
              <span>
                CLI alternative: <code className="bg-amber-100 px-1 rounded">node setup-cookie.js</code>
              </span>
            </li>
          </ul>
        </div>
      </Section>
    </>
  );
}
