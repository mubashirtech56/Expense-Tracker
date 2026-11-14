// ============================================================================
// Data Access Layer: Supabase API with Offline Caching & Realtime Sync
// ============================================================================
import { supabase, isSupabaseConfigured } from './supabase.js';
import { auth, slugifyLoginId } from './auth.js';

const CACHE_KEY = 'fem_cached_state';

export const api = {
  isOffline: false,

  // --------------------------------------------------------------------------
  // State Retrieval
  // --------------------------------------------------------------------------
  async fetchState() {
    if (!isSupabaseConfigured || !supabase) {
      this.isOffline = true;
      return { ...this.loadLocalCache(), isOffline: true };
    }

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
      if (cfgErr) throw cfgErr;

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
        status: e.status || 'confirmed',
        confirmedBy: e.confirmed_by,
        confirmedAt: e.confirmed_at,
        createdAt: e.created_at,
        participants: participantsByExpense.get(e.id) || [],
      }));

      const formattedSettlements = (settlements || []).map((s) => ({
        id: s.id,
        fromId: s.from_id,
        toId: s.to_id,
        amount: Number(s.amount),
        date: s.settlement_date,
        status: s.status || 'pending',
        confirmedBy: s.confirmed_by,
        confirmedAt: s.confirmed_at,
        createdBy: s.created_by,
        createdAt: s.created_at,
      }));

      const formattedFriends = (profiles || []).map((p) => ({
        id: p.id,
        name: p.name,
        loginId: p.login_id,
        role: p.role,
        mustChangePassword: Boolean(p.must_change_password),
        isActive: Boolean(p.is_active),
      }));

      const currentUser = auth.getCurrentUser();
      const state = {
        version: 2,
        friends: formattedFriends,
        expenses: formattedExpenses,
        settlements: formattedSettlements,
        currentUserId: currentUser?.id || (formattedFriends[0]?.id ?? null),
        budget: Number(settings?.monthly_budget) || 0,
        groupName: settings?.group_name || 'Friends Expense Manager',
        allowFriendsToAddExpenses: Boolean(settings?.allow_friends_to_add_expenses),
        settings: { notificationsReadAt: null },
        cachedFor: currentUser?.id || null,
        isOffline: false,
      };

      this.isOffline = false;

      // Cache locally for read-only display
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(state));
      } catch (_) {}

      return state;
    } catch (err) {
      console.warn('Supabase fetch failed, showing read-only cached data:', err);
      this.isOffline = true;
      const cached = this.loadLocalCache();
      return { ...cached, isOffline: true };
    }
  },

  loadLocalCache() {
    const currentUserId = auth.getCurrentUser()?.id || null;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Only reuse cache written for the current user; otherwise a previous
        // user's data could leak into another session on the same browser.
        const ownerMatches =
          (parsed?.cachedFor || null) === currentUserId || (!parsed?.cachedFor && !currentUserId);
        if (parsed && Array.isArray(parsed.friends) && ownerMatches) {
          return parsed;
        }
      }
    } catch (_) {}

    return {
      version: 2,
      friends: [],
      expenses: [],
      settlements: [],
      currentUserId: currentUserId,
      budget: 0,
      groupName: 'Friends Expense Manager',
      allowFriendsToAddExpenses: false,
      settings: { notificationsReadAt: null },
      cachedFor: currentUserId,
      isOffline: true,
    };
  },

  // --------------------------------------------------------------------------
  // Expense Operations (RPC based transactional writes)
  // --------------------------------------------------------------------------
  async createExpense(expenseData) {
    if (this.isOffline) {
      throw new Error('Cannot add expenses while offline. Please reconnect and retry.');
    }
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Backend not configured.');
    }

    const { data, error } = await supabase.rpc('create_expense', {
      p_title: String(expenseData.title || '').trim(),
      p_amount: expenseData.amount,
      p_category: expenseData.category,
      p_expense_date: expenseData.date,
      p_payer_id: expenseData.payerId,
      p_participants: expenseData.participants,
    });

    if (error) {
      throw new Error(error.message || 'Failed to create expense');
    }

    return {
      ...expenseData,
      id: data?.id,
      status: auth.isAdmin() ? 'confirmed' : 'pending',
      confirmedBy: auth.isAdmin() ? auth.getCurrentUser()?.id : null,
      createdAt: data?.createdAt || new Date().toISOString(),
    };
  },

  async reviewExpense(id, status) {
    if (this.isOffline) {
      throw new Error('Cannot review expenses while offline. Please reconnect.');
    }
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Backend not configured.');
    }
    if (!auth.isAdmin()) {
      throw new Error('Only an administrator can review expenses.');
    }
    if (!['confirmed', 'rejected'].includes(status)) {
      throw new Error('Invalid expense review status.');
    }

    const { error } = await supabase.rpc('review_expense', {
      p_expense_id: id,
      p_status: status,
    });
    if (error) throw new Error(error.message || 'Failed to review expense');
    return true;
  },

  async updateExpense(id, expenseData) {
    if (this.isOffline) {
      throw new Error('Cannot update expenses while offline. Please reconnect and retry.');
    }
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Backend not configured.');
    }

    const { data, error } = await supabase.rpc('update_expense', {
      p_expense_id: id,
      p_title: String(expenseData.title || '').trim(),
      p_amount: expenseData.amount,
      p_category: expenseData.category,
      p_expense_date: expenseData.date,
      p_payer_id: expenseData.payerId,
      p_participants: expenseData.participants,
    });

    if (error) {
      throw new Error(error.message || 'Failed to update expense');
    }

    return { ...expenseData, id };
  },

  async deleteExpense(id) {
    if (this.isOffline) {
      throw new Error('Cannot delete expenses while offline. Please reconnect and retry.');
    }
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Backend not configured.');
    }

    const { error } = await supabase.from('expenses').delete().eq('id', id);
    if (error) throw new Error(error.message || 'Failed to delete expense');
    return true;
  },

  // --------------------------------------------------------------------------
  // Settlement Operations
  // --------------------------------------------------------------------------
  async createSettlement(fromId, toId, amount, date) {
    if (this.isOffline) {
      throw new Error('Cannot record settlements while offline. Please reconnect and retry.');
    }
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Backend not configured.');
    }

    const user = auth.getCurrentUser();
    const isAdmin = auth.isAdmin();

    // Friends insert 'pending'; admins insert 'confirmed'
    const status = isAdmin ? 'confirmed' : 'pending';
    const confirmedBy = isAdmin ? user?.id : null;
    const confirmedAt = isAdmin ? new Date().toISOString() : null;

    const { data, error } = await supabase
      .from('settlements')
      .insert({
        from_id: fromId,
        to_id: toId,
        amount,
        settlement_date: date || new Date().toISOString().slice(0, 10),
        status,
        confirmed_by: confirmedBy,
        confirmed_at: confirmedAt,
        created_by: user?.id,
      })
      .select()
      .single();

    if (error) throw new Error(error.message || 'Failed to record settlement');

    return {
      id: data.id,
      fromId,
      toId,
      amount,
      date: data.settlement_date,
      status: data.status,
      confirmedBy: data.confirmed_by,
      confirmedAt: data.confirmed_at,
      createdAt: data.created_at,
    };
  },

  async confirmSettlement(id) {
    if (this.isOffline) {
      throw new Error('Cannot confirm settlements while offline. Please reconnect.');
    }
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Backend not configured.');
    }

    const user = auth.getCurrentUser();
    const { error } = await supabase
      .from('settlements')
      .update({
        status: 'confirmed',
        confirmed_by: user?.id,
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) throw new Error(error.message || 'Failed to confirm settlement');
    return true;
  },

  async rejectSettlement(id) {
    if (this.isOffline) {
      throw new Error('Cannot reject settlements while offline. Please reconnect.');
    }
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Backend not configured.');
    }

    const user = auth.getCurrentUser();
    const { error } = await supabase
      .from('settlements')
      .update({
        status: 'rejected',
        confirmed_by: user?.id,
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) throw new Error(error.message || 'Failed to reject settlement');
    return true;
  },

  async deleteSettlement(id) {
    if (this.isOffline) {
      throw new Error('Cannot delete settlements while offline. Please reconnect.');
    }
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Backend not configured.');
    }

    const { error } = await supabase.from('settlements').delete().eq('id', id);
    if (error) throw new Error(error.message || 'Failed to delete settlement');
    return true;
  },

  // --------------------------------------------------------------------------
  // Friend & Member Management
  // --------------------------------------------------------------------------
  async createFriend(name, loginId, role = 'friend') {
    if (this.isOffline) {
      throw new Error('Cannot add members while offline.');
    }
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Backend not configured.');
    }

    const cleanName = String(name ?? '').trim();
    if (!cleanName) {
      throw new Error('Member name is required.');
    }

    const cleanLogin = slugifyLoginId(loginId || cleanName);
    const { data, error } = await supabase.functions.invoke('create-friend', {
      body: { name: cleanName, loginId: cleanLogin, role },
    });

    if (error) throw new Error(error.message || 'Failed to create member');
    if (data?.error) throw new Error(data.error);

    return data.user;
  },

  async resetFriendPassword(friendId, customPassword = '') {
    if (this.isOffline) {
      throw new Error('Cannot reset password while offline.');
    }
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Backend not configured.');
    }

    if (!friendId || typeof friendId !== 'string') {
      throw new Error('A valid member ID is required.');
    }

    const { data, error } = await supabase.functions.invoke('reset-password', {
      body: { userId: friendId, customPassword },
    });

    if (error) throw new Error(error.message || 'Failed to reset password');
    if (data?.error) throw new Error(data.error);

    return data.tempPassword;
  },

  async toggleFriendActive(friendId, isActive) {
    if (this.isOffline) {
      throw new Error('Cannot update members while offline.');
    }
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Backend not configured.');
    }

    const { error } = await supabase
      .from('profiles')
      .update({ is_active: isActive })
      .eq('id', friendId);

    if (error) throw new Error(error.message || 'Failed to toggle member active status');
    return true;
  },

  async deleteFriend(friendId, hardDelete = false) {
    if (this.isOffline) {
      throw new Error('Cannot remove members while offline.');
    }
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Backend not configured.');
    }

    const { data, error } = await supabase.functions.invoke('delete-friend', {
      body: { userId: friendId, hardDelete },
    });

    if (error) throw new Error(error.message || 'Failed to remove member');
    if (data?.error) throw new Error(data.error);
    return data || { success: true };
  },

  async updateRole(friendId, newRole) {
    if (this.isOffline) {
      throw new Error('Cannot change roles while offline.');
    }
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Backend not configured.');
    }

    const { error } = await supabase
      .from('profiles')
      .update({ role: newRole })
      .eq('id', friendId);

    if (error) throw new Error(error.message || 'Failed to update member role');
    return true;
  },

  async updateProfileName(name) {
    if (this.isOffline) {
      throw new Error('Cannot update your profile while offline.');
    }
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Backend not configured.');
    }

    const cleanName = String(name || '').trim();
    if (!cleanName) {
      throw new Error('Display name cannot be empty.');
    }
    if (cleanName.length > 80) {
      throw new Error('Display name must be 80 characters or fewer.');
    }

    const user = auth.getCurrentUser();
    if (!user?.id) {
      throw new Error('You must be signed in to update your profile.');
    }

    const { error } = await supabase
      .from('profiles')
      .update({ name: cleanName })
      .eq('id', user.id);

    if (error) throw new Error(error.message || 'Failed to update display name');
    return true;
  },

  // --------------------------------------------------------------------------
  // Settings & Audit Logs
  // --------------------------------------------------------------------------
  async updateSettings(settingsData) {
    if (this.isOffline) {
      throw new Error('Cannot update settings while offline.');
    }
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Backend not configured.');
    }

    const updatePayload = {
      updated_at: new Date().toISOString(),
    };
    if (settingsData.groupName !== undefined) updatePayload.group_name = settingsData.groupName;
    if (settingsData.budget !== undefined) updatePayload.monthly_budget = settingsData.budget;
    if (settingsData.allowFriendsToAddExpenses !== undefined) {
      updatePayload.allow_friends_to_add_expenses = settingsData.allowFriendsToAddExpenses;
    }

    const { error } = await supabase
      .from('settings')
      .update(updatePayload)
      .eq('id', 1);

    if (error) throw new Error(error.message || 'Failed to update settings');
    return true;
  },

  async fetchAuditLogs() {
    if (!isSupabaseConfigured || !supabase) return [];

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
  },

  // --------------------------------------------------------------------------
  // Realtime Subscriptions (Debounced 300ms, all related tables)
  // --------------------------------------------------------------------------
  subscribeToChanges(onUpdate) {
    if (!isSupabaseConfigured || !supabase) return () => {};

    let debounceTimer = null;
    const debouncedNotify = (table) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        onUpdate(table);
      }, 300);
    };

    const channel = supabase
      .channel('fem_realtime_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'expenses' },
        () => debouncedNotify('expenses')
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'expense_participants' },
        () => debouncedNotify('expense_participants')
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'settlements' },
        () => debouncedNotify('settlements')
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        () => debouncedNotify('profiles')
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'settings' },
        () => debouncedNotify('settings')
      )
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  },

  // --------------------------------------------------------------------------
  // Danger Zone / Clear All Data (Transactional Admin RPC)
  // --------------------------------------------------------------------------
  async resetAllData() {
    if (this.isOffline) {
      throw new Error('Cannot reset data while offline.');
    }
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Backend not configured.');
    }

    const { data, error } = await supabase.rpc('reset_all_data', {
      p_confirmation: 'RESET DATA',
    });

    if (error) {
      throw new Error(error.message || 'Failed to reset all data');
    }
    return data;
  },

  // --------------------------------------------------------------------------
  // Backup Import (Transactional Admin RPC)
  // --------------------------------------------------------------------------
  async importBackup(backupJson) {
    if (this.isOffline) {
      throw new Error('Cannot import backup while offline.');
    }
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Backend not configured.');
    }

    const { data, error } = await supabase.rpc('import_backup', {
      p_data: backupJson,
    });

    if (error) {
      throw new Error(error.message || 'Failed to import backup');
    }
    return data;
  },
};
