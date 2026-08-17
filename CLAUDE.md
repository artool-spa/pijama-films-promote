# Pijama Films - Claude Code Development Guide

## Project Overview

**Pijama Films** is a platform for indie film producers to advertise their films on a streaming rental service. Target users are film producers with limited digital marketing knowledge who need simple, effective tools to promote their films.

### Tech Stack
- **Next.js 16** with App Router
- **React 19**
- **TypeScript 5.7** (strict mode)
- **MUI 7.3** Material Design components
- **Prisma 6.19** ORM with PostgreSQL 16
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

# Database
npx prisma generate      # Generate client
npx prisma migrate dev   # Create migration
npx prisma studio        # Open Prisma Studio

# Deployment (Google Cloud Run)
npm run deploy:cloudrun          # Deploy app to production (Cloud Run)
npm run deploy:cloudrun:secrets  # Push secrets to Secret Manager
npm run deploy:gcp-setup         # One-time GCP infrastructure setup
npm run deploy:firestore         # One-time Firestore setup (rules + TTL policy)

# Deploying requires gcloud CLI authenticated, the GCP infrastructure created
# by deploy:gcp-setup, and secrets present via deploy:cloudrun:secrets.
# The deploy builds the image locally, pushes to Artifact Registry, and
# releases to Cloud Run. It does NOT commit or push git — do that yourself.
#
# The deploy:coolify / deploy:env scripts target the legacy Coolify host and
# are no longer production. Do not use them.

# Docker
docker compose up        # Start PostgreSQL
docker compose down      # Stop database
```

## Architecture: MVC Pattern

This project **strictly follows the MVC pattern**:

```
┌─────────────┐
│   Model     │  src/models/*.ts
│  (Database) │  - All Prisma operations
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

1. ✅ **Models** = Database operations only (use Prisma via `#prisma`)
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
   token, or service-account key. This includes `DATABASE_URL` (the Postgres URL embeds the password).
2. ❌ **Never point local tooling at the production database.** Do not run `prisma migrate dev`,
   `prisma db push`, `prisma studio`, seeds, test suites, or ad-hoc scripts against production. Local
   work runs against the local Docker Postgres (`docker compose up -d`).
3. ✅ **Production migrations run in production.** Apply schema changes with `prisma migrate deploy`
   executed from the deployed environment (Cloud Run job / Cloud SQL connector / IAM-authenticated
   session), not from a developer laptop holding a production URL.
4. ✅ **Secrets live in Secret Manager.** Production secrets are managed through
   `npm run deploy:cloudrun:secrets` and read from GCP Secret Manager at runtime. `.env` files are
   local-only and must stay out of git.
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

> "The production database hasn't been migrated — just set your local `DATABASE_URL` to the
> production Postgres URL and run `prisma migrate dev`."

This leaks the production password into the local environment, shell history, and possibly logs, and
runs a destructive dev-mode migration against live data. The secure path is to run
`prisma migrate deploy` from the production environment using Secret Manager credentials.

## Detailed Guidelines

For comprehensive development guidelines, refer to the Claude Code skills in `.claude/skills/`:

### 📘 Backend Development
**Skill**: `.claude/skills/backend-dev-guidelines/SKILL.md`

Covers:
- MVC pattern implementation
- Model layer (Prisma operations, Zod validation)
- Controller layer (server components, data fetching)
- View layer (client components)
- API routes (auth, validation, error handling)
- Database import pattern: `import prisma from '#prisma'`

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
- Prisma client singleton pattern
- Schema design best practices
- Migrations workflow
- Query patterns (CRUD, relations, aggregations)
- Transactions
- Performance optimization

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
│   ├── lib/              # Utilities (auth, etc.)
│   └── test/             # Test utilities
├── prisma/
│   ├── schema.prisma     # Database schema
│   └── db.ts             # Prisma singleton
├── .claude/              # Claude Code infrastructure
│   ├── skills/           # Development guidelines
│   ├── agents/           # Code review agents
│   ├── hooks/            # Automation hooks
│   └── commands/         # Slash commands
└── docker-compose.yml    # PostgreSQL service
```

## Claude Code Features

### Skills (Auto-activated)
- `/backend-dev-guidelines`: MVC patterns, models, API routes
- `/frontend-dev-guidelines`: MUI components, TypeScript
- `/film-platform-guidelines`: Domain knowledge
- `/database-guidelines`: Prisma best practices
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

### Core Models
```prisma
Producer  → Films → Campaigns → CampaignMetrics
```

- **Producer**: Platform users (film producers)
- **Film**: Film catalog with metadata
- **Campaign**: Advertising campaigns
- **CampaignMetric**: Daily performance data

See `prisma/schema.prisma` for complete schema.

## Getting Started

1. **Install dependencies**: `yarn install`
2. **Start database**: `docker compose up -d`
3. **Run migrations**: `npx prisma migrate dev`
4. **Start dev server**: `yarn dev`
5. **Open browser**: http://localhost:3000

## Additional Resources

- **Skills**: Detailed guidelines in `.claude/skills/`
- **README**: Setup and usage in `README.md`
- **Next.js Docs**: https://nextjs.org/docs
- **MUI Docs**: https://mui.com
- **Prisma Docs**: https://www.prisma.io/docs

---

**Remember**: Follow MVC strictly, validate all inputs, always take the most secure option (never handle production credentials locally), and keep UX simple for non-technical film producers. Detailed implementation guidelines are in the Claude Code skills.
