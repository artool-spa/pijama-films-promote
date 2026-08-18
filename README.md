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
- **Backend**: Next.js API Routes, Cloud Firestore (Firebase Admin SDK)
- **Database**: Cloud Firestore
- **Testing**: Vitest
- **Package Manager**: Yarn
- **Deployment**: Docker

## Prerequisites

- Node.js 22+
- Yarn 1.22+
- Docker and Docker Compose
- A Google Cloud project with Firestore enabled

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
FIREBASE_PROJECT_ID="pijama-promote-firebase"
SESSION_SECRET="generate with: openssl rand -base64 48"
```

### 3. Authenticate

The Firebase Admin SDK uses Application Default Credentials:

```bash
gcloud auth application-default login
```

### 4. Start Development Server

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
npm run deploy:firestore              # Deploy rules, indexes and the TTL policy
npm run firestore:import-partners     # Import partner records from a JSON export
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

firestore.rules       # Security rules
firestore.indexes.json # Composite indexes

.claude/              # Claude Code infrastructure
├── agents/           # Specialized agents
├── skills/           # Development guidelines
├── hooks/            # Automation hooks
└── commands/         # Slash commands
```

## Architecture

This project follows the **MVC pattern**:

- **Models** (`src/models/`): Database operations with Firestore
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

### Run with Docker

```bash
docker build -t pijama-films . && docker run -p 3000:3000 pijama-films
```

The database is managed Firestore, so nothing else needs to run locally; the
container authenticates with Application Default Credentials.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `FIREBASE_PROJECT_ID` | Project holding Firestore and Auth | Required |
| `JWT_SECRET_KEY` | Secret key for JWT tokens | Required |
| `JWT_EXPIRATION_TIME` | JWT token expiration | `7d` |

## Database Schema

### Core Models

- **Producer**: Film producers (platform users)
- **Film**: Film catalog entries
- **Campaign**: Advertising campaigns
- **CampaignMetric**: Daily performance metrics

See `docs/firestore-migration.md` for the complete Firestore layout.

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

Check that Application Default Credentials are present and point at the right
project:

```bash
gcloud auth application-default login
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
