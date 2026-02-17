import { NextResponse, NextRequest } from "next/server";
import { corsHeaders } from "@/lib/utils";
import { promises as fs } from "fs";
import path from "path";
import * as cookie from "cookie";

export const dynamic = "force-dynamic";

/**
 * GET /api/cookie - Check current cookie status
 */
export async function GET(req: NextRequest) {
  try {
    const envPath = path.join(process.cwd(), ".env");
    let hasCookie = false;
    let cookiePreview = "";
    let hasSession = false;
    let hasClient = false;

    try {
      const envContent = await fs.readFile(envPath, "utf8");
      const match = envContent.match(/SUNO_COOKIE=(.+)/);
      if (match && match[1].trim()) {
        hasCookie = true;
        const parsed = cookie.parse(match[1].trim());
        hasSession =
          !!parsed.__session && parsed.__session.length > 100;
        hasClient = !!parsed.__client;

        // Show a masked preview
        const rawCookie = match[1].trim();
        cookiePreview =
          rawCookie.substring(0, 40) +
          "..." +
          rawCookie.substring(rawCookie.length - 20);
      }
    } catch {
      // .env file doesn't exist
    }

    // Also check runtime env
    const runtimeCookie = process.env.SUNO_COOKIE;
    const hasRuntimeCookie = !!runtimeCookie && runtimeCookie.length > 10;

    return NextResponse.json(
      {
        has_cookie: hasCookie || hasRuntimeCookie,
        has_session_token: hasSession,
        has_client_id: hasClient,
        cookie_preview: cookiePreview || undefined,
        message: hasCookie
          ? "Cookie is configured"
          : "No cookie configured",
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to check cookie status: " + error },
      { status: 500, headers: corsHeaders }
    );
  }
}

/**
 * POST /api/cookie - Save cookie to .env file
 * Body: { token?: string, cookie: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token, cookie: rawCookie } = body;

    if (!rawCookie && !token) {
      return NextResponse.json(
        { error: "Please provide at least a cookie or token" },
        { status: 400, headers: corsHeaders }
      );
    }

    let finalCookie = "";

    if (rawCookie) {
      // Parse and reconstruct cookies
      const cookieParts = rawCookie
        .split(";")
        .map((c: string) => c.trim())
        .filter(Boolean);

      if (token && token.trim().length > 100) {
        // If a separate JWT token is provided, replace __session with it
        const filteredCookies = cookieParts.filter(
          (c: string) => !c.startsWith("__session=")
        );
        filteredCookies.unshift(`__session=${token.trim()}`);
        finalCookie = filteredCookies.join("; ");
      } else {
        finalCookie = cookieParts.join("; ");
      }
    } else if (token && token.trim().length > 100) {
      // Token only mode
      finalCookie = `__session=${token.trim()}`;
    }

    // Validate: must have __session or __client
    const parsed = cookie.parse(finalCookie);
    const hasSession =
      !!parsed.__session && parsed.__session.length > 100;
    const hasClient = !!parsed.__client;

    if (!hasSession && !hasClient) {
      return NextResponse.json(
        {
          error:
            "Invalid cookie: must contain __session (JWT token) or __client. Please check the instructions and try again.",
        },
        { status: 400, headers: corsHeaders }
      );
    }

    // Write to .env file
    const envPath = path.join(process.cwd(), ".env");
    let envContent = "";

    try {
      envContent = await fs.readFile(envPath, "utf8");
    } catch {
      // .env doesn't exist yet
    }

    const cookieRegex = /SUNO_COOKIE=.*/;
    if (cookieRegex.test(envContent)) {
      envContent = envContent.replace(
        cookieRegex,
        `SUNO_COOKIE=${finalCookie}`
      );
    } else {
      envContent = `SUNO_COOKIE=${finalCookie}\n` + envContent;
    }

    await fs.writeFile(envPath, envContent);

    // Update runtime env so it takes effect without restart
    process.env.SUNO_COOKIE = finalCookie;

    return NextResponse.json(
      {
        success: true,
        has_session_token: hasSession,
        has_client_id: hasClient,
        message: "Cookie saved successfully. " +
          (hasSession
            ? "JWT token mode detected (direct auth)."
            : "Clerk session mode detected (will auto-refresh token)."),
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to save cookie: " + error },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 200,
    headers: corsHeaders,
  });
}
