// ============================================================================
// Data Access Layer: Supabase API with Offline Caching & Realtime Sync
// ============================================================================
import { supabase, isSupabaseConfigured } from './supabase.js';
import { auth, slugifyLoginId } from './auth.js';

const CACHE_KEY = 'friends-expense-manager:data:v2';

export const api = {
  // --------------------------------------------------------------------------
  // State Retrieval
  // --------------------------------------------------------------------------
  async fetchState() {
    if (isSupabaseConfigured && supabase) {
      try {
        const [
          { data: profiles, error: profErr },
          { data: expenses, error: expErr },
          { data: participants, error: partErr },
          { data: settlements, error: setErr },
          { data: settings, error: cfgErr },
        ] = await Promise.all([
          supabase.from('profiles').select('*').order('created_at', { ascending: true }),
          supabase.from('expenses').select('*').order('expense_date', { ascending: false }),
          supabase.from('expense_participants').select('*'),
          supabase.from('settlements').select('*').order('settlement_date', { ascending: false }),
          supabase.from('settings').select('*').eq('id', 1).maybeSingle(),
        ]);

        if (profErr) throw profErr;
        if (expErr) throw expErr;
        if (partErr) throw partErr;
        if (setErr) throw setErr;

        // Group participants by expense_id
        const participantsByExpense = new Map();
        (participants || []).forEach((p) => {
          if (!participantsByExpense.has(p.expense_id)) {
            participantsByExpense.set(p.expense_id, []);
          }
          participantsByExpense.get(p.expense_id).push({
            friendId: p.friend_id,
            amount: Number(p.share_amount),
          });
        });

        const formattedExpenses = (expenses || []).map((e) => ({
          id: e.id,
          title: e.title,
          amount: Number(e.amount),
          category: e.category,
          date: e.expense_date,
          payerId: e.payer_id,
          createdBy: e.created_by,
          createdAt: e.created_at,
          participants: participantsByExpense.get(e.id) || [],
        }));

        const formattedSettlements = (settlements || []).map((s) => ({
          id: s.id,
          fromId: s.from_id,
          toId: s.to_id,
          amount: Number(s.amount),
          date: s.settlement_date,
          createdBy: s.created_by,
          createdAt: s.created_at,
        }));

        const formattedFriends = (profiles || []).map((p) => ({
          id: p.id,
          name: p.name,
          loginId: p.login_id,
          role: p.role,
          mustChangePassword: p.must_change_password,
          isActive: p.is_active,
        }));

        const state = {
          version: 2,
          friends: formattedFriends,
          expenses: formattedExpenses,
          settlements: formattedSettlements,
          currentUserId: auth.getCurrentUser()?.id || (formattedFriends[0]?.id ?? 'f-admin'),
          budget: Number(settings?.monthly_budget) || 0,
          groupName: settings?.group_name || 'Friends Expense Manager',
          settings: { notificationsReadAt: null },
        };

        // Cache locally for offline resilience
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(state));
        } catch (_) {}

        return state;
      } catch (err) {
        console.warn('Supabase fetch failed, falling back to local cache:', err);
        return this.loadLocalCache();
      }
    }

    return this.loadLocalCache();
  },

  loadLocalCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.friends)) {
          return parsed;
        }
      }
    } catch (_) {}

    // Initial default state
    const defaultState = {
      version: 2,
      friends: [
        {
          id: 'f-admin',
          name: 'Admin',
          loginId: 'admin',
          role: 'admin',
          mustChangePassword: false,
          isActive: true,
        },
      ],
      expenses: [],
      settlements: [],
      currentUserId: 'f-admin',
      budget: 0,
      groupName: 'Friends Expense Manager',
      settings: { notificationsReadAt: null },
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(defaultState));
    return defaultState;
  },

  saveLocalCache(state) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(state));
    } catch (_) {}
  },

  // --------------------------------------------------------------------------
  // Expense Operations
  // --------------------------------------------------------------------------
  async createExpense(expenseData) {
    const user = auth.getCurrentUser();
    if (isSupabaseConfigured && supabase) {
      const { data: expense, error: expErr } = await supabase
        .from('expenses')
        .insert({
          title: expenseData.title,
          amount: expenseData.amount,
          category: expenseData.category,
          expense_date: expenseData.date,
          payer_id: expenseData.payerId,
          created_by: user?.id,
        })
        .select()
        .single();

      if (expErr) throw expErr;

      const participantRows = expenseData.participants.map((p) => ({
        expense_id: expense.id,
        friend_id: p.friendId,
        share_amount: p.amount,
      }));

      const { error: partErr } = await supabase
        .from('expense_participants')
        .insert(participantRows);

      if (partErr) throw partErr;

      // Audit Log
      await this.logAudit('CREATE_EXPENSE', {
        expense_id: expense.id,
        title: expense.title,
        amount: expense.amount,
      });

      return {
        ...expenseData,
        id: expense.id,
        createdAt: expense.created_at,
      };
    }

    // Local implementation
    const state = this.loadLocalCache();
    const newExpense = {
      id: `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      ...expenseData,
      createdBy: user?.id,
      createdAt: new Date().toISOString(),
    };
    state.expenses.unshift(newExpense);
    this.saveLocalCache(state);
    return newExpense;
  },

  async updateExpense(id, expenseData) {
    if (isSupabaseConfigured && supabase) {
      const { error: expErr } = await supabase
        .from('expenses')
        .update({
          title: expenseData.title,
          amount: expenseData.amount,
          category: expenseData.category,
          expense_date: expenseData.date,
          payer_id: expenseData.payerId,
        })
        .eq('id', id);

      if (expErr) throw expErr;

      // Delete old participants and insert new
      await supabase.from('expense_participants').delete().eq('expense_id', id);

      const participantRows = expenseData.participants.map((p) => ({
        expense_id: id,
        friend_id: p.friendId,
        share_amount: p.amount,
      }));

      const { error: partErr } = await supabase
        .from('expense_participants')
        .insert(participantRows);

      if (partErr) throw partErr;

      await this.logAudit('UPDATE_EXPENSE', {
        expense_id: id,
        title: expenseData.title,
        amount: expenseData.amount,
      });

      return { ...expenseData, id };
    }

    const state = this.loadLocalCache();
    const index = state.expenses.findIndex((e) => e.id === id);
    if (index !== -1) {
      state.expenses[index] = { ...state.expenses[index], ...expenseData };
      this.saveLocalCache(state);
    }
    return { ...expenseData, id };
  },

  async deleteExpense(id) {
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.from('expenses').delete().eq('id', id);
      if (error) throw error;
      await this.logAudit('DELETE_EXPENSE', { expense_id: id });
      return true;
    }

    const state = this.loadLocalCache();
    state.expenses = state.expenses.filter((e) => e.id !== id);
    this.saveLocalCache(state);
    return true;
  },

  // --------------------------------------------------------------------------
  // Settlement Operations
  // --------------------------------------------------------------------------
  async createSettlement(fromId, toId, amount, date) {
    const user = auth.getCurrentUser();
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase
        .from('settlements')
        .insert({
          from_id: fromId,
          to_id: toId,
          amount,
          settlement_date: date || new Date().toISOString().slice(0, 10),
          created_by: user?.id,
        })
        .select()
        .single();

      if (error) throw error;

      await this.logAudit('RECORD_SETTLEMENT', {
        settlement_id: data.id,
        from_id: fromId,
        to_id: toId,
        amount,
      });

      return {
        id: data.id,
        fromId,
        toId,
        amount,
        date: data.settlement_date,
        createdAt: data.created_at,
      };
    }

    const state = this.loadLocalCache();
    const newSettlement = {
      id: `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      fromId,
      toId,
      amount,
      date: date || new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
      createdBy: user?.id,
    };
    state.settlements.unshift(newSettlement);
    this.saveLocalCache(state);
    return newSettlement;
  },

  async deleteSettlement(id) {
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.from('settlements').delete().eq('id', id);
      if (error) throw error;
      await this.logAudit('DELETE_SETTLEMENT', { settlement_id: id });
      return true;
    }

    const state = this.loadLocalCache();
    state.settlements = state.settlements.filter((s) => s.id !== id);
    this.saveLocalCache(state);
    return true;
  },

  // --------------------------------------------------------------------------
  // Friend & Member Management
  // --------------------------------------------------------------------------
  async createFriend(name, loginId, role = 'friend', initialPassword = '') {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.functions.invoke('create-friend', {
        body: { name, loginId, role, initialPassword },
      });

      if (error) throw new Error(error.message || 'Failed to create friend via server');
      if (data?.error) throw new Error(data.error);

      return data.user;
    }

    // Local Fallback
    const state = this.loadLocalCache();
    const cleanLogin = slugifyLoginId(loginId || name);
    const newFriend = {
      id: `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      loginId: cleanLogin,
      role,
      mustChangePassword: true,
      isActive: true,
      tempPassword: initialPassword || 'friend123',
    };
    state.friends.push(newFriend);
    this.saveLocalCache(state);
    return newFriend;
  },

  async resetFriendPassword(friendId, customPassword = '') {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.functions.invoke('reset-password', {
        body: { userId: friendId, customPassword },
      });

      if (error) throw new Error(error.message || 'Failed to reset password');
      if (data?.error) throw new Error(data.error);

      return data.tempPassword;
    }

    const state = this.loadLocalCache();
    const friend = state.friends.find((f) => f.id === friendId);
    if (friend) {
      friend.mustChangePassword = true;
      friend.tempPassword = customPassword || 'friend123';
      this.saveLocalCache(state);
      return friend.tempPassword;
    }
    return 'friend123';
  },

  async toggleFriendActive(friendId, isActive) {
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase
        .from('profiles')
        .update({ is_active: isActive })
        .eq('id', friendId);

      if (error) throw error;
      await this.logAudit(isActive ? 'ACTIVATE_FRIEND' : 'DEACTIVATE_FRIEND', { friendId });
      return true;
    }

    const state = this.loadLocalCache();
    const friend = state.friends.find((f) => f.id === friendId);
    if (friend) {
      friend.isActive = isActive;
      this.saveLocalCache(state);
    }
    return true;
  },

  async deleteFriend(friendId, hardDelete = false) {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.functions.invoke('delete-friend', {
        body: { userId: friendId, hardDelete },
      });

      if (error) throw new Error(error.message || 'Failed to delete friend');
      if (data?.error) throw new Error(data.error);
      return true;
    }

    const state = this.loadLocalCache();
    state.friends = state.friends.filter((f) => f.id !== friendId);
    this.saveLocalCache(state);
    return true;
  },

  async updateRole(friendId, newRole) {
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase
        .from('profiles')
        .update({ role: newRole })
        .eq('id', friendId);

      if (error) throw error;
      await this.logAudit('CHANGE_ROLE', { target_id: friendId, role: newRole });
      return true;
    }

    const state = this.loadLocalCache();
    const friend = state.friends.find((f) => f.id === friendId);
    if (friend) {
      friend.role = newRole;
      this.saveLocalCache(state);
    }
    return true;
  },

  // --------------------------------------------------------------------------
  // Settings & Audit Logs
  // --------------------------------------------------------------------------
  async updateSettings(settingsData) {
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase
        .from('settings')
        .upsert({
          id: 1,
          group_name: settingsData.groupName || 'Friends Expense Manager',
          monthly_budget: settingsData.budget || 0,
          updated_at: new Date().toISOString(),
        });

      if (error) throw error;
      await this.logAudit('UPDATE_SETTINGS', settingsData);
      return true;
    }

    const state = this.loadLocalCache();
    state.budget = Number(settingsData.budget) || 0;
    state.groupName = settingsData.groupName || state.groupName;
    this.saveLocalCache(state);
    return true;
  },

  async fetchAuditLogs() {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase
        .from('audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) {
        console.warn('Could not fetch audit logs:', error);
        return [];
      }
      return data || [];
    }
    return [];
  },

  async logAudit(action, details = {}) {
    const user = auth.getCurrentUser();
    if (isSupabaseConfigured && supabase && user) {
      try {
        await supabase.from('audit_log').insert({
          actor_id: user.id,
          actor_name: user.name,
          action,
          details,
        });
      } catch (err) {
        console.warn('Audit logging failed:', err);
      }
    }
  },

  // --------------------------------------------------------------------------
  // Realtime Subscriptions
  // --------------------------------------------------------------------------
  subscribeToChanges(onUpdate) {
    if (!isSupabaseConfigured || !supabase) return () => {};

    const channel = supabase
      .channel('fem_realtime_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'expenses' },
        () => onUpdate('expenses')
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'settlements' },
        () => onUpdate('settlements')
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        () => onUpdate('profiles')
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'settings' },
        () => onUpdate('settings')
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },

  // --------------------------------------------------------------------------
  // Danger Zone / Clear All Data
  // --------------------------------------------------------------------------
  async resetAllData() {
    if (isSupabaseConfigured && supabase) {
      // Delete expenses and settlements (cascades participants)
      await Promise.all([
        supabase.from('settlements').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
        supabase.from('expenses').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
      ]);
      await this.logAudit('RESET_ALL_DATA', { timestamp: new Date().toISOString() });
      return true;
    }

    const defaultState = {
      version: 2,
      friends: [
        {
          id: 'f-admin',
          name: 'Admin',
          loginId: 'admin',
          role: 'admin',
          mustChangePassword: false,
          isActive: true,
        },
      ],
      expenses: [],
      settlements: [],
      currentUserId: 'f-admin',
      budget: 0,
      groupName: 'Friends Expense Manager',
      settings: { notificationsReadAt: null },
    };
    this.saveLocalCache(defaultState);
    return true;
  },
};
