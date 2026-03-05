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
  return Array.from(document.querySelectorAll('a.conversation'));
}

// ─── Find the "我的內容" button ──────────────────────────────────────────────

function findMyContentButton() {
  // Try multiple strategies to find the "我的內容" / "My Stuff" nav button
  // Strategy 1: look for side-nav-entry-button
  const sideNavBtns = document.querySelectorAll('a[class*="side-nav-entry-button"]');
  for (const btn of sideNavBtns) {
    const text = btn.textContent.trim();
    if (text.includes('我的內容') || text.includes('My Stuff') || text.includes('My content')) {
      return btn;
    }
  }
  // Strategy 2: look for any <a> with href containing "mystuff"
  const mystuffLink = document.querySelector('a[href*="mystuff"]');
  if (mystuffLink) return mystuffLink;

  // Strategy 3: look for aria-label
  const ariaBtn = document.querySelector('a[aria-label*="我的內容"], a[aria-label*="My Stuff"], a[aria-label*="My content"]');
  if (ariaBtn) return ariaBtn;

  // Strategy 4: brute-force scan all links in the sidebar
  const allLinks = document.querySelectorAll('nav a, [class*="side"] a');
  for (const link of allLinks) {
    const text = link.textContent.trim();
    if (text === '我的內容' || text === 'My Stuff' || text === 'My content') {
      return link;
    }
  }

  return null;
}

// ─── Button Injection ───────────────────────────────────────────────────────

function injectToggleButton() {
  if (document.querySelector('#gwp-batch-toggle')) return;

  const myContentBtn = findMyContentButton();
  if (!myContentBtn) {
    console.log('Gemini Web Plugin: Could not find "我的內容" button yet');
    return;
  }

  console.log('Gemini Web Plugin: Found "我的內容" button, injecting Batch Delete');

  // Deep clone the entire native button — this preserves Angular's _ngcontent-* attributes
  // which are required for scoped CSS rules to apply
  const btn = myContentBtn.cloneNode(true);
  btn.id = 'gwp-batch-toggle';
  btn.href = 'javascript:void(0)';
  btn.removeAttribute('aria-label');
  btn.classList.add('gwp-batch-toggle');

  // Remove Angular internal elements (ripple, tooltip trigger, etc)
  btn.querySelectorAll('.mat-ripple-element, .mat-mdc-button-ripple, .mdc-list-item__ripple, mat-ripple').forEach(el => el.remove());

  // Replace the icon — clear the entire icon wrapper and create fresh mat-icon
  const allIcons = btn.querySelectorAll('mat-icon');
  if (allIcons.length > 0) {
    // Save metadata before clearing (clearing removes the original elements)
    const origIcon = allIcons[0];
    const iconClassName = origIcon.className;
    const ngAttrs = [];
    for (const attr of origIcon.attributes) {
      if (attr.name.startsWith('_ngcontent') || attr.name.startsWith('_nghost')) {
        ngAttrs.push({ name: attr.name, value: attr.value });
      }
    }

    const iconWrapper = origIcon.parentElement;
    // Clear the wrapper completely — removes all old icons
    iconWrapper.innerHTML = '';

    // Create a fresh mat-icon with saved metadata
    const newIcon = document.createElement('mat-icon');
    newIcon.className = iconClassName;
    ngAttrs.forEach(a => newIcon.setAttribute(a.name, a.value));
    newIcon.setAttribute('role', 'img');
    newIcon.textContent = 'delete';
    iconWrapper.appendChild(newIcon);
  }

  // Swap the label text to "批次刪除"
  // Try known text container first, then fall back to last div
  const textEl = btn.querySelector('[class*="side-nav-entry-button-text"], [class*="button-text"]')
    || btn.querySelector('div:last-child');
  if (textEl) textEl.textContent = '批次刪除';

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleBatchMode();
  });

  // Insert right after "我的內容"
  if (myContentBtn.nextSibling) {
    myContentBtn.parentNode.insertBefore(btn, myContentBtn.nextSibling);
  } else {
    myContentBtn.parentNode.appendChild(btn);
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
  const firstConvo = document.querySelector('a.conversation');
  if (firstConvo) {
    firstConvo.parentElement.insertBefore(bar, firstConvo);
  } else {
    // Fallback: append to sidebar
    const sidebar = document.querySelector('a.conversation')?.closest('nav, aside')
      || document.querySelector('a.conversation')?.closest('[class*="side"]')
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
    throw new Error('Could not find 3-dot menu button');
  }

  console.log('Gemini Web Plugin: Clicking menu button');
  menuBtn.click();
  await sleep(300);

  // Step 3: Wait for dropdown menu items to appear
  // Angular CDK overlays attach to a body-level overlay container, so search globally
  await waitForElement('.mat-mdc-menu-panel button[role="menuitem"], .mat-mdc-menu-panel .mat-mdc-menu-item, [role="menu"] [role="menuitem"]', document.body, 3000);
  await sleep(300);

  // Step 4: Find and click the "Delete" / "刪除" menu item
  // Search globally in all overlay containers since Angular renders menus in CDK overlay
  const allMenuItems = document.querySelectorAll('.mat-mdc-menu-panel button, .mat-mdc-menu-panel [role="menuitem"], [role="menu"] [role="menuitem"]');
  console.log(`Gemini Web Plugin: Found ${allMenuItems.length} menu items`);

  let deleteMenuItem = null;
  for (const mi of allMenuItems) {
    // Strategy 1: Check mat-icon ligature text
    const icons = mi.querySelectorAll('mat-icon, [class*="google-symbols"]');
    for (const icon of icons) {
      if (icon.textContent.trim() === 'delete') {
        deleteMenuItem = mi;
        break;
      }
    }
    if (deleteMenuItem) break;

    // Strategy 2: Check span text content
    const spans = mi.querySelectorAll('.mat-mdc-menu-item-text, span');
    for (const span of spans) {
      const t = span.textContent.trim();
      if (t === '刪除' || t === 'Delete') {
        deleteMenuItem = mi;
        break;
      }
    }
    if (deleteMenuItem) break;
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
  await sleep(300);

  // Step 5: Wait for confirmation dialog to fully render
  await waitForElement('mat-dialog-container, [role="dialog"]', document.body, 3000);
  await sleep(500); // Give Angular time to render dialog content

  // Step 6: Find the DELETE button in the dialog (NOT the cancel button)
  // NOTE: Gemini puts mat-primary class on the Cancel button, so we match by TEXT
  const dialogContainers = document.querySelectorAll('mat-dialog-container, [role="dialog"], .cdk-overlay-container');
  let confirmBtn = null;

  for (const dialog of dialogContainers) {
    const allBtns = dialog.querySelectorAll('button');
    for (const b of allBtns) {
      const text = b.textContent?.trim() || '';
      // Match the delete button by text, skip cancel
      if (text === '刪除' || text === 'Delete' || text === 'delete') {
        confirmBtn = b;
        break;
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
  await waitForElementToDisappear('mat-dialog-container, [role="dialog"]', document.body, 5000);
  await sleep(400);
}

// ─── Observer & Init ────────────────────────────────────────────────────────

function startObserver() {
  const observer = new MutationObserver(() => {
    if (GWP.isDeleting) return;
    injectToggleButton();
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
    if (!document.querySelector('#gwp-batch-toggle')) {
      setTimeout(tryInject, 1000);
    }
  };
  tryInject();
  startObserver();
}

init();
