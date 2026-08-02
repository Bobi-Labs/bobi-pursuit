// Background script. Sole job: get the capture panel open when the toolbar
// icon is clicked. All real work lives in the panel.
//
// This file runs in BOTH browsers, from two different manifests, because the
// panel APIs are not the same:
//
//   Chrome   MV3 service worker + `side_panel`     -> chrome.sidePanel
//   Firefox  MV3 event page     + `sidebar_action` -> chrome.sidebarAction
//
// Every call below is feature-detected rather than branched on a user-agent
// string: the browser lacking an API simply skips its arm. Listeners are
// registered synchronously at the top level, which Firefox's non-persistent
// event page requires — registering one inside an async callback means it is
// missing after the page unloads and revives.

// Chrome: make a toolbar click open the side panel directly. With this set,
// Chrome does NOT fire action.onClicked, so the Firefox arm stays dormant there.
if (chrome.sidePanel?.setPanelBehavior) {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((e) => console.warn("[bobi-pursuit] sidePanel behavior:", e));
  });
}

// Firefox: no equivalent behaviour flag, so the click has to open the sidebar
// explicitly. sidebarAction.open() requires a user gesture, and this listener
// is one, which is why it cannot move somewhere more convenient.
chrome.action?.onClicked?.addListener(() => {
  chrome.sidebarAction?.open?.();
});
