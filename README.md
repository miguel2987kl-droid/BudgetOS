<div align="center">

# BudgetOS · Assessoria Carvalho

**Self-hosted finance back office for Assessoria Carvalho's BPO clients**

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![SQLite](https://img.shields.io/badge/SQLite-supported-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-supported-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![MariaDB](https://img.shields.io/badge/MariaDB-supported-003545?logo=mariadb&logoColor=white)](https://mariadb.org/)
[![License](https://img.shields.io/badge/License-PolyForm_NC_1.0-blue)](#license)

</div>

---

## What is this?

This repository is Assessoria Carvalho's fork of [BudgetOS](https://github.com/PPCM/BudgetOS), a self-hosted web application for tracking bank accounts, credit cards, transactions and financial reports.

Upstream BudgetOS is built for individuals and families. This fork adapts it for a **financial BPO workflow**: one analyst manages the books of several clients from a single login, with each client's data kept in its own isolated workspace, and with Brazilian Portuguese and BRL as the defaults.

- **Source**: [JuanDouglas/BudgetOS](https://github.com/JuanDouglas/BudgetOS)
- **Issues**: [GitHub Issues](https://github.com/JuanDouglas/BudgetOS/issues)
- **Upstream**: [PPCM/BudgetOS](https://github.com/PPCM/BudgetOS)

---

## What this fork adds

### Multi-client workspaces

- A **client selector** in the top bar switches between your personal workspace and each client's workspace.
- **Add client** creates an isolated workspace with its own accounts, transactions, credit cards, categories, payees, rules, imports and reports.
- Each workspace has its own **currency, locale and number format**, plus free-text **notes** for the client.
- Workspaces can be **deactivated, reactivated or deleted** without touching other clients.
- A workspace is visible only to the user who created it. Under the hood, each client's records belong to an internal data identity that cannot log in (`src/models/ClientWorkspace.js`, `src/middleware/workspaceContext.js`).

### Brazilian defaults

- Interface language defaults to **Portuguese (pt)**, currency to **BRL**.
- Number format defaults to `1.234,56` (comma decimal, dot grouping).
- Migration `025_set_brazilian_defaults` moves an existing install's system defaults from French to Portuguese; personal preferences that users already set are left alone.

### Credit-card installments (parcelas)

- An expense on a **deferred-debit credit card** can be split into **2 to 36 installments**.
- The amount is divided to the cent (any remainder goes to the first installments), and each installment lands in the following months' billing cycles.
- Pick the number of installments in the transaction form; the installments of one purchase are stored as a linked group with their number (`n` of `N`).

### BPO reports and dashboard

- **Management income statement**: current-month income, expenses and net result by category.
- **Payables and receivables**: pending transactions and scheduled occurrences over the next 90 days, split into payments and receipts.
- **Reconciliation queue**: current-month transactions not yet reconciled.
- Dashboard quick actions, and keyboard-friendly modals across the app.

### Carvalho branding

Navy `#12284d`, gold `#cca761` and white by default. Override the product name with `VITE_APP_NAME` and `VITE_APP_MARK` in `client/.env.local`, or edit the palette in `client/src/lib/brand.js`.

### Inherited from upstream

Bank accounts, transactions, credit cards with billing cycles, recurring transactions, bank import (CSV, Excel, QIF, OFX/QFX), reconciliation, categories, payees, categorization rules, trend/category/forecast reports, multi-user roles, and SQLite/PostgreSQL/MariaDB support. See the [User Guide](doc/user-guide.md) for the full feature list.

---

## Running it

### Windows, for development: `start.ps1`

Requires Node.js 20 or later and npm.

```powershell
.\start.ps1
```

The script:

1. Checks that ports **3000** and **5173** are free.
2. Runs `npm ci` in the root and in `client/` if `node_modules` is missing.
3. Opens two PowerShell windows: the backend (`npm run dev`, port 3000) and the frontend (Vite, port 5173).
4. Waits for both, then opens <http://localhost:5173> in your browser.

Stop the app by closing the two PowerShell windows. On first run, copy `.env.example` to `.env` if you want to change any setting; the defaults use SQLite at `data/budgetos.db`.

### Linux / macOS, for development

```bash
cp .env.example .env
npm ci && (cd client && npm ci)
npm run dev                 # backend on http://localhost:3000
cd client && npm run dev    # frontend on http://localhost:5173
```

### Docker (production)

There is no published image for this fork; build it from source. The upstream `ppcm/budgetos` image on Docker Hub does **not** include the changes above.

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

Open <http://localhost:3000> and create the admin account.

`docker/docker-compose.yml` uses SQLite in a named volume by default and has commented-out PostgreSQL and MariaDB variants. Leave `SESSION_SECRET` unset to have a strong secret generated and persisted in the data volume, or set your own (`openssl rand -hex 32`). Set `COOKIE_SECURE=true` when serving over HTTPS.

To build the image alone:

```bash
docker build -f docker/Dockerfile -t budgetos-carvalho .
docker run -d --name budgetos -p 3000:3000 -v budgetos_data:/app/data budgetos-carvalho
```

### Demo data

```bash
npm run db:seed                                   # local
docker exec budgetos node src/database/seed.js    # Docker
```

This creates the admin account `admin@budgetos.local` / `Admin123!` with sample data. Do not run it against a database holding client data.

---

## Configuration

Settings are read from environment variables (or `.env`). The most relevant ones:

| Variable | Default | Description |
|----------|---------|-------------|
| `SESSION_SECRET` | auto-generated in production | Session encryption key |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | HTTP bind |
| `COOKIE_SECURE` | `false` | `true` behind HTTPS |
| `DEFAULT_LOCALE` | `pt` | Default interface language |
| `DEFAULT_CURRENCY` | `BRL` | Default currency |
| `DB_TYPE` | `sqlite` | `sqlite`, `postgres` or `mysql` |
| `DB_PATH` | `./data/budgetos.db` | SQLite file |
| `POSTGRES_HOST` / `_PORT` / `_DB` / `_USER` / `_PASSWORD` | | PostgreSQL connection |
| `MYSQL_HOST` / `_PORT` / `_DB` / `_USER` / `_PASSWORD` | | MariaDB/MySQL connection |
| `SMTP_HOST` / `_PORT` / `_SECURE` / `_USER` / `_PASS` / `_FROM`, `APP_URL` | | Optional, for password-reset emails |

See [.env.example](.env.example) and the [Admin Guide](doc/admin-guide.md) for the complete list and database setup.

### Volumes

| Path | Purpose |
|------|---------|
| `/app/data` | SQLite database and generated session secret |
| `/app/uploads` | Temporary bank-import files |
| `/app/logs` | Application logs |

---

## Development

| Command | What it does |
|---------|--------------|
| `npm test` | Backend unit tests (Vitest) |
| `npm run test:integration` | Backend integration tests, including workspaces and installments |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run lint` | Backend ESLint |
| `npm run db:migrate` | Apply database migrations |

See the [Developer Guide](doc/developer-guide.md) for project structure and API endpoints.

---

## Documentation

| Document | Description |
|----------|-------------|
| [User Guide](doc/user-guide.md) | Using the app, including client workspaces and BPO reports |
| [Admin Guide](doc/admin-guide.md) | Installation, configuration, user management |
| [Developer Guide](doc/developer-guide.md) | Stack, structure, branding, testing |

Screenshots in the guides come from upstream and may not show the Carvalho branding or the fork's features.

---

## Credits

BudgetOS was created by [PPCM](https://github.com/PPCM) and is developed at [PPCM/BudgetOS](https://github.com/PPCM/BudgetOS). This fork builds on upstream release 1.7.0; everything outside the changes listed above is their work. Please report issues specific to this fork here, not upstream.

## License

[PolyForm Noncommercial 1.0.0](LICENSE), inherited from upstream.
