const DEFAULT_INSTANCE = "https://pursuit.bobilabs.dev";
const $ = (id) => document.getElementById(id);

// `cookies` is an optional permission: it only means anything in self-hosted
// mode, where reading the session cookie is how we notice you are signed in.
// Never assume it is there — a free-app user is never asked for it.
async function hasCookiePermission() {
  try {
    return await chrome.permissions.contains({ permissions: ["cookies"] });
  } catch {
    return false;
  }
}

function showCookieNote(text) {
  const note = $("cookieNote");
  note.textContent = text || "";
  note.hidden = !text;
}

function applyMode(mode) {
  // The server-only fields are meaningless against the free app, which has
  // neither accounts nor an API. Hiding them prevents the "I set a token and
  // it still says sign in" confusion.
  const local = mode === "local";
  $("serverAuth").style.display = local ? "none" : "";
  $("modeHelp").textContent = local
    ? "The free app. No account, no sign-in, no API key — it has none of those, and this is the right choice for almost everyone. Captures open its add form pre-filled."
    : "For people running their own deployment. Captures POST to your instance and are scored server-side. Sign in from the side panel, or paste an ingest token below.";
  if (local) showCookieNote("");
}

(async () => {
  const s = await chrome.storage.sync.get(["instanceUrl", "token", "appMode"]);
  // The free app is the default product, so anything that is not an explicit
  // "server" — including a never-configured install — resolves to local.
  const mode = s.appMode === "server" ? "server" : "local";
  $("instanceUrl").value = s.instanceUrl || DEFAULT_INSTANCE;
  $("token").value = s.token || "";
  $(mode === "local" ? "modeLocal" : "modeServer").checked = true;
  applyMode(mode);
  // Reloading the page is not a user gesture, so we only report the state here
  // — we never prompt from it.
  if (mode === "server" && !(await hasCookiePermission())) {
    showCookieNote(
      "Cookie access is not granted, so sign-in detection is off. Re-pick Self-hosted to be asked again, or use an ingest token."
    );
  }
})();

for (const id of ["modeServer", "modeLocal"]) {
  $(id).addEventListener("change", () => applyMode($("modeLocal").checked ? "local" : "server"));
}

// Picking self-hosted is the one moment the `cookies` permission is worth
// asking for, and a click is the user gesture Chrome requires to grant it.
// Declining is not fatal: the mode still saves, you just lose sign-in
// detection and fall back to an ingest token.
$("modeServer").addEventListener("click", async () => {
  if (!$("modeServer").checked) return;
  if (await hasCookiePermission()) {
    showCookieNote("");
    return;
  }
  let granted = false;
  try {
    granted = await chrome.permissions.request({ permissions: ["cookies"] });
  } catch {
    granted = false;
  }
  showCookieNote(
    granted
      ? ""
      : "Cookie access declined — sign-in detection will not work. Capture still saves; paste an ingest token below to authenticate."
  );
});

$("save").addEventListener("click", async () => {
  const appMode = $("modeLocal").checked ? "local" : "server";
  const instanceUrl = ($("instanceUrl").value || DEFAULT_INSTANCE)
    .trim()
    .replace(/\/+$/, "");
  const token = $("token").value.trim();
  await chrome.storage.sync.set({ instanceUrl, token, appMode });
  const st = $("status");
  st.textContent =
    appMode === "local"
      ? "Saved ✓ (free app)"
      : token
        ? "Saved ✓ (using token)"
        : "Saved ✓ (using Sign in)";
  setTimeout(() => (st.textContent = ""), 2500);
});
