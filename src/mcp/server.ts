import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sunoApi, SUNO_MODELS, DEFAULT_MODEL } from "../lib/SunoApi.js";

/**
 * Create and configure the Suno MCP server with all tool definitions.
 */
export function createSunoMcpServer() {
  const server = new McpServer(
    {
      name: "suno-api",
      version: "1.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // --- Tool: get_credits ---
  server.tool(
    "get_credits",
    "Get the remaining credits and usage limits for the Suno account",
    {},
    async () => {
      try {
        const api = await sunoApi();
        const credits = await api.get_credits();
        return {
          content: [{ type: "text", text: JSON.stringify(credits, null, 2) }],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // --- Tool: generate ---
  server.tool(
    "generate",
    "Generate music from a text prompt using Suno AI. Returns audio clip metadata.",
    {
      prompt: z.string().describe("Text description of the music to generate"),
      make_instrumental: z
        .boolean()
        .optional()
        .default(false)
        .describe("Generate instrumental only (no vocals)"),
      model: z
        .string()
        .optional()
        .describe(
          `Model version to use. Options: ${Object.values(SUNO_MODELS).join(", ")}. Default: ${DEFAULT_MODEL}`
        ),
      wait_audio: z
        .boolean()
        .optional()
        .default(false)
        .describe("Wait for audio generation to complete before returning"),
    },
    async ({ prompt, make_instrumental, model, wait_audio }) => {
      try {
        const api = await sunoApi();
        const result = await api.generate(
          prompt,
          make_instrumental,
          model,
          wait_audio
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // --- Tool: custom_generate ---
  server.tool(
    "custom_generate",
    "Generate music with fine-grained control over lyrics, style tags, and title",
    {
      prompt: z.string().describe("Lyrics or detailed description for the song"),
      tags: z.string().describe('Style tags, e.g. "pop, upbeat, energetic"'),
      title: z.string().describe("Title for the song"),
      make_instrumental: z
        .boolean()
        .optional()
        .default(false)
        .describe("Generate instrumental only"),
      model: z
        .string()
        .optional()
        .describe(`Model version. Default: ${DEFAULT_MODEL}`),
      wait_audio: z
        .boolean()
        .optional()
        .default(false)
        .describe("Wait for audio generation to complete"),
      negative_tags: z
        .string()
        .optional()
        .describe('Styles to avoid, e.g. "heavy metal, screaming"'),
    },
    async ({
      prompt,
      tags,
      title,
      make_instrumental,
      model,
      wait_audio,
      negative_tags,
    }) => {
      try {
        const api = await sunoApi();
        const result = await api.custom_generate(
          prompt,
          tags,
          title,
          make_instrumental,
          model,
          wait_audio,
          negative_tags
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // --- Tool: generate_lyrics ---
  server.tool(
    "generate_lyrics",
    "Generate song lyrics from a topic or theme prompt",
    {
      prompt: z.string().describe("Topic or theme for the lyrics"),
    },
    async ({ prompt }) => {
      try {
        const api = await sunoApi();
        const result = await api.generateLyrics(prompt);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // --- Tool: get_audio ---
  server.tool(
    "get_audio",
    "Get status and details for audio clips by their IDs, or list recent generations",
    {
      ids: z
        .string()
        .optional()
        .describe("Comma-separated audio clip IDs. If omitted, lists recent generations."),
      page: z.string().optional().describe("Page number for pagination"),
    },
    async ({ ids, page }) => {
      try {
        const api = await sunoApi();
        const songIds = ids ? ids.split(",").map((id) => id.trim()) : undefined;
        const result = await api.get(songIds, page);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // --- Tool: extend_audio ---
  server.tool(
    "extend_audio",
    "Extend an existing audio clip by generating additional content from a specific timestamp",
    {
      audio_id: z.string().describe("ID of the audio clip to extend"),
      prompt: z
        .string()
        .optional()
        .default("")
        .describe("New lyrics or description for the extension"),
      continue_at: z
        .number()
        .describe("Timestamp in seconds where the extension should start"),
      tags: z.string().optional().default("").describe("Style tags for the extension"),
      negative_tags: z.string().optional().default("").describe("Styles to avoid"),
      title: z.string().optional().default("").describe("Title for the extended version"),
      model: z
        .string()
        .optional()
        .describe(`Model version. Default: ${DEFAULT_MODEL}`),
      wait_audio: z
        .boolean()
        .optional()
        .default(false)
        .describe("Wait for generation to complete"),
    },
    async ({
      audio_id,
      prompt,
      continue_at,
      tags,
      negative_tags,
      title,
      model,
      wait_audio,
    }) => {
      try {
        const api = await sunoApi();
        const result = await api.extendAudio(
          audio_id,
          prompt,
          continue_at,
          tags,
          negative_tags,
          title,
          model,
          wait_audio
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // --- Tool: generate_stems ---
  server.tool(
    "generate_stems",
    "Separate an audio clip into individual stem tracks (vocals, drums, bass, etc.)",
    {
      audio_id: z.string().describe("ID of the audio clip to separate into stems"),
    },
    async ({ audio_id }) => {
      try {
        const api = await sunoApi();
        const result = await api.generateStems(audio_id);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // --- Tool: concat ---
  server.tool(
    "concat",
    "Concatenate extended audio segments into a single complete song",
    {
      clip_id: z
        .string()
        .describe("ID of the final clip in an extension chain to concatenate"),
    },
    async ({ clip_id }) => {
      try {
        const api = await sunoApi();
        const result = await api.concatenate(clip_id);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}
