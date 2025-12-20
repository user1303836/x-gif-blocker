const BLOCKED_HASHES_KEY = 'blockedHashes';
const MUTE_ON_BLOCK_KEY = 'muteOnBlock';
const BLOCKED_USERS_KEY = 'blockedUsers';

// Inject styles
const style = document.createElement('style');
style.textContent = `
  .gif-blocker-item:hover {
    background-color: rgba(15, 20, 25, 0.1) !important;
  }
  [data-theme="dark"] .gif-blocker-item:hover {
    background-color: rgba(255, 255, 255, 0.1) !important;
  }
`;
document.head.appendChild(style);

let blockedHashes = [];
let muteOnBlock = false;
let blockedUsers = [];
const blockStatusCache = new Map(); // hash -> isBlocked (boolean)

// IntersectionObserver for lazy loading
const tweetObserver = new IntersectionObserver((entries, observer) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const tweet = entry.target;
      processVisibleTweet(tweet);
      // Stop observing once processed, unless we want to re-check dynamic content
      // For static thumbnails, processing once is usually enough.
      observer.unobserve(tweet);
    }
  });
}, {
  rootMargin: '200px' // Start processing 200px before it enters viewport
});

// Load settings
chrome.storage.local.get([BLOCKED_HASHES_KEY, MUTE_ON_BLOCK_KEY, BLOCKED_USERS_KEY], (result) => {
  blockedHashes = result[BLOCKED_HASHES_KEY] || [];
  muteOnBlock = result[MUTE_ON_BLOCK_KEY] || false;
  blockedUsers = result[BLOCKED_USERS_KEY] || [];
  blockStatusCache.clear();
  
  // Initial scan
  scanForTweets();
});

// Update settings when they change
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    let changed = false;
    if (changes[BLOCKED_HASHES_KEY]) {
      blockedHashes = changes[BLOCKED_HASHES_KEY].newValue || [];
      blockStatusCache.clear();
      changed = true;
    }
    if (changes[MUTE_ON_BLOCK_KEY]) {
      muteOnBlock = changes[MUTE_ON_BLOCK_KEY].newValue || false;
      changed = true;
    }
    if (changes[BLOCKED_USERS_KEY]) {
      blockedUsers = changes[BLOCKED_USERS_KEY].newValue || [];
      changed = true;
    }
    
    if (changed) {
      // Re-scan and re-process everything visible
      document.querySelectorAll('article[data-testid="tweet"]').forEach(tweet => {
        tweet.dataset.gifBlockerProcessed = 'false'; // Force re-process
        tweetObserver.observe(tweet);
      });
    }
  }
});

const ONE_BITS = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

function getHammingDistance(h1, h2) {
  if (h1.length !== h2.length) return Infinity;
  let distance = 0;
  for (let i = 0; i < h1.length; i++) {
    const n1 = parseInt(h1[i], 16);
    const n2 = parseInt(h2[i], 16);
    distance += ONE_BITS[n1 ^ n2];
  }
  return distance;
}

function isHashBlocked(hash) {
  if (blockStatusCache.has(hash)) {
    return blockStatusCache.get(hash);
  }

  // Threshold of 10-15 is usually good for 256-bit hash
  const isBlocked = blockedHashes.some(item => {
    // Handle migration: item can be string or object
    const storedHash = (typeof item === 'string') ? item : item.hash;
    return getHammingDistance(hash, storedHash) < 12;
  });
  // Cap cache size
  if (blockStatusCache.size > 1000) {
    blockStatusCache.clear();
  }
  blockStatusCache.set(hash, isBlocked);
  return isBlocked;
}

function getTweetPosterUrl(tweetElement) {
  // 1. Try video poster directly
  const video = tweetElement.querySelector('video');
  if (video && video.poster) return video.poster;

  // 2. Try looking inside the video player container
  const player = tweetElement.querySelector('[data-testid="videoPlayer"]');
  if (player) {
    // Look for images that look like thumbnails (X usually serves them from pbs.twimg.com/media or video_thumb)
    const imgs = Array.from(player.querySelectorAll('img'));
    
    // Prioritize images that look like video thumbnails
    const thumb = imgs.find(img => img.src.includes('video_thumb') || img.src.includes('/media/'));
    if (thumb) return thumb.src;
    
    // Fallback to the largest image in the player
    if (imgs.length > 0) {
       // Sort by area (approximation)
       imgs.sort((a, b) => (b.width * b.height) - (a.width * a.height));
       return imgs[0].src;
    }
  }

  return null;
}

