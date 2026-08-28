# Pijama Films - Claude Code Development Guide

## Project Overview

**Pijama Films** is a platform for indie film producers to advertise their films on a streaming rental service. Target users are film producers with limited digital marketing knowledge who need simple, effective tools to promote their films.

### Tech Stack
- **Next.js 16** with App Router
- **React 19**
- **TypeScript 5.7** (strict mode)
- **MUI 7.3** Material Design components
- **Cloud Firestore** via the Firebase Admin SDK
- **Vitest** testing framework
- **Docker** for deployment

## Quick Reference

### Build Commands

```bash
# Development
yarn dev                  # Start dev server (port 3000)
yarn build                # Production build
yarn start                # Start production server

# Quality & Testing
yarn lint                 # ESLint
yarn test                 # Run tests
yarn test:watch          # Watch mode
yarn test:coverage       # With coverage

# Database (Cloud Firestore)
npm run deploy:firestore                # Rules + indexes + TTL policy (idempotent)
npm run db:seed                         # Seed the special "pijamafilms" partner
npm run firestore:import-partners       # Import partner records from a JSON export

# Users (provisional auth: Firebase email + password)
npm run users:seed                                     # the 5 in-house users, reset links
npm run user:provision -- <email> <name> <partnerId>   # prints a one-time reset link
npm run user:provision -- <email> <name> <partnerId> --password-stdin  # password via stdin

# Scripts using the Admin SDK need Application Default Credentials, which are
# separate from `gcloud auth login`:
#   gcloud auth application-default login

# Deployment (Firebase App Hosting)
# Project pijama-promote-firebase, backend "pijama-promote" (us-central1).
# App Hosting builds and releases from the connected GitHub branch: push, do not
# deploy by hand. MERGING TO master DEPLOYS TO PRODUCTION IMMEDIATELY — there is
# no intermediate gate. Configuration lives in apphosting.yaml; secret values
# live in Secret Manager and are referenced there by name.
npx firebase-tools apphosting:secrets:set NAME --project=pijama-promote-firebase --data-file=- --force

# ROTATING A SECRET DEPLOYS NOTHING (issue #53). Cloud Run revisions pin the
# secret VERSION at build time, and auto-rollout reacts to git pushes, not to
# Secret Manager. After setting a new secret version, trigger a rollout:
#   npx firebase-tools apphosting:rollouts:create pijama-promote \
#     --project=pijama-promote-firebase --git-commit <sha>
# The live Stripe key sat inert for 3d16h in 2026-08 because nobody merged.

# DNS (transitional): promote.pijamafilms.com still resolves to 64.176.6.210,
# the legacy Vultr VM, which reverse-proxies to App Hosting (~450ms vs ~77ms
# direct, and it strips some headers). Do NOT decommission that VM until the
# A record cutover completes — plan and exact records in
# coordination/pijama-sso/transicion-dns-proxy.md (branch coordination/pijama-sso).

# Triggers (Cloud Functions) — the ONE exception to "do not deploy by hand".
# functions/ is a second deployable: App Hosting does not build it, so it has to
# be released with the CLI after any change under functions/.
npm run deploy:functions

```

## Architecture: MVC Pattern

This project **strictly follows the MVC pattern**:

```
┌─────────────┐
│   Model     │  src/models/*.ts
│  (Database) │  - All Firestore operations
└──────┬──────┘  - Zod validation
       │         - Business logic
       ↓
┌─────────────┐
│ Controller  │  src/app/**/page.tsx
│  (Server)   │  - Async server components
└──────┬──────┘  - Call models directly
       │         - Handle 404 with notFound()
       ↓
┌─────────────┐
│    View     │  src/app/**/client.tsx
│  (Client)   │  - 'use client' components
└─────────────┘  - UI rendering
                 - User interactions
```

### Key Rules

