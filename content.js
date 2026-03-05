/**
 * Gemini Web Plugin - Content Script
 */

const SELECTORS = {
    chatListContainer: 'nav', 
    chatItem: '[role="listitem"]',
    chatLink: 'a[href*="/app/chat/"]',
    menuBtn: 'button[aria-haspopup="menu"]', // Gemini's three-dot menu
    deleteBtnText: 'Delete', // Text in the menu to click
    confirmDeleteBtn: 'button:contains("Delete")' // Placeholder for dialog
};

let pluginData = {
    folders: [],
    mapping: {}, // chatId -> folderName
    activeFolder: null
};

console.log('Gemini Web Plugin: Content Script Initialized');

// --- Storage Logic ---

async function loadPluginData() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['gemini_plugin_data'], (result) => {
            if (result.gemini_plugin_data) {
                pluginData = result.gemini_plugin_data;
            }
            resolve(pluginData);
        });
    });
}

async function savePluginData() {
    return new Promise((resolve) => {
        chrome.storage.local.set({ 'gemini_plugin_data': pluginData }, () => {
            console.log('Gemini Web Plugin: Data saved', pluginData);
            resolve();
        });
    });
}

// --- UI Components ---

function createActionBar(parent) {
    if (document.getElementById('gemini-plugin-action-bar')) return;

    const actionBar = document.createElement('div');
    actionBar.id = 'gemini-plugin-action-bar';
    actionBar.className = 'gemini-web-plugin-action-bar';
    
    actionBar.innerHTML = `
        <button class="gemini-web-plugin-btn" id="gemini-select-all">Select All</button>
        <button class="gemini-web-plugin-btn gemini-web-plugin-btn-danger" id="gemini-delete-selected">Delete Selected (0)</button>
        <button class="gemini-web-plugin-btn" id="gemini-create-folder">+ Folder</button>
    `;

    parent.prepend(actionBar);

    document.getElementById('gemini-select-all').addEventListener('click', toggleAllCheckboxes);
    document.getElementById('gemini-delete-selected').addEventListener('click', deleteSelectedChats);
    document.getElementById('gemini-create-folder').addEventListener('click', handleCreateFolder);
    
    renderFolders(parent);
}

function renderFolders(parent) {
    let folderContainer = document.getElementById('gemini-plugin-folder-container');
    if (!folderContainer) {
        folderContainer = document.createElement('div');
        folderContainer.id = 'gemini-plugin-folder-container';
        parent.appendChild(folderContainer);
    }

    folderContainer.innerHTML = '<strong>Folders</strong>';
    
    // Add "All Chats" option
    const allChatsEl = document.createElement('div');
    allChatsEl.className = `gemini-web-plugin-folder ${!pluginData.activeFolder ? 'gemini-web-plugin-folder-active' : ''}`;
    allChatsEl.innerText = '🏠 All Chats';
    allChatsEl.onclick = () => filterByFolder(null);
    folderContainer.appendChild(allChatsEl);

    pluginData.folders.forEach(folderName => {
        const folderEl = document.createElement('div');
        folderEl.className = `gemini-web-plugin-folder ${pluginData.activeFolder === folderName ? 'gemini-web-plugin-folder-active' : ''}`;
        folderEl.innerText = `📁 ${folderName}`;
        folderEl.onclick = () => filterByFolder(folderName);
        folderContainer.appendChild(folderEl);
    });
}

function filterByFolder(folderName) {
    pluginData.activeFolder = folderName;
    renderFolders(document.querySelector(SELECTORS.chatListContainer));
    
    const items = document.querySelectorAll(SELECTORS.chatItem);
    items.forEach(item => {
        const chatId = getChatId(item);
        if (!folderName) {
            item.classList.remove('gemini-web-plugin-hidden');
        } else if (pluginData.mapping[chatId] === folderName) {
            item.classList.remove('gemini-web-plugin-hidden');
        } else {
            item.classList.add('gemini-web-plugin-hidden');
        }
    });
}