function processVisibleTweet(tweetElement) {
  if (tweetElement.dataset.gifBlockerProcessed === 'true') return;
  
  // Check if user is muted
  const userLink = tweetElement.querySelector('a[href^="/"][role="link"]');
  if (userLink) {
    const username = userLink.getAttribute('href').substring(1);
    if (blockedUsers.includes(username)) {
      console.log('[X GIF Blocker] Hiding tweet from muted user:', username);
      tweetElement.style.display = 'none';
      return;
    }
  }

  const posterUrl = getTweetPosterUrl(tweetElement);
  if (posterUrl) {
    chrome.runtime.sendMessage({ type: 'GET_HASH', url: posterUrl }, (response) => {
      if (response && response.hash) {
        if (isHashBlocked(response.hash)) {
          console.log('[X GIF Blocker] Hiding tweet (hash match)');
          tweetElement.style.display = 'none';
        }
      }
    });
  }
  
  tweetElement.dataset.gifBlockerProcessed = 'true';
}

function scanForTweets() {
  document.querySelectorAll('article[data-testid="tweet"]').forEach(tweet => {
    if (tweet.dataset.gifBlockerObserved !== 'true') {
      tweet.dataset.gifBlockerObserved = 'true';
      tweetObserver.observe(tweet);
    }
  });
}

// Optimized MutationObserver
let mutationTimeout;
const observer = new MutationObserver((mutations) => {
  // Simple debounce to avoid thrashing on massive DOM updates
  if (mutationTimeout) return;
  
  mutationTimeout = setTimeout(() => {
    mutationTimeout = null;
    scanForTweets();
  }, 100);
});

observer.observe(document.body, { childList: true, subtree: true });

// Also handle the dropdown menu for blocking
let lastClickedTweet = null;

document.addEventListener('click', (e) => {
  const menuButton = e.target.closest('[data-testid="caret"]');
  if (menuButton) {
    console.log('[X GIF Blocker] Caret clicked');
    lastClickedTweet = menuButton.closest('article[data-testid="tweet"]');
    if (lastClickedTweet) {
      console.log('[X GIF Blocker] Tweet context captured');
      // Retry finding the menu a few times in case of rendering lag
      setTimeout(() => injectBlockButton(), 50);
      setTimeout(() => injectBlockButton(), 150);
      setTimeout(() => injectBlockButton(), 300);
    } else {
      console.log('[X GIF Blocker] Could not find parent tweet');
    }
  }
}, true); // Use capture phase to ensure we get it first

