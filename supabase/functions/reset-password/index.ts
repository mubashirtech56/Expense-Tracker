// Supabase Edge Function: reset-password
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function getCorsHeaders(req: Request) {
  const allowedOrigin = Deno.env.get("CORS_ORIGIN") || "*";
  const origin = req.headers.get("Origin") || "*";
  const allowOrigin = allowedOrigin === "*" ? origin : allowedOrigin;

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function generateSecureTempPassword(length = 16): string {
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*";
  // Rejection sampling keeps the distribution uniform (avoids modulo bias).
  const maxValid = Math.floor(256 / charset.length) * charset.length;
  const chars: string[] = [];
  const buffer = new Uint8Array(32);
  while (chars.length < length) {
    crypto.getRandomValues(buffer);
    for (const byte of buffer) {
      if (byte < maxValid) {
        chars.push(charset[byte % charset.length]);
        if (chars.length === length) break;
      }
    }
  }
  return chars.join("");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function methodNotAllowed(corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { ...corsHeaders, "Content-Type": "application/json", Allow: "POST, OPTIONS" },
  });
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return methodNotAllowed(corsHeaders);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Missing backend configuration" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const client = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await client.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: callerProfile, error: profileError } = await client
      .from("profiles")
      .select("role, is_active, name")
      .eq("id", user.id)
      .single();

    if (profileError || callerProfile?.role !== "admin" || !callerProfile?.is_active) {
      return new Response(JSON.stringify({ error: "Forbidden: Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => null);
    const { userId, customPassword } = body || {};
    if (!userId || typeof userId !== "string" || !UUID_RE.test(userId)) {
      return new Response(JSON.stringify({ error: "A valid userId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: targetProfile, error: targetError } = await adminClient
      .from("profiles")
      .select("id, role, is_active")
      .eq("id", userId)
      .maybeSingle();

    if (targetError) {
      return new Response(JSON.stringify({ error: "Could not verify target member" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!targetProfile) {
      return new Response(JSON.stringify({ error: "Member not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let tempPassword = "";
    if (customPassword) {
      if (
        typeof customPassword !== "string" ||
        customPassword.length < 8 ||
        customPassword.length > 128
      ) {
        return new Response(
          JSON.stringify({ error: "Custom password must be between 8 and 128 characters long." }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      tempPassword = customPassword;
    } else {
      tempPassword = generateSecureTempPassword(16);
    }

    const { error: updateAuthError } = await adminClient.auth.admin.updateUserById(userId, {
      password: tempPassword,
    });

    if (updateAuthError) {
      const isRateLimit = updateAuthError.message?.toLowerCase().includes("rate") || (updateAuthError as any).status === 429;
      return new Response(
        JSON.stringify({
          error: isRateLimit
            ? "Too many requests. Please wait a moment before resetting password."
            : updateAuthError.message,
        }),
        {
          status: isRateLimit ? 429 : 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { error: profileUpdateError } = await adminClient
      .from("profiles")
      .update({ must_change_password: true })
      .eq("id", userId);

    if (profileUpdateError) {
      return new Response(JSON.stringify({ error: profileUpdateError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ success: true, tempPassword }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
