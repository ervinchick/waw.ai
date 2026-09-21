(() => {
  "use strict";

  /* =========================================================
     КОНСТАНТЫ
     ========================================================= */
  const STORAGE_KEY = "waw_web_state_v1";
  // OpenAI-совместимый endpoint. Можно заменить на свой прокси,
  // главное — чтобы он принимал { model, messages } и ключ Bearer.
  const API_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
  const DEFAULT_MODEL = "openai/gpt-4o-mini";

  /* =========================================================
     STORAGE
     ========================================================= */
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // миграция: подмешиваем новые поля настроек к старым сохранениям
        parsed.settings = Object.assign(defaultState().settings, parsed.settings || {});
        return parsed;
      }
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
        apiKey: "",
        apiModel: DEFAULT_MODEL,
      },
    };
  }

  let state = loadState() || defaultState();
  let reasoningOn = state.settings.reasoningDefault;
  let roleplayOn = state.settings.roleplayDefault;
  let isGenerating = false; // не даём отправлять, пока WAW печатает

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
  const themeSegmented = $("themeSegmented");
  const reasoningDefaultSwitch = $("reasoningDefaultSwitch");
  const roleplayDefaultSwitch = $("roleplayDefaultSwitch");
  const apiKeyInput = $("apiKeyInput");
  const toggleKeyVisibility = $("toggleKeyVisibility");
  const apiModelInput = $("apiModelInput");
  const wipeDataBtn = $("wipeDataBtn");

  /* =========================================================
     MARKDOWN + ПОДСВЕТКА
     ========================================================= */
  function renderMarkdown(el, text, withCaret) {
    if (window.marked && window.DOMPurify) {
      const html = marked.parse(text, { breaks: true, gfm: true });
      el.innerHTML = DOMPurify.sanitize(html) + (withCaret ? '<span class="stream-caret"></span>' : "");
    } else {
      el.textContent = text + (withCaret ? "▌" : "");
    }
  }

  function highlightCode(root) {
    if (!window.hljs) return;
    root.querySelectorAll("pre code").forEach((block) => {
      try { hljs.highlightElement(block); } catch (e) { /* noop */ }
    });
  }

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
     RENDER: сообщения — только пузыри, без аватарок и ников
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

    chat.messages.forEach((m) => {
      const { body, textEl } = buildMessageShell(m);
      renderMarkdown(textEl, m.text, false);
      highlightCode(textEl);
      messagesEl.appendChild(body);
    });
    scrollThreadToBottom();
  }

  function buildMessageShell(m) {
    const wrap = document.createElement("div");
    wrap.className = "msg " + (m.role === "user" ? "user" : "model");

    const body = document.createElement("div");
    body.className = "msg-body";

    if (m.reasoning) {
      const reasoning = document.createElement("div");
      reasoning.className = "reasoning-block";
      reasoning.textContent = m.reasoning;
      body.appendChild(reasoning);
    }

    const textEl = document.createElement("div");
    textEl.className = "msg-text";
    body.appendChild(textEl);

    wrap.appendChild(body);
    return { wrap, body, textEl };
  }

  function scrollThreadToBottom() {
    requestAnimationFrame(() => {
      threadEl.scrollTop = threadEl.scrollHeight;
    });
  }

  /* =========================================================
     Плавный стрим текста сверху вниз (печатная машинка)
     ========================================================= */
  function streamText(textEl, fullText) {
    return new Promise((resolve) => {
      const len = fullText.length;
      // длительность: длинные ответы печатаются быстрее, но не дольше ~4с
      const duration = Math.min(4000, Math.max(900, len * 16));
      const start = performance.now();
      let raf = null;

      function tick(now) {
        const p = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - p, 2); // ease-out
        const cut = Math.floor(len * eased);
        renderMarkdown(textEl, fullText.slice(0, cut), p < 1);
        threadEl.scrollTop = threadEl.scrollHeight;

        if (p < 1) {
          raf = requestAnimationFrame(tick);
        } else {
          renderMarkdown(textEl, fullText, false);
          highlightCode(textEl);
          threadEl.scrollTop = threadEl.scrollHeight;
          resolve();
        }
      }

      raf = requestAnimationFrame(tick);
    });
  }

  /* =========================================================
     TYPING INDICATOR
     ========================================================= */
  function showTyping() {
    brandDot.classList.add("thinking");
    emptyStateEl.style.display = "none";

    const wrap = document.createElement("div");
    wrap.className = "msg model";
    wrap.id = "typingRow";
    wrap.innerHTML = `
      <div class="msg-body">
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
    sendBtn.disabled = messageInput.value.trim().length === 0 || isGenerating;
  }

  async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || isGenerating) return;

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

    isGenerating = true;
    showTyping();

    try {
      const { answer, reasoning } = await getReply(chat);
      hideTyping();

      const msg = {
        role: "model",
        text: answer,
        reasoning: reasoning || undefined,
        createdAt: Date.now(),
      };
      chat.messages.push(msg);
      save();

      // добавляем пустой пузырь и плавно печатаем в него сверху вниз
      const { body, textEl } = buildMessageShell(msg);
      messagesEl.appendChild(body);
      scrollThreadToBottom();

      await streamText(textEl, answer);
    } catch (err) {
      console.error("WAW: reply failed", err);
      hideTyping();
      const msg = {
        role: "model",
        text: "не удалось получить ответ. проверь API-ключ в настройках или попробуй позже",
        createdAt: Date.now(),
      };
      chat.messages.push(msg);
      save();
      const { body, textEl } = buildMessageShell(msg);
      messagesEl.appendChild(body);
      await streamText(textEl, msg.text);
    } finally {
      isGenerating = false;
      updateSendBtnState();
      messageInput.focus();
    }
  }

  /* =========================================================
     REPLY: настоящий API по ключу ИЛИ демо-режим
     ========================================================= */
  function buildSystemPrompt() {
    const parts = ["Ты — WAW, дружелюбный ИИ-ассистент. Отвечай на языке пользователя, используй Markdown: заголовки, списки, **жирный**, код в ```блоках``` где уместно."];
    if (state.settings.personalInstruction) {
      parts.push("Персональная инструкция пользователя: " + state.settings.personalInstruction);
    }
    if (roleplayOn) {
      parts.push("Стиль: живой, образный, с лёгкой эмоциональной окраской, как разговор с хорошим другом.");
    }
    if (reasoningOn) {
      parts.push("Перед ответом напиши краткое рассуждение (1–2 предложения) в формате «Рассуждение: …», затем сам ответ после слова «Ответ: ».");
    }
    return parts.join("\n");
  }

  async function getReply(chat) {
    const apiKey = state.settings.apiKey.trim();

    // ---- демо-режим без ключа ----
    if (!apiKey) return demoReply(chat);

    // ---- настоящий API ----
    const history = chat.messages
      .filter((m) => m.text)
      .map((m) => ({
        role: m.role === "model" ? "assistant" : "user",
        content: m.text,
      }));

    const res = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: state.settings.apiModel.trim() || DEFAULT_MODEL,
        messages: [{ role: "system", content: buildSystemPrompt() }, ...history],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`API вернул ${res.status}: ${detail.slice(0, 200)}`);
    }

    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content ?? "пустой ответ";

    return parseReasoning(raw);
  }

  /** Выделяет «Рассуждение: … Ответ: …», если модель его вернула. */
  function parseReasoning(raw) {
    if (!reasoningOn) return { answer: raw.trim(), reasoning: undefined };
    const match = raw.match(/рассуждение\s*:\s*([\s\S]*?)\s*ответ\s*:\s*([\s\S]*)/i);
    if (match) {
      return { reasoning: match[1].trim(), answer: match[2].trim() };
    }
    return { answer: raw.trim(), reasoning: undefined };
  }

  /** Демо-ответ без бэкенда — для превью и пока нет ключа. */
  function demoReply(chat) {
    const lastUser = [...chat.messages].reverse().find((m) => m.role === "user");
    const userText = lastUser ? lastUser.text : "";
    const delay = 500 + Math.random() * 700;

    const openers = roleplayOn
      ? ["хм, дай подумать вместе с тобой —", "о, интересный вопрос!", "ладно, слушай сюда:"]
      : ["", "", ""];

    const opener = openers[Math.floor(Math.random() * openers.length)];

    const answer = `это **демо-режим** WAW прямо в браузере: добавь свой API-ключ в настройках, и ответы будут приходить от настоящей модели. ${
      opener ? opener + " " : ""
    }пока могу только отразить то, что ты написал: «${truncate(userText, 160)}»

\`\`\`
настройки → подключение → API-ключ
\`\`\``;

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

  // Escape закрывает панели
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeSettings();
      closeSidebar();
    }
  });

  function populateSettingsForm() {
    displayNameInput.value = state.settings.displayName;
    personalInstructionInput.value = state.settings.personalInstruction;
    piCount.textContent = String(state.settings.personalInstruction.length);
    apiKeyInput.value = state.settings.apiKey;
    apiModelInput.value = state.settings.apiModel;

    // сегмент темы
    themeSegmented.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("active", b.dataset.theme === state.settings.theme);
    });

    document.querySelectorAll(".swatch").forEach((sw) => {
      sw.classList.toggle("active", sw.dataset.accent === state.settings.accent);
    });

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

  apiKeyInput.addEventListener("input", () => {
    state.settings.apiKey = apiKeyInput.value.trim();
    save();
  });

  toggleKeyVisibility.addEventListener("click", () => {
    const show = apiKeyInput.type === "password";
    apiKeyInput.type = show ? "text" : "password";
    toggleKeyVisibility.setAttribute("aria-label", show ? "Скрыть ключ" : "Показать ключ");
    apiKeyInput.focus();
  });

  apiModelInput.addEventListener("input", () => {
    state.settings.apiModel = apiModelInput.value.trim() || DEFAULT_MODEL;
    save();
  });

  themeSegmented.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-theme]");
    if (!btn) return;
    state.settings.theme = btn.dataset.theme;
    save();
    applyTheme();
    populateSettingsForm();
  });

  accentSwatches.addEventListener("click", (e) => {
    const btn = e.target.closest(".swatch");
    if (!btn) return;
    state.settings.accent = btn.dataset.accent;
    save();
    applyTheme();
    populateSettingsForm();
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
    document.body.classList.toggle("light", state.settings.theme === "light");
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
