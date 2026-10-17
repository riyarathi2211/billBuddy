# BillBuddy

BillBuddy is a browser-based personal expense manager built with React, Vite, and JavaScript. It organizes receipts and invoices, tracks spending, and presents locally calculated budget and spending insights.

## Features

- Dashboard, Documents, Categories, Budgets, Insights, and Export pages
- Transaction search, filtering, sorting, add/edit/delete, and CSV export
- Receipt image upload with in-browser English OCR powered by Tesseract.js
- Monthly budgets and category spending progress
- Smart budget alerts, possible unusual-expense indicators, savings estimates, and month-end forecasts
- Responsive layouts for desktop, tablet, and mobile

Transactions and budget settings are stored in the browser's IndexedDB database (`billbuddy-db`). Data is local to the browser and origin; there is no server-side account or synchronization. The app seeds example transactions only when the transaction store is empty on first run.

## Run locally

Use Node.js and npm, then run:

```sh
npm install
npm run dev
```

Vite prints the local development URL in the terminal.

## Validate and preview a production build

```sh
npm run lint
npm run build
npm run preview
```

The production build is written to `dist/`. The preview command serves that build locally so it can be checked before publishing.

## Static deployment

This repository currently has no deployment provider configuration. For a static host:

1. Set the install command to `npm install`.
2. Set the build command to `npm run build`.
3. Set the published/output directory to `dist`.
4. Configure the host to serve the app's `index.html` for the site root and unknown client-side paths.

The current Vite configuration assumes the app is hosted at the domain root. If it will be served from a subpath, set Vite's `base` option for that path before building. Deployment itself must be completed and verified with the chosen host.

## Browser storage and OCR notes

- Clearing site data, changing browsers/origins, or using a private browsing session can remove or limit IndexedDB data. Export important transactions regularly.
- OCR runs in the browser through Tesseract.js and may take time on large images. The deployed site must allow the OCR worker and English language data to load; restrictive Content Security Policy or network settings can prevent OCR from starting.
- OCR produces suggestions from image text. Review the vendor, date, and amount before saving a transaction.
