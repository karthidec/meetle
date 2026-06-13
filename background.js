// Meetle Chrome Extension — background service worker
//
// Opens the hosted Meetle web app (GitHub Pages) in a new tab.
// Hosting on GitHub Pages lets Google Maps JS API load without MV3 CSP restrictions.
//
// ⚠️  BEFORE PUBLISHING: replace the URL below with your actual GitHub Pages URL.
//     Format: https://YOUR_USERNAME.github.io/YOUR_REPO_NAME/

const MEETLE_URL = 'https://YOUR_GITHUB_USERNAME.github.io/google-maps/';

chrome.action.onClicked.addListener(async () => {
  // If Meetle is already open, switch to that tab instead of opening a duplicate
  const existing = await chrome.tabs.query({ url: MEETLE_URL + '*' });
  if (existing.length > 0) {
    chrome.tabs.update(existing[0].id, { active: true });
    chrome.windows.update(existing[0].windowId, { focused: true });
  } else {
    chrome.tabs.create({ url: MEETLE_URL });
  }
});
