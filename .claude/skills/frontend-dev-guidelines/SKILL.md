# Frontend Development Guidelines

## Overview
This skill provides guidelines for frontend development in the Pijama Films platform, focusing on MUI components, client components, TypeScript patterns, and UI best practices.

## Client Components

### Basic Structure
All interactive components must use the `'use client'` directive.

**✅ CORRECT:**
```typescript
'use client';

import { useState } from 'react';
import { Box, Button } from '@mui/material';

export default function FilmCard() {
  const [liked, setLiked] = useState(false);

  return (
    <Box>
      <Button onClick={() => setLiked(!liked)}>
        {liked ? 'Unlike' : 'Like'}
      </Button>
    </Box>
  );
}
```

**❌ WRONG - Missing 'use client':**
```typescript
import { useState } from 'react'; // ❌ Will error without 'use client'

export default function FilmCard() {
  const [liked, setLiked] = useState(false); // ❌ Hooks need client component
  // ...
}
```

## MUI Components

### Grid Layout
Use the Grid component from MUI Material for responsive layouts.

**✅ CORRECT - Grid Usage:**
```typescript
import { Grid, Box } from '@mui/material';

export default function FilmGallery() {
  return (
    <Grid container spacing={3}>
      <Grid item xs={12} sm={6} md={4}>
        <Box>Film Card 1</Box>
      </Grid>
      <Grid item xs={12} sm={6} md={4}>
        <Box>Film Card 2</Box>
      </Grid>
      <Grid item xs={12} sm={6} md={4}>
        <Box>Film Card 3</Box>
      </Grid>
    </Grid>
  );
}
```

**Important Notes:**
- Import: `import { Grid } from '@mui/material'` or `import Grid from '@mui/material/Grid'`
- Use `container` prop for the parent Grid
- Use `item` prop for grid items
- Use breakpoint props: `xs`, `sm`, `md`, `lg`, `xl` with numeric values (1-12 column system)
- Use `spacing` prop for gaps between items (values 0-10)

### Common MUI Components

**Box - Layout Container:**
```typescript
import { Box } from '@mui/material';

<Box
  sx={{
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    p: 3, // padding
    bgcolor: 'background.paper',
  }}
>
  {children}
</Box>
```

**Typography - Text Elements:**
```typescript
import { Typography } from '@mui/material';

<Typography variant="h4" component="h1" gutterBottom>
  Título de la Película
</Typography>
<Typography variant="body1" color="text.secondary">
  Descripción de la película...
</Typography>
```

**Button:**
```typescript
import { Button } from '@mui/material';

<Button variant="contained" color="primary" onClick={handleClick}>
  Publicar Película
</Button>
```

**Card:**
```typescript
import { Card, CardContent, CardMedia, CardActions } from '@mui/material';

<Card>
  <CardMedia
    component="img"
    height="300"
    image={film.posterUrl}
    alt={film.title}
  />
  <CardContent>
    <Typography variant="h5">{film.title}</Typography>
  </CardContent>
  <CardActions>
    <Button size="small">Ver Detalles</Button>
  </CardActions>
</Card>
```

## TypeScript Patterns

### Explicit Types
Always use explicit types for props and state.

**✅ CORRECT:**
```typescript
import { Film } from '@prisma/client';

type FilmCardProps = {
  film: Film;
  onEdit: (id: string) => void;
  showActions?: boolean;
};

export default function FilmCard({ film, onEdit, showActions = true }: FilmCardProps) {
  // ...
}
```

**❌ WRONG - Implicit types:**
```typescript
export default function FilmCard({ film, onEdit }) { // ❌ No types
  // ...
}
```

### State Types
```typescript
const [isLoading, setIsLoading] = useState<boolean>(false);
const [films, setFilms] = useState<Film[]>([]);
const [selectedFilm, setSelectedFilm] = useState<Film | null>(null);
```

## Form Handling

### Controlled Inputs
```typescript
'use client';

import { useState, FormEvent } from 'react';
import { TextField, Button, Box } from '@mui/material';

export default function FilmForm() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const response = await fetch('/api/films', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description }),
    });

    if (response.ok) {
      // Handle success
    }
  };

  return (
    <Box component="form" onSubmit={handleSubmit}>
      <TextField
        fullWidth
        label="Título"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
        margin="normal"
      />
      <TextField
        fullWidth
        label="Descripción"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        multiline
        rows={4}
        margin="normal"
      />
      <Button type="submit" variant="contained" color="primary">
        Guardar
      </Button>
    </Box>
  );
}
```

## Responsive Design

### Breakpoints
```typescript
<Box
  sx={{
    fontSize: { xs: '14px', sm: '16px', md: '18px' },
    padding: { xs: 2, md: 4 },
    display: { xs: 'block', md: 'flex' },
  }}
>
```

### Grid Responsive Patterns
```typescript
<Grid container spacing={2}>
  <Grid item xs={12} md={8}>
    {/* Main content - full width on mobile, 2/3 on desktop */}
  </Grid>
  <Grid item xs={12} md={4}>
    {/* Sidebar - full width on mobile, 1/3 on desktop */}
  </Grid>
</Grid>
```

## Component Organization

### File Structure
```
src/components/
  ├── FilmCard.tsx
  ├── CampaignCard.tsx
  ├── Header.tsx
  ├── Footer.tsx
  ├── theme.ts
  ├── ThemeRegistry.tsx
  └── EmotionCache.tsx
```

### Naming Conventions
- **Components**: PascalCase (e.g., `FilmCard`, `CampaignList`)
- **Functions**: camelCase (e.g., `handleSubmit`, `fetchFilms`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `MAX_FILE_SIZE`)
- **Props Types**: `[ComponentName]Props` (e.g., `FilmCardProps`)

## Theme Usage

### Accessing Theme
```typescript
import { useTheme } from '@mui/material/styles';

export default function MyComponent() {
  const theme = useTheme();

  return (
    <Box sx={{ color: theme.palette.primary.main }}>
      Content
    </Box>
  );
}
```

### Using sx Prop
```typescript
<Box
  sx={{
    bgcolor: 'background.paper',
    color: 'text.primary',
    borderRadius: 1,
    p: 2,
    '&:hover': {
      bgcolor: 'action.hover',
    },
  }}
>
```

## Loading States

```typescript
'use client';

import { useState, useEffect } from 'react';
import { CircularProgress, Box } from '@mui/material';

export default function FilmList() {
  const [loading, setLoading] = useState(true);
  const [films, setFilms] = useState([]);

  useEffect(() => {
    fetch('/api/films')
      .then(res => res.json())
      .then(data => {
        setFilms(data);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" p={4}>
        <CircularProgress />
      </Box>
    );
  }

  return <>{/* Render films */}</>;
}
```

## Language Conventions
- **Component names**: English
- **Function names**: English
- **UI text**: Spanish
- **Comments**: English

## Key Rules
1. Always use `'use client'` for interactive components
2. Import Grid from `@mui/material/Grid`
3. Use explicit TypeScript types for all props
4. Use MUI's sx prop for styling
5. Follow functional component patterns with hooks
6. Spanish for all user-facing text
7. Use theme values instead of hardcoded colors