async function handleCreateFolder() {
    const folderName = prompt('Enter folder name:');
    if (!folderName || pluginData.folders.includes(folderName)) return;

    pluginData.folders.push(folderName);
    await savePluginData();
    renderFolders(document.querySelector(SELECTORS.chatListContainer));
}

function getChatId(item) {
    const link = item.querySelector(SELECTORS.chatLink);
    if (!link) return null;
    const parts = link.href.split('/');
    return parts[parts.length - 1];
}

function injectUI(item) {
    if (item.querySelector('.gemini-web-plugin-checkbox')) return;

    const chatId = getChatId(item);
    if (!chatId) return;

    // Checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'gemini-web-plugin-checkbox';
    checkbox.addEventListener('change', updateDeleteButtonCount);
    
    // Folder Dropdown
    const select = document.createElement('select');
    select.className = 'gemini-web-plugin-move-dropdown';
    select.innerHTML = `<option value="">--Move--</option>` + 
        pluginData.folders.map(f => `<option value="${f}" ${pluginData.mapping[chatId] === f ? 'selected' : ''}>${f}</option>`).join('');
    
    select.onchange = (e) => {
        pluginData.mapping[chatId] = e.target.value;
        savePluginData();
        filterByFolder(pluginData.activeFolder);
    };

    if (item.firstChild) {
        item.insertBefore(checkbox, item.firstChild);
        item.insertBefore(select, checkbox.nextSibling);
    }
}

function updateDeleteButtonCount() {
    const checkedCount = document.querySelectorAll('.gemini-web-plugin-checkbox:checked:not(.gemini-web-plugin-hidden)').length;
    const btn = document.getElementById('gemini-delete-selected');
    if (btn) btn.innerText = `Delete Selected (${checkedCount})`;
}

function toggleAllCheckboxes() {
    const visibleCheckboxes = document.querySelectorAll(`${SELECTORS.chatItem}:not(.gemini-web-plugin-hidden) .gemini-web-plugin-checkbox`);
    const allChecked = Array.from(visibleCheckboxes).every(cb => cb.checked);
    visibleCheckboxes.forEach(cb => cb.checked = !allChecked);
    updateDeleteButtonCount();
}

async function deleteSelectedChats() {
    const selected = document.querySelectorAll('.gemini-web-plugin-checkbox:checked:not(.gemini-web-plugin-hidden)');
    if (selected.length === 0) return;
    if (!confirm(`Are you sure you want to delete ${selected.length} chats?`)) return;

    for (const cb of selected) {
        const item = cb.closest(SELECTORS.chatItem);
        await performDelete(item);
    }
}

async function performDelete(item) {
    console.log('Gemini Web Plugin: Deleting chat...');
    // Automating deletion is delicate. This is a generic pattern.
    const menuBtn = item.querySelector(SELECTORS.menuBtn);
    if (!menuBtn) return;
    
    menuBtn.click();
    await new Promise(r => setTimeout(r, 500)); // Wait for menu
    
    // Find "Delete" in the menu and click it
    const menuItems = document.querySelectorAll('[role="menuitem"]');
    for (const mi of menuItems) {
        if (mi.innerText.includes('Delete')) {
            mi.click();
            break;
        }
    }
    
    // Note: Usually a confirmation dialog appears. We would need to click "Delete" there too.
}

// --- Main Init ---

const observer = new MutationObserver(async () => {
    const chatList = document.querySelector(SELECTORS.chatListContainer);
    if (chatList) {
        if (pluginData.folders.length === 0 && Object.keys(pluginData.mapping).length === 0) {
            await loadPluginData();
        }
        createActionBar(chatList);
        const items = document.querySelectorAll(SELECTORS.chatItem);
        items.forEach(injectUI);
    }
});

observer.observe(document.body, { childList: true, subtree: true });
