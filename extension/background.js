let creatingOffscreen;
const URL_HASH_CACHE_KEY = 'urlHashCache';
let urlHashCache = {};

// Load persistent cache from storage
chrome.storage.local.get([URL_HASH_CACHE_KEY], (result) => {
  urlHashCache = result[URL_HASH_CACHE_KEY] || {};
});

async function setupOffscreenDocument(path) {
  // Check all windows controlled by the service worker to see if one 
  // of them is the offscreen document with the given path
  const offscreenUrl = chrome.runtime.getURL(path);
  
  try {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl]
    });

    if (existingContexts.length > 0) {
      return;
    }

    // create offscreen document
    if (creatingOffscreen) {
      await creatingOffscreen;
    } else {
      creatingOffscreen = chrome.offscreen.createDocument({
        url: path,
        reasons: ['BLOBS'],
        justification: 'To generate perceptual hashes of images using Canvas API.',
      });
      await creatingOffscreen;
      creatingOffscreen = null;
    }
  } catch (error) {
    creatingOffscreen = null;
    console.error('[Background] Failed to create offscreen document:', error);
    throw error;
  }
}

async function closeOffscreenDocument() {
  if (creatingOffscreen) {
    await creatingOffscreen;
  }
  
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });

  if (existingContexts.length > 0) {
    chrome.offscreen.closeDocument();
  }
}

let offscreenIdleTimeout;
function resetOffscreenIdleTimer() {
  clearTimeout(offscreenIdleTimeout);
  offscreenIdleTimeout = setTimeout(() => {
    closeOffscreenDocument();
  }, 30000); // Close after 30 seconds of inactivity
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_HASH') {
    console.log('[Background] Received GET_HASH request for:', message.url);
    resetOffscreenIdleTimer();
    
    if (urlHashCache[message.url]) {
      console.log('[Background] Returning cached hash');
      sendResponse({ hash: urlHashCache[message.url] });
    } else {
      console.log('[Background] Cache miss. Delegating to offscreen...');
      handleGetHash(message.url).then(response => {
        console.log('[Background] Offscreen returned:', response);
        if (response && response.hash) {
          urlHashCache[message.url] = response.hash;
          // Periodically save cache to storage
          saveCacheToStorage();
        }
        sendResponse(response);
      }).catch(err => {
        console.error('[Background] Error in handleGetHash:', err);
        sendResponse({ error: err.message });
      });
    }
    return true; // Keep message channel open for async response
  }
});

let saveTimeout;
function saveCacheToStorage() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    // Limit cache size to avoid exceeding storage limits
    const entries = Object.entries(urlHashCache);
    if (entries.length > 5000) {
      const trimmedCache = Object.fromEntries(entries.slice(-5000));
      urlHashCache = trimmedCache;
    }
    chrome.storage.local.set({ [URL_HASH_CACHE_KEY]: urlHashCache });
  }, 1000);
}

async function handleGetHash(url) {
  await setupOffscreenDocument('offscreen.html');
  
  // Give the offscreen document a moment to initialize its message listeners
  // This prevents race conditions where the document is created but JS hasn't run.
  await new Promise(resolve => setTimeout(resolve, 100));
  
  return new Promise((resolve, reject) => {
    console.log('[Background] Sending COMPUTE_HASH to offscreen...');
    
    // Add a timeout to prevent hanging forever
    const timeoutId = setTimeout(() => {
      resolve({ error: 'Offscreen hash computation timed out' });
    }, 10000);

    chrome.runtime.sendMessage({
      type: 'COMPUTE_HASH',
      url: url,
      target: 'offscreen'
    }, (response) => {
      clearTimeout(timeoutId);
      if (chrome.runtime.lastError) {
        console.error('[Background] Message error:', chrome.runtime.lastError);
        resolve({ error: chrome.runtime.lastError.message });
      } else {
        console.log('[Background] Received response from offscreen:', response);
        resolve(response || { error: 'Empty response from offscreen' });
      }
    });
  });
}
