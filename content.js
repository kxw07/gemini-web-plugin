/**
 * Gemini Web Plugin - Batch Delete Mode
 * Automates the native delete flow for multiple conversations.
 */

const GWP = {
  batchMode: false,
  isDeleting: false,
  selectedItems: new Set(),
};

console.log('Gemini Web Plugin: Content Script Loaded');

// ─── DOM Helpers ──────────────────────────────────────────────────────────────

function waitForElement(selector, root = document.body, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const existing = root.querySelector(selector);
    if (existing) return resolve(existing);
    const observer = new MutationObserver(() => {
      const el = root.querySelector(selector);
      if (el) { observer.disconnect(); resolve(el); }
    });
    observer.observe(root, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); reject(new Error(`Timeout: ${selector}`)); }, timeout);
  });
}

function waitForElementToDisappear(selector, root = document.body, timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (!root.querySelector(selector)) return resolve();
    const observer = new MutationObserver(() => {
      if (!root.querySelector(selector)) { observer.disconnect(); resolve(); }
    });
    observer.observe(root, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); reject(new Error(`Timeout disappear: ${selector}`)); }, timeout);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getConversationItems() {
  // Strategy 1: standard class
  let items = Array.from(document.querySelectorAll('a.conversation'));
  if (items.length > 0) return items;

  // Strategy 2: a tags in nav/aside with href containing /app/ followed by ID or /chat/ followed by ID
  const allLinks = document.querySelectorAll('nav a, aside a, [class*="sidebar"] a, [class*="nav"] a');
  items = Array.from(allLinks).filter(a => {
    const href = a.getAttribute('href') || '';
    const parts = href.split('/').filter(Boolean);
    // Filter out typical navigation links that are not conversations
    const nonChatPaths = ['settings', 'library', 'help', 'activity', 'gems', 'extensions', 'export'];
    return parts.length >= 2 && 
           (parts[0] === 'app' || parts[0] === 'chat') && 
           !nonChatPaths.includes(parts[1]);
  });
  
  return items;
}

// ─── Find a stable button to clone ──────────────────────────────────────────

function findButtonToClone() {
  // We want to find any stable sidebar item to clone.
  // Order of preference:
  // 1. Library (媒體庫) - the direct modern replacement for "My Stuff"
  // 2. Gems (Gem Manager)
  // 3. Settings (設定)
  // 4. Activity (活動)
  // 5. Help (說明)
  // 6. New chat (新對話)
  const keywords = [
    'Library', '媒體庫', 'library',
    'Gems', 'Gem Manager',
    'Settings', '設定', 'settings',
    'Activity', '活動', 'activity',
    'Help', '說明', 'help',
    'New chat', '新對話', 'new-chat'
  ];

  // Strategy 1: Search for button/link inside sidebar with text matching keywords
  const elements = document.querySelectorAll('nav a, nav button, aside a, aside button, [class*="sidebar"] a, [class*="sidebar"] button, [class*="nav"] a, [class*="nav"] button');
  for (const el of elements) {
    const text = el.textContent.trim();
    for (const kw of keywords) {
      if (text.includes(kw)) {
        return el;
      }
    }
  }

  // Strategy 2: Search by aria-label containing keywords
  for (const kw of keywords) {
    const el = document.querySelector(`[aria-label*="${kw}" i]`);
    if (el) return el;
  }

  // Strategy 3: Search for general sidebar nav buttons by class names
  const sideNavBtns = document.querySelectorAll('[class*="side-nav-entry-button"], [class*="nav-item"], [class*="sidebar-item"]');
  for (const btn of sideNavBtns) {
    // Return the first one that is a link or button
    if (btn.tagName === 'A' || btn.tagName === 'BUTTON' || btn.getAttribute('role') === 'button') {
      return btn;
    }
  }

  // Strategy 4: Fallback to the first anchor inside sidebar
  const firstAnchor = document.querySelector('nav a, aside a, [class*="sidebar"] a');
  if (firstAnchor) return firstAnchor;

  return null;
}

// ─── Button Injection ───────────────────────────────────────────────────────

