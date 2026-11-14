/* ==========================================================================
   Friends Expense Manager — Application Logic (ES Module)
   Backed by Supabase with offline resilience, full Auth & Admin Panel.
   ========================================================================== */

import { supabase, isSupabaseConfigured } from './supabase.js';
import { auth, slugifyLoginId } from './auth.js';
import { api } from './api.js';

/* ------------------------------------------------------------------------
   SVG Constants (Top of file)
   ---------------------------------------------------------------------- */
export const ARROW_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
export const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;
export const EDIT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
export const TRASH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>`;
export const UNDO_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-1"/></svg>`;
export const EYE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
export const EYE_OFF_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`;

/* ------------------------------------------------------------------------
   Configuration & Metadata
   ---------------------------------------------------------------------- */
const VIEWS = ["dashboard", "portal", "friends", "expenses", "settlements", "reports", "settings", "admin"];

const CATEGORY_META = {
  breakfast: {
    label: "Breakfast",
    color: "#93c5fd",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>`
  },
  lunch: {
    label: "Lunch",
    color: "#60a5fa",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Z"/></svg>`
  },
  dinner: {
    label: "Dinner",
    color: "#2563eb",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>`
  },
  tea: {
    label: "Tea",
    color: "#1e40af",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8h1a4 4 0 0 1 0 8h-1"/><path d="M3 8h14v6a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8Z"/><path d="M6 2v2M10 2v2M14 2v2"/></svg>`
  },
  snacks: {
    label: "Snacks",
    color: "#a5b4fc",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c0 2.5 2 4.5 4.5 4.5 1.4 0 2.7-.6 3.6-1.6.6 1.9.9 4 .9 6.1Z"/><path d="M8.5 8.5h.01M14.5 9.5h.01M9.5 14.5h.01M15.5 15.5h.01"/></svg>`
  }
};

const AVATAR_PALETTES = [
  ["#2563eb", "#1e3a8a"],
  ["#0ea5e9", "#0369a1"],
  ["#4f46e5", "#312e81"],
  ["#0891b2", "#155e75"],
  ["#3b82f6", "#1d4ed8"],
  ["#6366f1", "#4338ca"],
  ["#0284c7", "#075985"],
  ["#2563eb", "#0f172a"],
  ["#0f766e", "#134e4a"],
  ["#475569", "#1e293b"]
];

const VIEW_META = {
  portal: {
    docTitle: "My Portal",
    title: (name) => `${name}'s portal`,
    subtitle: "Your balances, payments and personal history."
  },
  dashboard: {
    docTitle: "Dashboard",
    title: (name) => `Welcome back, ${name}!`,
    subtitle: "Here's what's happening with your friends' expenses."
  },
  friends: {
    docTitle: "Friends",
    title: "Friends",
    subtitle: "Manage your circle and keep every balance transparent."
  },
  expenses: {
    docTitle: "Expenses",
    title: "Expenses",
    subtitle: "Every meal, snack and chai session in one place."
  },
  settlements: {
    docTitle: "Settlements",
    title: "Settlements",
    subtitle: "The simplest way to square up with everyone."
  },
  reports: {
    docTitle: "Reports",
    title: "Reports",
    subtitle: "A clear view of how the group is spending."
  },
  settings: {
    docTitle: "Settings",
    title: "Settings",
    subtitle: "Tune your preferences and account security."
  },
  admin: {
    docTitle: "Admin Panel",
    title: "Admin Panel",
    subtitle: "Manage group members, global budget and audit records."
  }
};

/* ------------------------------------------------------------------------
   Application State
   ---------------------------------------------------------------------- */
let state = {
  version: 2,
  friends: [],
  expenses: [],
  settlements: [],
  currentUserId: null,
  budget: 0,
  groupName: "Friends Expense Manager",
  settings: { notificationsReadAt: null }
};

let cachedLedger = null;
let cachedFriendStats = null;
let editingExpenseId = null;
let activeLedgerFriendId = null;
let lastFocusedElement = null;
const expenseFilters = { search: "", category: "all" };

