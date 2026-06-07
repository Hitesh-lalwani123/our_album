# Digital Photo Album

A beautiful digital photo album to cherish precious memories. 

This repository contains the source code for a web-based digital photo album. It features a soft page-turning animation and ambient background music. 

## Features

- **Soft Page Turn Animation:** Realistically styled page-turning effects.
- **Ambient Background Music:** Automatically plays upon first interaction to set the mood.
- **Client Mode:** Standard visitors see a read-only album with photos loaded directly from Google Drive.
- **Maker Mode:** Administrators can add, edit, or delete photos via a hidden interface.

## How to Add Photos

### Method 1: Hardcoding (For Permanent Display)
By default, the album will load photos specified in `script.js`. 
1. Upload your photos to a folder in Google Drive.
2. Select all photos, right-click, and choose **Share** -> **Anyone with the link**.
3. Open `script.js` in your editor.
4. Locate the `HARDCODED_PHOTOS` array at the top of the file.
5. Paste the Google Drive links or File IDs into this array.

```javascript
const HARDCODED_PHOTOS = [
  '1BxiMVs0X...', // File ID
  'https://drive.google.com/file/d/1BxiMVs0X.../view', // Full link
];
```

### Method 2: Maker Mode (Live Editing)
To edit the album interface directly:
1. Open your album in a browser.
2. Add `?admin=1` to the end of the URL (e.g., `https://yourusername.github.io/album/?admin=1`).
3. You will now see buttons to **Add Photo**, import from **Drive**, and edit captions/titles. Note that changes made via the UI in Admin mode will be stored locally in your browser. To make photos permanent for all visitors, you must add their IDs to `HARDCODED_PHOTOS` in `script.js`.

## Deployment

This repository is configured to automatically deploy to GitHub Pages whenever changes are pushed to the `main` branch. 
The `.github/workflows/deploy.yml` file handles this process using GitHub Actions.

To view your deployed album:
1. Go to your repository settings on GitHub.
2. Navigate to **Pages** on the left sidebar.
3. Your site's live URL will be displayed at the top (e.g., `https://yourusername.github.io/album/`).
