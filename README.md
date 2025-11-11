# Regex Highlight & Search Extension

A browser extension that enables regex-based text highlighting and navigation on web pages.

## Features

- 🔍 **Regex Pattern Search**: Search for text using regular expressions (e.g., `(dog|cat)`, `\d{3}-\d{2}-\d{4}`)
- 🎨 **Visual Highlighting**: All matches are highlighted in yellow, with the active match highlighted in orange
- ⬅️➡️ **Navigation Controls**: Previous and Next buttons to cycle through matches
- ⌨️ **Keyboard Shortcuts**: 
  - `Ctrl/Cmd + Shift + F`: Focus search input / toggle widget
  - `F3`: Go to next match
  - `Shift + F3`: Go to previous match
- 📊 **Match Counter**: Shows current position and total matches (e.g., "3 / 15")

## Installation

### Chrome/Edge (Chromium-based browsers)

1. Clone or download this repository
2. Open Chrome/Edge and navigate to `chrome://extensions/` (or `edge://extensions/`)
3. Enable "Developer mode" (toggle in the top right)
4. Click "Load unpacked"
5. Select the folder containing this extension
6. The extension is now installed!

### Firefox

1. Clone or download this repository
2. Open Firefox and navigate to `about:debugging`
3. Click "This Firefox" in the left sidebar
4. Click "Load Temporary Add-on"
5. Select the `manifest.json` file from this extension

## Usage

1. Navigate to any web page
2. The search UI overlay will appear in the top-right corner
3. Enter a regex pattern in the search input (e.g., `(dog|cat)`, `\d+`, `hello\s+world`)
4. Click "Search" or press Enter
5. All matches will be highlighted
6. Use "Previous" and "Next" buttons or keyboard shortcuts to navigate
7. Click "Clear" to remove all highlights

## Example Regex Patterns

- `(dog|cat)` - Match "dog" or "cat"
- `\d+` - Match one or more digits
- `[A-Z][a-z]+` - Match capitalized words
- `\b\w{4}\b` - Match exactly 4-letter words
- `https?://\S+` - Match URLs
- `\d{3}-\d{2}-\d{4}` - Match SSN format

## Technical Details

- **Manifest Version**: 3
- **Permissions**: `activeTab` (only works on the currently active tab)
- **Injection**: Content script injected into all pages
- **Compatibility**: Works on all websites (no CORS restrictions)

## Development

To modify the extension:

1. Edit the files as needed
2. Go to `chrome://extensions/`
3. Click the refresh icon on the extension card
4. Test on a web page

## License

MIT License - feel free to use and modify as needed.
