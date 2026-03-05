# Gemini Web Plugin
Enhance your Gemini Web experience with batch deletion and folder management.

## Core Functions
### 🗑️ Batch Delete
Injects checkboxes into your chat list. Select multiple conversations and delete them all at once with a single click. The UI is seamlessly integrated to match Gemini's native Material Design, complete with localized confirmation dialogs and progress overlays.

### 📁 Folder Management
Create custom folders in the sidebar. Move chats into folders using a simple dropdown and filter your view to stay organized.

---

## 🛠️ Chrome Setup Steps
To install this extension in Google Chrome, follow these steps:

1.  **Download/Clone** this repository to your local machine.
2.  Open Google Chrome and navigate to **`chrome://extensions/`**.
3.  In the top right corner, toggle on **Developer mode**.
4.  Click the **Load unpacked** button that appears in the top left.
5.  Select the **root folder** of this project (the directory containing `manifest.json`).
6.  The extension is now installed! Navigate to [gemini.google.com](https://gemini.google.com/) to see it in action.

---

## Development
- **Manifest V3**: Uses the latest Chrome extension standards.
- **Storage**: Folders and mappings are persisted using `chrome.storage.local`.
- **Dynamic UI**: Uses `MutationObserver` to handle Gemini's single-page application (SPA) updates.

## Roadmap (Completed)
- [x] Content script injection for Gemini sidebar.
- [x] Native-styled "Batch Delete" toggle button.
- [x] Inline checkboxes and floating action bar for batch selection.
- [x] Automated sequential deletion with progress overlay.
- [x] Persistent folder creation and storage.
- [x] Chat-to-folder mapping dropdowns.
- [x] Real-time folder filtering view.
