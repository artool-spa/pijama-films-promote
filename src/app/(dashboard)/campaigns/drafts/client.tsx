'use client';

import { useState } from 'react';
import {
  Container,
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  Card,
  CardContent,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  PlayArrow as PlayArrowIcon,
} from '@mui/icons-material';
import { useRouter } from 'next/navigation';

type DraftItem = {
  id: string;
  name: string;
  filmMuviUuid: string;
  filmTitle: string;
  budget: number;
  updatedAt: string;
};

type DraftsClientProps = {
  drafts: DraftItem[];
};

export default function DraftsClient({ drafts: initialDrafts }: DraftsClientProps) {
  const router = useRouter();
  const [drafts, setDrafts] = useState(initialDrafts);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/campaigns/${deleteId}`, { method: 'DELETE' });
      if (res.ok) {
        setDrafts((prev) => prev.filter((d) => d.id !== deleteId));
      }
    } catch (error) {
      console.error('Error deleting draft:', error);
    } finally {
      setDeleting(false);
      setDeleteId(null);
    }
  };

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h3" component="h1" gutterBottom>
          Drafts
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Campaigns saved as drafts
        </Typography>
      </Box>

      {drafts.length > 0 ? (
        <Card>
          <CardContent>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Film</TableCell>
                    <TableCell align="right">Budget</TableCell>
                    <TableCell>Last Updated</TableCell>
                    <TableCell align="center">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {drafts.map((draft) => (
                    <TableRow key={draft.id} hover>
                      <TableCell>
                        <Typography variant="body2" fontWeight="medium">
                          {draft.name}
                        </Typography>
                      </TableCell>
                      <TableCell>{draft.filmTitle}</TableCell>
                      <TableCell align="right">
                        ${draft.budget.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {new Date(draft.updatedAt).toLocaleDateString('en', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </TableCell>
                      <TableCell align="center">
                        <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1 }}>
                          <Button
                            size="small"
                            variant="contained"
                            startIcon={<PlayArrowIcon />}
                            onClick={() =>
                              router.push(
                                `/films/${draft.filmMuviUuid}/campaigns/new?draft=${draft.id}`
                              )
                            }
                          >
                            Continue
                          </Button>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => setDeleteId(draft.id)}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 6 }}>
            <Typography variant="h6" color="text.secondary" gutterBottom>
              No drafts yet
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Drafts will appear here when you save a campaign without publishing
            </Typography>
            <Button variant="contained" onClick={() => router.push('/films')}>
              Browse Films
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteId} onClose={() => setDeleteId(null)}>
        <DialogTitle>Delete Draft</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete this draft? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteId(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
