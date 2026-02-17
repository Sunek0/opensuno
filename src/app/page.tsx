import Section from "./components/Section";
import Markdown from 'react-markdown';


export default function Home() {

  const markdown = `

---
## 👋 Introduction

OpenSuno is an open-source Suno AI API that provides two modes of operation:

- **Bridge Mode** (Recommended) — A Chrome extension + local bridge server. Zero-config auth, automatic captcha bypass, no token expiry.
- **Cookie Mode** — Server-side approach using JWT tokens extracted from the browser.

Built with Claude Code & Paean AI.

## 🌟 Features

- **Chrome Extension + Bridge Server** — zero-config auth, automatic captcha bypass
- **MCP Server** — use as a tool provider for Claude Desktop, Cursor, or any MCP-compatible AI agent
- All Suno model versions supported (V4 / V4.5+ / V4.5 Pro / V5)
- REST API compatible with the original suno-api format
- OpenAI-compatible \`/v1/chat/completions\` endpoint
- One-click Vercel deployment (Cookie Mode)

## 🚀 Getting Started (Bridge Mode)

### 1. Install and build

\`\`\`bash
git clone https://github.com/paean-ai/opensuno.git
cd opensuno
bun install
bun run ext:build
\`\`\`

### 2. Load Chrome extension

1. Open \`chrome://extensions/\` in Chrome
2. Enable **Developer mode**
3. Click **Load unpacked** → select \`extension/dist/\`

### 3. Open suno.com

Open https://suno.com/create and make sure you're logged in.

### 4. Start bridge server

\`\`\`bash
bun run bridge
\`\`\`

### 5. Test it

\`\`\`bash
curl http://localhost:3001/api/get_limit
\`\`\`
`;

  return (
    <>
      <Section className="">
        <div className="flex flex-col m-auto py-20 text-center items-center justify-center gap-4 my-8
        lg:px-20 px-4
        bg-indigo-900/90 rounded-2xl border shadow-2xl hover:shadow-none duration-200">
          <span className=" px-5 py-1 text-xs font-light border rounded-full
          border-white/20 uppercase text-white/50">
            Open Source
          </span>
          <h1 className="font-bold text-7xl flex text-white/90">
            OpenSuno
          </h1>
          <p className="text-white/80 text-lg">
            Open-source Suno AI API with Chrome Extension bridge — zero-config auth & automatic captcha bypass.
          </p>
        </div>

      </Section>
      <Section className="my-10">
        <article className="prose lg:prose-lg max-w-3xl">
          <Markdown>
            {markdown}
          </Markdown>
        </article>
      </Section>


    </>
  );
}
