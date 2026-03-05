# Gemini Web Plugin

## Project Overview
This project is a Google Chrome extension designed to enhance the Gemini web interface (gemini.google.com). It adds batch deletion capabilities for chat history and a folder-based management system for organizing conversations.

### Technologies
- **Chrome Extension Manifest V3**
- **JavaScript (Vanilla)**: Content scripts for DOM manipulation.
- **CSS**: Styling for injected UI elements.
- **Chrome Storage API**: Persisting folder structure.

## Building and Running
1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the root directory of this project.
4. Navigate to `https://gemini.google.com/` to see the plugin in action (check the browser console for "Gemini Web Plugin: Content Script Loaded").

## Project Structure
- `manifest.json`: Extension configuration.
- `content.js`: Main logic for DOM manipulation on the Gemini web interface.
- `content.css`: Custom styles for the injected UI.
- `popup.html`: Basic popup UI when clicking the extension icon.
- `README.md`: Original project description.

## Development Conventions
- **DOM Interactions**: Gemini's DOM is highly dynamic. Use `MutationObserver` or robust `waitForElement` helpers to handle asynchronous loading.
- **Styling**: All injected styles should be namespaced with `.gemini-web-plugin-` to avoid conflicts with Gemini's native CSS.
- **Storage**: Use `chrome.storage.local` for folder hierarchies.

## Roadmap (TODO)
- [x] Implement robust `MutationObserver` for batch delete checkboxes.
- [x] Refine "Batch Delete" UI to perfectly match native Gemini Material Design (alignment, icons, dialogs).
- [ ] Create UI for folder creation and chat-to-folder assignment.
- [ ] Implement background script for more complex storage sync if needed.
