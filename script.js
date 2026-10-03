(() => {
  "use strict";

  const STORAGE_KEY = "waw_web_state_v1";
  const API_ENDPOINT = "https://forwaw-ai.ervin-mandarin.workers.dev/chat";
  const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // исходник; перед сохранением сжимаем
  const MAX_IMAGE_SIDE = 1280;

  const ACCENT_ICONS = {
    violet: "mainicon2.png",
    magenta: "mainicon3.png",
    indigo: "mainicon5.png",
    pine: "mainicon.png",
    cosmic: "mainicon6.png",
    rose: "mainicon4.png",
  };

  const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  /* =========================================================
     STORAGE
     ========================================================= */
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.chats) || parsed.chats.length === 0) {
          return null;
        }
        parsed.settings = Object.assign(defaultState().settings, parsed.settings || {});
        if (!parsed.chats.some((c) => c.id === parsed.activeChatId)) {
          parsed.activeChatId = parsed.chats[0].id;
        }
        parsed.chats.forEach((c) => {
          if (!Array.isArray(c.messages)) c.messages = [];
        });
        return parsed;
      }
    } catch (e) {
      console.warn("WAW: failed to read stored state", e);
    }
    return null;
  }

  function makeChat(index) {
    return { id: uid(), title: `Диалог ${index}`, messages: [] };
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
      },
    };
  }

  let state = loadState() || defaultState();
  let reasoningOn = state.settings.reasoningDefault;
  let roleplayOn = state.settings.roleplayDefault;
  let isGenerating = false;
  let typingChatId = null;
  let pendingImage = null;

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // localStorage переполнен (обычно из-за картинок) — выкидываем старые картинки
      try {
        const active = getActiveChat();
        const keep = active.messages[active.messages.length - 1];
        state.chats.forEach((c) =>
          c.messages.forEach((m) => {
            if (m.image && m !== keep) m.image = null;
          })
        );
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (e2) {
        console.warn("WAW: failed to persist state", e2);
      }
    }
  }

  function getActiveChat() {
    return state.chats.find((c) => c.id === state.activeChatId) || state.chats[0];
  }

  /* =========================================================
     DOM
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

  const attachBtn = $("attachBtn");
  const fileInput = $("fileInput");
  const attachPreview = $("attachPreview");
  const attachPreviewImg = $("attachPreviewImg");
  const attachRemove = $("attachRemove");

  const settingsBtn = $("settingsBtn");
  const settingsScrim = $("settingsScrim");
  const settingsPanel = $("settingsPanel");
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

  const wipeDataBtn = $("wipeDataBtn");

  const wawModalScrim = $("wawModalScrim");
  const wawModalTitle = $("wawModalTitle");
  const wawModalText = $("wawModalText");
  const wawModalCancel = $("wawModalCancel");
  const wawModalConfirm = $("wawModalConfirm");

  let modalResolver = null;

  function showConfirm(title, text, confirmLabel) {
    wawModalTitle.textContent = title;
    wawModalText.textContent = text;
    wawModalConfirm.textContent = confirmLabel || "Удалить";
    wawModalScrim.classList.add("open");
    return new Promise((resolve) => { modalResolver = resolve; });
  }

  function closeModal(result) {
    wawModalScrim.classList.remove("open");
    if (modalResolver) {
      modalResolver(result);
      modalResolver = null;
    }
  }

  wawModalCancel.addEventListener("click", () => closeModal(false));
  wawModalConfirm.addEventListener("click", () => closeModal(true));
  wawModalScrim.addEventListener("click", (e) => {
    if (e.target === wawModalScrim) closeModal(false);
  });

  /* =========================================================
     MARKDOWN
     ========================================================= */
  if (window.DOMPurify) {
    // ссылки из ответов открываем в новой вкладке
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    });
  }

  function renderMarkdown(el, text, withCaret) {
    const caret = withCaret ? '<span class="stream-caret"></span>' : "";
    if (window.marked && window.DOMPurify) {
      const parse = marked.parse || marked;
      const html = parse(text, { breaks: true, gfm: true });
      el.innerHTML = DOMPurify.sanitize(html, { ADD_ATTR: ["target"] }) + caret;
    } else {
      el.textContent = text + (withCaret ? "▌" : "");
    }
  }

  function highlightCode(root) {
    if (!window.hljs) return;
    root.querySelectorAll("pre code").forEach((block) => {
      try { hljs.highlightElement(block); } catch (e) {}
    });
  }

  /* =========================================================
     RENAME
     ========================================================= */
  function startRenameChat(chat, titleEl) {
    const current = chat.title;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "chat-rename-input";
    input.value = current;
    input.maxLength = 60;

    titleEl.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    function commit(ok) {
      if (done) return;
      done = true;
      const val = input.value.trim();
      if (ok && val && val !== current) {
        chat.title = val;
        save();
        if (chat.id === state.activeChatId) {
          topbarTitleEl.textContent = chat.title;
        }
      }
      renderChatList();
    }

    // клики и клавиши внутри поля не должны всплывать в .chat-item
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); commit(true); }
      if (e.key === "Escape") { e.preventDefault(); commit(false); }
    });
    input.addEventListener("blur", () => commit(true));
  }

  /* =========================================================
     CHAT LIST
     ========================================================= */
  function renderChatList() {
    chatListEl.innerHTML = "";
    state.chats.forEach((chat) => {
      const item = document.createElement("div");
      item.className = "chat-item" + (chat.id === state.activeChatId ? " active" : "");
      item.tabIndex = 0;
      item.setAttribute("role", "button");

      const title = document.createElement("span");
      title.className = "title";
      title.textContent = chat.title;

      const actions = document.createElement("div");
      actions.className = "chat-actions";

      const edit = document.createElement("button");
      edit.className = "chat-action edit";
      edit.setAttribute("aria-label", "Переименовать диалог");
      edit.title = "Переименовать";
      edit.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
      edit.addEventListener("click", (e) => {
        e.stopPropagation();
        startRenameChat(chat, title);
      });

      const del = document.createElement("button");
      del.className = "chat-action del";
      del.setAttribute("aria-label", "Удалить диалог");
      del.title = "Удалить";
      del.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13a1 1 0 001 1h6a1 1 0 001-1l1-13"/></svg>';
      del.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ok = await showConfirm(
          "Удалить диалог?",
          `«${chat.title}» будет удалён вместе с историей.`,
          "Удалить"
        );
        if (ok) deleteChat(chat.id);
      });

      actions.appendChild(edit);
      actions.appendChild(del);

      item.appendChild(title);
      item.appendChild(actions);

      item.addEventListener("click", () => selectChat(chat.id));
      item.addEventListener("keydown", (e) => {
        if (e.target !== item) return; // не перехватываем ввод в поле переименования
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
     VARIANTS (хранятся прямо в сообщении, переживают перезагрузку)
     message.text / message.reasoning всегда = текущий вариант
     ========================================================= */
  function ensureVariants(m) {
    if (!Array.isArray(m.variants) || m.variants.length === 0) {
      m.variants = [{ text: m.text, reasoning: m.reasoning }];
      m.vIndex = 0;
    }
    if (typeof m.vIndex !== "number") m.vIndex = m.variants.length - 1;
    return m;
  }

  function setVariant(m, i) {
    ensureVariants(m);
    m.vIndex = i;
    m.text = m.variants[i].text;
    m.reasoning = m.variants[i].reasoning;
  }

  /* =========================================================
     MESSAGE SHELL
     ========================================================= */
  function buildMessageShell(m) {
    const wrap = document.createElement("div");
    wrap.className = "msg " + (m.role === "user" ? "user" : "model");
    if (m.role === "model") wrap.dataset.messageId = m.id || "";

    const body = document.createElement("div");
    body.className = "msg-body";

    if (m.image) {
      const img = document.createElement("img");
      img.src = m.image;
      img.className = "msg-image";
      img.alt = "";
      body.appendChild(img);
    }

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

    if (m.role === "model") {
      body.appendChild(createMessageActions(m, body));
    }

    return { wrap, body, textEl };
  }

  function createIcon(path) { return `<svg viewBox="0 0 24 24">${path}</svg>`; }

  function createMessageActions(message, body) {
    const actions = document.createElement("div");
    actions.className = "msg-actions";

    const copyBtn = document.createElement("button");
    copyBtn.className = "msg-action";
    copyBtn.title = "Скопировать";
    copyBtn.innerHTML = createIcon('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>');
    copyBtn.addEventListener("click", () => copyMessage(message, body, copyBtn));

    const likeBtn = document.createElement("button");
    likeBtn.className = "msg-action";
    likeBtn.title = "Нравится";
    likeBtn.innerHTML = createIcon('<path d="M7 10v10H4a2 2 0 01-2-2v-6a2 2 0 012-2h3z"/><path d="M7 20h9.5a2 2 0 001.9-1.4l2-7A2 2 0 0018.5 9H14l.7-3.2A2.3 2.3 0 0012.5 3L7 10"/>');

    const dislikeBtn = document.createElement("button");
    dislikeBtn.className = "msg-action";
    dislikeBtn.title = "Не нравится";
    dislikeBtn.innerHTML = createIcon('<path d="M7 14V4H4a2 2 0 00-2 2v6a2 2 0 002 2h3z"/><path d="M7 4h9.5a2 2 0 011.9 1.4l2 7A2 2 0 0118.5 15H14l.7 3.2a2.3 2.3 0 01-2.2 2.8L7 14"/>');

    likeBtn.addEventListener("click", () => {
      likeBtn.classList.toggle("active-like");
      dislikeBtn.classList.remove("active-dislike");
    });
    dislikeBtn.addEventListener("click", () => {
      dislikeBtn.classList.toggle("active-dislike");
      likeBtn.classList.remove("active-like");
    });

    const retryBtn = document.createElement("button");
    retryBtn.className = "msg-action retry";
    retryBtn.title = "Переписать ответ";
    retryBtn.innerHTML = createIcon('<path d="M20 11a8.1 8.1 0 00-14.9-4L3 10"/><path d="M3 4v6h6"/><path d="M4 13a8.1 8.1 0 0014.9 4L21 14"/><path d="M21 20v-6h-6"/>');
    retryBtn.addEventListener("click", () => retryMessage(message));

    const versions = document.createElement("div");
    versions.className = "msg-versions";
    const prevBtn = document.createElement("button");
    prevBtn.className = "msg-version-arrow";
    prevBtn.innerHTML = "‹";
    const count = document.createElement("span");
    count.className = "msg-version-count";
    const nextBtn = document.createElement("button");
    nextBtn.className = "msg-version-arrow";
    nextBtn.innerHTML = "›";
    versions.appendChild(prevBtn);
    versions.appendChild(count);
    versions.appendChild(nextBtn);

    function updateVersionControls() {
      const total = message.variants ? message.variants.length : 1;
      if (total <= 1) {
        versions.style.display = "none";
        return;
      }
      const cur = message.vIndex ?? total - 1;
      versions.style.display = "flex";
      count.textContent = `${cur + 1}/${total}`;
      prevBtn.disabled = cur <= 0;
      nextBtn.disabled = cur >= total - 1;
    }

    function shift(delta) {
      ensureVariants(message);
      const next = message.vIndex + delta;
      if (next < 0 || next >= message.variants.length) return;
      setVariant(message, next);
      save();
      renderVariantInPlace(message, body);
      updateVersionControls();
    }

    prevBtn.addEventListener("click", () => shift(-1));
    nextBtn.addEventListener("click", () => shift(1));

    body._updateVersions = updateVersionControls;

    actions.appendChild(copyBtn);
    actions.appendChild(likeBtn);
    actions.appendChild(dislikeBtn);
    actions.appendChild(retryBtn);
    actions.appendChild(versions);

    updateVersionControls();
    return actions;
  }

  function renderVariantInPlace(message, body) {
    const textEl = body.querySelector(".msg-text");
    if (!textEl) return;

    let reasoning = body.querySelector(".reasoning-block");
    if (message.reasoning) {
      if (!reasoning) {
        reasoning = document.createElement("div");
        reasoning.className = "reasoning-block";
        body.insertBefore(reasoning, textEl);
      }
      reasoning.textContent = message.reasoning;
    } else if (reasoning) {
      reasoning.remove();
    }

    renderMarkdown(textEl, message.text, false);
    highlightCode(textEl);
  }

  async function copyMessage(message, body, button) {
    try {
      await navigator.clipboard.writeText(message.text);
      body.classList.remove("copy-flash");
      void body.offsetWidth;
      body.classList.add("copy-flash");
      setTimeout(() => body.classList.remove("copy-flash"), 850);
      const old = button.innerHTML;
      button.innerHTML = createIcon('<path d="M5 12l4 4L19 6"/>');
      setTimeout(() => { button.innerHTML = old; }, 1000);
    } catch (err) {
      console.warn("WAW: clipboard failed", err);
    }
  }

  async function retryMessage(originalMessage) {
    if (isGenerating) return;
    const chat = getActiveChat();
    const index = chat.messages.findIndex((m) => m.id === originalMessage.id);
    if (index === -1) return;

    const hasUser = chat.messages.slice(0, index).some((m) => m.role === "user");
    if (!hasUser) return;

    const wrap = messagesEl.querySelector(
      `.msg[data-message-id="${originalMessage.id}"]`
    );
    const body = wrap && wrap.querySelector(".msg-body");
    const textEl = wrap && wrap.querySelector(".msg-text");
    if (!body || !textEl) return;

    isGenerating = true;
    updateSendBtnState();

    textEl.innerHTML = `<div class="typing"><span></span><span></span><span></span></div>`;

    try {
      const result = await getReply(chat.messages.slice(0, index), null);
      const variant = { text: result.answer, reasoning: result.reasoning || undefined };

      if (originalMessage.error) {
        // вместо сообщения об ошибке ставим нормальный ответ
        originalMessage.error = false;
        originalMessage.variants = [variant];
        originalMessage.vIndex = 0;
      } else {
        ensureVariants(originalMessage);
        originalMessage.variants.push(variant);
        originalMessage.vIndex = originalMessage.variants.length - 1;
      }
      setVariant(originalMessage, originalMessage.vIndex);

      renderVariantInPlace(originalMessage, body);
      if (body._updateVersions) body._updateVersions();

      save();
      scrollThreadToBottom();
    } catch (err) {
      console.error("WAW: retry failed", err);
      renderVariantInPlace(originalMessage, body); // возвращаем прежний текст
      alert("не удалось переписать ответ: " + (err && err.message ? err.message : "ошибка"));
    } finally {
      isGenerating = false;
      updateSendBtnState();
    }
  }

  /* =========================================================
     ПРИВЕТСТВИЕ
     ========================================================= */
  const EMPTY_GREETINGS = [
    "не хочешь поговорить?",
    "о чём поговорим?",
    "с чего начнём?",
    "я тут. что скажешь?",
    "есть что обсудить?",
    "давай поболтаем",
    "как ты сегодня?",
    "что на душе?",
    "как настроение?",
    "что нового?",
    "ну что, поговорим?",
    "я слушаю",
    "давай, удиви меня",
    "рассказывай",
    "о чём думаешь?",
    "что тебя занимает?",
    "есть мысли?",
    "я на связи",
    "waw тут. чем займёмся?",
    "я готов слушать",
  ];

  function pickGreeting() {
    const name = state.settings.displayName && state.settings.displayName !== "Ты"
      ? state.settings.displayName
      : null;

    const phrase = EMPTY_GREETINGS[Math.floor(Math.random() * EMPTY_GREETINGS.length)];

    if (name && Math.random() < 0.3) return `${name}, ${phrase}`;
    return phrase;
  }

  /* =========================================================
     RENDER MESSAGES
     ========================================================= */
  function renderMessages() {
    const chat = getActiveChat();
    topbarTitleEl.textContent = chat.title;
    messagesEl.innerHTML = "";

    if (chat.messages.length === 0) {
      emptyStateEl.style.display = "block";
      const greeting = $("emptyGreeting");
      if (greeting) greeting.textContent = pickGreeting();
      return;
    }
    emptyStateEl.style.display = "none";

    chat.messages.forEach((m) => {
      if (m.role === "model" && !m.id) m.id = uid();
      const { wrap, textEl } = buildMessageShell(m);
      renderMarkdown(textEl, m.text, false);
      highlightCode(textEl);
      messagesEl.appendChild(wrap);
    });

    // если в этом чате ещё идёт генерация — возвращаем индикатор
    if (isGenerating && typingChatId === chat.id) showTyping();

    scrollThreadToBottom();
  }

  function scrollThreadToBottom() {
    requestAnimationFrame(() => { threadEl.scrollTop = threadEl.scrollHeight; });
  }

  function streamText(textEl, fullText) {
    return new Promise((resolve) => {
      const len = fullText.length;
      const duration = Math.min(1400, Math.max(300, len * 6));
      const start = performance.now();
      let lastRender = 0;

      function tick(now) {
        const p = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - p, 2);
        const cut = Math.floor(len * eased);
        if (now - lastRender >= 32 || p >= 1) {
          renderMarkdown(textEl, fullText.slice(0, cut), p < 1);
          lastRender = now;
          threadEl.scrollTop = threadEl.scrollHeight;
        }
        if (p < 1) requestAnimationFrame(tick);
        else {
          renderMarkdown(textEl, fullText, false);
          highlightCode(textEl);
          threadEl.scrollTop = threadEl.scrollHeight;
          resolve();
        }
      }
      requestAnimationFrame(tick);
    });
  }

  function showTyping() {
    if ($("typingRow")) return;
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
     IMAGE
     ========================================================= */
  // уменьшаем и пережимаем в JPEG, чтобы не забить localStorage
  function compressImage(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onerror = () => resolve(null);
      reader.onload = () => {
        const original = reader.result;
        const img = new Image();
        img.onerror = () => resolve(original);
        img.onload = () => {
          const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          try {
            resolve(canvas.toDataURL("image/jpeg", 0.85));
          } catch (e) {
            resolve(original);
          }
        };
        img.src = original;
      };
      reader.readAsDataURL(file);
    });
  }

  attachBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("Можно прикрепить только изображение");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      alert("Максимум 10 МБ");
      return;
    }
    const dataUrl = await compressImage(file);
    if (!dataUrl) {
      alert("Не удалось прочитать изображение");
      return;
    }
    pendingImage = { dataUrl: dataUrl, name: file.name };
    attachPreviewImg.src = dataUrl;
    attachPreview.hidden = false;
    updateSendBtnState();
  });

  function clearPendingImage() {
    pendingImage = null;
    attachPreview.hidden = true;
    attachPreviewImg.src = "";
  }

  attachRemove.addEventListener("click", () => {
    clearPendingImage();
    updateSendBtnState();
  });

  /* =========================================================
     SEND
     ========================================================= */
  function autoResizeInput() {
    messageInput.style.height = "auto";
    messageInput.style.height = Math.min(messageInput.scrollHeight, 180) + "px";
  }

  function updateSendBtnState() {
    const hasText = messageInput.value.trim().length > 0;
    const hasImage = !!pendingImage;
    sendBtn.disabled = (!hasText && !hasImage) || isGenerating;
  }

  async function sendMessage() {
    const text = messageInput.value.trim();
    const imageToSend = pendingImage;
    if ((!text && !imageToSend) || isGenerating) return;

    const chat = getActiveChat();

    if (chat.messages.length === 0 && chat.title.startsWith("Диалог")) {
      const base = text || "Изображение";
      chat.title = base.slice(0, 32) + (base.length > 32 ? "…" : "");
    }

    chat.messages.push({
      role: "user",
      text: text || "[изображение]",
      image: imageToSend ? imageToSend.dataUrl : null,
      createdAt: Date.now(),
    });

    clearPendingImage();

    save();
    renderChatList();

    isGenerating = true;
    typingChatId = chat.id;
    renderMessages(); // добавит индикатор набора

    messageInput.value = "";
    autoResizeInput();
    updateSendBtnState();

    // пока ждали ответ, диалог могли сменить или удалить
    const stillThere = () => state.chats.includes(chat);
    const isVisible = () => stillThere() && state.activeChatId === chat.id;

    try {
      const { answer, reasoning } = await getReply(chat, imageToSend);

      const msg = {
        id: uid(),
        role: "model",
        text: answer,
        reasoning: reasoning || undefined,
        createdAt: Date.now(),
      };
      ensureVariants(msg);

      if (!stillThere()) return;
      chat.messages.push(msg);
      save();

      if (isVisible()) {
        hideTyping();
        const { wrap, textEl } = buildMessageShell(msg);
        messagesEl.appendChild(wrap);
        scrollThreadToBottom();
        await streamText(textEl, answer);
      }
    } catch (err) {
      console.error("WAW: reply failed", err);

      if (!stillThere()) return;

      const msg = {
        id: uid(),
        role: "model",
        error: true,
        text:
          "не удалось получить ответ (" +
          (err && err.message ? err.message : "неизвестная ошибка") +
          "). попробуй ещё раз чуть позже",
        createdAt: Date.now(),
      };
      ensureVariants(msg);
      chat.messages.push(msg);
      save();

      if (isVisible()) {
        hideTyping();
        const { wrap, textEl } = buildMessageShell(msg);
        messagesEl.appendChild(wrap);
        await streamText(textEl, msg.text);
      }
    } finally {
      hideTyping();
      isGenerating = false;
      typingChatId = null;
      updateSendBtnState();
      if (window.innerWidth > 840) messageInput.focus();
    }
  }

  /* =========================================================
     API
     ========================================================= */
  async function getReply(source, imagePayload) {
    const chatMessages = Array.isArray(source) ? source : source.messages;

    // сообщения-ошибки в историю модели не отправляем
    const usable = chatMessages.filter((m) => m.text && !m.error);

    const history = usable.map((m) => ({
      role: m.role === "model" ? "assistant" : "user",
      text: m.text,
    }));

    // картинка последнего user-сообщения (в том числе при «переписать ответ»)
    let image = imagePayload ? imagePayload.dataUrl : null;
    if (!image) {
      for (let i = usable.length - 1; i >= 0; i--) {
        if (usable[i].role === "user") {
          image = usable[i].image || null;
          break;
        }
      }
    }

    const res = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        history: history,
        personalInstruction: state.settings.personalInstruction || "",
        reasoning: reasoningOn,
        roleplay: roleplayOn,
        image: image,
      }),
    });

    let data = null;
    try { data = await res.json(); }
    catch (e) { throw new Error(`Worker вернул не JSON (HTTP ${res.status})`); }

    if (!res.ok || !data || !data.ok) {
      throw new Error((data && data.error) || `Worker вернул HTTP ${res.status}`);
    }

    return parseReasoning(data.answer || "пустой ответ");
  }

  function parseReasoning(raw) {
    if (!reasoningOn) {
      return { answer: raw.trim(), reasoning: undefined };
    }
    const match = raw.match(
      /^\s*[*_#>\s]*(?:рассуждение|reasoning|мысли|thinking)\s*[*_]*\s*:\s*[*_]*\s*([\s\S]*?)\s*[*_#>\s]*(?:ответ|answer)\s*[*_]*\s*:\s*[*_]*\s*([\s\S]*)$/i
    );
    if (match && match[2].trim()) {
      return { reasoning: match[1].trim(), answer: match[2].trim() };
    }
    return { answer: raw.trim(), reasoning: undefined };
  }

  /* =========================================================
     TOGGLES
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
     SIDEBAR
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
     SETTINGS
     ========================================================= */
  function openSettings() {
    populateSettingsForm();
    settingsScrim.classList.add("open");
    settingsPanel.setAttribute("aria-hidden", "false");
  }
  function closeSettings() {
    settingsScrim.classList.remove("open");
    settingsPanel.setAttribute("aria-hidden", "true");
  }

  settingsBtn.addEventListener("click", openSettings);
  closeSettingsBtn.addEventListener("click", closeSettings);
  settingsScrim.addEventListener("click", (e) => {
    if (e.target === settingsScrim) closeSettings();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (wawModalScrim.classList.contains("open")) {
        closeModal(false);
      } else if (settingsScrim.classList.contains("open")) {
        closeSettings();
      } else {
        closeSidebar();
      }
    }
  });

  function populateSettingsForm() {
    displayNameInput.value = state.settings.displayName;
    personalInstructionInput.value = state.settings.personalInstruction;
    piCount.textContent = String(state.settings.personalInstruction.length);

    themeSegmented.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("active", b.dataset.theme === state.settings.theme);
    });
    themeSegmented.dataset.active = state.settings.theme;

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

  function createThemeRipple(x, y, color) {
    const ripple = document.createElement("div");
    ripple.className = "theme-ripple";
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    ripple.style.setProperty("--theme-ripple-color", color);
    document.body.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
  }

  function animateThemeChange(sourceElement, apply) {
    const rect = sourceElement && sourceElement.getBoundingClientRect();
    apply();
    if (!rect) return;
    const newBg = getComputedStyle(document.body).backgroundColor;
    createThemeRipple(rect.left + rect.width / 2, rect.top + rect.height / 2, newBg);
  }

  themeSegmented.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-theme]");
    if (!btn) return;
    const nextTheme = btn.dataset.theme;
    if (nextTheme === state.settings.theme) return;

    animateThemeChange(btn, () => {
      state.settings.theme = nextTheme;
      save();
      applyTheme();
      populateSettingsForm();
    });
  });

  accentSwatches.addEventListener("click", (e) => {
    const btn = e.target.closest(".swatch");
    if (!btn) return;
    const nextAccent = btn.dataset.accent;
    if (nextAccent === state.settings.accent) return;

    const rect = btn.getBoundingClientRect();
    state.settings.accent = nextAccent;
    save();
    applyTheme();
    populateSettingsForm();

    const newAccent = getComputedStyle(document.documentElement)
      .getPropertyValue("--accent");
    createThemeRipple(rect.left + rect.width / 2, rect.top + rect.height / 2, newAccent);
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

  wipeDataBtn.addEventListener("click", async () => {
    const ok = await showConfirm(
      "Удалить всё?",
      "Все диалоги, настройки и персонализация будут удалены без возможности восстановления.",
      "Удалить всё"
    );
    if (!ok) return;

    localStorage.removeItem(STORAGE_KEY);
    state = defaultState();
    reasoningOn = state.settings.reasoningDefault;
    roleplayOn = state.settings.roleplayDefault;
    clearPendingImage();
    save();
    closeSettings();
    setToggle(reasoningToggle, reasoningOn);
    setToggle(roleplayToggle, roleplayOn);
    applyTheme();
    applyProfileToUI();
    renderAll();
    updateSendBtnState();
  });

  function resolveTheme() {
    const t = state.settings.theme;
    if (t === "system") {
      return window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
    }
    return t;
  }

  function updateLogo() {
    const src = ACCENT_ICONS[state.settings.accent] || ACCENT_ICONS.violet;
    const logo = document.getElementById("emptyLogo");
    if (logo && logo.getAttribute("src") !== src) logo.setAttribute("src", src);
    const fav = document.querySelector('link[rel="icon"]');
    if (fav && fav.getAttribute("href") !== src) fav.setAttribute("href", src);
  }

  function applyTheme() {
    document.documentElement.setAttribute("data-accent", state.settings.accent);
    const resolved = resolveTheme();
    document.body.classList.toggle("light", resolved === "light");
    themeSegmented.dataset.active = state.settings.theme;

    // цвет статус-бара под выбранную тему (а не только под системную)
    const barColor = resolved === "light" ? "#FFFFFF" : "#0E0B19";
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      m.setAttribute("content", barColor);
    });

    updateLogo();
  }

  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (state.settings.theme === "system") applyTheme();
  });

  function applyProfileToUI() {
    userDisplayName.textContent = state.settings.displayName || "Ты";
    userAvatar.textContent =
      (state.settings.displayName || "Т").trim().charAt(0).toUpperCase() || "Т";
  }

  newChatBtn.addEventListener("click", createChat);

  deleteChatBtn.addEventListener("click", async () => {
    const chat = getActiveChat();
    const ok = await showConfirm(
      "Удалить диалог?",
      `«${chat.title}» будет удалён вместе с историей.`,
      "Удалить"
    );
    if (ok) deleteChat(chat.id);
  });

  messageInput.addEventListener("input", () => {
    autoResizeInput();
    updateSendBtnState();
  });

  messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.addEventListener("click", sendMessage);

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
