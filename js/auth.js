// ============================================================================
// Authentication Service (Supabase Auth with Offline Fallback)
// ============================================================================
import { supabase, isSupabaseConfigured } from './supabase.js';

const LOCAL_SESSION_KEY = 'fem_local_session_user';
const FALLBACK_ADMIN_LOGIN = 'admin';
const FALLBACK_ADMIN_PASSWORD = 'admin123';

export function slugifyLoginId(value) {
  return String(value || 'friend')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30) || 'friend';
}

export function loginIdToEmail(loginId) {
  return `${slugifyLoginId(loginId)}@friends.local`;
}

class AuthService {
  constructor() {
    this.currentUser = null;
    this.listeners = new Set();

    if (isSupabaseConfigured) {
      supabase.auth.onAuthStateChange(async (event, session) => {
        if (session?.user) {
          await this.loadUserProfile(session.user.id);
        } else {
          this.currentUser = null;
          this.notifyListeners();
        }
      });
    } else {
      this.loadLocalSession();
    }
  }

  onAuthStateChange(callback) {
    this.listeners.add(callback);
    callback(this.currentUser);
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

  loadLocalSession() {
    try {
      const raw = localStorage.getItem(LOCAL_SESSION_KEY);
      if (raw) {
        this.currentUser = JSON.parse(raw);
        this.notifyListeners();
      }
    } catch {
      this.currentUser = null;
    }
  }

  async loadUserProfile(userId) {
    if (!isSupabaseConfigured || !supabase) return null;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error || !data) {
        console.warn('Could not load profile for user:', userId, error);
        return null;
      }

      this.currentUser = {
        id: data.id,
        name: data.name,
        loginId: data.login_id,
        role: data.role,
        mustChangePassword: data.must_change_password,
        isActive: data.is_active,
      };

      this.notifyListeners();
      return this.currentUser;
    } catch (err) {
      console.error('Error fetching profile:', err);
      return null;
    }
  }

  async signIn(loginId, password) {
    const cleanLogin = slugifyLoginId(loginId);
    if (!cleanLogin || !password) {
      throw new Error('Please enter both your Login ID and password.');
    }

    if (isSupabaseConfigured && supabase) {
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
        throw new Error('User profile record not found. Please contact your admin.');
      }

      if (!profile.isActive) {
        await supabase.auth.signOut();
        throw new Error('Your account has been deactivated. Please contact your admin.');
      }

      return profile;
    }

    // Local / Offline fallback auth
    const localStoreKey = 'friends-expense-manager:data:v2';
    const localData = JSON.parse(localStorage.getItem(localStoreKey) || '{}');
    const friends = Array.isArray(localData.friends) ? localData.friends : [];

    const found = friends.find(
      (f) => String(f.loginId || '').toLowerCase() === cleanLogin
    );

    if (!found) {
      // Default admin credential fallback
      if (cleanLogin === FALLBACK_ADMIN_LOGIN && password === FALLBACK_ADMIN_PASSWORD) {
        const adminUser = {
          id: 'f-admin',
          name: 'Admin',
          loginId: 'admin',
          role: 'admin',
          mustChangePassword: false,
          isActive: true,
        };
        this.currentUser = adminUser;
        localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(adminUser));
        this.notifyListeners();
        return adminUser;
      }
      throw new Error('Invalid Login ID or password.');
    }

    // In local mode, verify password or default
    const expectedPassword = found.tempPassword || (found.role === 'admin' ? FALLBACK_ADMIN_PASSWORD : 'friend123');
    if (found.password !== password && password !== expectedPassword && !found.passwordHash) {
      throw new Error('Invalid Login ID or password.');
    }

    this.currentUser = {
      id: found.id,
      name: found.name,
      loginId: found.loginId,
      role: found.role || 'friend',
      mustChangePassword: Boolean(found.mustChangePassword),
      isActive: found.isActive !== false,
    };

    localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(this.currentUser));
    this.notifyListeners();
    return this.currentUser;
  }

  async signOut() {
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut();
    }
    localStorage.removeItem(LOCAL_SESSION_KEY);
    this.currentUser = null;
    this.notifyListeners();
  }

  async changePassword(newPassword) {
    if (!newPassword || newPassword.length < 6) {
      throw new Error('New password must be at least 6 characters.');
    }

    if (isSupabaseConfigured && supabase) {
      const { error: authError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (authError) throw new Error(authError.message);

      if (this.currentUser?.id) {
        await supabase
          .from('profiles')
          .update({ must_change_password: false })
          .eq('id', this.currentUser.id);
        
        this.currentUser.mustChangePassword = false;
        this.notifyListeners();
      }
      return true;
    }

    // Local fallback
    if (this.currentUser) {
      this.currentUser.mustChangePassword = false;
      localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(this.currentUser));
      this.notifyListeners();
    }
    return true;
  }

  getCurrentUser() {
    return this.currentUser;
  }

  isAdmin() {
    return this.currentUser?.role === 'admin';
  }
}

export const auth = new AuthService();