function injectToggleButton() {
  if (document.querySelector('#gwp-batch-toggle')) return;

  const cloneTarget = findButtonToClone();
  if (!cloneTarget) {
    console.log('Gemini Web Plugin: Could not find a sidebar button to clone yet');
    return;
  }

  console.log(`Gemini Web Plugin: Found button to clone (${cloneTarget.textContent.trim().substring(0, 20)}), injecting Batch Delete`);

  // Deep clone the entire native button to preserve Angular's _ngcontent-* scope attributes
  const btn = cloneTarget.cloneNode(true);
  btn.id = 'gwp-batch-toggle';
  btn.href = 'javascript:void(0)';
  btn.removeAttribute('aria-label');
  btn.classList.add('gwp-batch-toggle');

  // Remove Angular internal elements (ripple, tooltip trigger, etc)
  btn.querySelectorAll('.mat-ripple-element, .mat-mdc-button-ripple, .mdc-list-item__ripple, mat-ripple').forEach(el => el.remove());

  // Replace the icon — clear the entire icon wrapper and create fresh mat-icon
  const allIcons = btn.querySelectorAll('mat-icon');
  if (allIcons.length > 0) {
    const origIcon = allIcons[0];
    const iconClassName = origIcon.className;
    const ngAttrs = [];
    for (const attr of origIcon.attributes) {
      if (attr.name.startsWith('_ngcontent') || attr.name.startsWith('_nghost')) {
        ngAttrs.push({ name: attr.name, value: attr.value });
      }
    }

    const iconWrapper = origIcon.parentElement;
    iconWrapper.innerHTML = '';

    const newIcon = document.createElement('mat-icon');
    newIcon.className = iconClassName;
    ngAttrs.forEach(a => newIcon.setAttribute(a.name, a.value));
    newIcon.setAttribute('role', 'img');
    newIcon.textContent = 'delete';
    iconWrapper.appendChild(newIcon);
  } else {
    // If the cloned element doesn't have a mat-icon, check if there's an svg
    const svg = btn.querySelector('svg');
    if (svg) {
      svg.innerHTML = '<path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/>';
    }
  }

  // Swap the label text to "批次刪除"
  // Search for the element containing the original matched text to avoid overwriting structural divs
  let textEl = null;
  const cloneTargetText = cloneTarget.textContent.trim();
  const allChildren = Array.from(btn.querySelectorAll('*'));
  // Sort children by text content length ascending so we check the most specific elements first
  allChildren.sort((a, b) => a.textContent.length - b.textContent.length);

  for (const child of allChildren) {
    const text = child.textContent.trim();
    if (text && (
      text === 'Library' || text === '媒體庫' || text === 'library' ||
      text === 'Gems' || text === 'Gem Manager' ||
      text === 'Settings' || text === '設定' || text === 'settings' ||
      text === 'Activity' || text === '活動' || text === 'activity' ||
      text === 'Help' || text === '說明' || text === 'help' ||
      text === 'New chat' || text === '新對話' || text === 'new-chat'
    )) {
      textEl = child;
      break;
    }
  }

  // Fallback 1: Any child whose text matches the cloned target's text content
  if (!textEl) {
    for (const child of allChildren) {
      if (child.textContent.trim() === cloneTargetText) {
        textEl = child;
        break;
      }
    }
  }

  // Fallback 2: Look for known classes
  if (!textEl) {
    textEl = btn.querySelector('[class*="side-nav-entry-button-text"], [class*="button-text"]')
      || btn.querySelector('div:last-child')
      || btn.querySelector('span:last-child');
  }

  if (textEl) {
    textEl.textContent = '批次刪除';
  } else {
    btn.textContent = '批次刪除';
  }

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleBatchMode();
  });

  // Insert right after the cloned button
  if (cloneTarget.nextSibling) {
    cloneTarget.parentNode.insertBefore(btn, cloneTarget.nextSibling);
  } else {
    cloneTarget.parentNode.appendChild(btn);
  }

  console.log('Gemini Web Plugin: Batch Delete button injected');
}

// ─── Batch Mode Toggle ──────────────────────────────────────────────────────

function toggleBatchMode() {
  GWP.batchMode = !GWP.batchMode;
  GWP.selectedItems.clear();

  const toggle = document.querySelector('#gwp-batch-toggle');
  if (toggle) toggle.classList.toggle('gwp-active', GWP.batchMode);

  if (GWP.batchMode) {
    injectCheckboxes();
    showActionBar();
  } else {
    removeCheckboxes();
    hideActionBar();
  }
  updateActionBar();
}

