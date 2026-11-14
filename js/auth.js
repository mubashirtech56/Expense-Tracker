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

export function hashSecret(password, loginId) {
  const input = `fem-local:v1:${String(loginId || '').toLowerCase()}:${String(password || '')}`;
  let hashOne = 0x811c9dc5;
  let hashTwo = 0x9e3779b9;

  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    hashOne ^= code;
    hashOne = Math.imul(hashOne, 0x01000193);
    hashTwo ^= code;
    hashTwo = Math.imul(hashTwo, 0x01000193);
  }

  return `${(hashOne >>> 0).toString(16)}-${(hashTwo >>> 0).toString(16)}`;
}

class AuthService {
  constructor() {
    this.currentUser = null;
    this.listeners = new Set();

    if (isSupabaseConfigured && supabase) {
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
    let localData = {};
    try {
      localData = JSON.parse(localStorage.getItem(localStoreKey) || '{}');
    } catch (_) {}

    const friends = Array.isArray(localData.friends) ? localData.friends : [];

    // Find member by loginId or fallback for admin
    let found = friends.find(
      (f) => String(f.loginId || f.name || '').toLowerCase() === cleanLogin ||
             (cleanLogin === 'admin' && (f.role === 'admin' || f.id === 'f-admin'))
    );

    // If default admin signs in and no admin exists yet, auto-provision
    if (!found && cleanLogin === FALLBACK_ADMIN_LOGIN) {
      found = {
        id: 'f-admin',
        name: 'Admin',
        loginId: 'admin',
        role: 'admin',
        mustChangePassword: false,
        isActive: true,
      };
      if (!friends.some(f => f.id === 'f-admin')) {
        friends.unshift(found);
        localData.friends = friends;
        try {
          localStorage.setItem(localStoreKey, JSON.stringify(localData));
        } catch (_) {}
      }
    }

    if (!found) {
      throw new Error('Invalid Login ID or password.');
    }

    if (found.isActive === false) {
      throw new Error('Your account has been deactivated. Please contact your admin.');
    }

    // In local mode, verify credentials:
    // 1. If admin, always accept FALLBACK_ADMIN_PASSWORD ("admin123")
    const isAdminDefault = (found.role === 'admin' || found.id === 'f-admin') && password === FALLBACK_ADMIN_PASSWORD;
    // 2. Default friend password fallback ("friend123")
    const isFriendDefault = password === 'friend123';
    // 3. Plain stored password
    const isPlainMatch = (found.password && found.password === password) ||
                         (found.tempPassword && found.tempPassword === password);
    // 4. Stored password hash (from previous app version)
    const isHashMatch = Boolean(found.passwordHash && found.passwordHash === hashSecret(password, found.loginId));

    if (!isAdminDefault && !isFriendDefault && !isPlainMatch && !isHashMatch) {
      throw new Error('Invalid Login ID or password.');
    }

    const adminUser = {
      id: found.id || 'f-admin',
      name: found.name || 'Admin',
      loginId: found.loginId || 'admin',
      role: found.role || 'admin',
      mustChangePassword: Boolean(found.mustChangePassword && !isAdminDefault),
      isActive: true,
    };

    this.currentUser = adminUser;
    try {
      localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(adminUser));
    } catch (_) {}
    this.notifyListeners();
    return adminUser;
  }

  async signOut() {
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut();
    }
    try {
      localStorage.removeItem(LOCAL_SESSION_KEY);
    } catch (_) {}
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
      try {
        localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(this.currentUser));
        const localStoreKey = 'friends-expense-manager:data:v2';
        const localData = JSON.parse(localStorage.getItem(localStoreKey) || '{}');
        if (Array.isArray(localData.friends)) {
          const friend = localData.friends.find(f => f.id === this.currentUser.id);
          if (friend) {
            friend.passwordHash = hashSecret(newPassword, friend.loginId);
            friend.password = newPassword;
            friend.tempPassword = null;
            friend.mustChangePassword = false;
            localStorage.setItem(localStoreKey, JSON.stringify(localData));
          }
        }
      } catch (_) {}
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
