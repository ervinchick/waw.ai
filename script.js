(() => {
  "use strict";

  /* =========================================================
     STORAGE
     ========================================================= */
  const STORAGE_KEY = "waw_web_state_v1";

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.warn("WAW: failed to read stored state", e);
    }
    return null;
  }

  function makeChat(index) {
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: `Чат ${index}`,
      messages: [],
    };
  }

  function defaultState() {
    const chat = makeChat(1);
    return {
      chats: [chat],
      activeChatId: chat.id,
      settings: {
        displayName: "Ты",
        personalInstruction: "",
        accent: "violet",
        theme: "dark",
        reasoningDefault: false,
        roleplayDefault: false,
        apiUrl: "",
      },
    };
  }

  let state = loadState() || defaultState();
  // сессионные переключатели (не default-настройки, а то, что включено прямо сейчас)
  let reasoningOn = state.settings.reasoningDefault;
  let roleplayOn = state.settings.roleplayDefault;

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("WAW: failed to persist state", e);
    }
  }

  function getActiveChat() {
    return (
      state.chats.find((c) => c.id === state.activeChatId) || state.chats[0]
    );
  }

  /* =========================================================
     DOM REFS
     ========================================================= */
  const $ = (id) => document.getElementById(id);

  const chatListEl = $("chatList");
  const messagesEl = $("messages");
  const emptyStateEl = $("emptyState");
  const threadEl = $("thread");
  const topbarTitleEl = $("topbarTitle");
  const messageInput = $("messageInput");
  const sendBtn = $("sendBtn");
  const brandDot = document.querySelector(".brand-dot");

  const sidebarEl = $("sidebar");
  const sidebarScrim = $("sidebarScrim");
  const openSidebarBtn = $("openSidebarBtn");
  const closeSidebarBtn = $("closeSidebarBtn");

  const newChatBtn = $("newChatBtn");
  const deleteChatBtn = $("deleteChatBtn");

  const reasoningToggle = $("reasoningToggle");
  const roleplayToggle = $("roleplayToggle");

  const settingsBtn = $("settingsBtn");
  const settingsPanel = $("settingsPanel");
  const settingsScrim = $("settingsScrim");
  const closeSettingsBtn = $("closeSettingsBtn");

  const displayNameInput = $("displayNameInput");
  const userDisplayName = $("userDisplayName");
  const userAvatar = $("userAvatar");
  const personalInstructionInput = $("personalInstructionInput");
  const piCount = $("piCount");
  const accentSwatches = $("accentSwatches");
  const themeSwitch = $("themeSwitch");
  const reasoningDefaultSwitch = $("reasoningDefaultSwitch");
  const roleplayDefaultSwitch = $("roleplayDefaultSwitch");
  const apiUrlInput = $("apiUrlInput");
  const wipeDataBtn = $("wipeDataBtn");

  /* =========================================================
     RENDER: sidebar chat list
     ========================================================= */
  function renderChatList() {
    chatListEl.innerHTML = "";
    state.chats.forEach((chat) => {
      const item = document.createElement("div");
      item.className =
        "chat-item" + (chat.id === state.activeChatId ? " active" : "");
      item.tabIndex = 0;
      item.setAttribute("role", "button");

      const title = document.createElement("span");
      title.className = "title";
      title.textContent = chat.title;

      const del = document.createElement("button");
      del.className = "del";
      del.setAttribute("aria-label", "Удалить чат");
      del.innerHTML =
        '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13a1 1 0 001 1h6a1 1 0 001-1l1-13"/></svg>';
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteChat(chat.id);
      });

      item.appendChild(title);
      item.appendChild(del);

      item.addEventListener("click", () => selectChat(chat.id));
      item.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectChat(chat.id);
        }
      });

      chatListEl.appendChild(item);
    });
  }

  function selectChat(chatId) {
    state.activeChatId = chatId;
    save();
    renderAll();
    closeSidebarOnMobile();
  }

  function createChat() {
    const chat = makeChat(state.chats.length + 1);
    state.chats.push(chat);
    state.activeChatId = chat.id;
    save();
    renderAll();
    closeSidebarOnMobile();
    messageInput.focus();
  }

  function deleteChat(chatId) {
    const wasActive = chatId === state.activeChatId;
    state.chats = state.chats.filter((c) => c.id !== chatId);

    if (state.chats.length === 0) {
      const replacement = makeChat(1);
      state.chats = [replacement];
      state.activeChatId = replacement.id;
    } else if (wasActive) {
      state.activeChatId = state.chats[0].id;
    }

    save();
    renderAll();
  }

  /* =========================================================
     RENDER: messages
     ========================================================= */
  function renderMessages() {
    const chat = getActiveChat();
    topbarTitleEl.textContent = chat.title;
    messagesEl.innerHTML = "";

    if (chat.messages.length === 0) {
      emptyStateEl.style.display = "block";
      return;
    }
    emptyStateEl.style.display = "none";

    chat.messages.forEach((m) => appendMessageEl(m));
    scrollThreadToBottom();
  }

  function appendMessageEl(m) {
    const wrap = document.createElement("div");
    wrap.className = "msg " + (m.role === "user" ? "user" : "model");

    const avatar = document.createElement("div");
    avatar.className = "bubble-avatar";
    avatar.textContent = m.role === "user" ? "Т" : "W";

    const body = document.createElement("div");
    body.className = "msg-body";

    const name = document.createElement("div");
    name.className = "msg-name";
    name.textContent =
      m.role === "user" ? state.settings.displayName || "Ты" : "WAW";

    body.appendChild(name);

    if (m.reasoning) {
      const reasoning = document.createElement("div");
      reasoning.className = "reasoning-block";
      reasoning.textContent = m.reasoning;
      body.appendChild(reasoning);
    }

    const text = document.createElement("div");
    text.className = "msg-text";
    text.textContent = m.text;
    body.appendChild(text);

    wrap.appendChild(avatar);
    wrap.appendChild(body);
    messagesEl.appendChild(wrap);
  }

  function scrollThreadToBottom() {
    requestAnimationFrame(() => {
      threadEl.scrollTop = threadEl.scrollHeight;
    });
  }

  /* =========================================================
     TYPING / THINKING INDICATOR
     ========================================================= */
  function showTyping() {
    brandDot.classList.add("thinking");
    emptyStateEl.style.display = "none";

    const wrap = document.createElement("div");
    wrap.className = "msg model";
    wrap.id = "typingRow";
    wrap.innerHTML = `
      <div class="bubble-avatar">W</div>
      <div class="msg-body">
        <div class="msg-name">WAW</div>
        <div class="typing"><span></span><span></span><span></span></div>
      </div>`;
    messagesEl.appendChild(wrap);
    scrollThreadToBottom();
  }

  function hideTyping() {
    brandDot.classList.remove("thinking");
    const row = $("typingRow");
    if (row) row.remove();
  }

  /* =========================================================
     SENDING MESSAGES
     ========================================================= */
  function autoResizeInput() {
    messageInput.style.height = "auto";
    messageInput.style.height = Math.min(messageInput.scrollHeight, 180) + "px";
  }

  function updateSendBtnState() {
    sendBtn.disabled = messageInput.value.trim().length === 0;
  }

  async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    const chat = getActiveChat();

    if (chat.messages.length === 0 && chat.title.startsWith("Чат")) {
      chat.title = text.slice(0, 32) + (text.length > 32 ? "…" : "");
    }

    chat.messages.push({ role: "user", text, createdAt: Date.now() });
    save();
    renderChatList();
    renderMessages();

    messageInput.value = "";
    autoResizeInput();
    updateSendBtnState();

    showTyping();

    try {
      const { answer, reasoning } = await getReply(chat);
      hideTyping();
      chat.messages.push({
        role: "model",
        text: answer,
        reasoning: reasoning || undefined,
        createdAt: Date.now(),
      });
      save();
      renderMessages();
    } catch (err) {
      console.error("WAW: reply failed", err);
      hideTyping();
      chat.messages.push({
        role: "model",
        text: "не удалось получить ответ. попробуй ещё раз чуть позже",
        createdAt: Date.now(),
      });
      save();
      renderMessages();
    }
  }

  /**
   * Пытается получить ответ от настоящего API-сервера (если задан адрес
   * в настройках), иначе отвечает демо-режимом прямо в браузере.
   *
   * Формат запроса к серверу — под замену под ваш api-server:
   *   POST { messages, personalInstruction, reasoning, roleplay }
   *   ответ: { text, reasoning? }
   */
  async function getReply(chat) {
    const apiUrl = state.settings.apiUrl.trim();

    if (apiUrl) {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: chat.messages.map((m) => ({ role: m.role, text: m.text })),
          personalInstruction: state.settings.personalInstruction || null,
          reasoning: reasoningOn,
          roleplay: roleplayOn,
        }),
      });

      if (!res.ok) throw new Error(`API вернул ${res.status}`);
      const data = await res.json();
      return { answer: data.text ?? "пустой ответ", reasoning: data.reasoning };
    }

    return demoReply(chat);
  }

  /** Демо-ответ без бэкенда — имитирует поведение бота для превью на GitHub Pages. */
  function demoReply(chat) {
    const lastUser = [...chat.messages].reverse().find((m) => m.role === "user");
    const userText = lastUser ? lastUser.text : "";

    const delay = 500 + Math.random() * 700;

    const openers = roleplayOn
      ? [
          "хм, дай подумать вместе с тобой —",
          "о, интересный вопрос!",
          "ладно, слушай сюда:",
        ]
      : ["", "", ""];

    const opener = openers[Math.floor(Math.random() * openers.length)];

    let answer = `это демо-режим WAW прямо в браузере: настоящий ответ будет приходить с твоего API-сервера, как только укажешь его адрес в настройках. ${
      opener ? opener + " " : ""
    }пока могу только отразить то, что ты написал: «${truncate(userText, 160)}»`;

    let reasoning;
    if (reasoningOn) {
      reasoning = "нет подключённого API — формирую заглушку на основе последнего сообщения";
    }

    return new Promise((resolve) => {
      setTimeout(() => resolve({ answer, reasoning }), delay);
    });
  }

  function truncate(str, n) {
    return str.length > n ? str.slice(0, n).trim() + "…" : str;
  }

  /* =========================================================
     TOGGLES (reasoning / roleplay) — session state
     ========================================================= */
  function setToggle(btn, on) {
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  reasoningToggle.addEventListener("click", () => {
    reasoningOn = !reasoningOn;
    setToggle(reasoningToggle, reasoningOn);
  });

  roleplayToggle.addEventListener("click", () => {
    roleplayOn = !roleplayOn;
    setToggle(roleplayToggle, roleplayOn);
  });

  /* =========================================================
     SIDEBAR (mobile)
     ========================================================= */
  function openSidebar() {
    sidebarEl.classList.add("open");
    sidebarScrim.classList.add("open");
  }
  function closeSidebar() {
    sidebarEl.classList.remove("open");
    sidebarScrim.classList.remove("open");
  }
  function closeSidebarOnMobile() {
    if (window.innerWidth <= 840) closeSidebar();
  }

  openSidebarBtn.addEventListener("click", openSidebar);
  closeSidebarBtn.addEventListener("click", closeSidebar);
  sidebarScrim.addEventListener("click", closeSidebar);

  /* =========================================================
     SETTINGS PANEL
     ========================================================= */
  function openSettings() {
    populateSettingsForm();
    settingsPanel.classList.add("open");
    settingsPanel.setAttribute("aria-hidden", "false");
    settingsScrim.classList.add("open");
  }
  function closeSettings() {
    settingsPanel.classList.remove("open");
    settingsPanel.setAttribute("aria-hidden", "true");
    settingsScrim.classList.remove("open");
  }

  settingsBtn.addEventListener("click", openSettings);
  closeSettingsBtn.addEventListener("click", closeSettings);
  settingsScrim.addEventListener("click", closeSettings);

  function populateSettingsForm() {
    displayNameInput.value = state.settings.displayName;
    personalInstructionInput.value = state.settings.personalInstruction;
    piCount.textContent = String(state.settings.personalInstruction.length);
    apiUrlInput.value = state.settings.apiUrl;

    document.querySelectorAll(".swatch").forEach((sw) => {
      sw.classList.toggle(
        "active",
        sw.dataset.accent === state.settings.accent,
      );
    });

    setSwitch(themeSwitch, state.settings.theme === "dark");
    setSwitch(reasoningDefaultSwitch, state.settings.reasoningDefault);
    setSwitch(roleplayDefaultSwitch, state.settings.roleplayDefault);
  }

  function setSwitch(el, on) {
    el.setAttribute("aria-checked", on ? "true" : "false");
  }

  displayNameInput.addEventListener("input", () => {
    state.settings.displayName = displayNameInput.value.trim() || "Ты";
    save();
    applyProfileToUI();
  });

  personalInstructionInput.addEventListener("input", () => {
    const val = personalInstructionInput.value.slice(0, 2000);
    state.settings.personalInstruction = val;
    piCount.textContent = String(val.length);
    save();
  });

  apiUrlInput.addEventListener("input", () => {
    state.settings.apiUrl = apiUrlInput.value.trim();
    save();
  });

  accentSwatches.addEventListener("click", (e) => {
    const btn = e.target.closest(".swatch");
    if (!btn) return;
    state.settings.accent = btn.dataset.accent;
    save();
    applyTheme();
    populateSettingsForm();
  });

  themeSwitch.addEventListener("click", () => {
    const on = themeSwitch.getAttribute("aria-checked") !== "true";
    state.settings.theme = on ? "dark" : "light";
    save();
    setSwitch(themeSwitch, on);
    applyTheme();
  });

  reasoningDefaultSwitch.addEventListener("click", () => {
    const on = reasoningDefaultSwitch.getAttribute("aria-checked") !== "true";
    state.settings.reasoningDefault = on;
    save();
    setSwitch(reasoningDefaultSwitch, on);
  });

  roleplayDefaultSwitch.addEventListener("click", () => {
    const on = roleplayDefaultSwitch.getAttribute("aria-checked") !== "true";
    state.settings.roleplayDefault = on;
    save();
    setSwitch(roleplayDefaultSwitch, on);
  });

  wipeDataBtn.addEventListener("click", () => {
    if (!confirm("Удалить все чаты и настройки без возможности восстановления?")) return;
    localStorage.removeItem(STORAGE_KEY);
    state = defaultState();
    reasoningOn = state.settings.reasoningDefault;
    roleplayOn = state.settings.roleplayDefault;
    save();
    closeSettings();
    applyTheme();
    applyProfileToUI();
    renderAll();
  });

  /* =========================================================
     THEME / PROFILE APPLY
     ========================================================= */
  function applyTheme() {
    document.documentElement.setAttribute("data-accent", state.settings.accent);
    document.documentElement.setAttribute("data-theme", state.settings.theme);
  }

  function applyProfileToUI() {
    userDisplayName.textContent = state.settings.displayName || "Ты";
    userAvatar.textContent = (state.settings.displayName || "Т").trim()[0]?.toUpperCase() || "Т";
  }

  /* =========================================================
     CHAT CONTROLS
     ========================================================= */
  newChatBtn.addEventListener("click", createChat);
  deleteChatBtn.addEventListener("click", () => deleteChat(state.activeChatId));

  messageInput.addEventListener("input", () => {
    autoResizeInput();
    updateSendBtnState();
  });

  messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.addEventListener("click", sendMessage);

  /* =========================================================
     INIT
     ========================================================= */
  function renderAll() {
    renderChatList();
    renderMessages();
  }

  applyTheme();
  applyProfileToUI();
  setToggle(reasoningToggle, reasoningOn);
  setToggle(roleplayToggle, roleplayOn);
  renderAll();
  updateSendBtnState();
})();