1. ✅ **Models** = Database operations only (Firestore via `@/lib/firestore`)
2. ✅ **Controllers** = Server components call models directly (NOT API routes)
3. ✅ **Views** = Client components receive non-nullable data
4. ✅ **404 handling** = At server level with `notFound()`
5. ✅ **Validation** = All inputs with Zod
6. ✅ **Language** = English code and English UI
7. ✅ **Security** = Always choose the most secure option (see [Security First](#security-first))

## Security First

**Always prefer the most secure solution available, even when a less secure one is faster or simpler.**
When there is a trade-off between convenience and security, propose the secure option first, explain
the cost, and let the user decide. Never silently pick the insecure shortcut.

### Non-negotiable rules

1. ❌ **Never expose production credentials.** Do not print, echo, copy, paste into a command, write
   into a file, commit, or pass as a CLI argument any production connection string, password, API key,
   token, or service-account key.
2. ❌ **Never point local tooling at production data.** Do not run scripts, seeds or test suites
   against the production Firestore database. Local work runs against the Firestore emulator or the
   in-memory fake in `src/test/firestore-fake.ts`.
3. ✅ **Rules and indexes are deployed, not edited by hand.** Change `firestore.rules` /
   `firestore.indexes.json` and run `npm run deploy:firestore`; never widen a rule to make a query
   work.
4. ✅ **Secrets live in Secret Manager.** Production secrets are managed with
   `firebase-tools apphosting:secrets:set`, referenced by name from `apphosting.yaml`, and read
   from Secret Manager at runtime. `.env` files are local-only and must stay out of git. Prefer
   an OIDC token over a shared secret whenever the caller is a Google service (see
   `src/lib/auth/oidc-caller.ts`): nothing is stored, and the token cannot be replayed elsewhere.
5. ✅ **Least privilege.** Use the narrowest role, scope, and network exposure that makes the task
   work. Prefer short-lived, IAM-based credentials over long-lived static passwords.
6. ✅ **Redact in logs and errors.** Never log credentials, tokens, full connection strings, or
   personal data. Error messages returned to users must not leak internal details.
7. ✅ **Validate and authorize everything.** All input goes through Zod; every server action, API
   route, and model query must verify the session and confirm the resource belongs to the
   authenticated producer (no IDOR).
8. ✅ **Flag risks explicitly.** If a requested change introduces a security risk, say so plainly
   before implementing, and offer the secure alternative.

### Example of what NOT to suggest

> "The security rules are blocking that read — set `allow read: if true` for now and tighten it
> later."

That publishes every partner's data to anyone with the project id. The secure path is to add the
missing claim or index so the existing rule can serve the query.

## Detailed Guidelines

For comprehensive development guidelines, refer to the Claude Code skills in `.claude/skills/`:

### 📘 Backend Development
**Skill**: `.claude/skills/backend-dev-guidelines/SKILL.md`

Covers:
- MVC pattern implementation
- Model layer (Firestore operations, Zod validation)
- Controller layer (server components, data fetching)
- View layer (client components)
- API routes (auth, validation, error handling)
- Database access pattern: `import { adminDb } from '@/lib/firebase/admin'` plus the helpers in
  `@/lib/firestore`

### 🎨 Frontend Development
**Skill**: `.claude/skills/frontend-dev-guidelines/SKILL.md`

Covers:
- Client components (`'use client'`)
- MUI Grid layout (responsive design)
- Common MUI components (Box, Typography, Button, Card)
- TypeScript patterns (explicit types)
- Form handling
- Theme usage

### 🎬 Film Platform Domain
**Skill**: `.claude/skills/film-platform-guidelines/SKILL.md`

Covers:
- Domain entities (Producer, Film, Campaign, Metrics)
- Business rules
- User workflows
- Domain terminology
- Validation rules
- UI/UX guidelines for non-technical users

### 🗄️ Database
**Skill**: `.claude/skills/database-guidelines/SKILL.md`

Covers:
- Firestore collection layout and document ids
- Relation loading (`src/models/hydrate.ts`) in place of joins
- Query patterns (CRUD, aggregations, collection groups)
- Transactions and batched writes
- Indexes and security rules

### 🧪 Testing
**Skill**: `.claude/skills/testing-guidelines/SKILL.md`

Covers:
- Vitest setup
- Model testing patterns
- Component testing with React Testing Library
- API route testing
- Coverage requirements (70%+)


## Code Style

### Naming Conventions
- **Components**: PascalCase (`FilmCard`)
- **Functions**: camelCase (`getFilmById`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_SIZE`)
- **Props Types**: `[Component]Props` (`FilmCardProps`)

### Language Usage
- **Code** (variables, functions, comments): **English**
- **UI Text** (labels, buttons, messages): **English**
- **Logs**: English
- **User errors**: English

### TypeScript
- Strict mode enabled
- Explicit types for all props and functions
- No `any` types
- Use `unknown` if type is truly unknown

## Project Structure

```
pijama-films/
├── src/
│   ├── app/              # Next.js App Router
│   │   ├── api/          # API routes
│   │   └── [feature]/
│   │       ├── page.tsx      # Controller (server)
│   │       └── client.tsx    # View (client)
│   ├── models/           # Models (database)
│   ├── components/       # Shared UI components
│   ├── lib/              # Utilities (auth, firestore, etc.)
│   └── test/             # Test utilities (incl. the Firestore fake)
├── functions/            # Cloud Functions: schedules, task queue, Firestore
│                         # triggers. Thin — they dispatch to the routes above.
├── .claude/              # Claude Code infrastructure
│   ├── skills/           # Development guidelines
│   ├── agents/           # Code review agents
│   ├── hooks/            # Automation hooks
│   └── commands/         # Slash commands
├── firestore.rules       # Security rules
└── firestore.indexes.json # Composite indexes
```

## Claude Code Features

### Skills (Auto-activated)
- `/backend-dev-guidelines`: MVC patterns, models, API routes
- `/frontend-dev-guidelines`: MUI components, TypeScript
- `/film-platform-guidelines`: Domain knowledge
- `/database-guidelines`: Firestore best practices
- `/testing-guidelines`: Vitest patterns

### Agents
- `code-architecture-reviewer`: MVC compliance
- `style-guide-enforcer`: Naming, formatting
- `documentation-architect`: Documentation standards
- `refactor-planner`: Refactoring guidance
- `film-platform-expert`: Domain expertise

### Slash Commands
- `/dev-docs`: Create dev documentation structure
- `/dev-docs-update`: Update documentation
- `/film-feature [name]`: Scaffold complete MVC feature

## Database Schema

### Collections
```
partners → campaigns → ads → images/videos
accounts/{partnerId}/transactions
userPreferences, generatedCopies
```

- **Partner**: Platform users (film producers)
- **Campaign**: Advertising campaigns, referencing a film by MUVI uuid
- **Ad**: Creatives, holding `imageIds` / `videoIds`
- **Account**: Debit account and its ledger

See `docs/firestore-migration.md` for the layout and the reasoning behind it.

## Getting Started

1. **Install dependencies**: `yarn install`
2. **Authenticate**: `gcloud auth application-default login` (the Admin SDK uses ADC)
3. **Start dev server**: `yarn dev`
4. **Open browser**: http://localhost:3000

## Additional Resources

- **Skills**: Detailed guidelines in `.claude/skills/`
- **README**: Setup and usage in `README.md`
- **Next.js Docs**: https://nextjs.org/docs
- **MUI Docs**: https://mui.com
- **Firestore Docs**: https://firebase.google.com/docs/firestore

---

**Remember**: Follow MVC strictly, validate all inputs, always take the most secure option (never handle production credentials locally), and keep UX simple for non-technical film producers. Detailed implementation guidelines are in the Claude Code skills.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
