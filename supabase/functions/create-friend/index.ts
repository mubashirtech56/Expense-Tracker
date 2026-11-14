// Supabase Edge Function: create-friend
// Secure server-side user provisioning for Friends Expense Manager
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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
    const body = await req.json();
    const { name, loginId, role = "friend", initialPassword } = body;

    if (!name || !loginId) {
      return new Response(JSON.stringify({ error: "Name and Login ID are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleanLoginId = String(loginId).toLowerCase().trim().replace(/[^a-z0-9_-]/g, "");
    const email = `${cleanLoginId}@friends.local`;
    const tempPassword = initialPassword || `friend${Math.floor(1000 + Math.random() * 9000)}`;

    // 3. Admin client with service role
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: authData, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { name, loginId: cleanLoginId },
    });

    if (createError) {
      return new Response(JSON.stringify({ error: createError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const newUserId = authData.user.id;

    // 4. Insert or update public profile
    const { error: upsertError } = await adminClient.from("profiles").upsert({
      id: newUserId,
      name: name.trim(),
      login_id: cleanLoginId,
      role: role === "admin" ? "admin" : "friend",
      must_change_password: true,
      is_active: true,
    });

    if (upsertError) {
      return new Response(JSON.stringify({ error: upsertError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5. Audit log
    await adminClient.from("audit_log").insert({
      actor_id: user.id,
      actor_name: callerProfile.name,
      action: "CREATE_FRIEND",
      details: { target_id: newUserId, target_name: name, target_login: cleanLoginId, role },
    });

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: newUserId,
          name: name.trim(),
          loginId: cleanLoginId,
          role,
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
