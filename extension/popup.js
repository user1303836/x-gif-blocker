const BLOCKED_HASHES_KEY = 'blockedHashes';
const MUTE_ON_BLOCK_KEY = 'muteOnBlock';
const BLOCKED_USERS_KEY = 'blockedUsers';

document.addEventListener('DOMContentLoaded', () => {
  const muteOnBlockCheckbox = document.getElementById('muteOnBlock');
  const exportButton = document.getElementById('exportHashes');
  const importButton = document.getElementById('importHashes');
  const importFile = document.getElementById('importFile');
  const clearButton = document.getElementById('clearHashes');
  const gifCountSpan = document.getElementById('gifCount');
  const userCountSpan = document.getElementById('userCount');
  
  const toggleListButton = document.getElementById('toggleBlockList');
  const blockListContainer = document.getElementById('blockList');

  function updateStats() {
    chrome.storage.local.get([BLOCKED_HASHES_KEY, BLOCKED_USERS_KEY], (result) => {
      gifCountSpan.textContent = (result[BLOCKED_HASHES_KEY] || []).length;
      userCountSpan.textContent = (result[BLOCKED_USERS_KEY] || []).length;
    });
  }

  // Load current settings
  chrome.storage.local.get([BLOCKED_HASHES_KEY, MUTE_ON_BLOCK_KEY, BLOCKED_USERS_KEY], (result) => {
    muteOnBlockCheckbox.checked = result[MUTE_ON_BLOCK_KEY] || false;
    updateStats();
  });

  // Save settings when changed
  muteOnBlockCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ [MUTE_ON_BLOCK_KEY]: muteOnBlockCheckbox.checked });
  });

  // Toggle Block List
  toggleListButton.addEventListener('click', () => {
    if (blockListContainer.classList.contains('hidden')) {
      blockListContainer.classList.remove('hidden');
      toggleListButton.textContent = 'Hide Block List';
      renderBlockList();
    } else {
      blockListContainer.classList.add('hidden');
      toggleListButton.textContent = 'View Block List';
    }
  });

  function renderBlockList() {
    chrome.storage.local.get([BLOCKED_HASHES_KEY], (result) => {
      const hashes = result[BLOCKED_HASHES_KEY] || [];
      blockListContainer.innerHTML = '';

      if (hashes.length === 0) {
        blockListContainer.innerHTML = '<div style="text-align:center; color:#999; padding:10px;">No blocked GIFs</div>';
        return;
      }

      // Reverse to show newest first
      const reversedHashes = [...hashes].reverse();

      reversedHashes.forEach((item, index) => {
        // Handle migration: item can be string or object
        const isString = typeof item === 'string';
        const hash = isString ? item : item.hash;
        const url = isString ? null : item.url;
        const date = (isString || !item.timestamp) ? 'Unknown Date' : new Date(item.timestamp).toLocaleDateString();

        const el = document.createElement('div');
        el.className = 'block-item';
        el.innerHTML = `
          ${url ? `<img src="${url}" alt="Blocked GIF">` : '<div style="width:60px;height:60px;background:#eee;display:flex;align-items:center;justify-content:center;font-size:10px;color:#999;">No Image</div>'}
          <div class="block-info">
            <div class="block-hash" title="${hash}">${hash.substring(0, 16)}...</div>
            <div class="block-date">${date}</div>
          </div>
          <button class="unblock-btn" data-hash="${hash}">Unblock</button>
        `;
        blockListContainer.appendChild(el);
      });

      // Add listeners to unblock buttons
      document.querySelectorAll('.unblock-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const hashToRemove = e.target.dataset.hash;
          unblockHash(hashToRemove);
        });
      });
    });
  }

  function unblockHash(hashToRemove) {
    chrome.storage.local.get([BLOCKED_HASHES_KEY], (result) => {
      const hashes = result[BLOCKED_HASHES_KEY] || [];
      const newHashes = hashes.filter(item => {
        const h = (typeof item === 'string') ? item : item.hash;
        return h !== hashToRemove;
      });
      
      chrome.storage.local.set({ [BLOCKED_HASHES_KEY]: newHashes }, () => {
        updateStats();
        renderBlockList();
      });
    });
  }

  // Export hashes
  exportButton.addEventListener('click', () => {
    chrome.storage.local.get([BLOCKED_HASHES_KEY], (result) => {
      const hashes = result[BLOCKED_HASHES_KEY] || [];
      const blob = new Blob([JSON.stringify(hashes, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'blocked_hashes.json';
      a.click();
      URL.revokeObjectURL(url);
    });
  });

  // Import hashes
  importButton.addEventListener('click', () => {
    importFile.click();
  });

  importFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedHashes = JSON.parse(event.target.result);
        if (Array.isArray(importedHashes)) {
          chrome.storage.local.get([BLOCKED_HASHES_KEY], (result) => {
            const currentHashes = result[BLOCKED_HASHES_KEY] || [];
            
            // Deduplication logic for mixed types
            const existingHashSet = new Set(currentHashes.map(item => (typeof item === 'string') ? item : item.hash));
            
            const uniqueNewHashes = importedHashes.filter(item => {
              const h = (typeof item === 'string') ? item : item.hash;
              return !existingHashSet.has(h);
            });

            const mergedHashes = [...currentHashes, ...uniqueNewHashes];
            
            chrome.storage.local.set({ [BLOCKED_HASHES_KEY]: mergedHashes }, () => {
              updateStats();
              alert(`Successfully imported ${uniqueNewHashes.length} new hashes.`);
              if (!blockListContainer.classList.contains('hidden')) {
                renderBlockList();
              }
            });
          });
        }
      } catch (err) {
        alert('Failed to import hashes: Invalid JSON file.');
      }
    };
    reader.readAsText(file);
  });

  // Clear all blocks
  clearButton.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all blocked GIFs and muted users?')) {
      chrome.storage.local.set({
        [BLOCKED_HASHES_KEY]: [],
        [BLOCKED_USERS_KEY]: []
      }, () => {
        updateStats();
        if (!blockListContainer.classList.contains('hidden')) {
          renderBlockList();
        }
      });
    }
  });
});