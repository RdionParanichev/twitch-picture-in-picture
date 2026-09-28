"use strict";

const defaultTitle = "Twitch: картинка в картинке (Alt+Shift+P)";

async function report(tabId, error) {
  await chrome.action.setBadgeText({ tabId, text: error ? "!" : "" });
  await chrome.action.setTitle({ tabId, title: error || defaultTitle });
  if (error) await chrome.action.setBadgeBackgroundColor({ tabId, color: "#9146ff" });
}

async function handleAction(tab) {
  if (!tab.id) return;
  try {
    const url = new URL(tab.url || "about:blank");
    if (url.protocol !== "https:" || !["www.twitch.tv", "player.twitch.tv"].includes(url.hostname)) {
      await report(tab.id, "Откройте стрим или VOD на twitch.tv, затем нажмите значок ещё раз.");
      return;
    }
    // activeTab permits this injection, including tabs opened before installation.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["app.js"] });
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => globalThis.__twitchPip.toggle()
    });
    await report(tab.id, result?.result?.ok ? null : result?.result?.error || "Не удалось найти плеер Twitch.");
  } catch (error) {
    // The tab may close between the click and script completion.
    await report(tab.id, "Не удалось открыть PiP. Обновите Twitch и попробуйте ещё раз.").catch(() => {});
    console.warn("Twitch PiP:", error.message);
  }
}

chrome.action.onClicked.addListener(handleAction);
