// Supabase Edge Function: create-friend
// Secure server-side user provisioning for Friends Expense Manager
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

export function slugifyLoginId(value: string): string {
  const clean = String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);

  if (!clean) {
    throw new Error("Login ID cannot be empty and must contain alphanumeric characters.");
  }
  return clean;
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

    // 1. Verify caller authorization
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

    // Check if caller is admin
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

    // 2. Parse request
    const body = await req.json().catch(() => null);
    const { name, loginId, role = "friend" } = body || {};

    const cleanName = typeof name === "string" ? name.trim() : "";
    if (!cleanName || !loginId) {
      return new Response(JSON.stringify({ error: "Name and Login ID are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (cleanName.length > 80) {
      return new Response(JSON.stringify({ error: "Name must be 80 characters or fewer" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (role !== "admin" && role !== "friend") {
      return new Response(JSON.stringify({ error: "Role must be either 'admin' or 'friend'" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let cleanLoginId: string;
    try {
      cleanLoginId = slugifyLoginId(loginId);
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message || "Invalid Login ID" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const email = `${cleanLoginId}@friends.local`;
    const tempPassword = generateSecureTempPassword(16);

    // 3. Admin client with service role
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: authData, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { name: cleanName, loginId: cleanLoginId },
    });

    if (createError) {
      const isRateLimit = createError.message?.toLowerCase().includes("rate") || (createError as any).status === 429;
      return new Response(
        JSON.stringify({
          error: isRateLimit
            ? "Too many requests. Please wait a moment before creating more members."
            : createError.message,
        }),
        {
          status: isRateLimit ? 429 : 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const newUserId = authData.user.id;

    // 4. Insert into public.profiles
    const { error: insertProfileError } = await adminClient.from("profiles").insert({
      id: newUserId,
      name: cleanName,
      login_id: cleanLoginId,
      role: role === "admin" ? "admin" : "friend",
      must_change_password: true,
      is_active: true,
    });

    if (insertProfileError) {
      // Rollback auth user creation if profile creation fails!
      console.error("Profile insert failed, rolling back auth user:", insertProfileError);
      await adminClient.auth.admin.deleteUser(newUserId).catch((err) => {
        console.error("Failed to delete auth user during rollback:", err);
      });

      return new Response(
        JSON.stringify({ error: `Failed to create profile: ${insertProfileError.message}` }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: newUserId,
          name: cleanName,
          loginId: cleanLoginId,
          role: role === "admin" ? "admin" : "friend",
          tempPassword,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