// ─── Checkboxes ──────────────────────────────────────────────────────────────

function injectCheckboxes() {
  const items = getConversationItems();
  items.forEach(item => {
    if (item.querySelector('.gwp-checkbox-wrap')) return;

    const wrap = document.createElement('label');
    wrap.className = 'gwp-checkbox-wrap';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'gwp-checkbox';

    const checkmark = document.createElement('span');
    checkmark.className = 'gwp-checkmark';
    checkmark.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

    wrap.appendChild(checkbox);
    wrap.appendChild(checkmark);

    wrap.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      checkbox.checked = !checkbox.checked;
      if (checkbox.checked) {
        GWP.selectedItems.add(item);
      } else {
        GWP.selectedItems.delete(item);
      }
      item.classList.toggle('gwp-selected', checkbox.checked);
      updateActionBar();
    });

    item.insertBefore(wrap, item.firstChild);
    item.classList.add('gwp-batch-item');
  });
}

function removeCheckboxes() {
  document.querySelectorAll('.gwp-checkbox-wrap').forEach(el => el.remove());
  document.querySelectorAll('.gwp-batch-item').forEach(el => {
    el.classList.remove('gwp-batch-item', 'gwp-selected');
  });
}


// ─── Floating Action Bar ────────────────────────────────────────────────────

function showActionBar() {
  if (document.querySelector('.gwp-action-bar')) return;

  const bar = document.createElement('div');
  bar.className = 'gwp-action-bar';
  bar.innerHTML = `
    <div class="gwp-action-bar-inner">
      <span class="gwp-action-count">已選擇 0 項</span>
      <div class="gwp-action-buttons">
        <button class="gwp-btn gwp-btn-cancel">取消</button>
        <button class="gwp-btn gwp-btn-delete" disabled>刪除</button>
      </div>
    </div>
  `;

  bar.querySelector('.gwp-btn-cancel').addEventListener('click', toggleBatchMode);
  bar.querySelector('.gwp-btn-delete').addEventListener('click', () => handleBatchDelete());

  // Insert before the first conversation item
  const convos = getConversationItems();
  const firstConvo = convos[0];
  if (firstConvo) {
    firstConvo.parentElement.insertBefore(bar, firstConvo);
  } else {
    // Fallback: append to sidebar
    const sidebar = convos[0]?.closest('nav, aside')
      || document.querySelector('[class*="sidebar"]')
      || document.querySelector('nav')
      || document.querySelector('aside')
      || document.body;
    sidebar.appendChild(bar);
  }
}

function hideActionBar() {
  document.querySelectorAll('.gwp-action-bar').forEach(el => el.remove());
}

function updateActionBar() {
  const count = GWP.selectedItems.size;
  const countEl = document.querySelector('.gwp-action-count');
  const deleteBtn = document.querySelector('.gwp-btn-delete');
  if (countEl) countEl.textContent = `已選擇 ${count} 項`;
  if (deleteBtn) deleteBtn.disabled = count === 0;
}

// ─── Progress Overlay ──────────────────────────────────────────────────────

function showProgress(current, total, title) {
  let overlay = document.querySelector('.gwp-progress-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'gwp-progress-overlay';
    overlay.innerHTML = `
      <div class="gwp-progress-card">
        <div class="gwp-progress-title">正在刪除對話...</div>
        <div class="gwp-progress-bar-wrap">
          <div class="gwp-progress-bar-fill"></div>
        </div>
        <div class="gwp-progress-status"></div>
      </div>
    `;
    document.body.appendChild(overlay);
  }
  const pct = Math.round((current / total) * 100);
  overlay.querySelector('.gwp-progress-bar-fill').style.width = `${pct}%`;
  overlay.querySelector('.gwp-progress-status').textContent = `${current} / ${total} — ${title}`;
}

function hideProgress() {
  document.querySelectorAll('.gwp-progress-overlay').forEach(el => el.remove());
}

// ─── Batch Delete Logic ──────────────────────────────────────────────────────