function injectBlockButton() {
  const menu = document.querySelector('[data-testid="Dropdown"], [data-testid="dropdown"]');
  
  if (!menu) {
    // console.log('[X GIF Blocker] Menu not found yet');
    return;
  }

  if (menu.querySelector('.gif-blocker-item')) {
    return; // Already injected
  }

  if (!lastClickedTweet) {
    console.log('[X GIF Blocker] No tweet context available');
    return;
  }

  // Check for video/gif in the captured tweet context
  // Use the same logic we use for blocking to ensure consistency
  const posterUrl = getTweetPosterUrl(lastClickedTweet);

  if (!posterUrl) {
    console.log('[X GIF Blocker] Tweet has no blockable content (GIF/Video), skipping injection');
    return;
  }

  console.log('[X GIF Blocker] Injecting menu item');

  const blockItem = document.createElement('div');
  blockItem.className = 'gif-blocker-item';
  blockItem.role = 'menuitem';
  blockItem.tabIndex = 0;
  blockItem.style.padding = '12px';
  blockItem.style.cursor = 'pointer';
  blockItem.style.display = 'flex';
  blockItem.style.alignItems = 'center';
  blockItem.style.transition = 'background-color 0.2s';
  blockItem.innerHTML = `
    <div style="margin-right: 12px; font-size: 18px; width: 20px; text-align: center;">🚫</div>
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 700;">Block this GIF</div>
  `;
  
  blockItem.addEventListener('mouseover', () => {
    blockItem.style.backgroundColor = 'rgba(15, 20, 25, 0.1)';
  });
  blockItem.addEventListener('mouseout', () => {
    blockItem.style.backgroundColor = 'transparent';
  });
  
  blockItem.addEventListener('click', (e) => {
    // Prevent default to avoid navigation if something bubbles
    e.preventDefault();
    e.stopPropagation();
    
    console.log('[X GIF Blocker] Block button clicked');
    if (lastClickedTweet) {
      blockGifInTweet(lastClickedTweet);
    }
    
    // 1. Try to find the active caret and click it again to toggle the menu closed
    const activeCaret = Array.from(document.querySelectorAll('[data-testid="caret"]')).find(el => el.getAttribute('aria-expanded') === 'true');
    if (activeCaret) {
      activeCaret.click();
    }

    // 2. Simulate Escape key
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true
    }));

    // 3. Click the backdrop/mask if it exists
    setTimeout(() => {
      const mask = document.querySelector('[data-testid="mask"]');
      if (mask) {
        mask.click();
      } else {
        // Final fallback: click far away from the menu
        document.body.click();
      }
    }, 10);
  });
  
  // Insert as the first item or append
  if (menu.firstChild) {
    menu.insertBefore(blockItem, menu.firstChild);
  } else {
    menu.appendChild(blockItem);
  }
}

function blockGifInTweet(tweetElement) {
  const posterUrl = getTweetPosterUrl(tweetElement);
  
  if (!posterUrl) {
    alert('Error: Could not find the GIF thumbnail URL. Cannot block.');
    console.error('[X GIF Blocker] Could not find poster URL in tweet:', tweetElement);
    return;
  }

  console.log('[X GIF Blocker] Attempting to block GIF with poster:', posterUrl);
  
  chrome.runtime.sendMessage({ type: 'GET_HASH', url: posterUrl }, (response) => {
    // Check for runtime errors
    if (chrome.runtime.lastError) {
      alert('Extension Error: ' + chrome.runtime.lastError.message);
      return;
    }

    if (response && response.hash) {
      const hash = response.hash;
      console.log('[X GIF Blocker] Generated hash to block:', hash);
      
              // Save hash
              chrome.storage.local.get([BLOCKED_HASHES_KEY], (result) => {
                const hashes = result[BLOCKED_HASHES_KEY] || [];
                // Check for existence (handle legacy strings and new objects)
                const exists = hashes.some(item => {
                  const storedHash = (typeof item === 'string') ? item : item.hash;
                  return storedHash === hash;
                });
      
                if (!exists) {
                  hashes.push({
                    hash: hash,
                    url: posterUrl,
                    timestamp: Date.now()
                  });
                  chrome.storage.local.set({ [BLOCKED_HASHES_KEY]: hashes }, () => {
                     console.log('[X GIF Blocker] Hash saved to blocklist');
                     // Clear cache to ensure immediate blocking update
                     blockStatusCache.clear();
                  });
                }
              });
            // Optionally mute user
      if (muteOnBlock) {
        const userLink = tweetElement.querySelector('a[href^="/"][role="link"]');
        if (userLink) {
          const username = userLink.getAttribute('href').substring(1);
          if (username) {
            chrome.storage.local.get([BLOCKED_USERS_KEY], (result) => {
              const users = result[BLOCKED_USERS_KEY] || [];
              if (!users.includes(username)) {
                users.push(username);
                chrome.storage.local.set({ [BLOCKED_USERS_KEY]: users });
              }
            });
          }
        }
      }
      
              // Hide tweet immediately
      
              tweetElement.style.display = 'none';
      
              console.log('[X GIF Blocker] GIF Blocked and hidden');
      
            } else {
      
      
      const errorMsg = response && response.error ? response.error : 'Unknown error';
      console.error('[X GIF Blocker] Failed to generate hash:', errorMsg);
      alert('Failed to block GIF. Error generating hash: ' + errorMsg);
    }
  });
}
