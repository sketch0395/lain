"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import RemindersPanel from "./RemindersPanel";
import AboutMePanel from "./AboutMePanel";
import MemoriesPanel from "./MemoriesPanel";
import WipeMemoryModal from "./WipeMemoryModal";
import GrantCapturePermissionModal from "./GrantCapturePermissionModal";
import MarkdownMessage from "./MarkdownMessage";

export default function ChatClient({ userLabel, userImage, signOutAction }) {
  const [conversations, setConversations] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [ollamaOk, setOllamaOk] = useState(null);
  const [toolsStatus, setToolsStatus] = useState("off");
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [personality, setPersonality] = useState(true);
  const [notifStatus, setNotifStatus] = useState("unsupported");
  const [editingId, setEditingId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [aboutMeOpen, setAboutMeOpen] = useState(false);
  const [memoriesOpen, setMemoriesOpen] = useState(false);
  const [wipeMemoryOpen, setWipeMemoryOpen] = useState(false);
  const [grantCaptureOpen, setGrantCaptureOpen] = useState(false);
  const [tone, setTone] = useState(null);
  const [deepThinking, setDeepThinking] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    refreshConversations();
    checkHealth();
    const interval = setInterval(checkHealth, 15000);

    const stored = window.localStorage.getItem("lain-personality");
    if (stored !== null) setPersonality(stored === "true");

    const storedDeep = window.localStorage.getItem("lain-deep-thinking");
    if (storedDeep !== null) setDeepThinking(storedDeep === "true");

    initNotifications();

    // Deep link support: /?c=<conversationId> (e.g. printed by the `lain`
    // CLI) opens that conversation directly instead of a blank new chat.
    const params = new URLSearchParams(window.location.search);
    const deepLinkId = params.get("c");
    if (deepLinkId) {
      openConversation(deepLinkId);
      window.history.replaceState({}, "", window.location.pathname);
    }

    return () => clearInterval(interval);
  }, []);

  function togglePersonality() {
    setPersonality((prev) => {
      const next = !prev;
      window.localStorage.setItem("lain-personality", String(next));
      return next;
    });
  }

  function toggleDeepThinking() {
    setDeepThinking((prev) => {
      const next = !prev;
      window.localStorage.setItem("lain-deep-thinking", String(next));
      return next;
    });
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  }

  async function initNotifications() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setNotifStatus("unsupported");
      return;
    }
    try {
      const keyRes = await fetch("/api/push/vapid-public-key");
      const { configured } = await keyRes.json();
      if (!configured) {
        setNotifStatus("server_off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        setNotifStatus("on");
      } else if (Notification.permission === "denied") {
        setNotifStatus("denied");
      } else {
        setNotifStatus("off");
      }
    } catch {
      setNotifStatus("unsupported");
    }
  }

  async function enableNotifications() {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setNotifStatus(permission === "denied" ? "denied" : "off");
        return;
      }
      const keyRes = await fetch("/api/push/vapid-public-key");
      const { configured, publicKey } = await keyRes.json();
      if (!configured) {
        setNotifStatus("server_off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription }),
      });
      setNotifStatus("on");
    } catch {
      setNotifStatus("off");
    }
  }

  async function disableNotifications() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setNotifStatus("off");
    } catch {
      // best-effort
    }
  }

  function toggleNotifications() {
    if (notifStatus === "on") disableNotifications();
    else enableNotifications();
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function checkHealth() {
    try {
      const res = await fetch("/api/health");
      if (res.status === 401) return redirectToLogin();
      const data = await res.json();
      setOllamaOk(data.ollamaReachable);
      setToolsStatus(
        data.toolsEnabled ? (data.toolsReachable ? "ok" : "down") : "off"
      );
      setEmailEnabled(Boolean(data.emailEnabled));
    } catch {
      setOllamaOk(false);
      setToolsStatus("down");
    }
  }

  function redirectToLogin() {
    window.location.href = "/login";
  }

  async function refreshConversations() {
    const res = await fetch("/api/conversations");
    if (res.status === 401) return redirectToLogin();
    setConversations(await res.json());
  }

  async function openConversation(id) {
    setConversationId(id);
    const res = await fetch(`/api/conversations/${id}`);
    if (res.status === 401) return redirectToLogin();
    setMessages(await res.json());
    setTone(null);
    // Reflect the open conversation in the URL so it can be copied/shared
    // (e.g. pasted into the `lain --continue <url>` CLI command).
    window.history.replaceState({}, "", `${window.location.pathname}?c=${id}`);
    setSidebarOpen(false);
  }

  function startNewChat() {
    setConversationId(null);
    setMessages([]);
    setTone(null);
    window.history.replaceState({}, "", window.location.pathname);
    setSidebarOpen(false);
  }

  async function removeConversation(e, id) {
    e.stopPropagation();
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (id === conversationId) startNewChat();
    refreshConversations();
  }

  function startRename(e, c) {
    e.stopPropagation();
    setEditingId(c.id);
    setEditingTitle(c.title || "");
  }

  async function commitRename(id) {
    const title = editingTitle.trim();
    setEditingId(null);
    if (!title) return;
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title } : c))
    );
    await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    refreshConversations();
  }

  // Secret phrase that opens the "Wipe All Memory" flow from inside chat
  // (mirrors the Settings menu option). Forgiving of curly quotes, a
  // missing/dropped apostrophe, trailing punctuation, and extra spaces —
  // an exact-match check is too easy to miss by a stray period or autocorrect.
  // Placeholder phrase — swap for whatever fits once Lain's personality
  // is defined.
  const WIPE_PHRASE = "forget everything";
  function isWipeCommand(text) {
    const normalized = text
      .trim()
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/[.!?]+$/, "")
      .replace(/\s+/g, " ")
      .replace(/'/g, "");
    return normalized === WIPE_PHRASE;
  }

  async function sendMessage(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);

    if (isWipeCommand(text)) {
      setWipeMemoryOpen(true);
      return;
    }

    await doSend(text);
  }

  async function doSend(text) {
    setSending(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          conversationId,
          personality,
          deepThinking,
        }),
      });

      if (res.status === 401) return redirectToLogin();

      const data = await res.json();

      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `⚠️ ${data.error}`,
            error: true,
            retryId: crypto.randomUUID(),
            retryText: text,
          },
        ]);
        return;
      }

      setConversationId(data.conversationId);
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}?c=${data.conversationId}`
      );

      setTone(data.tone?.label && data.tone.label !== "neutral" ? data.tone : null);

      if (data.needsConfirmation) {
        setMessages((prev) => [
          ...prev,
          {
            role: "confirm",
            pendingId: data.pendingId,
            toolCalls: data.toolCalls,
          },
        ]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply },
      ]);
      refreshConversations();
    } catch (err) {
      // Network drop, timeout, or the tab reconnecting after sleep — the
      // user's message is still in the thread, so let them retry it in
      // place instead of having to retype it.
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `⚠️ ${err.message || "Connection lost"}`,
          error: true,
          retryId: crypto.randomUUID(),
          retryText: text,
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  async function respondToToolRequest(pendingId, approve) {
    setMessages((prev) =>
      prev.map((m) =>
        m.pendingId === pendingId
          ? { ...m, resolution: approve ? "approved" : "denied" }
          : m
      )
    );
    setSending(true);
    try {
      const res = await fetch("/api/chat/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingId, approve }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `⚠️ ${data.error}`,
            error: true,
            retryId: crypto.randomUUID(),
            retryToolCall: { pendingId, approve },
          },
        ]);
        return;
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply },
      ]);
      refreshConversations();
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `⚠️ ${err.message || "Connection lost"}`,
          error: true,
          retryId: crypto.randomUUID(),
          retryToolCall: { pendingId, approve },
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function retryMessage(m) {
    setMessages((prev) => prev.filter((mm) => mm.retryId !== m.retryId));
    if (m.retryToolCall) {
      respondToToolRequest(m.retryToolCall.pendingId, m.retryToolCall.approve);
    } else {
      doSend(m.retryText);
    }
  }

  return (
    <div className="flex h-dvh bg-[var(--lain-bg)] text-[var(--lain-text)] overflow-hidden">
      {/* Mobile top bar: hamburger + title. Hidden on md+ where the sidebar is always visible. */}
      <div className="md:hidden fixed top-0 inset-x-0 z-30 flex items-center gap-3 px-3 h-14 bg-[var(--lain-panel)] border-b border-[var(--lain-border)]">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open chat list"
          className="p-2 -ml-2 text-[var(--lain-text)] active:opacity-60"
        >
          <span className="text-xl leading-none">☰</span>
        </button>
        {/* Text monogram logo — no external image asset. */}
        <span className="w-6 h-6 rounded-md bg-[var(--lain-accent)] border border-[var(--lain-highlight)]/40 flex items-center justify-center text-xs font-bold shrink-0">
          L
        </span>
        <span className="font-bold bg-gradient-to-r from-[var(--lain-accent-light)] to-[var(--lain-highlight-soft)] bg-clip-text text-transparent">
          Lain
        </span>
      </div>

      {/* Backdrop for the mobile drawer. */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-30"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed md:static inset-y-0 left-0 z-40 w-72 md:w-64 shrink-0 bg-[var(--lain-panel)] border-r border-[var(--lain-border)] p-4 flex flex-col transition-transform duration-200 ease-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
          {/* Text monogram logo — no external image asset. */}
          <span className="w-7 h-7 rounded-md bg-[var(--lain-accent)] border border-[var(--lain-highlight)]/40 flex items-center justify-center text-sm font-bold shrink-0">
            L
          </span>
          <span className="text-xl font-bold bg-gradient-to-r from-[var(--lain-accent-light)] to-[var(--lain-highlight-soft)] bg-clip-text text-transparent">
            Lain
          </span>
        </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close chat list"
            className="md:hidden p-1 text-[var(--lain-muted)]"
          >
            ✕
          </button>
        </div>
        <button
          onClick={startNewChat}
          className="bg-[var(--lain-accent)] hover:bg-[var(--lain-accent-light)] text-[var(--lain-text)] rounded-lg py-2.5 font-semibold mb-3 border border-[var(--lain-highlight)]/40 transition-colors"
        >
          + New Chat
        </button>
        <button
          type="button"
          onClick={() => setRemindersOpen(true)}
          className="flex items-center justify-center gap-2 bg-[var(--lain-panel-alt)] hover:bg-[var(--lain-border)] text-[var(--lain-text)] rounded-lg py-2 text-sm font-medium mb-3 border border-[var(--lain-border)] transition-colors"
        >
          ⏰ Reminders
        </button>
        <div className="flex-1 overflow-y-auto space-y-1 -mx-1 px-1">
          {conversations.map((c) => (
            <div
              key={c.id}
              onClick={() => editingId !== c.id && openConversation(c.id)}
              onDoubleClick={(e) => startRename(e, c)}
              className={`flex items-center justify-between px-3 py-2.5 md:py-2 rounded-md text-sm cursor-pointer text-[var(--lain-muted)] hover:bg-[var(--lain-accent)]/20 hover:text-[var(--lain-text)] ${
                c.id === conversationId
                  ? "bg-[var(--lain-accent)]/20 text-[var(--lain-text)] border-l-2 border-[var(--lain-highlight)]"
                  : ""
              }`}
            >
              {editingId === c.id ? (
                <input
                  autoFocus
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={() => commitRename(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(c.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="flex-1 bg-transparent border-b border-[var(--lain-highlight)] text-[var(--lain-text)] outline-none min-w-0 text-base md:text-sm"
                />
              ) : (
                <span className="truncate">{c.title || "New chat"}</span>
              )}
              <span className="flex items-center gap-3 md:gap-2 shrink-0 ml-2">
                <span
                  onClick={(e) => startRename(e, c)}
                  title="Rename chat"
                  className="opacity-50 hover:opacity-100 hover:text-[var(--lain-highlight)] p-1 -m-1"
                >
                  ✎
                </span>
                <span
                  onClick={(e) => removeConversation(e, c.id)}
                  title="Delete chat"
                  className="opacity-50 hover:opacity-100 hover:text-[var(--lain-accent-light)] p-1 -m-1"
                >
                  ✕
                </span>
              </span>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="flex items-center gap-2 mt-2 pt-3 border-t border-[var(--lain-border)] text-xs text-[var(--lain-muted)] hover:text-[var(--lain-text)] text-left"
        >
          {userImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={userImage}
              alt=""
              className="w-7 h-7 rounded-full border border-[var(--lain-highlight)]/40 shrink-0"
            />
          )}
          <span className="truncate flex-1">{userLabel}</span>
          <span className="opacity-60">⚙️</span>
        </button>
      </aside>

      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-[var(--lain-panel)] border border-[var(--lain-highlight)]/40 rounded-2xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold bg-gradient-to-r from-[var(--lain-accent-light)] to-[var(--lain-highlight-soft)] bg-clip-text text-transparent">
                Settings
              </h2>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                aria-label="Close settings"
                className="p-1 text-[var(--lain-muted)] hover:text-[var(--lain-text)]"
              >
                ✕
              </button>
            </div>

            <div className="flex items-center gap-3">
              {userImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={userImage}
                  alt=""
                  className="w-10 h-10 rounded-full border border-[var(--lain-highlight)]/40"
                />
              )}
              <span className="text-sm text-[var(--lain-text)] truncate">{userLabel}</span>
            </div>

            <div className="space-y-1 border-t border-[var(--lain-border)] pt-3">
              <button
                type="button"
                onClick={() => {
                  setSettingsOpen(false);
                  setAboutMeOpen(true);
                }}
                className="w-full flex items-center justify-between px-1 py-2 text-sm text-[var(--lain-muted)] hover:text-[var(--lain-text)]"
              >
                <span>👤 About me</span>
                <span className="opacity-60">›</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSettingsOpen(false);
                  setMemoriesOpen(true);
                }}
                className="w-full flex items-center justify-between px-1 py-2 text-sm text-[var(--lain-muted)] hover:text-[var(--lain-text)]"
              >
                <span>🧠 Memories</span>
                <span className="opacity-60">›</span>
              </button>

              <Link
                href="/threat-intel"
                onClick={() => setSettingsOpen(false)}
                className="w-full flex items-center justify-between px-1 py-2 text-sm text-[var(--lain-muted)] hover:text-[var(--lain-text)]"
              >
                <span>🛡️ Threat Intel</span>
                <span className="opacity-60">›</span>
              </Link>

              <button
                type="button"
                onClick={() => {
                  setSettingsOpen(false);
                  setWipeMemoryOpen(true);
                }}
                title="Permanently erase everything Lain has learned and remembered about you"
                className="w-full flex items-center justify-between px-1 py-2 text-sm text-[var(--lain-accent-light)] hover:text-red-400"
              >
                <span>🗑️ Wipe All Memory</span>
                <span className="opacity-60">›</span>
              </button>

              {toolsStatus !== "off" && (
                <button
                  type="button"
                  onClick={() => {
                    setSettingsOpen(false);
                    setGrantCaptureOpen(true);
                  }}
                  title="Grant tcpdump permission to capture live network traffic (requires your sudo password, sent directly to the tools agent — never through chat)"
                  className="w-full flex items-center justify-between px-1 py-2 text-sm text-[var(--lain-muted)] hover:text-[var(--lain-text)]"
                >
                  <span>🛡️ Enable packet capture</span>
                  <span className="opacity-60">›</span>
                </button>
              )}

              <button
                type="button"
                onClick={togglePersonality}
                aria-pressed={personality}
                title="Toggle Lain's personality on or off"
                className="w-full flex items-center justify-between px-1 py-2 text-sm text-[var(--lain-muted)] hover:text-[var(--lain-text)]"
              >
                <span>{personality ? "✨ Personality: on" : "Personality: off"}</span>
                <span
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    personality ? "bg-[var(--lain-accent)]" : "bg-[var(--lain-border)]"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-[var(--lain-text)] transition-transform ${
                      personality ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </span>
              </button>

              {notifStatus !== "unsupported" && (
                <button
                  type="button"
                  onClick={toggleNotifications}
                  disabled={notifStatus === "denied" || notifStatus === "server_off"}
                  aria-pressed={notifStatus === "on"}
                  title={
                    notifStatus === "denied"
                      ? "Notifications blocked in browser settings"
                      : notifStatus === "server_off"
                      ? "Server hasn't configured push notifications (VAPID keys) yet"
                      : "Toggle browser push notifications for reminders"
                  }
                  className="w-full flex items-center justify-between px-1 py-2 text-sm text-[var(--lain-muted)] hover:text-[var(--lain-text)] disabled:opacity-50"
                >
                  <span>
                    {notifStatus === "denied"
                      ? "🔕 Notifications: blocked"
                      : notifStatus === "server_off"
                      ? "Notifications: not set up on server"
                      : notifStatus === "on"
                      ? "🔔 Notifications: on"
                      : "Notifications: off"}
                  </span>
                  <span
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                      notifStatus === "on" ? "bg-[var(--lain-accent)]" : "bg-[var(--lain-border)]"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-[var(--lain-text)] transition-transform ${
                        notifStatus === "on" ? "translate-x-4" : "translate-x-0.5"
                      }`}
                    />
                  </span>
                </button>
              )}
            </div>

            <div className="text-xs text-[var(--lain-muted)] border-t border-[var(--lain-border)] pt-3 space-y-1">
              <div>
                {ollamaOk === null
                  ? "checking connection…"
                  : ollamaOk
                  ? "🟢 laptop reachable"
                  : "🔴 laptop unreachable"}
              </div>
              {toolsStatus !== "off" && (
                <div>
                  {toolsStatus === "ok"
                    ? "🧰 tools agent connected"
                    : "🧰 tools agent unreachable"}
                </div>
              )}
              {emailEnabled && <div>📧 email reminders enabled</div>}
            </div>

            {signOutAction && (
              <form action={signOutAction} className="border-t border-[var(--lain-border)] pt-3">
                <button
                  type="submit"
                  className="w-full text-sm text-[var(--lain-muted)] hover:text-[var(--lain-text)] border border-[var(--lain-border)] rounded-lg py-2"
                >
                  Sign out
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {remindersOpen && <RemindersPanel onClose={() => setRemindersOpen(false)} />}

      {aboutMeOpen && <AboutMePanel onClose={() => setAboutMeOpen(false)} />}

      {memoriesOpen && <MemoriesPanel onClose={() => setMemoriesOpen(false)} />}

      {wipeMemoryOpen && (
        <WipeMemoryModal
          onClose={() => setWipeMemoryOpen(false)}
          onWiped={() => {
            startNewChat();
            refreshConversations();
          }}
        />
      )}

      {grantCaptureOpen && (
        <GrantCapturePermissionModal onClose={() => setGrantCaptureOpen(false)} />
      )}

      <main className="flex-1 flex flex-col min-w-0 pt-14 md:pt-0">
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-3 bg-no-repeat"
          style={{
            backgroundImage: "url(/lain-bg.jpeg)",
            backgroundSize: "260px auto",
            backgroundPosition: "bottom right",
          }}
        >
          {messages.map((m, i) =>
            m.role === "confirm" ? (
              <div
                key={i}
                className="max-w-[85%] sm:max-w-[70%] px-4 py-3 rounded-2xl bg-[var(--lain-panel-alt)]/50 border border-[var(--lain-highlight)]/50 space-y-2"
              >
                <p className="text-sm">
                  🔧 Lain wants to:
                  <br />
                  {m.toolCalls.map((tc, j) => (
                    <span key={j} className="block text-[var(--lain-highlight-soft)]">
                      • {tc.description}
                    </span>
                  ))}
                </p>
                {!m.resolution ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => respondToToolRequest(m.pendingId, true)}
                      className="flex-1 rounded-lg bg-[var(--lain-accent)] hover:bg-[var(--lain-accent-light)] py-1.5 text-sm font-semibold border border-[var(--lain-highlight)]/40"
                    >
                      Allow
                    </button>
                    <button
                      type="button"
                      onClick={() => respondToToolRequest(m.pendingId, false)}
                      className="flex-1 rounded-lg border border-[var(--lain-border)] py-1.5 text-sm text-[var(--lain-muted)] hover:text-[var(--lain-text)]"
                    >
                      Deny
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-[var(--lain-muted)]">
                    {m.resolution === "approved" ? "✅ Allowed" : "🚫 Denied"}
                  </p>
                )}
              </div>
            ) : (
              <div
                key={i}
                className={`max-w-[85%] sm:max-w-[70%] px-4 py-2 rounded-2xl break-words ${
                  m.role === "user"
                    ? "self-end ml-auto whitespace-pre-wrap bg-gradient-to-br from-[var(--lain-accent)]/50 to-[var(--lain-accent-dark)]/50 text-[var(--lain-text)] border border-[var(--lain-highlight)]/30"
                    : m.error
                    ? "bg-[var(--lain-panel-alt)]/50 border border-red-500/40"
                    : "bg-[var(--lain-panel-alt)]/50 border border-[var(--lain-border)]"
                }`}
              >
                {m.role === "user" ? (
                  <p>{m.content}</p>
                ) : (
                  <MarkdownMessage content={m.content} />
                )}
                {m.error && (
                  <button
                    type="button"
                    onClick={() => retryMessage(m)}
                    disabled={sending}
                    className="mt-2 flex items-center gap-1 text-xs font-medium text-[var(--lain-highlight-soft)] hover:text-[var(--lain-highlight)] disabled:opacity-50"
                  >
                    <span>🔄</span>
                    <span>Retry</span>
                  </button>
                )}
              </div>
            )
          )}
          {sending && (
            <div className="max-w-[85%] sm:max-w-[70%] px-4 py-2 rounded-2xl bg-[var(--lain-panel-alt)]/50 border border-[var(--lain-border)] text-[var(--lain-muted)]">
              Lain is thinking…
            </div>
          )}
        </div>

        {tone && (
          <div
            className="px-3 sm:px-4 pt-2 text-xs text-[var(--lain-muted)] flex items-center gap-1"
            title="Lain's read on your last message's tone — influences her reply style"
          >
            <span>{tone.emoji}</span>
            <span>{tone.hint}</span>
          </div>
        )}

        <div className="px-3 sm:px-4 pt-2 flex items-center justify-end">
          <button
            type="button"
            onClick={toggleDeepThinking}
            aria-pressed={deepThinking}
            title="Deep Thinking uses a larger, slower model for harder questions (a bit slower to respond, including a brief model-swap delay)"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
              deepThinking
                ? "bg-[var(--lain-accent)] border-[var(--lain-highlight)]/40 text-[var(--lain-text)]"
                : "bg-[var(--lain-panel-alt)] border-[var(--lain-border)] text-[var(--lain-muted)] hover:text-[var(--lain-text)]"
            }`}
          >
            <span>🧠</span>
            <span>{deepThinking ? "Deep Thinking: on" : "Deep Thinking: off"}</span>
          </button>
        </div>

        <form
          onSubmit={sendMessage}
          className="flex gap-2 sm:gap-3 p-3 sm:p-4 border-t border-[var(--lain-border)]"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage(e);
              }
            }}
            rows={1}
            placeholder="Message Lain..."
            className="flex-1 resize-none bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-xl px-3 py-2 text-base sm:text-sm text-[var(--lain-text)] placeholder:text-[var(--lain-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-highlight)]"
          />
          <button
            type="submit"
            disabled={sending}
            aria-label="Send message"
            title="Send"
            className="flex items-center justify-center shrink-0 w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-gradient-to-r from-[var(--lain-accent)] to-[var(--lain-accent-dark)] border border-[var(--lain-highlight)]/40 text-[var(--lain-text)] disabled:opacity-50 hover:brightness-110 transition"
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              className="w-5 h-5 translate-x-[1px]"
              aria-hidden="true"
            >
              <path d="M2.94 2.94a1.5 1.5 0 0 1 1.62-.33l17 6.5a1.5 1.5 0 0 1 0 2.8l-17 6.5a1.5 1.5 0 0 1-2-1.83L4.2 12 2.56 4.42a1.5 1.5 0 0 1 .38-1.48Zm3.02 3.7L7.24 11H13a1 1 0 0 1 0 2H7.24l-1.28 4.36L18.6 12Z" />
            </svg>
          </button>
        </form>
      </main>
    </div>
  );
}
