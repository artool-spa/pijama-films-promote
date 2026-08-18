# Backend Development Guidelines

## Overview
This skill provides guidelines for backend development in the Pijama Films platform, focusing on the MVC pattern, database operations, API routes, and server-side logic.

## MVC Architecture Pattern

### Model Layer (`/src/models/`)
- **Purpose**: Handle all database operations
- **Location**: `/src/models/[entity].ts`
- **Responsibilities**:
  - Database CRUD operations
  - Data validation with Zod schemas
  - Complex queries and aggregations
  - Business logic related to data

**✅ CORRECT Model Pattern:**
```typescript
// src/models/film.ts
import { adminDb } from '@/lib/firebase/admin';
import { COLLECTIONS, docData, sanitize } from '@/lib/firestore';
import { z } from 'zod';

export const FilmSchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  duration: z.number().int().positive(),
  year: z.number().int().min(1900),
  genre: z.array(z.string()),
  director: z.string(),
});

export type FilmInput = z.infer<typeof FilmSchema>;

function films() {
  return adminDb().collection(COLLECTIONS.films);
}

export async function getFilmById(id: string) {
  const snap = await films().doc(id).get();
  const film = docData(snap);

  if (!film) return null;

  // Firestore has no joins: related documents are loaded explicitly.
  return { ...film, campaigns: await campaignsOfFilm(id) };
}

export async function createFilm(producerId: string, data: FilmInput) {
  const validated = FilmSchema.parse(data);

  const ref = films().doc();
  const document = { ...sanitize(validated), producerId, createdAt: new Date() };

  await ref.set(document);

  return { id: ref.id, ...document };
}
```

**❌ WRONG - Firestore access in API route:**
```typescript
// DON'T DO THIS
import { getFirestore } from 'firebase-admin/firestore';

export async function GET() {
  const films = await getFirestore().collection('films').get(); // ❌ Wrong!
  return Response.json(films);
}
```

### Controller Layer (`/src/app/**/page.tsx`)
- **Purpose**: Server components that fetch data and handle routing
- **Type**: Async server components
- **Responsibilities**:
  - Import and call model functions directly
  - Authentication/authorization checks
  - Error handling with `notFound()`
  - Pass clean, non-nullable data to client components

**✅ CORRECT Controller Pattern:**
```typescript
// src/app/films/[id]/page.tsx
import { notFound } from 'next/navigation';
import { getFilmById } from '@/models/film';
import FilmDetailClient from './client';

export default async function FilmDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const film = await getFilmById(params.id);

  if (!film) {
    notFound(); // ✅ Handle 404 at server level
  }

  return <FilmDetailClient film={film} />; // ✅ Non-nullable prop
}
```

**❌ WRONG - Calling API route from server component:**
```typescript
// DON'T DO THIS
export default async function FilmDetailPage() {
  const res = await fetch('http://localhost:3000/api/films/123'); // ❌ Wrong!
  const film = await res.json();
  return <FilmDetailClient film={film} />;
}
```

### View Layer (`/src/app/**/client.tsx`)
- **Purpose**: Client components that handle UI and interactions
- **Type**: Client components (`'use client'`)
- **Responsibilities**:
  - Rendering UI
  - User interactions
  - Form submissions
  - Calling API routes for mutations

**✅ CORRECT Client Component:**
```typescript
// src/app/films/[id]/client.tsx
'use client';

import type { Film } from '@/models/film';
import { Box, Typography, Button } from '@mui/material';

type Props = {
  film: Film; // ✅ Non-nullable
};

export default function FilmDetailClient({ film }: Props) {
  const handlePublish = async () => {
    await fetch(`/api/films/${film.id}/publish`, { method: 'POST' });
  };

  return (
    <Box>
      <Typography variant="h4">{film.title}</Typography>
      <Button onClick={handlePublish}>Publicar</Button>
    </Box>
  );
}
```

## API Routes (`/src/app/api/`)

### Structure
- **Location**: `/src/app/api/[resource]/route.ts`
- **Methods**: GET, POST, PUT, DELETE
- **Responsibilities**:
  - Request validation with Zod
  - Authentication verification
  - Call model functions (NOT Firestore directly)
  - Response formatting

**✅ CORRECT API Route:**
```typescript
// src/app/api/films/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { FilmSchema, createFilm, getAllFilms } from '@/models/film';
import { verifyAuth } from '@/lib/auth';

export async function GET() {
  const films = await getAllFilms(); // ✅ Use model function
  return NextResponse.json(films);
}

export async function POST(req: NextRequest) {
  const { userId } = await verifyAuth(req);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const result = FilmSchema.safeParse(body);

  if (!result.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: result.error.flatten() },
      { status: 400 }
    );
  }

  const film = await createFilm(userId, result.data); // ✅ Use model function
  return NextResponse.json(film, { status: 201 });
}
```

## Validation with Zod

### Guidelines
- Define schemas in model files
- Use `.parse()` for errors that should throw
- Use `.safeParse()` for user input validation
- Export schemas for reuse in API routes

```typescript
import { z } from 'zod';

export const CampaignSchema = z.object({
  name: z.string().min(1).max(100),
  budget: z.number().positive(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
  filmId: z.string().cuid(),
});

export type CampaignInput = z.infer<typeof CampaignSchema>;
```

## Error Handling

### Server Components
```typescript
import { notFound } from 'next/navigation';

const data = await getDataById(id);
if (!data) {
  notFound(); // ✅ Proper Next.js 404
}
```

### API Routes
```typescript
try {
  const data = await someOperation();
  return NextResponse.json(data);
} catch (error) {
  console.error('Error:', error);
  return NextResponse.json(
    { error: 'Internal server error' },
    { status: 500 }
  );
}
```

## Database Import Pattern

**✅ CORRECT:**
```typescript
import { adminDb } from '@/lib/firebase/admin';           // ✅ Shared singleton
import { COLLECTIONS, docData, sanitize } from '@/lib/firestore';
```

**❌ WRONG:**
```typescript
import { getFirestore, initializeApp } from 'firebase-admin/firestore'; // ❌ Don't
const db = getFirestore(initializeApp());                 // ❌ initialise your own app
```

## Language Conventions
- **Code**: English (variables, functions, comments)
- **UI Messages**: Spanish (user-facing text)
- **Error Messages**: English (logs), Spanish (user-facing)

## Key Rules
1. Never use Prisma client directly in API routes - always use model functions
2. Server components call model functions directly, not API routes
3. Handle 404 errors at server level with `notFound()`
4. Never pass nullable data to client components
5. All user input must be validated with Zod
6. Import prisma as default: `import prisma from '#prisma'`
