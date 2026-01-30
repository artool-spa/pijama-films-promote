'use client';

import { Card, CardContent, Typography, Box } from '@mui/material';

type StatsCardProps = {
  title: string;
  value: string | number;
  subtitle?: string;
  color?: string;
};

export default function StatsCard({ title, value, subtitle, color }: StatsCardProps) {
  return (
    <Card>
      <CardContent>
        <Typography variant="overline" color="text.secondary" gutterBottom>
          {title}
        </Typography>
        <Typography variant="h4" component="div" color={color || 'text.primary'}>
          {value}
        </Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {subtitle}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
