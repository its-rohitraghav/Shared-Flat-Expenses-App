# Shared Expenses Terminal - Operations and Setup Guide

This guide details all download requirements, local installation procedures, and operational step-by-step guidance for every functional module in the Shared Expenses application.

* **Download Node.js**: Download and install Node.js runtime environment (v18.0.0 or higher recommended) from the official website [Node.js Downloads](https://nodejs.org/).
* **Download Git**: Download Git version control software from the official website [Git Downloads](https://git-scm.com/) to clone or download project source files.
* **Clone repository files**: Execute `git clone <repository-url>` in your terminal or unpack the provided source code archive.
* **Install dependencies**: Execute the command `npm install` inside the project root directory using your command terminal.
* **Create SQLite Database Schema**: Run `npx prisma db push` to generate the local SQLite database container and configure the schemas.
* **Populate Flatmate Seeds**: Run the command `node prisma/seed.js` to seed default roommates (Aisha, Rohan, Priya, Meera, Sam, Dev, Kabir) with their specific occupancy date ranges.
* **Start local server**: Execute `npm run dev` and navigate your web browser to `http://localhost:3000` to access the terminal interface.
* **Ingest CSV expenses data**: Click the "IMPORT CSV" button in the header bar to load the original `expenses_export.csv` file, or copy-paste CSV rows into the "Staged Buffer" text area and click "SCAN & STREAM".
* **Diagnose and resolve anomalies**: View quarantined rows in the "Staged Buffer" tab, click "Review" on records flagged with anomalies (such as missing payers, format errors, or date out-of-bounds), adjust values inside the modal form, and click "Approve & Commit" to transfer them to the committed ledger.
* **Audit ledger transactions**: Navigate to the "Ledger Audit" tab to view committed transactions, type inside the search filter box to search descriptions or payers, or select a flatmate from the sidebar to view their individual transaction audit trail.
* **Execute minimized settlements**: Open the "Cash Settlements" tab to view optimized cash flows calculated to clear roommate debts with the minimum number of transactions, and click "MARK PAID" to commit a payment and clear the balance.
* **Track membership timelines**: Navigate to the "Timeline" tab to inspect flatmate occupancy calendars, and click "EDIT DATES" on any flatmate to update their residency window.

The Shared Expenses application is now fully configured and running local operations under the white background and black text monochrome design system.