async function handleBatchDelete() {
  const items = Array.from(GWP.selectedItems);
  if (items.length === 0) return;

  GWP.isDeleting = true;
  hideActionBar();

  let deleted = 0;
  const total = items.length;

  for (const item of items) {
    if (!document.body.contains(item)) {
      deleted++;
      continue;
    }

    const title = (item.textContent?.trim() || 'Untitled').substring(0, 30);
    showProgress(deleted + 1, total, title);

    try {
      await deleteSingleConversation(item);
      deleted++;
      console.log(`Gemini Web Plugin: Deleted (${deleted}/${total}): ${title}`);
    } catch (err) {
      console.error(`Gemini Web Plugin: Failed to delete "${title}":`, err);
    }

    await sleep(600);
  }

  hideProgress();
  GWP.isDeleting = false;
  GWP.selectedItems.clear();
  GWP.batchMode = false;

  const toggle = document.querySelector('#gwp-batch-toggle');
  if (toggle) toggle.classList.remove('gwp-active');
  removeCheckboxes();

  console.log(`Gemini Web Plugin: Batch delete complete. ${deleted}/${total} deleted.`);
}

async function deleteSingleConversation(item) {
  // Step 1: Hover to reveal the 3-dot menu button
  item.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  item.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  await sleep(400);

  // Step 2: Find the 3-dot ⋮ button — search broadly
  let menuBtn = null;
  // Primary: look for it within the conversation item itself
  menuBtn = item.querySelector('button.conversation-actions-menu-button');
  if (!menuBtn) {
    // It might be a sibling or in a parent wrapper
    const wrapper = item.closest('[role="listitem"]') || item.parentElement;
    menuBtn = wrapper?.querySelector('button.conversation-actions-menu-button');
  }
  if (!menuBtn) {
    // Angular might use a different class pattern
    menuBtn = item.querySelector('button[class*="menu-button"]')
      || item.querySelector('button[aria-haspopup="menu"]');
  }
  if (!menuBtn) {
    const wrapper = item.closest('[role="listitem"]') || item.parentElement;
    menuBtn = wrapper?.querySelector('button[class*="menu-button"]')
      || wrapper?.querySelector('button[aria-haspopup="menu"]');
  }
  if (!menuBtn) {
    // Try using aria-labels containing menu, more, 更多, 選單
    menuBtn = item.querySelector('button[aria-label*="menu" i], button[aria-label*="more" i], button[aria-label*="更多"], button[aria-label*="選單"]')
      || item.closest('[role="listitem"]')?.querySelector('button[aria-label*="menu" i], button[aria-label*="more" i], button[aria-label*="更多"], button[aria-label*="選單"]')
      || item.parentElement?.querySelector('button[aria-label*="menu" i], button[aria-label*="more" i], button[aria-label*="更多"], button[aria-label*="選單"]');
  }
  if (!menuBtn) {
    // Look for mat-icon or svg inside buttons in the item containing more_vert
    const btns = Array.from(item.querySelectorAll('button'));
    menuBtn = btns.find(b => {
      const icon = b.querySelector('mat-icon, svg, [class*="google-symbols"]');
      return icon && (icon.textContent.includes('more_vert') || icon.textContent.includes('more') || b.getAttribute('aria-expanded') !== null);
    });
  }

  if (!menuBtn) {
    throw new Error('Could not find 3-dot menu button');
  }

  console.log('Gemini Web Plugin: Clicking menu button');
  menuBtn.click();
  await sleep(400);

  // Step 3: Wait for dropdown menu items to appear
  // Angular CDK overlays attach to a body-level overlay container, so search globally
  await waitForElement('.mat-mdc-menu-panel button[role="menuitem"], .mat-mdc-menu-panel .mat-mdc-menu-item, [role="menu"] [role="menuitem"], .cdk-overlay-container [role="menuitem"]', document.body, 3000);
  await sleep(300);

  // Step 4: Find and click the "Delete" / "刪除" menu item
  // Search globally in all overlay containers since Angular renders menus in CDK overlay
  const allMenuItems = document.querySelectorAll('.mat-mdc-menu-panel button, .mat-mdc-menu-panel [role="menuitem"], [role="menu"] [role="menuitem"], .cdk-overlay-container button, .cdk-overlay-container [role="menuitem"]');
  console.log(`Gemini Web Plugin: Found ${allMenuItems.length} menu items`);

  let deleteMenuItem = null;
  for (const mi of allMenuItems) {
    // Strategy 1: Check mat-icon ligature text or content
    const icons = mi.querySelectorAll('mat-icon, [class*="google-symbols"], svg');
    for (const icon of icons) {
      const it = icon.textContent.trim();
      if (it === 'delete' || it === 'delete_forever') {
        deleteMenuItem = mi;
        break;
      }
    }
    if (deleteMenuItem) break;

    // Strategy 2: Check span text content
    const spans = mi.querySelectorAll('.mat-mdc-menu-item-text, span, div');
    for (const span of spans) {
      const t = span.textContent.trim();
      if (t === '刪除' || t === 'Delete' || t === 'delete') {
        deleteMenuItem = mi;
        break;
      }
    }
    if (deleteMenuItem) break;
    
    // Strategy 3: Check raw menu item content
    const t = mi.textContent.trim();
    if (t.includes('刪除') || t.includes('Delete')) {
      deleteMenuItem = mi;
      break;
    }
  }

  if (!deleteMenuItem) {
    // Debug: log what we found
    allMenuItems.forEach((mi, i) => {
      console.log(`Gemini Web Plugin: Menu item ${i}: "${mi.textContent.trim().substring(0, 40)}"`);
    });
    // Close the menu
    document.body.click();
    await sleep(200);
    throw new Error('Could not find Delete menu item');
  }

  console.log('Gemini Web Plugin: Clicking delete menu item');
  deleteMenuItem.click();
  await sleep(400);

  // Step 5: Wait for confirmation dialog to fully render
  await waitForElement('mat-dialog-container, [role="dialog"], .mat-mdc-dialog-container', document.body, 3000);
  await sleep(500); // Give Angular time to render dialog content

  // Step 6: Find the DELETE button in the dialog (NOT the cancel button)
  // NOTE: Gemini puts mat-primary class on the Cancel button, so we match by TEXT
  const dialogContainers = document.querySelectorAll('mat-dialog-container, [role="dialog"], .cdk-overlay-container, .mat-mdc-dialog-container');
  let confirmBtn = null;

  for (const dialog of dialogContainers) {
    const allBtns = dialog.querySelectorAll('button');
    for (const b of allBtns) {
      const text = b.textContent?.trim() || '';
      // Match the delete button by text, skip cancel
      if (text === '刪除' || text === 'Delete' || text === 'delete' || text.includes('刪除') || text.includes('Delete')) {
        // Double check it's not the cancel button
        if (!text.includes('取消') && !text.includes('Cancel') && !text.includes('cancel')) {
          confirmBtn = b;
          break;
        }
      }
    }
    if (confirmBtn) break;
  }

  if (!confirmBtn) {
    console.error('Gemini Web Plugin: Could not find delete confirm button');
    throw new Error('Could not find confirm button in dialog');
  }

  console.log('Gemini Web Plugin: Clicking confirm delete');
  confirmBtn.click();

  // Step 7: Wait for dialog to close
  await waitForElementToDisappear('mat-dialog-container, [role="dialog"], .mat-mdc-dialog-container', document.body, 5000);
  await sleep(400);
}

