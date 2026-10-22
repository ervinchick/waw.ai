(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const app = () => window.WAWApp;
  const input = $("messageInput");
  const list = $("chatList");

  /* ===== 6. Счётчик символов и токенов ===== */
  const counter = $("charCounter");
  function updateCounter() {
    const n = input.value.length;
    counter.textContent = n ? `${n}/4000 · ≈${Math.ceil(n / 4)} токенов` : "";
  }
  input.addEventListener("input", updateCounter);

  /* ===== 7. Шаблоны промптов ===== */
  const TEMPLATES = [
    ["Перескажи", "перескажи коротко: "],
    ["Переведи на английский", "переведи на английский: "],
    ["Исправь ошибки", "исправь ошибки в тексте: "],
    ["Объясни проще", "объясни проще: "],
    ["Сделай короче", "сделай короче: "],
  ];
  const tplBox = $("templates");
  TEMPLATES.forEach(([label, prefix]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tpl-chip";
    b.textContent = label;
    b.addEventListener("click", () => {
      input.value = prefix + input.value;
      input.dispatchEvent(new Event("input"));
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
    tplBox.appendChild(b);
  });

  /* ===== 1. Экспорт диалога в Markdown ===== */
  function safeName(s) {
    return (s || "chat").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60) || "chat";
  }

  function exportChat() {
    const chat = app().getActiveChat();
    if (!chat || !chat.messages.length) {
      app().toast("в диалоге пока нет сообщений", true);
      return;
    }
    const me = app().state.settings.displayName || "Ты";
    const lines = [`# ${chat.title}`, ""];
    chat.messages.forEach((m) => {
      lines.push(`**${m.role === "model" ? "WAW" : me}:**`, "", m.text || "", "");
    });
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = safeName(chat.title) + ".md";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $("exportChatBtn").addEventListener("click", exportChat);

  /* ===== 2. Поиск по диалогам ===== */
  const search = document.createElement("input");
  search.type = "search";
  search.id = "chatSearch";
  search.className = "chat-search";
  search.placeholder = "Поиск по диалогам";
  list.parentNode.insertBefore(search, list);

  function applyFilter() {
    const q = search.value.trim().toLowerCase();
    const chats = app().orderedChats();
    [...list.children].forEach((el, i) => {
      const c = chats[i];
      if (!c) return;
      const hit =
        !q ||
        c.title.toLowerCase().includes(q) ||
        c.messages.some((m) => (m.text || "").toLowerCase().includes(q));
      el.style.display = hit ? "" : "none";
    });
  }
  search.addEventListener("input", applyFilter);
  // список перерисовывается при каждом изменении — фильтр применяем заново
  new MutationObserver(applyFilter).observe(list, { childList: true });

  /* ===== 11. Статистика в настройках ===== */
  function renderStats() {
    const chats = app().state.chats;
    let msgs = 0, user = 0, model = 0, files = 0;
    chats.forEach((c) =>
      c.messages.forEach((m) => {
        msgs++;
        if (m.role === "model") model++; else user++;
        if (m.image) files++;
      })
    );
    const rows = [
      ["Диалогов", chats.length],
      ["Сообщений", msgs],
      ["Твоих", user],
      ["Ответов WAW", model],
      ["Вложений", files],
    ];
    $("statsBox").innerHTML =
      rows.map(([k, v]) => `<div class="stat-row"><span>${k}</span><b>${v}</b></div>`).join("") +
      '<p class="stat-note">Считаются загруженные диалоги. Облачные чаты, которые ещё не открывались, попадут в статистику после открытия.</p>';
  }
  new MutationObserver(() => {
    if ($("settingsScrim").classList.contains("open")) renderStats();
  }).observe($("settingsScrim"), { attributes: true, attributeFilter: ["class"] });

  updateCounter();
  applyFilter();
})();
