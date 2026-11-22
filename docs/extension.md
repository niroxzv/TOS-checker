# Tickwise browser extension

Tickwise reads the terms of service on the page you're on, and its linked Terms, Privacy and Cookie pages, then tells you in plain English what you're agreeing to: your data, your rights and your money. Every point quotes the exact sentence it came from. Not legal advice.

![The popup on a sign-up page](screenshots/extension-in-context.png)

## Install it

Download the files from the [latest release](https://github.com/niroxzv/TOS-checker/releases/latest).

### Firefox

1. Download `tickwise.xpi`.
2. Open it in Firefox (or drag it onto a Firefox window) and click **Add**.
3. Firefox puts new add-ons in the puzzle-piece (Extensions) menu. To keep Tickwise in the toolbar, open that menu, click the gear next to **Tickwise** and choose **Pin to Toolbar**.

It's signed by Mozilla, so it stays installed.

### Edge or Chrome

1. Download `tickwise-extension.zip` and unzip it.
2. Open **edge://extensions** in Edge, or **chrome://extensions** in Chrome.
3. Turn on **Developer mode**. In Edge it's in the left sidebar; in Chrome it's at the top right.
4. Click **Load unpacked** and choose the unzipped folder (the one with `manifest.json` directly inside it).
5. Click the puzzle-piece icon in the toolbar and pin **Tickwise**.

Keep the unzipped folder where it is: the browser loads Tickwise from it.

### Updates

Tickwise doesn't update by itself. When there's a new release, download the new file and install it the same way. In Edge or Chrome, replace the folder's contents and click **Reload** on Tickwise's card.

## Use it

Open a sign-up page, a terms of service or a privacy policy, and click the **Tickwise** icon.

- **Score:** a boundary score out of 100. Lower means the terms ask more of you.
- **What to look at:** one card per kind of point, biggest risks first. Each card has the point in plain English, the sentence it came from, which document it's in, and one safeguard to **Add**. Smaller points are folded under **Show N smaller points**.
- **Show on page:** scrolls to the sentence and highlights it.
- **Open and show:** for a point from a linked page (say, the Privacy Policy), opens that page at the sentence.
- **Not OK:** marks a point as a dealbreaker for you. It moves to the top, lowers the score, and stays marked on every site. Click it again to undo.
- **Selected text:** select a long passage (more than 200 characters) before clicking the icon, and Tickwise checks it as its own document.
- **Badge:** the number on the icon is how many high-risk points the page has.
- **Changes:** check the same page again later, and Tickwise tells you if its terms changed since last time, with new points marked **New**.

### Linked pages on other sites

Terms often sit on another site (say, `legal.example.com`). Tickwise doesn't contact that site until you say so. It lists those pages under **Linked pages we couldn't read**, with an **Allow reading N more pages** button. Click it and accept your browser's prompt. In Edge and Chrome the popup closes when the prompt opens: accept, then click the icon again. The browser remembers your choice for that site.

## Your privacy

- Tickwise only reads a page when you click its icon. Nothing runs in the background.
- Nothing is sent to the developer or anyone else. There's no account and no server.
- Linked terms pages are fetched without your cookies or the address of the page you're on.
- Your **Not OK** choices and a record of which points each page had are kept in your browser only. The record stores scrambled codes (hashes) instead of page addresses, but anyone with a copy of your browser profile could still work out common sites from them. In a private window, nothing about the sites you check is saved.

## What it can't do

- Browser pages (`edge://`, `chrome://`, `about:`, the add-on stores) can't be read by any extension.
- Terms inside a frame on the page are missed.
- Some linked pages build their text with JavaScript; those come back mostly empty.
- It reads what the words say, so it can miss points worded in unusual ways, and it can't judge whether a term is legal where you live.

Building it yourself, testing and publishing: [extension-dev.md](extension-dev.md).
