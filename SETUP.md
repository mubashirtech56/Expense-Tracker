# Setup & Deployment Guide — Friends Expense Manager

This guide walks you through connecting your **Friends Expense Manager** app to a live **Supabase** backend and deploying it automatically to **GitHub Pages**.

---

## 1. Create Supabase Project

1. Go to [database.new](https://database.new) and sign in to Supabase.
2. Click **New project**.
3. Choose your organization, project name (e.g. `friends-expense-manager`), set a database password, and pick a region close to your users.
4. Wait 1-2 minutes for the database to provision.

---

## 2. Run Database Schema

1. In your Supabase dashboard, navigate to **SQL Editor** from the left navigation.
2. Click **New query**.
3. Open `supabase/schema.sql` from this repository and copy its entire content into the SQL editor.
4. Click **Run** (or `Ctrl+Enter`).
5. Verify in **Table Editor** that the following tables exist with Row Level Security (RLS) enabled:
   - `profiles`
   - `expenses`
   - `expense_participants`
   - `settlements`
   - `settings`
   - `audit_log`

> [!IMPORTANT]
> `schema.sql` always creates the latest schema from scratch. If your database already
> exists, apply the incremental files in `supabase/migrations/` in order instead:
> `002_security_hardening.sql`, then `003_validation_hardening.sql`.

---

## 3. Configure Supabase Authentication

1. Navigate to **Authentication** -> **Providers** -> **Email**.
2. Ensure **Enable Email provider** is turned **ON**.
3. Under **Email Auth**, disable **Confirm email** (since Login IDs are internally mapped to `<loginId>@friends.local`).
4. Set Minimum password length to `8`.
5. Click **Save**.

---

## 4. Deploy Supabase Edge Functions

The app includes three edge functions under `supabase/functions/` for secure user administration:
- `create-friend`: Creates an auth user + profile with a temporary password and `must_change_password = true`.
- `reset-password`: Allows the admin to reset any member's password and flag it for first-login reset.
- `delete-friend`: Allows the admin to deactivate or delete member accounts.

### Deploying via Supabase CLI:

```bash
# 1. Login to Supabase CLI
npx supabase login

# 2. Link your local directory to your remote project
npx supabase link --project-ref <your-project-ref>

# 3. Deploy all edge functions
npx supabase functions deploy create-friend --no-verify-jwt
npx supabase functions deploy reset-password --no-verify-jwt
npx supabase functions deploy delete-friend --no-verify-jwt

# 4. Set a custom secret name without the reserved SUPABASE_ prefix
# Supabase reserves the SUPABASE_ prefix for built-in environment variables.
npx supabase secrets set SERVICE_ROLE_KEY=<your-service-role-key>
```

> [!NOTE]
> Edge functions use the server-side service role key to administer users without exposing the secret to client browsers. Use a custom variable name such as `SERVICE_ROLE_KEY` instead of `SUPABASE_SERVICE_ROLE_KEY` because the `SUPABASE_` prefix is reserved by Supabase.

---

## 5. Create the Initial Admin User

You can bootstrap the initial admin either from the Supabase dashboard or via SQL:

### Option A: Using the Supabase Dashboard
1. Go to **Authentication** -> **Users** -> **Add user** -> **Create user**.
2. **Email**: `admin@friends.local`
3. **Password**: `admin123` (or your chosen strong password).
4. Auto Confirm User: Checked.
5. In **Table Editor** -> `profiles`, find the new user record (or insert one if not created by trigger):
   - `id`: `<auth-user-id>`
   - `name`: `Admin`
   - `login_id`: `admin`
   - `role`: `admin`
   - `is_active`: `true`
   - `must_change_password`: `false`

### Option B: Using SQL Editor
```sql
-- Replace with your admin auth user ID from auth.users:
INSERT INTO public.profiles (id, name, login_id, role, must_change_password, is_active)
SELECT id, 'Admin', 'admin', 'admin', false, true
FROM auth.users
WHERE email = 'admin@friends.local'
ON CONFLICT (id) DO UPDATE SET role = 'admin';
```

---

## 6. Local Development Configuration

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. In your Supabase Dashboard, go to **Project Settings** -> **API**.
3. Copy **Project URL** and paste it as `VITE_SUPABASE_URL`.
4. Copy the `anon` / `public` API key and paste it as `VITE_SUPABASE_ANON_KEY`.
5. Start the local development server:
   ```bash
   npm run dev
   ```
6. Visit `http://localhost:5173` in your browser.
7. Sign in using:
   - **Login ID**: `admin`
   - **Password**: `admin123`

---

## 7. GitHub Secrets & Automatic Deployment

To deploy to GitHub Pages automatically on push:

1. Push your repository to GitHub:
   ```bash
   git add .
   git commit -m "feat: complete friends expense manager v2.0 upgrade"
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
2. In your GitHub repository, go to **Settings** -> **Secrets and variables** -> **Actions**.
3. Click **New repository secret** and add:
   - `VITE_SUPABASE_URL`: Your Supabase Project URL (`https://<project-ref>.supabase.co`)
   - `VITE_SUPABASE_ANON_KEY`: Your Supabase anonymous public API key
4. Go to **Settings** -> **Pages**:
   - Under **Build and deployment** -> **Source**, select **GitHub Actions**.
5. Push a commit or manually run the **Deploy to GitHub Pages** workflow under the **Actions** tab.
6. Your live app will be accessible at `https://<your-username>.github.io/<your-repo>/`.
