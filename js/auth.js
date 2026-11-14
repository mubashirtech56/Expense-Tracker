// ============================================================================
// Authentication Service (Strict Supabase Auth)
// ============================================================================
import { supabase, isSupabaseConfigured } from './supabase.js';
import { slugifyLoginId } from './slugify.js';

export { slugifyLoginId };

export function loginIdToEmail(loginId) {
  return `${slugifyLoginId(loginId)}@friends.local`;
}

class AuthService {
  constructor() {
    this.currentUser = null;
    this.listeners = new Set();
    this.authInitialized = !isSupabaseConfigured || !supabase;

    if (isSupabaseConfigured && supabase) {
      supabase.auth.onAuthStateChange((event, session) => {
        // Requirement 13: Do not await Supabase calls inside onAuthStateChange; defer with setTimeout(..., 0)
        setTimeout(async () => {
          if (session?.user) {
            const profile = await this.loadUserProfile(session.user.id, false);
            this.authInitialized = true;
            // A valid session without an active profile is unusable; drop it so
            // the UI falls back to the login screen instead of staying blank.
            if (!profile || !profile.isActive) {
              try {
                await supabase.auth.signOut();
              } catch (_) {}
              this.currentUser = null;
              this.notifyListeners();
            } else {
              this.notifyListeners();
            }
          } else {
            this.authInitialized = true;
            this.currentUser = null;
            this.notifyListeners();
          }
        }, 0);
      });
    }
  }

  onAuthStateChange(callback) {
    this.listeners.add(callback);
    if (this.authInitialized) callback(this.currentUser);
    return () => this.listeners.delete(callback);
  }

  notifyListeners() {
    this.listeners.forEach((callback) => {
      try {
        callback(this.currentUser);
      } catch (err) {
        console.error('Auth listener error:', err);
      }
    });
  }

  async loadUserProfile(userId, notify = true) {
    if (!isSupabaseConfigured || !supabase) return null;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error || !data) {
        console.warn('Could not load profile for user:', userId, error);
        this.currentUser = null;
        return null;
      }

      this.currentUser = {
        id: data.id,
        name: data.name,
        loginId: data.login_id,
        role: data.role,
        mustChangePassword: Boolean(data.must_change_password),
        isActive: Boolean(data.is_active),
      };

      // Do not announce deactivated accounts: the auth flow signs them out
      // instead of rendering the app with a stale session.
      if (this.currentUser.isActive && notify) {
        this.notifyListeners();
      }
      return this.currentUser;
    } catch (err) {
      console.error('Error fetching profile:', err);
      this.currentUser = null;
      return null;
    }
  }

  async signIn(loginId, password) {
    const normalizedLogin = typeof loginId === 'string' ? loginId.trim() : String(loginId ?? '').trim();
    const normalizedPassword = typeof password === 'string' ? password : String(password ?? '');

    let cleanLogin = '';
    try {
      cleanLogin = slugifyLoginId(normalizedLogin);
    } catch {
      throw new Error('Please enter a valid Login ID.');
    }

    if (!cleanLogin || !normalizedPassword) {
      throw new Error('Please enter both your Login ID and password.');
    }

    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Backend is not configured. Please check your Supabase configuration.');
    }

    const email = loginIdToEmail(cleanLogin);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw new Error(error.message || 'Invalid Login ID or password.');
    }

    const profile = await this.loadUserProfile(data.user.id);
    if (!profile) {
      try {
        await supabase.auth.signOut();
      } catch (_) {}
      throw new Error('User profile record not found. Please contact your admin.');
    }

    if (!profile.isActive) {
      await supabase.auth.signOut();
      throw new Error('Your account has been deactivated. Please contact your admin.');
    }

    return profile;
  }

  async signOut() {
    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.auth.signOut();
      } catch (err) {
        console.warn('Supabase sign out error:', err);
      }
    }

    // Clear all fem_* keys from localStorage (Requirement 14)
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('fem_')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
    } catch (_) {}

    this.currentUser = null;
    this.notifyListeners();
  }

  async changePassword(newPassword, currentPassword) {
    if (!newPassword || newPassword.length < 8) {
      throw new Error('New password must be at least 8 characters long.');
    }

    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Backend is not configured.');
    }

    // When invoked from settings, verify the current password before changing it.
    // The force-change flow omits it because the user just signed in with the
    // temporary password.
    if (currentPassword) {
      const loginId = this.currentUser?.loginId;
      if (!loginId) {
        throw new Error('You must be signed in to change your password.');
      }
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: loginIdToEmail(loginId),
        password: currentPassword,
      });
      if (verifyError) {
        throw new Error('Current password is incorrect.');
      }
    }

    const { error: authError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (authError) throw new Error(authError.message);

    if (this.currentUser?.id) {
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ must_change_password: false })
        .eq('id', this.currentUser.id);

      if (profileError) {
        console.warn('Could not update must_change_password in profile:', profileError);
      }

      this.currentUser.mustChangePassword = false;
      this.notifyListeners();
    }
    return true;
  }

  updateCurrentUserName(name) {
    const cleanName = String(name || '').trim();
    if (!this.currentUser || !cleanName) return;
    this.currentUser.name = cleanName;
    // Update in-memory state only; the caller persists and re-renders. Notifying
    // here would re-run the auth callback and reload the whole app.
  }


  getCurrentUser() {
    return this.currentUser;
  }

  isAdmin() {
    return this.currentUser?.role === 'admin';
  }
}

export const auth = new AuthService();
