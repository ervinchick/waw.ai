/* ===========================================================
   WAW — WawID: профиль пользователя (public.profiles в Supabase).
   • @handle с живой проверкой занятости (RPC wawid_available)
   • имя, «о себе», акцент, персональная инструкция и настройки
     синхронизируются между устройствами через профиль;
   • без входа всё хранится в localStorage, как раньше.
   Подключается ДО script.js: тот вызывает хуки WAWID.*
   =========================================================== */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const Cloud = () => window.WAWCloud;
  const App = () => window.WAWApp;

  const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
  // ключи state.settings, которые лежат в profiles.settings (jsonb)
  const SETTINGS_KEYS = ["theme", "reasoningDefault", "roleplayDefault", "model", "streamingEnabled"];
  const ACCENTS = ["violet", "magenta", "indigo", "pine", "cosmic", "rose"];
  const SYNC_VERSION = 1;

  let user = null;
  let profile = null;
  let pushTimer = 0;
  let applying = false;
  let pushWarned = false;

  /* ---------- маппинг настроек <-> профиль ---------- */
  function settingsToPatch(s) {
    const settings = { _v: SYNC_VERSION };
    SETTINGS_KEYS.forEach((k) => { if (s[k] !== undefined) settings[k] = s[k]; });
    const dn = (s.displayName || "").trim();
    return {
      display_name: dn && dn !== "Ты" ? dn.slice(0, 30) : null,
      personal_instruction: (s.personalInstruction || "").slice(0, 2000) || null,
      accent: ACCENTS.includes(s.accent) ? s.accent : null,
      settings: settings,
    };
  }

  function profileToSettings(p) {
    const out = {};
    const ps = p.settings && typeof p.settings === "object" ? p.settings : {};
    SETTINGS_KEYS.forEach((k) => { if (ps[k] !== undefined) out[k] = ps[k]; });
    if (p.display_name) out.displayName = p.display_name;
    if (typeof p.personal_instruction === "string") out.personalInstruction = p.personal_instruction;
    else if (p.personal_instruction === null && ps._v) out.personalInstruction = "";
    if (p.accent && ACCENTS.includes(p.accent)) out.accent = p.accent;
    return out;
  }

  /* ---------- хуки из script.js ---------- */
  async function onSignedIn(u) {
    user = u;
    const C = Cloud();
    if (!C || !C.getProfile) return;
    let p = await C.getProfile();
    const app = App();
    const local = app ? app.state.settings : {};

    if (!p.settings || !p.settings._v) {
      // первый вход с WawID: переносим локальные настройки в профиль,
      // имя из Google берём, если локально стоит «Ты»
      const patch = settingsToPatch(local);
      if (!patch.display_name && p.display_name) patch.display_name = p.display_name;
      if (!patch.personal_instruction && p.personal_instruction) patch.personal_instruction = p.personal_instruction;
      try { p = await C.updateProfile(patch); } catch (e) { console.warn("WAW: WawID first sync failed", e); }
    }
    profile = p;
    applying = true;
    try { if (app) app.applySettings(profileToSettings(p)); }
    finally { applying = false; }
    renderCard();
  }

  function onSignedOut() {
    clearTimeout(pushTimer);
    pushTimer = 0;
    user = null;
    profile = null;
    renderCard();
  }

  function onSettingsChanged(s) {
    if (applying || !user || !profile) return;
    clearTimeout(pushTimer);
    const snapshot = settingsToPatch(s);
    pushTimer = setTimeout(async () => {
      pushTimer = 0;
      try {
        profile = await Cloud().updateProfile(snapshot);
        renderCard(true);
      } catch (e) {
        console.warn("WAW: WawID sync failed", e);
        if (!pushWarned && App()) { pushWarned = true; App().toast("не удалось сохранить настройки в WawID", true); }
      }
    }, 800);
  }

  /* ---------- карточка в настройках ---------- */
  const avatarEl = $("wawidAvatar");
  const nameEl = $("wawidName");
  const handleLabel = $("wawidHandleLabel");
  const handleInput = $("wawidHandleInput");
  const handleSave = $("wawidHandleSave");
  const handleStatus = $("wawidHandleStatus");
  const bioInput = $("wawidBioInput");
  const bioCount = $("wawidBioCount");
  const syncNote = $("wawidSyncNote");
  const badge = $("wawidBadge");

  function setStatus(text, kind) {
    if (!handleStatus) return;
    handleStatus.textContent = text || "";
    handleStatus.dataset.kind = text ? kind || "info" : "";
  }

  function renderAvatar() {
    if (!avatarEl) return;
    const app = App();
    const dn = (app && app.state.settings.displayName) || "Ты";
    const initial = dn.trim().charAt(0).toUpperCase() || "Т";
    const url = profile && profile.avatar_url;
    const cur = avatarEl.querySelector("img");
    if (url) {
      if (cur && cur.getAttribute("src") === url) return;
      avatarEl.textContent = "";
      const img = document.createElement("img");
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.decoding = "async";
      img.src = url;
      img.onerror = () => { avatarEl.textContent = initial; };
      avatarEl.appendChild(img);
    } else {
      avatarEl.textContent = initial;
    }
  }

  // keepInputs: не трогать поля, которые пользователь сейчас редактирует
  function renderCard(keepInputs) {
    const app = App();
    const dn = (app && app.state.settings.displayName) || "Ты";
    if (nameEl) nameEl.textContent = dn;
    renderAvatar();
    const signedIn = !!(user && profile);
    if (handleLabel) handleLabel.textContent = signedIn && profile.handle ? "@" + profile.handle : signedIn ? "@ ещё не выбран" : "не выполнен вход";
    if (badge) badge.dataset.on = signedIn ? "1" : "";
    if (handleInput) handleInput.disabled = !signedIn;
    if (bioInput) bioInput.disabled = !signedIn;
    if (syncNote) {
      syncNote.textContent = signedIn
        ? "Имя, акцент, инструкция и настройки синхронизируются через WawID на всех устройствах."
        : "Настройки хранятся на этом устройстве. Войди, чтобы синхронизировать их через WawID.";
    }
    if (!keepInputs || document.activeElement !== handleInput) {
      if (handleInput) handleInput.value = signedIn && profile.handle ? profile.handle : "";
      if (handleSave) handleSave.disabled = true;
      setStatus("");
    }
    if (!keepInputs || document.activeElement !== bioInput) {
      if (bioInput) bioInput.value = signedIn && profile.bio ? profile.bio : "";
      if (bioCount) bioCount.textContent = String(bioInput ? bioInput.value.length : 0);
    }
    if (app && app.applyProfileToUI) app.applyProfileToUI();
  }

  /* --- @handle: живая проверка --- */
  let checkTimer = 0;
  let checkSeq = 0;
  let lastOk = "";

  function normalizeHandle(v) {
    return String(v || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
  }

  if (handleInput) {
    handleInput.addEventListener("input", () => {
      const norm = normalizeHandle(handleInput.value);
      if (norm !== handleInput.value) {
        const pos = Math.min(handleInput.selectionStart || norm.length, norm.length);
        handleInput.value = norm;
        try { handleInput.setSelectionRange(pos, pos); } catch (e) {}
      }
      lastOk = "";
      handleSave.disabled = true;
      clearTimeout(checkTimer);
      const seq = ++checkSeq;
      if (!norm) return setStatus("");
      if (profile && norm === profile.handle) return setStatus("это твой текущий WawID", "ok");
      if (!HANDLE_RE.test(norm)) return setStatus("3–20 символов: a–z, 0–9 и «_»", "error");
      setStatus("проверяю…", "info");
      checkTimer = setTimeout(async () => {
        try {
          const free = await Cloud().wawidAvailable(norm);
          if (seq !== checkSeq) return;
          if (free) {
            lastOk = norm;
            handleSave.disabled = false;
            setStatus("@" + norm + " свободен", "ok");
          } else {
            setStatus("@" + norm + " уже занят", "error");
          }
        } catch (e) {
          if (seq !== checkSeq) return;
          setStatus("не удалось проверить — нет связи?", "error");
        }
      }, 350);
    });

    handleInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); if (!handleSave.disabled) handleSave.click(); }
    });
  }

  if (handleSave) {
    handleSave.addEventListener("click", async () => {
      const h = lastOk;
      if (!h || !profile) return;
      handleSave.disabled = true;
      setStatus("сохраняю…", "info");
      try {
        profile = await Cloud().updateProfile({ handle: h });
        lastOk = "";
        renderCard();
        setStatus("готово: теперь ты @" + profile.handle, "ok");
        if (App()) App().toast("WawID обновлён: @" + profile.handle, true);
      } catch (e) {
        const taken = e && (e.code === "23505" || /duplicate|unique/i.test(e.message || ""));
        setStatus(taken ? "@" + h + " только что заняли — попробуй другой" : "не удалось сохранить", "error");
      }
    });
  }

  /* --- «О себе» --- */
  let bioTimer = 0;
  if (bioInput) {
    bioInput.addEventListener("input", () => {
      const v = bioInput.value.slice(0, 300);
      bioCount.textContent = String(v.length);
      if (!profile) return;
      clearTimeout(bioTimer);
      bioTimer = setTimeout(async () => {
        try { profile = await Cloud().updateProfile({ bio: v.trim() || null }); }
        catch (e) { console.warn("WAW: bio save failed", e); }
      }, 700);
    });
  }

  // имя в карточке обновляется вместе с полем «Как к тебе обращаться»
  const dnInput = $("displayNameInput");
  if (dnInput) dnInput.addEventListener("input", () => { if (nameEl) nameEl.textContent = dnInput.value.trim() || "Ты"; renderAvatar(); });

  window.WAWID = {
    onSignedIn,
    onSignedOut,
    onSettingsChanged,
    onSettingsOpen: () => renderCard(),
    profile: () => profile,
  };
})();