/* ------------------------------------------------------------------------
   DOM Elements
   ---------------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", async () => {
  const appShell = document.getElementById("appShell");
  const loginScreen = document.getElementById("loginScreen");
  const loginForm = document.getElementById("loginForm");
  const loginIdInput = document.getElementById("loginId");
  const loginPasswordInput = document.getElementById("loginPassword");
  const loginError = document.getElementById("loginError");
  const loginHelp = document.getElementById("loginHelp");
  const logoutBtn = document.getElementById("logoutBtn");
  const toggleLoginPasswordBtn = document.getElementById("toggleLoginPasswordBtn");

  const themeToggleBtn = document.getElementById("themeToggleBtn");
  const sidebar = document.getElementById("sidebar");
  const sidebarOverlay = document.getElementById("sidebarOverlay");
  const menuToggle = document.getElementById("menuToggle");
  const navLinks = Array.from(document.querySelectorAll(".nav-link"));
  const portalNavLink = document.getElementById("portalNavLink");
  const adminNavLink = document.getElementById("adminNavLink");
  const pageTitle = document.getElementById("pageTitle");
  const pageSubtitle = document.getElementById("pageSubtitle");

  const notificationRoot = document.getElementById("notification");
  const notificationBtn = document.getElementById("notificationBtn");
  const notificationMenu = document.getElementById("notificationMenu");
  const notificationList = document.getElementById("notificationList");
  const notificationDot = document.getElementById("notificationDot");
  const notificationSubtitle = document.getElementById("notificationSubtitle");
  const markReadBtn = document.getElementById("markReadBtn");

  const profileBtn = document.getElementById("profileBtn");
  const profileAvatar = document.getElementById("profileAvatar");
  const profileName = document.getElementById("profileName");
  const profileRole = document.getElementById("profileRole");
  const sidebarTotal = document.getElementById("sidebarTotal");
  const sidebarBudgetBar = document.getElementById("sidebarBudgetBar");
  const sidebarBudgetText = document.getElementById("sidebarBudgetText");

  const statTotal = document.getElementById("statTotal");
  const statTotalTrend = document.getElementById("statTotalTrend");
  const statTotalHint = document.getElementById("statTotalHint");
  const statReceive = document.getElementById("statReceive");
  const statReceiveTrend = document.getElementById("statReceiveTrend");
  const statReceiveHint = document.getElementById("statReceiveHint");
  const statOwe = document.getElementById("statOwe");
  const statOweTrend = document.getElementById("statOweTrend");
  const statOweHint = document.getElementById("statOweHint");
  const statFriends = document.getElementById("statFriends");
  const statFriendsHint = document.getElementById("statFriendsHint");

  const friendsOverviewGrid = document.getElementById("friendsOverviewGrid");
  const friendsOverviewSub = document.getElementById("friendsOverviewSub");
  const recentExpensesList = document.getElementById("recentExpensesList");

  const chart = document.getElementById("donutChart");
  const chartLegend = document.getElementById("chartLegend");
  const chartTotal = document.getElementById("chartTotal");
  const chartChip = document.getElementById("chartChip");
  const chartNote = document.getElementById("chartNote");

  const friendsPageGrid = document.getElementById("friendsPageGrid");
  const friendsPageSub = document.getElementById("friendsPageSub");
  const addFriendBtn = document.getElementById("addFriendBtn");

  const expensesList = document.getElementById("expensesList");
  const expensesEmpty = document.getElementById("expensesEmpty");
  const expenseSearch = document.getElementById("expenseSearch");
  const expenseFilter = document.getElementById("expenseFilter");
  const expenseCount = document.getElementById("expenseCount");

  const settlementsList = document.getElementById("settlementsList");
  const settlementsHistory = document.getElementById("settlementsHistory");
  const settlementsSub = document.getElementById("settlementsSub");
  const settlementsChip = document.getElementById("settlementsChip");

  const reportTotal = document.getElementById("reportTotal");
  const reportTotalHint = document.getElementById("reportTotalHint");
  const reportAverage = document.getElementById("reportAverage");
  const reportAverageHint = document.getElementById("reportAverageHint");
  const reportTopCategory = document.getElementById("reportTopCategory");
  const reportTopCategoryHint = document.getElementById("reportTopCategoryHint");
  const reportActiveFriends = document.getElementById("reportActiveFriends");
  const reportActiveFriendsHint = document.getElementById("reportActiveFriendsHint");
  const reportCategoryBars = document.getElementById("reportCategoryBars");
  const reportContributors = document.getElementById("reportContributors");
  const reportMonths = document.getElementById("reportMonths");

  const settingsForm = document.getElementById("settingsForm");
  const settingsName = document.getElementById("settingsName");
  const settingsBudget = document.getElementById("settingsBudget");
  const settingsLoginId = document.getElementById("settingsLoginId");
  const exportDataBtn = document.getElementById("exportDataBtn");
  const resetDataBtn = document.getElementById("resetDataBtn");
  const exportCsvBtn = document.getElementById("exportCsvBtn");
  const importDataBtn = document.getElementById("importDataBtn");
  const importDataInput = document.getElementById("importDataInput");

  // Admin view elements
  const adminMembersList = document.getElementById("adminMembersList");
  const adminAddMemberBtn = document.getElementById("adminAddMemberBtn");
  const adminGroupForm = document.getElementById("adminGroupForm");
  const adminGroupName = document.getElementById("adminGroupName");
  const adminGroupBudget = document.getElementById("adminGroupBudget");
  const adminAuditList = document.getElementById("adminAuditList");
  const refreshAuditBtn = document.getElementById("refreshAuditBtn");
  const adminResetDataBtn = document.getElementById("adminResetDataBtn");

  // Modals & Forms
  const expenseModal = document.getElementById("expenseModal");
  const expenseForm = document.getElementById("expenseForm");
  const expenseModalTitle = document.getElementById("expenseModalTitle");
  const expenseModalSubtitle = document.getElementById("expenseModalSubtitle");
  const expenseTitle = document.getElementById("expenseTitle");
  const expenseAmount = document.getElementById("expenseAmount");
  const expenseCategory = document.getElementById("expenseCategory");
  const expenseDate = document.getElementById("expenseDate");
  const expensePayer = document.getElementById("expensePayer");
  const participantGrid = document.getElementById("participantGrid");
  const splitEquallyBtn = document.getElementById("splitEquallyBtn");
  const selectAllParticipants = document.getElementById("selectAllParticipants");
  const allocationBar = document.getElementById("allocationBar");
  const allocationAmount = document.getElementById("allocationAmount");
  const allocationTotal = document.getElementById("allocationTotal");
  const allocationStatus = document.getElementById("allocationStatus");
  const expenseSubmitLabel = document.getElementById("expenseSubmitLabel");
  const addExpenseBtn = document.getElementById("addExpenseBtn");

  const friendModal = document.getElementById("friendModal");
  const friendForm = document.getElementById("friendForm");
  const friendName = document.getElementById("friendName");

  const friendLedgerModal = document.getElementById("friendLedgerModal");
  const friendLedgerAvatar = document.getElementById("friendLedgerAvatar");
  const friendLedgerTitle = document.getElementById("friendLedgerTitle");
  const friendLedgerSub = document.getElementById("friendLedgerSub");
  const friendLedgerContent = document.getElementById("friendLedgerContent");

  const portalLedger = document.getElementById("portalLedger");
  const portalSub = document.getElementById("portalSub");
  const portalLoginChip = document.getElementById("portalLoginChip");
  const portalAccountId = document.getElementById("portalAccountId");
  const portalPasswordHint = document.getElementById("portalPasswordHint");
  const passwordForms = Array.from(document.querySelectorAll("[data-password-form]"));
  const toastContainer = document.getElementById("toastContainer");

  // Custom Accessible Confirm Modal
  const confirmModal = document.getElementById("confirmModal");
  const confirmModalTitle = document.getElementById("confirmModalTitle");
  const confirmModalMessage = document.getElementById("confirmModalMessage");
  const confirmModalTypedWrapper = document.getElementById("confirmModalTypedWrapper");
  const confirmModalInput = document.getElementById("confirmModalInput");
  const confirmModalInputLabel = document.getElementById("confirmModalInputLabel");
  const confirmModalCancelBtn = document.getElementById("confirmModalCancelBtn");
  const confirmModalOkBtn = document.getElementById("confirmModalOkBtn");

  /* ------------------------------------------------------------------------
     Theme Management (Phase 3)
     ---------------------------------------------------------------------- */
  function initTheme() {
    const saved = localStorage.getItem("fem_theme");
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const theme = saved || (prefersDark ? "dark" : "light");
    applyTheme(theme);
  }

  function applyTheme(theme) {
    if (theme === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
      themeToggleBtn?.setAttribute("aria-label", "Switch to light theme");
      themeToggleBtn?.setAttribute("title", "Switch to light theme");
    } else {
      document.documentElement.removeAttribute("data-theme");
      themeToggleBtn?.setAttribute("aria-label", "Switch to dark theme");
      themeToggleBtn?.setAttribute("title", "Switch to dark theme");
    }
    localStorage.setItem("fem_theme", theme);
  }

  themeToggleBtn?.addEventListener("click", () => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    applyTheme(isDark ? "light" : "dark");
  });

  initTheme();

  /* ------------------------------------------------------------------------
     Password Visibility Toggle (Phase 3)
     ---------------------------------------------------------------------- */
  toggleLoginPasswordBtn?.addEventListener("click", () => {
    if (!loginPasswordInput) return;
    const isPassword = loginPasswordInput.type === "password";
    loginPasswordInput.type = isPassword ? "text" : "password";
    toggleLoginPasswordBtn.innerHTML = isPassword ? EYE_OFF_ICON : EYE_ICON;
    toggleLoginPasswordBtn.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
  });

  /* ------------------------------------------------------------------------
     Custom Accessible Confirm Dialog (Replaces window.confirm)
     ---------------------------------------------------------------------- */
  let confirmDialogResolver = null;

  function showConfirmDialog({
    title = "Confirm Action",
    message = "Are you sure you want to proceed?",
    confirmText = "Confirm",
    cancelText = "Cancel",
    isDanger = true,
    requireTypedText = null
  }) {
    return new Promise((resolve) => {
      confirmDialogResolver = resolve;
      if (!confirmModal) {
        resolve(window.confirm(message));
        return;
      }

      confirmModalTitle.textContent = title;
      confirmModalMessage.textContent = message;
      confirmModalOkBtn.textContent = confirmText;
      confirmModalCancelBtn.textContent = cancelText;

      confirmModalOkBtn.className = isDanger ? "button button--danger" : "button button--primary";

      if (requireTypedText) {
        confirmModalTypedWrapper.classList.remove("hidden");
        confirmModalInputLabel.textContent = `Type "${requireTypedText}" to confirm:`;
        confirmModalInput.value = "";
        confirmModalOkBtn.disabled = true;

        confirmModalInput.oninput = () => {
          confirmModalOkBtn.disabled = confirmModalInput.value.trim() !== requireTypedText;
        };
      } else {
        confirmModalTypedWrapper.classList.add("hidden");
        confirmModalOkBtn.disabled = false;
        confirmModalInput.oninput = null;
      }

      openModal(confirmModal);
      if (requireTypedText) {
        setTimeout(() => confirmModalInput.focus(), 80);
      } else {
        setTimeout(() => confirmModalCancelBtn.focus(), 80);
      }
    });
  }

  function closeConfirmDialog(result) {
    if (confirmModal) {
      closeModal(confirmModal);
    }
    if (confirmDialogResolver) {
      const resolve = confirmDialogResolver;
      confirmDialogResolver = null;
      resolve(result);
    }
  }

  confirmModalOkBtn?.addEventListener("click", () => closeConfirmDialog(true));
  confirmModalCancelBtn?.addEventListener("click", () => closeConfirmDialog(false));

  /* ------------------------------------------------------------------------
     Sanitization & String Formatting Helpers
     ---------------------------------------------------------------------- */
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);
  }

  function roundMoney(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function formatMoney(value) {
    const amount = roundMoney(value);
    return `Rs. ${amount.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }

  function formatSignedMoney(value) {
    const amount = roundMoney(value);
    if (Math.abs(amount) < 0.005) return "Rs. 0.00";
    const sign = amount > 0 ? "+" : "-";
    return `${sign}${formatMoney(Math.abs(amount))}`;
  }

  function formatDate(isoString) {
    if (!isoString) return "—";
    const [year, month, day] = String(isoString).split("T")[0].split("-").map(Number);
    if (!year || !month || !day) return isoString;
    return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-IN", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }

  function timeAgo(isoString) {
    if (!isoString) return "just now";
    const timestamp = new Date(isoString).getTime();
    if (Number.isNaN(timestamp)) return "recently";
    const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return formatDate(isoString);
  }

  function getInitials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "F";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function avatarStyle(index) {
    const palette = AVATAR_PALETTES[Math.abs(index) % AVATAR_PALETTES.length];
    return `background: linear-gradient(135deg, ${palette[0]}, ${palette[1]}); color: #ffffff;`;
  }

  function friendAvatar(friend, index) {
    const label = escapeHtml(friend?.name || "Friend");
    return `<span class="avatar" style="${avatarStyle(index)}" aria-label="${label}">${getInitials(friend?.name)}</span>`;
  }

  function getFriend(id) {
    return state.friends.find((friend) => friend.id === id) || null;
  }

  function getFriendName(id) {
    return getFriend(id)?.name || "Friend";
  }

  function friendIndex(id) {
    const index = state.friends.findIndex((friend) => friend.id === id);
    return index >= 0 ? index : 0;
  }

  function getAllActiveFriends() {
    return state.friends.filter((f) => f.isActive !== false);
  }

  function getTodayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function listNames(ids) {
    return ids.map((id) => getFriendName(id)).filter(Boolean);
  }

  function describeNames(names, prefix = "With") {
    if (!names.length) return "";
    if (names.length === 1) return `${prefix} ${names[0]}`;
    if (names.length === 2) return `${prefix} ${names[0]} and ${names[1]}`;
    return `${prefix} ${names[0]}, ${names[1]} and ${names.length - 2} more`;
  }

  function invalidateCaches() {
    cachedLedger = null;
    cachedFriendStats = null;
  }

  function showToast(message, duration = 3200) {
    if (!toastContainer) return;
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    toastContainer.appendChild(toast);

    window.setTimeout(() => {
      toast.classList.add("is-visible");
    }, 10);

    window.setTimeout(() => {
      toast.classList.remove("is-visible");
      window.setTimeout(() => toast.remove(), 260);
    }, duration);
  }

  /* ------------------------------------------------------------------------
     Mathematical Balance Engine (Phase 0 Fix)
     Global Net Balance = (Paid + Settlements Sent) - (Shares + Settlements Received)
     ---------------------------------------------------------------------- */
  function getFriendStats() {
    if (cachedFriendStats) return cachedFriendStats;

    const stats = state.friends.map((friend, index) => {
      let paid = 0;
      let share = 0;
      let settledSent = 0;
      let settledReceived = 0;

      state.expenses.forEach((expense) => {
        if (expense.payerId === friend.id) {
          paid = roundMoney(paid + Number(expense.amount));
        }
        (expense.participants || []).forEach((p) => {
          if (p.friendId === friend.id) {
            share = roundMoney(share + Number(p.amount));
          }
        });
      });

      state.settlements.forEach((s) => {
        if (s.fromId === friend.id) {
          settledSent = roundMoney(settledSent + Number(s.amount));
        }
        if (s.toId === friend.id) {
          settledReceived = roundMoney(settledReceived + Number(s.amount));
        }
      });

      const net = roundMoney((paid + settledSent) - (share + settledReceived));
      const receives = net > 0.005 ? net : 0;
      const owes = net < -0.005 ? roundMoney(-net) : 0;

      return {
        friend,
        index,
        paid,
        share,
        settledSent,
        settledReceived,
        receives,
        owes,
        net
      };
    });

    cachedFriendStats = stats;
    return cachedFriendStats;
  }

  function getSuggestedSettlements() {
    const stats = getFriendStats();
    const creditors = stats
      .filter((s) => s.net > 0.005)
      .map((s) => ({ id: s.friend.id, amount: s.net }))
      .sort((a, b) => b.amount - a.amount);

    const debtors = stats
      .filter((s) => s.net < -0.005)
      .map((s) => ({ id: s.friend.id, amount: roundMoney(-s.net) }))
      .sort((a, b) => b.amount - a.amount);

    const transfers = [];
    let dIdx = 0;
    let cIdx = 0;

    while (dIdx < debtors.length && cIdx < creditors.length) {
      const debtor = debtors[dIdx];
      const creditor = creditors[cIdx];
      const amount = roundMoney(Math.min(debtor.amount, creditor.amount));

      if (amount > 0.005) {
        transfers.push({ fromId: debtor.id, toId: creditor.id, amount });
      }

      debtor.amount = roundMoney(debtor.amount - amount);
      creditor.amount = roundMoney(creditor.amount - amount);

      if (debtor.amount <= 0.005) dIdx += 1;
      if (creditor.amount <= 0.005) cIdx += 1;
    }

    return transfers;
  }

  function getLedger() {
    if (cachedLedger) return cachedLedger;

    const ledger = {};
    state.friends.forEach((friend) => {
      ledger[friend.id] = {};
    });

    const transfers = getSuggestedSettlements();
    transfers.forEach(({ fromId, toId, amount }) => {
      if (ledger[fromId]) {
        ledger[fromId][toId] = roundMoney((ledger[fromId][toId] || 0) + amount);
      }
    });

    cachedLedger = ledger;
    return cachedLedger;
  }

  function getBalanceStatus(net) {
    if (Math.abs(net) < 0.005) {
      return { label: "Settled", tone: "neutral", amountClass: "neutral" };
    }
    if (net > 0) {
      return { label: "Gets Money", tone: "positive", amountClass: "positive" };
    }
    return { label: "Owes Money", tone: "negative", amountClass: "negative" };
  }

  function getCurrentUserBalances() {
    const currentId = state.currentUserId;
    const ledger = getLedger();

    const oweEntries = Object.entries(ledger[currentId] || {})
      .filter(([_, amount]) => amount > 0.005)
      .map(([toId, amount]) => ({
        friend: getFriend(toId),
        amount: roundMoney(amount)
      }))
      .filter((entry) => Boolean(entry.friend));

    const receiveEntries = [];
    Object.entries(ledger).forEach(([fromId, debts]) => {
      if (fromId !== currentId && (debts[currentId] || 0) > 0.005) {
        receiveEntries.push({
          friend: getFriend(fromId),
          amount: roundMoney(debts[currentId])
        });
      }
    });

    const stats = getFriendStats().find((s) => s.friend.id === currentId);
    const owes = stats ? stats.owes : 0;
    const receives = stats ? stats.receives : 0;
    const net = stats ? stats.net : 0;

    return {
      receives: roundMoney(receives),
      owes: roundMoney(owes),
      net: roundMoney(net),
      oweEntries,
      receiveEntries
    };
  }

  function getFriendLedger(friendId) {
    const friend = getFriend(friendId);
    if (!friend) return null;

    const ledger = getLedger();
    const otherFriends = state.friends.filter((entry) => entry.id !== friendId);

    const payTo = otherFriends
      .map((other) => ({ friend: other, amount: roundMoney(ledger[friendId]?.[other.id] || 0) }))
      .filter((entry) => entry.amount > 0.005)
      .sort((a, b) => b.amount - a.amount);

    const receiveFrom = otherFriends
      .map((other) => ({ friend: other, amount: roundMoney(ledger[other.id]?.[friendId] || 0) }))
      .filter((entry) => entry.amount > 0.005)
      .sort((a, b) => b.amount - a.amount);

    const stats = getFriendStats().find((s) => s.friend.id === friendId);
    const owes = stats ? stats.owes : 0;
    const receives = stats ? stats.receives : 0;
    const net = stats ? stats.net : 0;

    const activity = [];
    state.expenses.forEach((expense) => {
      const isPayer = expense.payerId === friendId;
      const participant = (expense.participants || []).find((p) => p.friendId === friendId);
      if (!isPayer && !participant) return;

      const share = participant ? roundMoney(participant.amount) : 0;
      const meta = CATEGORY_META[expense.category] || CATEGORY_META.lunch;
      const payerName = isPayer ? "you" : getFriendName(expense.payerId);
      const count = (expense.participants || []).length;
      const shareNote = count > 1 ? ` · Split with ${count} friends` : " · Solo expense";

      activity.push({
        id: expense.id,
        type: "expense",
        date: expense.date,
        createdAt: expense.createdAt || `${expense.date}T00:00:00Z`,
        title: expense.title,
        detail: `${formatDate(expense.date)} · ${meta.label} · Paid by ${payerName}${shareNote}`,
        amount: isPayer ? roundMoney(expense.amount) : share,
        amountLabel: isPayer ? "paid" : "share",
        amountClass: isPayer ? "positive" : "negative",
        icon: meta.icon,
        color: meta.color
      });
    });

    state.settlements.forEach((settlement) => {
      const isSender = settlement.fromId === friendId;
      const isReceiver = settlement.toId === friendId;
      if (!isSender && !isReceiver) return;

      const otherId = isSender ? settlement.toId : settlement.fromId;
      activity.push({
        id: settlement.id,
        type: "settlement",
        date: settlement.date,
        createdAt: settlement.createdAt || `${settlement.date}T00:00:00Z`,
        title: isSender ? `Paid ${getFriendName(otherId)}` : `Received from ${getFriendName(otherId)}`,
        detail: `${formatDate(settlement.date)} · Settlement`,
        amount: roundMoney(settlement.amount),
        amountLabel: isSender ? "paid" : "received",
        amountClass: isSender ? "negative" : "positive",
        icon: ARROW_ICON,
        color: isSender ? "#c2410c" : "#15803d"
      });
    });

    activity.sort((a, b) => {
      const dateCompare = String(b.date || "").localeCompare(String(a.date || ""));
      if (dateCompare !== 0) return dateCompare;
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    });

    return { friend, payTo, receiveFrom, owes, receives, net, activity };
  }

  function getSortedExpenses() {
    return [...state.expenses].sort((a, b) => {
      const dateDiff = String(b.date || "").localeCompare(String(a.date || ""));
      if (dateDiff !== 0) return dateDiff;
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    });
  }

  function getCategoryStats() {
    return Object.entries(CATEGORY_META).map(([key, meta]) => {
      const matching = state.expenses.filter((e) => e.category === key);
      const amount = matching.reduce((sum, e) => sum + Number(e.amount), 0);
      return {
        key,
        label: meta.label,
        color: meta.color,
        amount: roundMoney(amount),
        count: matching.length
      };
    });
  }

  /* ------------------------------------------------------------------------
     Rendering Engine
     ---------------------------------------------------------------------- */
  function renderAll() {
    renderAccessControl();
    renderSidebar();
    renderProfile();
    renderDashboard();
    renderFriendsPage();
    renderExpensesPage();
    renderSettlements();
    renderReports();
    renderSettingsForm();
    renderAdminPanel();
    renderPortal();
    renderNotifications();
    renderRoute(false, false);
  }

  function renderAccessControl() {
    const admin = auth.isAdmin();
    document.body.dataset.role = admin ? "admin" : "friend";

    navLinks.forEach((link) => {
      const view = link.dataset.nav;
      if (view === "admin") {
        link.hidden = !admin;
      } else if (view === "portal") {
        link.hidden = admin;
      }
    });

    if (portalNavLink) portalNavLink.hidden = admin;
    if (adminNavLink) adminNavLink.hidden = !admin;
  }

  function renderSidebar() {
    const balances = getCurrentUserBalances();
    const net = balances.net;

    if (sidebarTotal) {
      sidebarTotal.textContent = formatSignedMoney(net);
      sidebarTotal.className = `sidebar-balance__val amount--${getBalanceStatus(net).amountClass}`;
    }

    if (sidebarBudgetBar && sidebarBudgetText) {
      const budget = Number(state.budget) || 0;
      const monthKey = getTodayISO().slice(0, 7);
      const monthTotal = state.expenses
        .filter((expense) => String(expense.date).slice(0, 7) === monthKey)
        .reduce((sum, expense) => sum + Number(expense.amount), 0);

      const ratio = budget > 0 ? Math.min(100, (monthTotal / budget) * 100) : 0;
      sidebarBudgetBar.style.width = `${ratio}%`;
      sidebarBudgetText.textContent = budget > 0
        ? `${Math.round(ratio)}% of ${formatMoney(budget)} monthly budget`
        : "Set a monthly budget in Settings or Admin.";
    }
  }

  function renderProfile() {
    const current = auth.getCurrentUser() || state.friends[0];
    if (!current) return;
    const index = friendIndex(current.id);

    if (profileAvatar) {
      profileAvatar.textContent = getInitials(current.name);
      profileAvatar.style.cssText = avatarStyle(index);
    }
    if (profileName) profileName.textContent = current.name || "Member";
    if (profileRole) profileRole.textContent = current.role === "admin" ? "Admin" : "Friend";
  }

  function expenseRowMarkup(expense, options = {}) {
    const meta = CATEGORY_META[expense.category] || CATEGORY_META.lunch;
    const payer = getFriend(expense.payerId);
    const payerName = payer?.name || "Unknown";
    const participantNames = listNames(expense.participants.map((p) => p.friendId));
    const manage = Boolean(options.manage);

    return `
      <article class="expense-row ${manage ? "expense-row--manage" : ""}">
        <span class="expense-icon expense-icon--${escapeHtml(expense.category)}" style="background:${meta.color}1f;color:${meta.color}" aria-hidden="true">
          ${meta.icon}
        </span>
        <div class="expense-row__copy">
          <h3>${escapeHtml(expense.title)}</h3>
          <p>
            Paid by ${escapeHtml(payerName)}
            <span>•</span>
            ${escapeHtml(meta.label)}
            <span>•</span>
            ${escapeHtml(formatDate(expense.date))}
            <span>•</span>
            ${expense.participants.length} ${expense.participants.length === 1 ? "person" : "people"}
          </p>
        </div>
        <div class="expense-row__amount">
          <strong>${formatMoney(expense.amount)}</strong>
          <span>${escapeHtml(describeNames(participantNames, "Split with"))}</span>
        </div>
        ${manage ? `
          <div class="expense-row__actions">
            <button class="icon-btn icon-btn--sm" type="button" data-edit-expense="${escapeHtml(expense.id)}" aria-label="Edit ${escapeHtml(expense.title)}" title="Edit expense">
              ${EDIT_ICON}
            </button>
            <button class="icon-btn icon-btn--sm icon-btn--danger" type="button" data-delete-expense="${escapeHtml(expense.id)}" aria-label="Delete ${escapeHtml(expense.title)}" title="Delete expense">
              ${TRASH_ICON}
            </button>
          </div>
        ` : ""}
      </article>
    `;
  }

  function setStatValue(element, value, isMoney = true) {
    if (!element) return;
    element.textContent = isMoney ? formatMoney(value) : String(value);
  }

  function renderDashboard() {
    const sorted = getSortedExpenses();
    const total = state.expenses.reduce((sum, expense) => sum + Number(expense.amount), 0);
    const monthKey = getTodayISO().slice(0, 7);
    const monthTotal = state.expenses
      .filter((expense) => String(expense.date).slice(0, 7) === monthKey)
      .reduce((sum, expense) => sum + Number(expense.amount), 0);

    const balances = getCurrentUserBalances();
    const stats = getFriendStats().filter((entry) => entry.friend.id !== state.currentUserId);

    setStatValue(statTotal, total);
    if (statTotalTrend) statTotalTrend.textContent = monthTotal > 0 ? `${formatMoney(monthTotal)} this month` : "All time";
    if (statTotalHint) statTotalHint.textContent = `${state.expenses.length} ${state.expenses.length === 1 ? "expense" : "expenses"} tracked`;

    setStatValue(statReceive, balances.receives);
    if (statReceiveTrend) {
      statReceiveTrend.textContent = `${balances.receiveEntries.length} ${balances.receiveEntries.length === 1 ? "friend" : "friends"}`;
    }
    if (statReceiveHint) {
      statReceiveHint.textContent = balances.receiveEntries.length
        ? "Pairwise suggested settlements"
        : "All square right now";
    }

    setStatValue(statOwe, balances.owes);
    if (statOweTrend) {
      statOweTrend.textContent = `${balances.oweEntries.length} ${balances.oweEntries.length === 1 ? "friend" : "friends"}`;
    }
    if (statOweHint) {
      statOweHint.textContent = balances.oweEntries.length
        ? "Pairwise suggested settlements"
        : "Nothing pending";
    }

    setStatValue(statFriends, stats.length, false);
    if (statFriendsHint) statFriendsHint.textContent = `${stats.filter((entry) => Math.abs(entry.net) > 0.005).length} with open balances`;

    if (friendsOverviewSub) {
      const activeCount = new Set(
        state.expenses.flatMap((expense) => (expense.participants || []).map((participant) => participant.friendId))
      ).size;
      const friendWord = stats.length === 1 ? "friend" : "friends";
      friendsOverviewSub.textContent = `${stats.length} ${friendWord} · ${activeCount} sharing expenses · tap a card for history`;
    }

    if (friendsOverviewGrid) {
      friendsOverviewGrid.innerHTML = stats.length ? stats.map((entry) => {
        const status = getBalanceStatus(entry.net);
        const name = escapeHtml(entry.friend.name);

        return `
          <article class="friend-card friend-card--ledger">
            <button class="friend-card__open" type="button" data-friend-ledger="${escapeHtml(entry.friend.id)}" aria-label="Open ${name}'s balance history" title="Open ${name}'s history"></button>
            <div class="friend-card__top">
              ${friendAvatar(entry.friend, entry.index)}
              <div class="friend-card__identity">
                <h3>${name}</h3>
                <p>Paid ${formatMoney(entry.paid)}</p>
              </div>
              <span class="badge badge--${status.tone}">${status.label}</span>
            </div>
            <div class="friend-card__bottom">
              <span>Net balance</span>
              <span class="friend-card__balance">
                <strong class="amount amount--${status.amountClass}">${formatSignedMoney(entry.net)}</strong>
                <svg class="friend-card__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m9 6 6 6-6 6"/>
                </svg>
              </span>
            </div>
          </article>
        `;
      }).join("") : `<div class="empty-state empty-state--inline"><strong>No friends yet</strong><p>Add friends in the Friends view or Admin panel.</p></div>`;
    }

    if (recentExpensesList) {
      const recent = sorted.slice(0, 5);
      recentExpensesList.innerHTML = recent.length
        ? recent.map((expense) => expenseRowMarkup(expense)).join("")
        : `<div class="empty-state empty-state--inline"><strong>No expenses yet</strong><p>Add the first shared bill to get started.</p></div>`;
    }

    renderChart();
  }

  function renderChart() {
    if (!chart || !chartLegend) return;

    const categories = getCategoryStats();
    const total = categories.reduce((sum, category) => sum + category.amount, 0);

    if (chartTotal) chartTotal.textContent = formatMoney(total);
    if (chartChip) chartChip.textContent = `${state.expenses.length} ${state.expenses.length === 1 ? "bill" : "bills"}`;

    if (total <= 0) {
      chart.style.background = "conic-gradient(#e2e8f0 0% 100%)";
      chartLegend.innerHTML = `<p class="empty-state--inline">No spending data yet.</p>`;
      if (chartNote) chartNote.textContent = "Add an expense to see how the group spends.";
      return;
    }

    let cursor = 0;
    const segments = [];
    const visibleCategories = categories.filter((category) => category.amount > 0);

    visibleCategories.forEach((category) => {
      const share = (category.amount / total) * 100;
      const start = cursor;
      const end = Math.min(100, cursor + share);
      segments.push(`${category.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`);
      cursor = end;
    });

    const last = visibleCategories[visibleCategories.length - 1];
    if (cursor < 100 && last) {
      segments.push(`${last.color} ${cursor.toFixed(2)}% 100%`);
    }

    chart.style.background = `conic-gradient(${segments.join(", ")})`;
    chartLegend.innerHTML = visibleCategories.map((category) => {
      const percent = Math.round((category.amount / total) * 100);
      return `
        <div class="legend-row">
          <span class="legend-dot" style="background:${category.color}"></span>
          <span class="legend-label">${escapeHtml(category.label)}</span>
          <span class="legend-value">${formatMoney(category.amount)}</span>
          <span class="legend-pct">${percent}%</span>
        </div>
      `;
    }).join("");

    if (chartNote) {
      const top = [...visibleCategories].sort((a, b) => b.amount - a.amount)[0];
      chartNote.textContent = top
        ? `${top.label} leads the group pot at ${formatMoney(top.amount)} across ${top.count} ${top.count === 1 ? "bill" : "bills"}.`
        : "No spending data yet.";
    }
  }

  function renderFriendsPage() {
    const stats = getFriendStats().filter((entry) => entry.friend.id !== state.currentUserId);

    if (friendsPageSub) {
      friendsPageSub.textContent = `${stats.length} ${stats.length === 1 ? "friend" : "friends"} in the group · balances update automatically.`;
    }

    if (!friendsPageGrid) return;
    if (!stats.length) {
      friendsPageGrid.innerHTML = `<div class="empty-state empty-state--inline"><strong>No friends yet</strong><p>Add someone to start splitting expenses.</p></div>`;
      return;
    }

    friendsPageGrid.innerHTML = stats.map((entry) => {
      const status = getBalanceStatus(entry.net);

      return `
        <article class="friend-card friend-card--detail">
          <div class="friend-card__top">
            ${friendAvatar(entry.friend, entry.index)}
            <div class="friend-card__identity">
              <h3>${escapeHtml(entry.friend.name)}</h3>
              <p>${status.label} ${Math.abs(entry.net) < 0.005 ? "up" : status.tone === "positive" ? "from the group" : "to the group"}</p>
            </div>
            <div class="friend-card__top-actions">
              <span class="badge badge--${status.tone}">${status.label}</span>
              ${auth.isAdmin() ? `
                <button class="icon-btn icon-btn--sm icon-btn--danger friend-card__remove" type="button" data-remove-friend="${escapeHtml(entry.friend.id)}" aria-label="Remove ${escapeHtml(entry.friend.name)}" title="Remove friend">
                  ${TRASH_ICON}
                </button>
              ` : ""}
            </div>
          </div>

          <div class="friend-card__stats">
            <div><span>Paid</span><strong>${formatMoney(entry.paid)}</strong></div>
            <div><span>Share</span><strong>${formatMoney(entry.share)}</strong></div>
            <div><span>Net</span><strong class="amount--${status.amountClass}">${formatSignedMoney(entry.net)}</strong></div>
          </div>

          <div class="friend-card__bottom">
            <span>${entry.net > 0.005 ? "Should receive" : entry.net < -0.005 ? "Should pay" : "Balance"}</span>
            <strong class="amount amount--${status.amountClass}">${formatMoney(Math.abs(entry.net))}</strong>
          </div>

          <div class="friend-card__login">
            <span class="friend-card__login-id">
              <span>Login ID</span>
              <strong>${escapeHtml(entry.friend.loginId || "—")}</strong>
            </span>
            <span class="friend-card__login-state">${entry.friend.mustChangePassword ? "Temp password active" : "Password set"}</span>
            ${auth.isAdmin() ? `
              <button class="btn btn--soft btn--sm" type="button" data-reset-password="${escapeHtml(entry.friend.id)}">Reset password</button>
            ` : ""}
          </div>
        </article>
      `;
    }).join("");
  }

  function buildFriendLedgerMarkup(ledger) {
    const { friend, payTo, receiveFrom, net, activity } = ledger;
    const status = getBalanceStatus(net);
    const name = escapeHtml(friend.name);
    const friendCount = (count) => `${count} ${count === 1 ? "friend" : "friends"}`;

    const pairMarkup = (entry, direction) => {
      const other = entry.friend;
      const otherName = escapeHtml(other.name);
      const isPaying = direction === "pay";

      return `
        <article class="ledger-pair">
          <div class="ledger-pair__person">
            ${friendAvatar(other, friendIndex(other.id))}
            <div>
              <strong>${otherName}</strong>
              <span>${isPaying ? `${name} owes ${otherName}` : `${otherName} owes ${name}`}</span>
            </div>
          </div>
          <strong class="amount amount--${isPaying ? "negative" : "positive"}">${formatMoney(entry.amount)}</strong>
          <button class="btn btn--soft btn--sm" type="button"
            data-settle-from="${isPaying ? escapeHtml(friend.id) : escapeHtml(other.id)}"
            data-settle-to="${isPaying ? escapeHtml(other.id) : escapeHtml(friend.id)}"
            data-settle-amount="${entry.amount}">
            ${isPaying ? "Mark paid" : "Mark received"}
          </button>
        </article>
      `;
    };

    const activityMarkup = activity.length
      ? activity.map((entry) => `
        <article class="ledger-activity-row">
          <span class="ledger-activity-row__icon" style="background:${entry.color}1f;color:${entry.color}" aria-hidden="true">${entry.icon}</span>
          <div class="ledger-activity-row__copy">
            <strong>${escapeHtml(entry.title)}</strong>
            <span>${escapeHtml(entry.detail)}</span>
          </div>
          <div class="ledger-activity-row__amount">
            <strong class="amount amount--${entry.amountClass}">${formatMoney(entry.amount)}</strong>
            <span>${escapeHtml(entry.amountLabel)}</span>
          </div>
        </article>
      `).join("")
      : `<p class="ledger-empty">No expenses or settlements involve ${name} yet.</p>`;

    const stats = getFriendStats().find((entry) => entry.friend.id === friend.id) || { paid: 0, share: 0 };
    const pairList = (entries, direction) => entries.length
      ? entries.map((entry) => pairMarkup(entry, direction)).join("")
      : `<p class="ledger-empty">${direction === "pay" ? "Nothing to pay" : "Nothing to receive"} right now.</p>`;

    return `
      <div class="ledger">
        <div class="ledger-summary">
          <div class="ledger-summary__item">
            <span>Total paid</span>
            <strong class="amount">${formatMoney(stats.paid)}</strong>
            <small>Across group expenses</small>
          </div>
          <div class="ledger-summary__item">
            <span>Their share</span>
            <strong class="amount">${formatMoney(stats.share)}</strong>
            <small>Of all group spending</small>
          </div>
          <div class="ledger-summary__item ledger-summary__item--net">
            <span>Net balance</span>
            <strong class="amount amount--${status.amountClass}">${formatSignedMoney(net)}</strong>
            <small>${status.label}</small>
          </div>
        </div>

        <div class="ledger-pairs">
          <section class="ledger-block">
            <div class="ledger-section__head">
              <h3>Needs to pay</h3>
              <span>${friendCount(payTo.length)}</span>
            </div>
            ${pairList(payTo, "pay")}
          </section>

          <section class="ledger-block">
            <div class="ledger-section__head">
              <h3>Should receive</h3>
              <span>${friendCount(receiveFrom.length)}</span>
            </div>
            ${pairList(receiveFrom, "receive")}
          </section>
        </div>

        <section class="ledger-activity">
          <div class="ledger-section__head">
            <h3>Recent history</h3>
            <span>${activity.length} ${activity.length === 1 ? "entry" : "entries"}</span>
          </div>
          <div class="ledger-activity__list">${activityMarkup}</div>
        </section>
      </div>
    `;
  }

  function renderPortal() {
    const user = auth.getCurrentUser();
    if (!user || !portalLedger) return;

    const ledger = getFriendLedger(user.id);
    if (portalLoginChip) portalLoginChip.textContent = `ID: ${user.loginId}`;
    if (portalAccountId) portalAccountId.textContent = user.loginId;
    if (portalPasswordHint) {
      portalPasswordHint.textContent = user.mustChangePassword
        ? "Temporary password in use. Change it immediately to secure your portal."
        : "Use at least 6 characters and keep it private.";
    }

    if (!ledger) {
      if (portalSub) portalSub.textContent = "Your portal is unavailable right now.";
      portalLedger.innerHTML = `<p class="ledger-empty">Could not load your ledger.</p>`;
      return;
    }

    const { net, payTo, receiveFrom } = ledger;
    if (portalSub) {
      portalSub.textContent = `${formatSignedMoney(net)} net · ${payTo.length} to pay · ${receiveFrom.length} to receive`;
    }
    portalLedger.innerHTML = buildFriendLedgerMarkup(ledger);
  }

  function renderFriendLedger(force = false) {
    if (!activeLedgerFriendId || !friendLedgerModal) return;
    if (!force && !friendLedgerModal.classList.contains("is-open")) return;

    const ledger = getFriendLedger(activeLedgerFriendId);
    if (!ledger) {
      activeLedgerFriendId = null;
      closeModal(friendLedgerModal);
      return;
    }

    const { friend, net } = ledger;
    const status = getBalanceStatus(net);

    if (friendLedgerAvatar) {
      friendLedgerAvatar.textContent = getInitials(friend.name);
      friendLedgerAvatar.className = "avatar ledger-modal__avatar";
      friendLedgerAvatar.style.cssText = avatarStyle(friendIndex(friend.id));
    }
    if (friendLedgerTitle) friendLedgerTitle.textContent = `${friend.name}'s history`;
    if (friendLedgerSub) friendLedgerSub.textContent = `Net ${formatSignedMoney(net)} · ${status.label}`;
    if (friendLedgerContent) friendLedgerContent.innerHTML = buildFriendLedgerMarkup(ledger);
  }

  function openFriendLedger(friendId) {
    if (!getFriend(friendId) || !friendLedgerModal) return;
    activeLedgerFriendId = friendId;
    openModal(friendLedgerModal);
    renderFriendLedger(true);
  }

  function renderExpensesPage() {
    if (!expensesList) return;

    const search = expenseFilters.search.trim().toLowerCase();
    const category = expenseFilters.category;
    const filtered = getSortedExpenses().filter((expense) => {
      if (category !== "all" && expense.category !== category) return false;
      if (!search) return true;

      const haystack = [
        expense.title,
        getFriendName(expense.payerId),
        CATEGORY_META[expense.category]?.label || "",
        ...listNames((expense.participants || []).map((participant) => participant.friendId)),
        String(expense.amount),
        formatMoney(expense.amount)
      ].join(" ").toLowerCase();

      return haystack.includes(search);
    });

    if (expenseCount) {
      expenseCount.textContent = `${filtered.length} ${filtered.length === 1 ? "expense" : "expenses"}`;
    }

    if (expensesEmpty) {
      expensesEmpty.hidden = filtered.length > 0;
    }

    expensesList.innerHTML = filtered.map((expense) => expenseRowMarkup(expense, { manage: auth.isAdmin() })).join("");
  }

  function renderSettlements() {
    const suggested = getSuggestedSettlements();

    if (settlementsChip) {
      settlementsChip.textContent = `${suggested.length} ${suggested.length === 1 ? "transfer" : "transfers"}`;
    }

    if (settlementsSub) {
      settlementsSub.textContent = suggested.length
        ? `${suggested.length} ${suggested.length === 1 ? "payment" : "payments"} will settle every balance.`
        : "The fewest payments needed to square up.";
    }

    if (settlementsList) {
      settlementsList.innerHTML = suggested.length
        ? suggested.map((transfer) => {
          const from = getFriend(transfer.fromId);
          const to = getFriend(transfer.toId);
          if (!from || !to) return "";

          return `
            <article class="settlement-row">
              <div class="settlement-row__people">
                ${friendAvatar(from, friendIndex(from.id))}
                <span class="settlement-row__arrow">${ARROW_ICON}</span>
                ${friendAvatar(to, friendIndex(to.id))}
              </div>
              <div class="settlement-row__copy">
                <strong>${escapeHtml(from.name)} pays ${escapeHtml(to.name)}</strong>
                <span>Suggested transfer to settle all shared balances</span>
              </div>
              <div class="settlement-row__amount">
                <strong>${formatMoney(transfer.amount)}</strong>
                <button class="btn btn--soft btn--sm" type="button" data-settle-from="${escapeHtml(transfer.fromId)}" data-settle-to="${escapeHtml(transfer.toId)}" data-settle-amount="${transfer.amount}">
                  Mark paid
                </button>
              </div>
            </article>
          `;
        }).join("")
        : `<div class="empty-state empty-state--inline">
            <span class="empty-state__icon" aria-hidden="true">${CHECK_ICON}</span>
            <strong>Everyone is settled up</strong>
            <p>No payments are needed right now.</p>
          </div>`;
    }

    if (settlementsHistory) {
      const history = [...state.settlements].sort((a, b) => {
        return String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date));
      });

      settlementsHistory.innerHTML = history.length
        ? history.map((settlement) => {
          const from = getFriend(settlement.fromId);
          const to = getFriend(settlement.toId);
          if (!from || !to) return "";

          return `
            <article class="settlement-row settlement-row--history">
              <div class="settlement-row__people">
                ${friendAvatar(from, friendIndex(from.id))}
                <span class="settlement-row__arrow">${ARROW_ICON}</span>
                ${friendAvatar(to, friendIndex(to.id))}
              </div>
              <div class="settlement-row__copy">
                <strong>${escapeHtml(from.name)} paid ${escapeHtml(to.name)}</strong>
                <span>${escapeHtml(formatDate(settlement.date))} · ${formatMoney(settlement.amount)}</span>
              </div>
              <div class="settlement-row__amount">
                <span class="badge badge--positive">Completed</span>
                ${auth.isAdmin() ? `
                  <button class="icon-btn icon-btn--sm icon-btn--danger" type="button" data-delete-settlement="${escapeHtml(settlement.id)}" aria-label="Delete settlement" title="Delete settlement">
                    ${TRASH_ICON}
                  </button>
                ` : ""}
              </div>
            </article>
          `;
        }).join("")
        : `<p class="ledger-empty">No settlements have been recorded yet.</p>`;
    }
  }

  function renderReports() {
    const total = state.expenses.reduce((sum, e) => sum + Number(e.amount), 0);
    const count = state.expenses.length;
    const average = count ? total / count : 0;
    const categories = getCategoryStats().sort((a, b) => b.amount - a.amount);
    const top = categories[0];

    const activeFriends = new Set(
      state.expenses.flatMap((expense) => (expense.participants || []).map((participant) => participant.friendId))
    ).size;

    setStatValue(reportTotal, total);
    if (reportTotalHint) reportTotalHint.textContent = `${count} ${count === 1 ? "expense" : "expenses"} total`;

    setStatValue(reportAverage, average);
    if (reportAverageHint) reportAverageHint.textContent = count ? `Across ${count} group events` : "No bills recorded";

    if (reportTopCategory) reportTopCategory.textContent = top?.amount ? top.label : "—";
    if (reportTopCategoryHint) {
      reportTopCategoryHint.textContent = top?.amount
        ? `${formatMoney(top.amount)} (${Math.round((top.amount / (total || 1)) * 100)}%)`
        : "Add expenses to rank";
    }

    setStatValue(reportActiveFriends, activeFriends, false);
    if (reportActiveFriendsHint) {
      reportActiveFriendsHint.textContent = `${activeFriends} of ${state.friends.length} members have shared expenses`;
    }

    if (reportCategoryBars) {
      reportCategoryBars.innerHTML = categories.map((cat) => {
        const pct = total > 0 ? (cat.amount / total) * 100 : 0;
        return `
          <div class="bar-row">
            <span class="bar-row__label">${escapeHtml(cat.label)}</span>
            <div class="bar-track">
              <div class="bar-fill" style="width: ${pct}%; background: ${cat.color}"></div>
            </div>
            <span class="bar-row__value">${formatMoney(cat.amount)}</span>
          </div>
        `;
      }).join("");
    }

    if (reportContributors) {
      const stats = getFriendStats().sort((a, b) => b.paid - a.paid);
      reportContributors.innerHTML = stats.map((entry) => `
        <div class="contributor-row">
          ${friendAvatar(entry.friend, entry.index)}
          <span class="contributor-name">${escapeHtml(entry.friend.name)}</span>
          <strong class="contributor-paid">${formatMoney(entry.paid)}</strong>
        </div>
      `).join("");
    }

    if (reportMonths) {
      const months = {};
      state.expenses.forEach((expense) => {
        const key = String(expense.date).slice(0, 7);
        months[key] = (months[key] || 0) + Number(expense.amount);
      });

      const keys = Object.keys(months).sort().reverse().slice(0, 6);
      reportMonths.innerHTML = keys.length ? keys.map((key) => `
        <div class="month-row">
          <span>${key}</span>
          <strong>${formatMoney(months[key])}</strong>
        </div>
      `).join("") : `<p class="ledger-empty">No monthly data available.</p>`;
    }
  }

  function renderSettingsForm() {
    const current = auth.getCurrentUser() || state.friends[0];
    if (settingsName) settingsName.value = current?.name || "";
    if (settingsBudget) settingsBudget.value = Number(state.budget) || 0;
    if (settingsLoginId) settingsLoginId.textContent = current?.loginId || "—";
  }

  /* ------------------------------------------------------------------------
     Admin Panel Rendering (Phase 2)
     ---------------------------------------------------------------------- */
  async function renderAdminPanel() {
    if (!auth.isAdmin()) return;

    if (adminGroupName) adminGroupName.value = state.groupName || "Friends Expense Manager";
    if (adminGroupBudget) adminGroupBudget.value = Number(state.budget) || 0;

    if (adminMembersList) {
      adminMembersList.innerHTML = state.friends.map((friend, idx) => {
        const isCurrent = friend.id === state.currentUserId;
        const isAdmin = friend.role === "admin";
        const isActive = friend.isActive !== false;

        return `
          <tr>
            <td>
              <div style="display:flex;align-items:center;gap:0.75rem;">
                ${friendAvatar(friend, idx)}
                <div>
                  <strong>${escapeHtml(friend.name)}</strong>
                  ${isCurrent ? ` <span class="badge badge--neutral">You</span>` : ""}
                </div>
              </div>
            </td>
            <td><code>${escapeHtml(friend.loginId)}</code></td>
            <td>
              <span class="badge badge--${isAdmin ? "primary" : "neutral"}">${isAdmin ? "Admin" : "Friend"}</span>
            </td>
            <td>
              <span class="badge badge--${isActive ? "positive" : "negative"}">${isActive ? "Active" : "Deactivated"}</span>
            </td>
            <td>
              <small>${friend.mustChangePassword ? "Temp password" : "Password set"}</small>
            </td>
            <td>
              <div class="admin-actions">
                ${!isCurrent ? `
                  <button class="btn btn--ghost btn--sm" type="button" data-admin-role="${escapeHtml(friend.id)}" data-target-role="${isAdmin ? "friend" : "admin"}">
                    ${isAdmin ? "Demote" : "Promote"}
                  </button>
                  <button class="btn btn--ghost btn--sm" type="button" data-admin-toggle-active="${escapeHtml(friend.id)}" data-is-active="${isActive}">
                    ${isActive ? "Deactivate" : "Activate"}
                  </button>
                ` : ""}
                <button class="btn btn--soft btn--sm" type="button" data-admin-reset-pwd="${escapeHtml(friend.id)}">
                  Reset Pwd
                </button>
                ${!isCurrent ? `
                  <button class="icon-btn icon-btn--sm icon-btn--danger" type="button" data-admin-delete-friend="${escapeHtml(friend.id)}" title="Delete member">
                    ${TRASH_ICON}
                  </button>
                ` : ""}
              </div>
            </td>
          </tr>
        `;
      }).join("");
    }

    loadAuditLogs();
  }

  async function loadAuditLogs() {
    if (!adminAuditList || !auth.isAdmin()) return;
    try {
      const logs = await api.fetchAuditLogs();
      if (!logs.length) {
        adminAuditList.innerHTML = `<p class="ledger-empty">No activity logs recorded yet.</p>`;
        return;
      }

      adminAuditList.innerHTML = logs.slice(0, 30).map((log) => `
        <div class="audit-item">
          <div class="audit-item__header">
            <strong>${escapeHtml(log.action)}</strong>
            <span>${timeAgo(log.created_at)}</span>
          </div>
          <p class="audit-item__details">
            Actor: <strong>${escapeHtml(log.actor_name || "System")}</strong> · ${escapeHtml(JSON.stringify(log.details || {}))}
          </p>
        </div>
      `).join("");
    } catch (err) {
      adminAuditList.innerHTML = `<p class="ledger-empty">Failed to load audit logs.</p>`;
    }
  }

  refreshAuditBtn?.addEventListener("click", () => {
    loadAuditLogs();
    showToast("Audit log refreshed.");
  });

  /* ------------------------------------------------------------------------
     Notification Drawer
     ---------------------------------------------------------------------- */
  function renderNotifications() {
    if (!notificationList || !notificationBtn) return;

    const events = [
      ...state.expenses.map((expense) => ({
        type: "expense",
        id: expense.id,
        createdAt: expense.createdAt || `${expense.date}T12:00:00Z`,
        title: `${getFriendName(expense.payerId)} added ${expense.title}`,
        detail: `${formatMoney(expense.amount)} · ${formatDate(expense.date)}`
      })),
      ...state.settlements.map((settlement) => ({
        type: "settlement",
        id: settlement.id,
        createdAt: settlement.createdAt || `${settlement.date}T12:00:00Z`,
        title: `${getFriendName(settlement.fromId)} settled with ${getFriendName(settlement.toId)}`,
        detail: `${formatMoney(settlement.amount)} · ${formatDate(settlement.date)}`
      }))
    ].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    const readAt = state.settings.notificationsReadAt;
    const unread = events.filter((event) => !readAt || String(event.createdAt) > String(readAt)).length;

    notificationDot?.classList.toggle("is-visible", unread > 0);
    notificationDot?.setAttribute("aria-hidden", unread > 0 ? "false" : "true");

    if (notificationSubtitle) {
      notificationSubtitle.textContent = unread > 0 ? `${unread} unread updates` : "You're all caught up";
    }

    const recent = events.slice(0, 10);
    notificationList.innerHTML = recent.length
      ? recent.map((event) => {
        const isUnread = !readAt || String(event.createdAt) > String(readAt);
        return `
          <button class="notification-item ${isUnread ? "" : "is-read"}" type="button" data-nav="${event.type === "expense" ? "expenses" : "settlements"}">
            <span class="notification-item__icon notification-item__icon--${event.type === "expense" ? "blue" : "green"}" aria-hidden="true">
              ${event.type === "expense" ? CATEGORY_META.lunch.icon : ARROW_ICON}
            </span>
            <span class="notification-item__copy">
              <strong>${escapeHtml(event.title)}</strong>
              <small>${escapeHtml(event.detail)} · ${escapeHtml(timeAgo(event.createdAt))}</small>
            </span>
            <span class="notification-item__unread" aria-hidden="true"></span>
          </button>
        `;
      }).join("")
      : `<p class="notification-empty">No updates yet.</p>`;
  }

  function closeNotifications() {
    if (!notificationMenu) return;
    notificationMenu.classList.remove("is-open");
    notificationMenu.setAttribute("aria-hidden", "true");
  }

  function toggleNotifications() {
    if (!notificationMenu) return;
    const isOpen = notificationMenu.classList.toggle("is-open");
    notificationMenu.setAttribute("aria-hidden", isOpen ? "false" : "true");
  }

  /* ------------------------------------------------------------------------
     Routing & Navigation
     ---------------------------------------------------------------------- */
  function getDefaultView() {
    return auth.isAdmin() ? "dashboard" : "portal";
  }

  function canAccessView(view) {
    if (view === "admin") return auth.isAdmin();
    return true;
  }

  function getViewFromHash() {
    const view = String(window.location.hash || "").replace(/^#/, "");
    return VIEWS.includes(view) && canAccessView(view) ? view : getDefaultView();
  }

  function goToView(view, push = true) {
    const target = VIEWS.includes(view) && canAccessView(view) ? view : getDefaultView();
    if (push) {
      window.location.hash = target;
    } else {
      window.history.replaceState(null, "", `#${target}`);
    }
    renderRoute(false, false);
  }

  function renderRoute(closeDrawers = true, scroll = true) {
    const view = getViewFromHash();
    const meta = VIEW_META[view] || VIEW_META.dashboard;
    const current = auth.getCurrentUser() || state.friends[0];

    document.querySelectorAll("[data-view-panel]").forEach((panel) => {
      const isActive = panel.dataset.viewPanel === view;
      panel.hidden = !isActive;
      panel.classList.toggle("is-active", isActive);
    });

    navLinks.forEach((link) => {
      const isTarget = link.dataset.nav === view;
      link.classList.toggle("is-active", isTarget);
      link.setAttribute("aria-current", isTarget ? "page" : "false");
    });

    const docPrefix = state.groupName || "Friends Expense Manager";
    document.title = `${meta.docTitle} · ${docPrefix}`;

    if (pageTitle) {
      pageTitle.textContent = typeof meta.title === "function" ? meta.title(current?.name || "Friend") : meta.title;
    }
    if (pageSubtitle) {
      pageSubtitle.textContent = meta.subtitle;
    }

    if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
    if (closeDrawers) {
      closeSidebar();
      closeNotifications();
    }
  }

  function closeSidebar() {
    if (!sidebar) return;
    sidebar.classList.remove("is-open");
    sidebarOverlay?.classList.remove("is-open");
    document.body.classList.remove("sidebar-open");
  }

  function openSidebar() {
    if (!sidebar) return;
    sidebar.classList.add("is-open");
    sidebarOverlay?.classList.add("is-open");
    document.body.classList.add("sidebar-open");
  }

  /* ------------------------------------------------------------------------
     Modal Helpers (Phase 0 Accessibility Fix for trapFocus)
     ---------------------------------------------------------------------- */
  function openModal(modal) {
    if (!modal) return;
    lastFocusedElement = document.activeElement;
    closeSidebar();
    closeNotifications();
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");

    window.setTimeout(() => {
      const focusable = modal.querySelector("input:not([type='hidden']), select, button");
      focusable?.focus();
    }, 60);
  }

  function closeModal(modal) {
    if (!modal) return;
    if (modal === friendLedgerModal) activeLedgerFriendId = null;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");

    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
      lastFocusedElement.focus();
    }
  }

  function closeAllModals() {
    document.querySelectorAll(".modal.is-open").forEach((modal) => closeModal(modal));
  }

  function trapFocus(event) {
    if (event.key !== "Tab") return;
    const modal = document.querySelector(".modal.is-open");
    if (!modal) return;

    const focusable = Array.from(modal.querySelectorAll(
      "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
    )).filter((element) => element.offsetParent !== null);

    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (!modal.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /* ------------------------------------------------------------------------
     Expense Modal & Share Calculations
     ---------------------------------------------------------------------- */
  function populatePayerOptions(selectedId) {
    if (!expensePayer) return;
    const friends = getAllActiveFriends();

    if (!friends.length) {
      expensePayer.innerHTML = `<option value="">Add a member first</option>`;
      return;
    }

    expensePayer.innerHTML = friends.map((friend) => {
      const isSelected = friend.id === selectedId;
      return `<option value="${escapeHtml(friend.id)}" ${isSelected ? "selected" : ""}>${escapeHtml(friend.name)}</option>`;
    }).join("");
  }

  function renderParticipantGrid(selectedShares) {
    if (!participantGrid) return;
    const friends = getAllActiveFriends();
    const shares = selectedShares instanceof Map ? selectedShares : new Map();

    if (!friends.length) {
      participantGrid.innerHTML = `<p class="participants-empty">Add members before splitting a bill.</p>`;
      return;
    }

    participantGrid.innerHTML = friends.map((friend) => {
      const share = shares.has(friend.id) ? shares.get(friend.id) : 0;
      const checked = shares.has(friend.id);

      return `
        <div class="participant-row">
          <label class="participant-row__name">
            <input class="js-participant-check" type="checkbox" value="${escapeHtml(friend.id)}" ${checked ? "checked" : ""}>
            <span>${escapeHtml(friend.name)}</span>
          </label>
          <div class="participant-row__input-wrap">
            <span class="currency-prefix">Rs.</span>
            <input class="form-input participant-input js-participant-amount" type="number" min="0" step="any" data-friend-id="${escapeHtml(friend.id)}" value="${share ? share.toFixed(2) : ""}" placeholder="0.00">
          </div>
        </div>
      `;
    }).join("");

    updateAllocation();
  }

  function updateAllocation() {
    if (!expenseAmount || !allocationBar) return;
    const total = roundMoney(Number(expenseAmount.value) || 0);
    const inputs = Array.from(document.querySelectorAll(".js-participant-amount"));
    const assigned = inputs.reduce((sum, input) => sum + roundMoney(Number(input.value) || 0), 0);
    const diff = roundMoney(total - assigned);

    if (allocationAmount) allocationAmount.textContent = formatMoney(assigned);
    if (allocationTotal) allocationTotal.textContent = `of ${formatMoney(total)}`;

    const ratio = total > 0 ? Math.min(100, (assigned / total) * 100) : 0;
    allocationBar.style.width = `${ratio}%`;

    if (Math.abs(diff) < 0.005 && total > 0) {
      allocationBar.style.background = "var(--green-500, #22c55e)";
      allocationStatus.textContent = "Fully allocated";
      allocationStatus.className = "allocation-status allocation-status--ok";
    } else if (diff > 0) {
      allocationBar.style.background = "var(--blue-500, #3b82f6)";
      allocationStatus.textContent = `${formatMoney(diff)} remaining`;
      allocationStatus.className = "allocation-status allocation-status--warning";
    } else {
      allocationBar.style.background = "var(--red-500, #ef4444)";
      allocationStatus.textContent = `${formatMoney(Math.abs(diff))} over allocated`;
      allocationStatus.className = "allocation-status allocation-status--error";
    }
  }

  function splitEqually() {
    const total = roundMoney(Number(expenseAmount?.value) || 0);
    const checked = Array.from(document.querySelectorAll(".js-participant-check:checked"));
    if (!checked.length || total <= 0) return;

    const baseShare = Math.floor((total / checked.length) * 100) / 100;
    let remainder = Math.round((total - baseShare * checked.length) * 100);

    checked.forEach((box) => {
      const input = document.querySelector(`.js-participant-amount[data-friend-id="${box.value}"]`);
      if (input) {
        let amount = baseShare;
        if (remainder > 0) {
          amount = roundMoney(amount + 0.01);
          remainder -= 1;
        }
        input.value = amount.toFixed(2);
      }
    });

    updateAllocation();
  }

  function openExpenseModal(expenseId = null) {
    editingExpenseId = expenseId;
    const expense = expenseId ? state.expenses.find((e) => e.id === expenseId) : null;
    const isEdit = Boolean(expense);

    expenseModalTitle.textContent = isEdit ? "Edit Expense" : "Add Expense";
    expenseModalSubtitle.textContent = isEdit ? "Update details for this shared bill" : "Record a shared meal, snack or bill";
    expenseSubmitLabel.textContent = isEdit ? "Save Changes" : "Save Expense";

    if (expense) {
      expenseTitle.value = expense.title;
      expenseAmount.value = expense.amount;
      expenseCategory.value = expense.category;
      expenseDate.value = expense.date;
      populatePayerOptions(expense.payerId);

      const shares = new Map(expense.participants.map((p) => [p.friendId, p.amount]));
      renderParticipantGrid(shares);
    } else {
      expenseForm.reset();
      expenseCategory.value = "lunch";
      expenseDate.value = getTodayISO();
      const active = getAllActiveFriends();
      populatePayerOptions(active[0]?.id);
      const defaultShares = new Map(active.map((f) => [f.id, 0]));
      renderParticipantGrid(defaultShares);
    }

    updateAllocation();
    openModal(expenseModal);
  }

  async function submitExpense(event) {
    event.preventDefault();
    const title = expenseTitle.value.trim();
    const amount = roundMoney(Number(expenseAmount.value));
    const category = expenseCategory.value;
    const date = expenseDate.value || getTodayISO();
    const payerId = expensePayer.value;

    if (!title || amount <= 0 || !payerId) {
      showToast("Please provide a title, valid amount, and payer.");
      return;
    }

    const participantInputs = Array.from(document.querySelectorAll(".js-participant-amount"));
    const participants = [];
    let sumAssigned = 0;

    participantInputs.forEach((input) => {
      const friendId = input.dataset.friendId;
      const share = roundMoney(Number(input.value) || 0);
      if (share > 0) {
        participants.push({ friendId, amount: share });
        sumAssigned = roundMoney(sumAssigned + share);
      }
    });

    if (Math.abs(roundMoney(amount - sumAssigned)) > 0.01) {
      showToast(`Split total (${formatMoney(sumAssigned)}) must match expense amount (${formatMoney(amount)}).`);
      return;
    }

    const payload = { title, amount, category, date, payerId, participants };

    try {
      if (editingExpenseId) {
        await api.updateExpense(editingExpenseId, payload);
        showToast("Expense updated.");
      } else {
        await api.createExpense(payload);
        showToast("Expense added to the group pot.");
      }

      closeModal(expenseModal);
      await loadAndRenderData();
    } catch (err) {
      showToast(err.message || "Failed to save expense.");
    }
  }

  async function deleteExpense(id) {
    const expense = state.expenses.find((e) => e.id === id);
    const confirmed = await showConfirmDialog({
      title: "Delete Expense",
      message: `Delete "${expense?.title || "this expense"}"? This will recalculate all group balances.`,
      confirmText: "Delete",
      isDanger: true
    });

    if (!confirmed) return;

    try {
      await api.deleteExpense(id);
      showToast("Expense deleted.");
      await loadAndRenderData();
    } catch (err) {
      showToast(err.message || "Failed to delete expense.");
    }
  }

  /* ------------------------------------------------------------------------
     Settlement Actions
     ---------------------------------------------------------------------- */
  async function recordSettlement(fromId, toId, amount) {
    const value = roundMoney(Number(amount));
    if (!getFriend(fromId) || !getFriend(toId) || fromId === toId || value <= 0) {
      showToast("That settlement couldn't be recorded.");
      return;
    }

    const fromName = getFriendName(fromId);
    const toName = getFriendName(toId);

    const confirmed = await showConfirmDialog({
      title: "Confirm Settlement",
      message: `Record payment of ${formatMoney(value)} from ${fromName} to ${toName}?`,
      confirmText: "Record Payment",
      isDanger: false
    });

    if (!confirmed) return;

    try {
      await api.createSettlement(fromId, toId, value, getTodayISO());
      showToast(`Recorded: ${fromName} paid ${toName} ${formatMoney(value)}.`);
      await loadAndRenderData();
    } catch (err) {
      showToast(err.message || "Failed to record settlement.");
    }
  }

  async function deleteSettlement(id) {
    const confirmed = await showConfirmDialog({
      title: "Delete Settlement",
      message: "Are you sure you want to delete this recorded settlement?",
      confirmText: "Delete",
      isDanger: true
    });

    if (!confirmed) return;

    try {
      await api.deleteSettlement(id);
      showToast("Settlement deleted.");
      await loadAndRenderData();
    } catch (err) {
      showToast(err.message || "Failed to delete settlement.");
    }
  }

  /* ------------------------------------------------------------------------
     Member & Friend Actions
     ---------------------------------------------------------------------- */
  async function submitFriend(event) {
    event.preventDefault();
    const name = friendName.value.trim();
    if (!name) {
      showToast("Please enter a friend's name.");
      return;
    }

    try {
      const newFriend = await api.createFriend(name);
      closeModal(friendModal);
      showToast(`Added ${newFriend.name}! Login ID: ${newFriend.loginId}`);
      await loadAndRenderData();
    } catch (err) {
      showToast(err.message || "Failed to add friend.");
    }
  }

  async function removeFriend(friendId) {
    const friend = getFriend(friendId);
    if (!friend) return;

    const hasExpenses = state.expenses.some(
      (e) => e.payerId === friendId || (e.participants || []).some((p) => p.friendId === friendId)
    );

    const confirmed = await showConfirmDialog({
      title: "Remove Friend",
      message: hasExpenses
        ? `"${friend.name}" has shared expenses. Deactivating their account preserves historical records. Continue?`
        : `Remove "${friend.name}" from the group?`,
      confirmText: "Remove",
      isDanger: true
    });

    if (!confirmed) return;

    try {
      await api.deleteFriend(friendId, !hasExpenses);
      showToast(`${friend.name} has been removed.`);
      await loadAndRenderData();
    } catch (err) {
      showToast(err.message || "Failed to remove friend.");
    }
  }

  async function handleResetPassword(friendId) {
    const friend = getFriend(friendId);
    if (!friend) return;

    const confirmed = await showConfirmDialog({
      title: "Reset Password",
      message: `Reset password for ${friend.name}? A temporary password will be assigned.`,
      confirmText: "Reset",
      isDanger: false
    });

    if (!confirmed) return;

    try {
      const tempPass = await api.resetFriendPassword(friendId);
      await showConfirmDialog({
        title: "Password Reset Successful",
        message: `Temporary password for ${friend.name} is: ${tempPass}\n\nPlease share this with them. They will be required to change it on their next login.`,
        confirmText: "Copy & Done",
        cancelText: "Close",
        isDanger: false
      });
      navigator.clipboard?.writeText(tempPass).catch(() => {});
      await loadAndRenderData();
    } catch (err) {
      showToast(err.message || "Failed to reset password.");
    }
  }

  /* ------------------------------------------------------------------------
     Backup Import / Export (Phase 0 & 3)
     ---------------------------------------------------------------------- */
  function exportJson() {
    const payload = {
      exportedAt: new Date().toISOString(),
      app: "Friends Expense Manager",
      data: state
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `friends-expense-backup-${getTodayISO()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("JSON backup downloaded.");
  }

  function exportCsv() {
    const header = ["Date", "Title", "Category", "Amount (Rs.)", "Paid By", "Participants", "Shares"];
    const rows = getSortedExpenses().map((expense) => {
      const participants = (expense.participants || []).map((p) => getFriendName(p.friendId));
      const shares = (expense.participants || []).map((p) => roundMoney(p.amount));
      return [
        expense.date,
        expense.title,
        CATEGORY_META[expense.category]?.label || expense.category,
        expense.amount,
        getFriendName(expense.payerId),
        participants.join("; "),
        shares.join("; ")
      ].map((val) => `"${String(val).replace(/"/g, '""')}"`).join(",");
    });

    const csv = [header.join(","), ...rows].join("\r\n");
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `friends-expenses-${getTodayISO()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("Expense CSV exported.");
  }

  async function handleImportJson(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const raw = JSON.parse(e.target.result);
        const data = raw.data || raw;

        if (!data || !Array.isArray(data.friends) || !Array.isArray(data.expenses)) {
          showToast("Invalid backup file: missing friends or expenses array.");
          return;
        }

        const confirmed = await showConfirmDialog({
          title: "Import Data",
          message: `This will replace all current data with ${data.friends.length} members and ${data.expenses.length} expenses from the backup file. Overwrite?`,
          confirmText: "Import & Overwrite",
          isDanger: true
        });

        if (!confirmed) return;

        state = {
          version: 2,
          friends: data.friends,
          expenses: data.expenses,
          settlements: Array.isArray(data.settlements) ? data.settlements : [],
          currentUserId: auth.getCurrentUser()?.id || data.friends[0]?.id || "f-admin",
          budget: Number(data.budget) || 0,
          groupName: data.groupName || "Friends Expense Manager",
          settings: { notificationsReadAt: null }
        };

        api.saveLocalCache(state);
        invalidateCaches();
        renderAll();
        showToast("Backup imported successfully.");
      } catch (err) {
        showToast("Failed to parse backup JSON file.");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  /* ------------------------------------------------------------------------
     Settings & Admin Form Submissions
     ---------------------------------------------------------------------- */
  async function saveSettings(event) {
    event.preventDefault();
    const budget = roundMoney(Number(settingsBudget.value) || 0);

    try {
      await api.updateSettings({ budget });
      state.budget = budget;
      renderSidebar();
      showToast("Budget saved.");
    } catch (err) {
      showToast("Failed to update budget.");
    }
  }

  async function saveAdminGroupSettings(event) {
    event.preventDefault();
    const groupName = adminGroupName.value.trim() || "Friends Expense Manager";
    const budget = roundMoney(Number(adminGroupBudget.value) || 0);

    try {
      await api.updateSettings({ groupName, budget });
      state.groupName = groupName;
      state.budget = budget;
      renderSidebar();
      renderRoute(false, false);
      showToast("Group identity and budget saved.");
    } catch (err) {
      showToast("Failed to update group settings.");
    }
  }

  async function handlePasswordChange(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const currentPasswordInput = form.querySelector(".js-current-password");
    const newPasswordInput = form.querySelector(".js-new-password");
    const confirmPasswordInput = form.querySelector(".js-confirm-password");

    const currentPassword = currentPasswordInput?.value || "";
    const newPassword = newPasswordInput?.value || "";
    const confirmPassword = confirmPasswordInput?.value || "";

    if (!currentPassword) {
      showToast("Please enter your current password.");
      currentPasswordInput?.focus();
      return;
    }

    if (newPassword.length < 6) {
      showToast("New password must be at least 6 characters.");
      newPasswordInput?.focus();
      return;
    }

    if (newPassword !== confirmPassword) {
      showToast("New passwords do not match.");
      confirmPasswordInput?.focus();
      return;
    }

    try {
      await auth.changePassword(newPassword, currentPassword);
      form.reset();
      showToast("Password updated successfully! Please use your new password on next login.");
      await loadAndRenderData();
    } catch (err) {
      showToast(err.message || "Failed to update password.");
      if (err.message && err.message.toLowerCase().includes("current")) {
        currentPasswordInput?.focus();
        currentPasswordInput?.select();
      }
    }
  }

  /* ------------------------------------------------------------------------
     Danger Zone (Typed Confirmation)
     ---------------------------------------------------------------------- */
  async function handleDangerReset() {
    const confirmed = await showConfirmDialog({
      title: "RESET GROUP DATA",
      message: "This will permanently purge all expenses, splits and settlement transactions. Member accounts will remain intact.",
      confirmText: "Purge All Data",
      isDanger: true,
      requireTypedText: "RESET DATA"
    });

    if (!confirmed) return;

    try {
      await api.resetAllData();
      showToast("All financial data has been wiped.");
      await loadAndRenderData();
    } catch (err) {
      showToast(err.message || "Failed to reset data.");
    }
  }

  /* ------------------------------------------------------------------------
     Auth State Lifecycle
     ---------------------------------------------------------------------- */
  async function attemptLogin(event) {
    event.preventDefault();
    const loginId = loginIdInput.value.trim();
    const password = loginPasswordInput.value;

    if (!loginId || !password) {
      if (loginError) {
        loginError.hidden = false;
        loginError.textContent = "Please enter both Login ID and password.";
      }
      return;
    }

    try {
      loginError.hidden = true;
      const user = await auth.signIn(loginId, password);
      loginForm.reset();
      showToast(`Welcome back, ${user.name}!`);
    } catch (err) {
      if (loginError) {
        loginError.hidden = false;
        loginError.textContent = err.message || "Login failed.";
      }
    }
  }

  async function logout() {
    await auth.signOut();
    showToast("Signed out.");
  }

  async function loadAndRenderData() {
    try {
      const fresh = await api.fetchState();
      state = fresh;
      invalidateCaches();
      renderAll();
    } catch (err) {
      console.warn("Error loading state:", err);
    }
  }

  auth.onAuthStateChange(async (user) => {
    if (user) {
      loginScreen.hidden = true;
      appShell.hidden = false;
      state.currentUserId = user.id;

      await loadAndRenderData();
      goToView(getDefaultView(), false);

      if (user.mustChangePassword) {
        showToast("Please update your temporary password in Settings or Portal.");
      }
    } else {
      appShell.hidden = true;
      loginScreen.hidden = false;
      if (loginIdInput) loginIdInput.value = "";
      if (loginPasswordInput) loginPasswordInput.value = "";
    }
  });

  // Supabase Realtime synchronization
  api.subscribeToChanges(() => {
    loadAndRenderData();
  });

  /* ------------------------------------------------------------------------
     Global Delegated Event Listeners
     ---------------------------------------------------------------------- */
  document.addEventListener("click", async (event) => {
    const navTarget = event.target.closest("[data-nav]");
    if (navTarget) {
      event.preventDefault();
      goToView(navTarget.dataset.nav);
      return;
    }

    const editExpenseTarget = event.target.closest("[data-edit-expense]");
    if (editExpenseTarget) {
      openExpenseModal(editExpenseTarget.dataset.editExpense);
      return;
    }

    const deleteExpenseTarget = event.target.closest("[data-delete-expense]");
    if (deleteExpenseTarget) {
      deleteExpense(deleteExpenseTarget.dataset.deleteExpense);
      return;
    }

    const deleteSettlementTarget = event.target.closest("[data-delete-settlement]");
    if (deleteSettlementTarget) {
      deleteSettlement(deleteSettlementTarget.dataset.deleteSettlement);
      return;
    }

    const settleTarget = event.target.closest("[data-settle-from]");
    if (settleTarget) {
      recordSettlement(
        settleTarget.dataset.settleFrom,
        settleTarget.dataset.settleTo,
        settleTarget.dataset.settleAmount
      );
      return;
    }

    const removeFriendTarget = event.target.closest("[data-remove-friend]");
    if (removeFriendTarget) {
      removeFriend(removeFriendTarget.dataset.removeFriend);
      return;
    }

    const resetPwdTarget = event.target.closest("[data-reset-password]");
    if (resetPwdTarget) {
      handleResetPassword(resetPwdTarget.dataset.resetPassword);
      return;
    }

    const friendLedgerTarget = event.target.closest("[data-friend-ledger]");
    if (friendLedgerTarget) {
      openFriendLedger(friendLedgerTarget.dataset.friendLedger);
      return;
    }

    // Admin table delegated actions
    const adminRoleTarget = event.target.closest("[data-admin-role]");
    if (adminRoleTarget) {
      const friendId = adminRoleTarget.dataset.adminRole;
      const newRole = adminRoleTarget.dataset.targetRole;
      await api.updateRole(friendId, newRole);
      showToast(`Updated role to ${newRole}.`);
      await loadAndRenderData();
      return;
    }

    const adminToggleActiveTarget = event.target.closest("[data-admin-toggle-active]");
    if (adminToggleActiveTarget) {
      const friendId = adminToggleActiveTarget.dataset.adminToggleActive;
      const isCurrentlyActive = adminToggleActiveTarget.dataset.isActive === "true";
      await api.toggleFriendActive(friendId, !isCurrentlyActive);
      showToast(isCurrentlyActive ? "Member deactivated." : "Member activated.");
      await loadAndRenderData();
      return;
    }

    const adminResetPwdTarget = event.target.closest("[data-admin-reset-pwd]");
    if (adminResetPwdTarget) {
      handleResetPassword(adminResetPwdTarget.dataset.adminResetPwd);
      return;
    }

    const adminDeleteFriendTarget = event.target.closest("[data-admin-delete-friend]");
    if (adminDeleteFriendTarget) {
      removeFriend(adminDeleteFriendTarget.dataset.adminDeleteFriend);
      return;
    }

    // Modal Close
    if (event.target.closest("[data-close-modal]")) {
      const openModalElement = event.target.closest(".modal");
      if (openModalElement) closeModal(openModalElement);
      return;
    }

    // Notification dropdown close on outer click
    if (notificationRoot && !notificationRoot.contains(event.target)) {
      closeNotifications();
    }
  });

  menuToggle?.addEventListener("click", () => {
    if (sidebar?.classList.contains("is-open")) {
      closeSidebar();
    } else {
      openSidebar();
    }
  });

  sidebarOverlay?.addEventListener("click", closeSidebar);
  notificationBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleNotifications();
  });

  markReadBtn?.addEventListener("click", () => {
    state.settings.notificationsReadAt = new Date().toISOString();
    renderNotifications();
    showToast("Notifications marked as read.");
  });

  addExpenseBtn?.addEventListener("click", () => openExpenseModal());
  addFriendBtn?.addEventListener("click", () => {
    friendForm?.reset();
    openModal(friendModal);
  });
  adminAddMemberBtn?.addEventListener("click", () => {
    friendForm?.reset();
    openModal(friendModal);
  });

  loginForm?.addEventListener("submit", attemptLogin);
  logoutBtn?.addEventListener("click", logout);
  expenseForm?.addEventListener("submit", submitExpense);
  friendForm?.addEventListener("submit", submitFriend);
  settingsForm?.addEventListener("submit", saveSettings);
  adminGroupForm?.addEventListener("submit", saveAdminGroupSettings);
  passwordForms.forEach((form) => form.addEventListener("submit", handlePasswordChange));

  exportDataBtn?.addEventListener("click", exportJson);
  exportCsvBtn?.addEventListener("click", exportCsv);
  resetDataBtn?.addEventListener("click", handleDangerReset);
  adminResetDataBtn?.addEventListener("click", handleDangerReset);

  importDataBtn?.addEventListener("click", () => importDataInput?.click());
  importDataInput?.addEventListener("change", handleImportJson);

  expenseAmount?.addEventListener("input", updateAllocation);
  participantGrid?.addEventListener("input", (e) => {
    if (e.target.classList.contains("js-participant-amount")) {
      const checkbox = e.target.closest(".participant-row")?.querySelector(".js-participant-check");
      if (checkbox) checkbox.checked = Number(e.target.value) > 0;
      updateAllocation();
    }
  });

  participantGrid?.addEventListener("change", (e) => {
    if (e.target.classList.contains("js-participant-check")) {
      const input = e.target.closest(".participant-row")?.querySelector(".js-participant-amount");
      if (input && !e.target.checked) input.value = "";
      updateAllocation();
    }
  });

  splitEquallyBtn?.addEventListener("click", splitEqually);
  selectAllParticipants?.addEventListener("click", () => {
    document.querySelectorAll(".js-participant-check").forEach((box) => {
      box.checked = true;
    });
    splitEqually();
  });

  expenseSearch?.addEventListener("input", () => {
    expenseFilters.search = expenseSearch.value;
    renderExpensesPage();
  });

  expenseFilter?.addEventListener("change", () => {
    expenseFilters.category = expenseFilter.value;
    renderExpensesPage();
  });

  window.addEventListener("hashchange", () => {
    renderRoute(true, true);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const openModalElement = document.querySelector(".modal.is-open");
      if (openModalElement) {
        closeModal(openModalElement);
        return;
      }
      if (notificationMenu?.classList.contains("is-open")) {
        closeNotifications();
        return;
      }
      if (sidebar?.classList.contains("is-open")) {
        closeSidebar();
        return;
      }
    }
    trapFocus(event);
  });

  /* ------------------------------------------------------------------------
     Service Worker Registration (PWA)
     ---------------------------------------------------------------------- */
  if ("serviceWorker" in navigator && window.location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
});
