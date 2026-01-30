# Pijama Films

Platform for indie film producers to advertise their films on streaming rental services.

## Overview

Pijama Films is a web platform designed for independent film producers with limited digital marketing knowledge. It provides simple, intuitive tools to:

- Manage film catalog
- Create and track advertising campaigns
- Monitor performance metrics
- Analyze campaign ROI

## Tech Stack

- **Frontend**: Next.js 16, React 19, MUI 7.3
- **Backend**: Next.js API Routes, Prisma ORM
- **Database**: PostgreSQL 16
- **Testing**: Vitest
- **Package Manager**: Yarn
- **Deployment**: Docker

## Prerequisites

- Node.js 22+
- Yarn 1.22+
- Docker and Docker Compose
- PostgreSQL 16 (via Docker)

## Getting Started

### 1. Clone and Install

```bash
git clone <repository-url>
cd pijama-films
yarn install
```

### 2. Environment Setup

Copy the example environment file:

```bash
cp .env.example .env
```

Update `.env` with your configuration:

```env
DATABASE_URL="postgresql://pijama:pijama@localhost:5432/pijama_films?schema=public"
JWT_SECRET_KEY="your_secret_key_here"
JWT_EXPIRATION_TIME="7d"
```

### 3. Start Database

```bash
docker compose up -d
```

### 4. Run Migrations

```bash
npx prisma generate
npx prisma migrate dev
```

### 5. Start Development Server

```bash
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Development

### Available Commands

```bash
# Development
yarn dev              # Start dev server
yarn build            # Build for production
yarn start            # Start production server

# Code Quality
yarn lint             # Run ESLint
yarn test             # Run tests
yarn test:watch       # Run tests in watch mode
yarn test:coverage    # Run tests with coverage

# Database
npx prisma studio     # Open Prisma Studio
npx prisma generate   # Generate Prisma client
npx prisma migrate dev --name [name]  # Create migration
```

### Project Structure

```
src/
├── app/              # Next.js App Router
│   ├── api/          # API routes
│   └── [feature]/    # Feature pages
├── models/           # Database operations
├── components/       # Shared UI components
├── lib/              # Utilities
└── test/             # Test utilities

prisma/
├── schema.prisma     # Database schema
└── db.ts             # Prisma client

.claude/              # Claude Code infrastructure
├── agents/           # Specialized agents
├── skills/           # Development guidelines
├── hooks/            # Automation hooks
└── commands/         # Slash commands
```

## Architecture

This project follows the **MVC pattern**:

- **Models** (`src/models/`): Database operations with Prisma
- **Controllers** (`src/app/**/page.tsx`): Server components that fetch data
- **Views** (`src/app/**/client.tsx`): Client components for UI

See [CLAUDE.md](./CLAUDE.md) for detailed architecture guidelines.

## Core Features

### Film Management
- Add and edit film details
- Upload posters and trailers
- Publish films to catalog

### Campaign Management
- Create advertising campaigns
- Set budgets and schedules
- Link campaigns to films

### Analytics
- Track impressions, clicks, conversions
- Monitor campaign performance
- Calculate ROI

## Testing

```bash
# Run all tests
yarn test

# Run tests in watch mode
yarn test:watch

# Run tests with UI
yarn test:ui

# Generate coverage report
yarn test:coverage
```

Tests are located in `__tests__` directories next to the code they test.

## Docker Deployment

### Build Docker Image

```bash
docker build -t pijama-films .
```

### Run with Docker Compose

```bash
docker compose up
```

This starts:
- PostgreSQL database on port 5432
- Next.js application on port 3000

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://pijama:pijama@localhost:5432/pijama_films` |
| `JWT_SECRET_KEY` | Secret key for JWT tokens | Required |
| `JWT_EXPIRATION_TIME` | JWT token expiration | `7d` |

## Database Schema

### Core Models

- **Producer**: Film producers (platform users)
- **Film**: Film catalog entries
- **Campaign**: Advertising campaigns
- **CampaignMetric**: Daily performance metrics

See `prisma/schema.prisma` for complete schema.

## Contributing

1. Follow the MVC architecture pattern
2. Validate all inputs with Zod
3. Write tests for new features
4. Use TypeScript strict mode
5. Code in English, UI in Spanish
6. See [CLAUDE.md](./CLAUDE.md) for full guidelines

## Code Style

- **TypeScript**: Strict mode, explicit types
- **Naming**: PascalCase for components, camelCase for functions
- **Language**: English code, Spanish UI
- **Formatting**: Run `yarn lint` before committing

## Troubleshooting

### Database Connection Error

Ensure PostgreSQL is running:

```bash
docker compose up -d
```

### Prisma Client Not Found

Generate the Prisma client:

```bash
npx prisma generate
```

### Port 3000 Already in Use

Change the port in `.env`:

```env
PORT=3001
```

## License

Private project - All rights reserved

## Support

For questions or issues, please contact the development team.