// ─── Observer & Init ────────────────────────────────────────────────────────

function startObserver() {
  const observer = new MutationObserver(() => {
    if (GWP.isDeleting) return;
    injectToggleButton();
    injectScrollButtons();
    if (GWP.batchMode) {
      injectCheckboxes();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function init() {
  // Retry injection since Gemini loads the sidebar asynchronously
  const tryInject = () => {
    injectToggleButton();
    injectScrollButtons();
    if (!document.querySelector('#gwp-batch-toggle')) {
      setTimeout(tryInject, 1000);
    }
  };
  tryInject();
  startObserver();
}

// ─── Scroll to Bottom Button ──────────────────────────────────────────────

function findScrollContainer() {
  // Strategy 1: Look for the specific Gemini chat container
  const selectors = [
    'ms-chat-view-container',
    'ms-infinite-scroller',
    'infinite-scroller',
    'main',
    '.chat-history',
    '[role="main"]',
    'ms-chat-view'
  ];

  for (const selector of selectors) {
    const els = document.querySelectorAll(selector);
    for (const el of els) {
      if (el && el.scrollHeight > el.clientHeight + 10) {
        const style = window.getComputedStyle(el);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
          return el;
        }
      }
    }
  }

  // Strategy 2: Find the largest scrollable element that contains messages
  const allScrollable = Array.from(document.querySelectorAll('*')).filter(el => {
    // Basic scrollability check
    if (el.scrollHeight <= el.clientHeight + 10) return false;
    const s = window.getComputedStyle(el);
    return s.overflowY === 'auto' || s.overflowY === 'scroll';
  });

  // Sort by area (width * height) descending to find the main container
  allScrollable.sort((a, b) => {
    return (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight);
  });

  // Prioritize elements containing chat messages
  const messageScroller = allScrollable.find(el => 
    el.querySelector('message-content, .message, [role="article"]')
  );
  if (messageScroller) return messageScroller;

  // Then look for conversation list (sidebar / my stuff)
  const conversationScroller = allScrollable.find(el => {
    if (el.querySelector('.conversation-container, a.conversation')) return true;
    const items = getConversationItems();
    return items.some(item => el.contains(item));
  });
  if (conversationScroller) return conversationScroller;

  return allScrollable[0] || document.scrollingElement || document.documentElement;
}

function injectScrollButtons() {
  if (document.querySelector('.gwp-scroll-top-btn')) return;

  console.log('Gemini Web Plugin: Injecting scroll buttons');

  // Create Scroll to Top Button
  const topBtn = document.createElement('div');
  topBtn.className = 'gwp-scroll-btn gwp-scroll-top-btn';
  topBtn.innerHTML = '<span class="google-symbols" role="img" aria-hidden="true">arrow_upward</span>';
  topBtn.title = '捲動到頂部';

  // Create Scroll to Bottom Button
  const bottomBtn = document.createElement('div');
  bottomBtn.className = 'gwp-scroll-btn gwp-scroll-bottom-btn';
  bottomBtn.innerHTML = '<span class="google-symbols" role="img" aria-hidden="true">arrow_downward</span>';
  bottomBtn.title = '捲動到底部';

  document.body.appendChild(topBtn);
  document.body.appendChild(bottomBtn);

  let container = null;

  const updateButtonsVisibility = (event) => {
    // If we receive a scroll event from a valid chat container, update our reference
    if (event && event.type === 'scroll' && event.target instanceof HTMLElement) {
      const target = event.target;
      if (target !== container && target.querySelector('message-content, [role="article"]')) {
        container = target;
      }
    }

    // Re-validate container if it's gone, hidden, or not the current scroller
    if (!container || !document.body.contains(container) || (container !== document.body && container.offsetParent === null)) {
      container = findScrollContainer();
    }
    
    if (!container) {
      topBtn.classList.remove('gwp-visible');
      bottomBtn.classList.remove('gwp-visible');
      return;
    }

    const threshold = 150;
    const scrollTop = container.scrollTop;
    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;
    
    // Safety check for invalid dimensions
    if (clientHeight === 0) {
      topBtn.classList.remove('gwp-visible');
      bottomBtn.classList.remove('gwp-visible');
      return;
    }

    const distanceToBottom = scrollHeight - scrollTop - clientHeight;

    // Top button visible if scrolled down
    if (scrollTop > threshold) {
      topBtn.classList.add('gwp-visible');
    } else {
      topBtn.classList.remove('gwp-visible');
    }

    // Bottom button visible if not near the bottom
    if (distanceToBottom > threshold) {
      bottomBtn.classList.add('gwp-visible');
    } else {
      bottomBtn.classList.remove('gwp-visible');
    }
  };

  topBtn.addEventListener('click', () => {
    if (!container || !document.body.contains(container) || (container !== document.body && container.offsetParent === null)) {
      container = findScrollContainer();
    }
    if (container) {
      container.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  bottomBtn.addEventListener('click', () => {
    if (!container || !document.body.contains(container) || (container !== document.body && container.offsetParent === null)) {
      container = findScrollContainer();
    }
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }
  });

  // Check scroll status periodically and on scroll
  setInterval(updateButtonsVisibility, 500);
  // Listen for scroll events globally in capture phase to catch them from the container
  window.addEventListener('scroll', updateButtonsVisibility, true);
}

init();
