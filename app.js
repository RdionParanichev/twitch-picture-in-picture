(() => {
  "use strict";

  // Also injected on toolbar clicks, so an already-open Twitch tab works immediately.
  if (globalThis.__twitchPip) return;

  const host = document.createElement("twitch-pip-control");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; position: fixed; z-index: 2147483647; display: none;
        color-scheme: dark; font-family: Arial, sans-serif; }
      button { box-sizing: border-box; display: flex; align-items: center; gap: 6px;
        height: 34px; padding: 0 10px; border: 1px solid #ffffff45; border-radius: 7px;
        background: #18181be6; color: #fff; font: 600 12px/1 Arial, sans-serif;
        cursor: pointer; box-shadow: 0 2px 8px #0005; }
      button:hover { background: #772ce8; border-color: #bf94ff; }
      button:focus-visible { outline: 3px solid #bf94ff; outline-offset: 3px; }
      button[aria-pressed="true"] { background: #772ce8; }
      button:disabled { cursor: wait; opacity: .65; }
      svg { width: 20px; height: 20px; fill: currentColor; flex: none; }
      .status { position: absolute; right: 0; top: 42px; width: max-content;
        max-width: min(300px, 75vw); box-sizing: border-box; padding: 10px 12px;
        border-radius: 7px; background: #18181bf5; color: #fff;
        font: 13px/1.45 Arial, sans-serif; box-shadow: 0 2px 12px #0006; }
      .status:empty { display: none; }
    </style>
    <button type="button" aria-label="Картинка в картинке" aria-pressed="false"
      title="Картинка в картинке (Alt+Shift+P)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 11h-8v6h8v-6Zm2-8H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm0 16H3V5h18v14Z"/></svg>
      <span>PiP</span>
    </button>
    <div class="status" role="status" aria-live="polite"></div>`;

  const button = shadow.querySelector("button");
  const status = shadow.querySelector(".status");
  let currentVideo = null;
  let pending = false;
  let scheduled = null;
  let statusTimer;

  function visibleArea(video) {
    const rect = video.getBoundingClientRect();
    const style = getComputedStyle(video);
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return 0;
    const width = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
    return width >= 120 && height >= 68 ? width * height : 0;
  }

  function findVideo() {
    return [...document.querySelectorAll("video")]
      .map(video => ({ video, area: visibleArea(video) }))
      .filter(item => item.area > 0)
      .sort((a, b) => b.area - a.area)[0]?.video || null;
  }

  const resizeObserver = new ResizeObserver(() => schedule());

  function refresh() {
    const video = findVideo();
    if (video !== currentVideo) {
      resizeObserver.disconnect();
      currentVideo = video;
      if (video) resizeObserver.observe(video);
    }

    const parent = document.fullscreenElement || document.body;
    // Native fullscreen on a <video> cannot contain HTML controls.
    if (!video || !parent || parent instanceof HTMLVideoElement) {
      host.style.display = "none";
      return;
    }
    if (host.parentNode !== parent) parent.append(host);
    const rect = video.getBoundingClientRect();
    host.style.display = "block";
    host.style.top = `${Math.max(8, rect.top + 12)}px`;
    host.style.left = `${Math.max(8, Math.min(innerWidth - 92, rect.right - 92))}px`;
    const active = Boolean(document.pictureInPictureElement);
    button.setAttribute("aria-pressed", String(active));
    const label = active ? "Вернуть видео во вкладку" : "Картинка в картинке";
    button.setAttribute("aria-label", label);
    button.title = `${label} (Alt+Shift+P)`;
    button.disabled = pending;
  }

  function schedule() {
    if (scheduled !== null) return;
    scheduled = setTimeout(() => {
      scheduled = null;
      refresh();
    }, 100);
  }

  function showError(message) {
    status.textContent = message;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { status.textContent = ""; }, 6000);
  }

  function errorMessage(error) {
    if (error.name === "NotAllowedError") return "Нажмите кнопку PiP ещё раз, чтобы разрешить открытие окна.";
    if (error.name === "InvalidStateError") return "Дождитесь загрузки видео и нажмите PiP ещё раз.";
    if (error.name === "SecurityError" || error.name === "NotSupportedError") return "Картинка в картинке недоступна для этого видео или отключена в браузере.";
    return error.message || "Не удалось открыть PiP. Обновите страницу и попробуйте ещё раз.";
  }

  async function toggle() {
    if (pending) return { ok: false, error: "Дождитесь открытия окна PiP." };
    pending = true;
    button.disabled = true;
    status.textContent = "";
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        return { ok: true, active: false };
      }
      const video = findVideo();
      if (!video) throw new Error("Откройте стрим или VOD Twitch и запустите видео.");
      if (!document.pictureInPictureEnabled || !video.requestPictureInPicture) {
        throw new Error("Картинка в картинке отключена или не поддерживается этим браузером.");
      }
      if (video.readyState === 0 || video.videoWidth === 0) {
        throw new Error("Дождитесь загрузки видео и нажмите PiP ещё раз.");
      }
      // Twitch may opt out of PiP. Override only for this explicit user request.
      const wasDisabled = video.disablePictureInPicture;
      video.disablePictureInPicture = false;
      try {
        // Keep the request in the original user gesture; do not await play() first.
        await video.requestPictureInPicture();
        // Restoring the flag while PiP is open makes Chromium immediately close it.
        if (wasDisabled) video.addEventListener("leavepictureinpicture", () => {
          video.disablePictureInPicture = true;
        }, { once: true });
      } catch (error) {
        if (wasDisabled) video.disablePictureInPicture = true;
        throw error;
      }
      return { ok: true, active: true };
    } catch (error) {
      const message = errorMessage(error);
      showError(message);
      return { ok: false, error: message };
    } finally {
      pending = false;
      refresh();
    }
  }

  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    void toggle();
  });
  // Stop player shortcuts from also reacting to keyboard activation of this button.
  button.addEventListener("keydown", event => event.stopPropagation());
  button.addEventListener("keyup", event => event.stopPropagation());

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  for (const event of ["loadedmetadata", "emptied", "play", "enterpictureinpicture", "leavepictureinpicture", "fullscreenchange"]) {
    document.addEventListener(event, schedule, true);
  }
  addEventListener("resize", schedule);
  addEventListener("scroll", schedule, true);
  globalThis.__twitchPip = Object.freeze({ toggle });
  refresh();
})();
