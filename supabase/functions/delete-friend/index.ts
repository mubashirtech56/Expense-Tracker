// Supabase Edge Function: delete-friend
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
    const { userId, hardDelete = false } = body || {};
    if (!userId || typeof userId !== "string" || !UUID_RE.test(userId)) {
      return new Response(JSON.stringify({ error: "A valid userId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (userId === user.id) {
      return new Response(JSON.stringify({ error: "Admins cannot delete or deactivate their own account" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Verify target user is not the last admin
    const { data: targetProfile } = await adminClient
      .from("profiles")
      .select("role, is_active")
      .eq("id", userId)
      .single();

    if (!targetProfile) {
      return new Response(JSON.stringify({ error: "Member not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (targetProfile?.role === "admin" && targetProfile?.is_active) {
      const { count } = await adminClient
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("role", "admin")
        .eq("is_active", true);

      if ((count || 0) <= 1) {
        return new Response(JSON.stringify({ error: "Cannot remove or deactivate the last active administrator." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const softDeactivate = async () => {
      const { error: updateError } = await adminClient
        .from("profiles")
        .update({ is_active: false })
        .eq("id", userId);
      if (updateError) return updateError.message;
      return null;
    };

    if (hardDelete) {
      // A hard delete would orphan expense/settlement history because those
      // rows reference profiles. Detect any references and fall back to a soft
      // delete so historical data stays intact.
      const [expensesResult, participantsResult, settlementsResult] = await Promise.all([
        adminClient
          .from("expenses")
          .select("*", { count: "exact", head: true })
          .or(`payer_id.eq.${userId},created_by.eq.${userId}`),
        adminClient
          .from("expense_participants")
          .select("*", { count: "exact", head: true })
          .eq("friend_id", userId),
        adminClient
          .from("settlements")
          .select("*", { count: "exact", head: true })
          .or(`from_id.eq.${userId},to_id.eq.${userId},created_by.eq.${userId},confirmed_by.eq.${userId}`),
      ]);

      if (
        expensesResult.error ||
        participantsResult.error ||
        settlementsResult.error
      ) {
        return new Response(JSON.stringify({ error: "Could not verify member references" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const referenceCount =
        (expensesResult.count || 0) +
        (participantsResult.count || 0) +
        (settlementsResult.count || 0);

      if (referenceCount > 0) {
        const updateError = await softDeactivate();
        if (updateError) {
          return new Response(JSON.stringify({ error: updateError }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({
            success: true,
            softDeleted: true,
            message:
              "This member appears in existing expenses or settlements, so the account was deactivated instead of permanently deleted.",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error: delError } = await adminClient.auth.admin.deleteUser(userId);
      if (delError) {
        const isRateLimit = delError.message?.toLowerCase().includes("rate") || (delError as any).status === 429;
        return new Response(
          JSON.stringify({
            error: isRateLimit
              ? "Too many requests. Please wait a moment before deleting members."
              : delError.message,
          }),
          {
            status: isRateLimit ? 429 : 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    } else {
      // Soft-delete / deactivate to preserve historical expenses and settlements
      const updateError = await softDeactivate();
      if (updateError) {
        return new Response(JSON.stringify({ error: updateError }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
