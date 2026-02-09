'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Container,
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Button,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  CircularProgress,
  ToggleButtonGroup,
  ToggleButton,
  Divider,
} from '@mui/material';
import {
  AccountBalanceWallet as WalletIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import type { AccountWithTransactions } from '@/models/account';
import { calculateWorstCaseFee, calculateTotalCharge } from '@/lib/stripe/fees';

type AccountClientProps = {
  account: AccountWithTransactions;
  paymentStatus: string | null;
  sessionId: string | null;
};

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  DEPOSIT: 'Deposit',
  CAMPAIGN_CHARGE: 'Charge',
  CAMPAIGN_REFUND: 'Refund',
  ADJUSTMENT: 'Adjustment',
};

const TRANSACTION_TYPE_COLORS: Record<string, 'success' | 'error' | 'info' | 'warning'> = {
  DEPOSIT: 'success',
  CAMPAIGN_CHARGE: 'error',
  CAMPAIGN_REFUND: 'info',
  ADJUSTMENT: 'warning',
};

const TRANSACTION_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

const PRESET_AMOUNTS = [50, 100, 250, 500, 1000];

export default function AccountClient({ account: initialAccount, paymentStatus, sessionId }: AccountClientProps) {
  const router = useRouter();
  const [account, setAccount] = useState(initialAccount);
  const [page, setPage] = useState(0);
  const [rowsPerPage] = useState(20);
  const [loading, setLoading] = useState(false);

  // Add funds modal
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedAmount, setSelectedAmount] = useState<number | null>(100);
  const [customAmount, setCustomAmount] = useState('');
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Payment verification state
  const [verifying, setVerifying] = useState(!!sessionId);
  const [verifiedStatus, setVerifiedStatus] = useState<string | null>(null);
  const [showPaymentAlert, setShowPaymentAlert] = useState(false);

  // Refresh account data after payment return
  const refreshAccount = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/account?limit=${rowsPerPage}&offset=${page * rowsPerPage}`);
      if (response.ok) {
        const data = await response.json();
        setAccount(data);
      }
    } catch (error) {
      console.error('Error refreshing account:', error);
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage]);

  useEffect(() => {
    if (!sessionId || !paymentStatus) return;

    const verifySession = async () => {
      try {
        setVerifying(true);
        const response = await fetch('/api/account/verify-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });

        if (response.ok) {
          const data = await response.json();
          setVerifiedStatus(data.status);
          setShowPaymentAlert(true);
          await refreshAccount();
        }
      } catch (error) {
        console.error('Error verifying session:', error);
      } finally {
        setVerifying(false);
      }
    };

    verifySession();
  }, [sessionId, paymentStatus, refreshAccount]);

  const handlePageChange = async (_: unknown, newPage: number) => {
    setPage(newPage);
    try {
      setLoading(true);
      const response = await fetch(`/api/account?limit=${rowsPerPage}&offset=${newPage * rowsPerPage}`);
      if (response.ok) {
        const data = await response.json();
        setAccount(data);
      }
    } catch (error) {
      console.error('Error fetching transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  const getFinalAmount = (): number => {
    if (selectedAmount) return selectedAmount;
    const parsed = parseFloat(customAmount);
    return isNaN(parsed) ? 0 : parsed;
  };

  const handleCheckout = async () => {
    const amount = getFinalAmount();
    if (amount < 5) {
      setCheckoutError('Minimum amount is $5');
      return;
    }

    setCheckoutLoading(true);
    setCheckoutError(null);

    try {
      const response = await fetch('/api/account/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Error creating checkout session');
      }

      const { url } = await response.json();
      if (url) {
        window.location.href = url;
      }
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : 'Error processing payment');
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleAmountToggle = (_: React.MouseEvent<HTMLElement>, value: number | null) => {
    setSelectedAmount(value);
    if (value) setCustomAmount('');
  };

  const handleCustomAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomAmount(e.target.value);
    setSelectedAmount(null);
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* Payment verification spinner */}
      {verifying && (
        <Alert severity="info" icon={<CircularProgress size={20} />} sx={{ mb: 3 }}>
          Verifying payment...
        </Alert>
      )}

      {/* Payment status alerts (only shown after server verification) */}
      {showPaymentAlert && verifiedStatus === 'completed' && (
        <Alert
          severity="success"
          sx={{ mb: 3 }}
          onClose={() => {
            setShowPaymentAlert(false);
            router.replace('/account', { scroll: false });
          }}
        >
          Payment processed successfully. Your balance has been updated.
        </Alert>
      )}
      {showPaymentAlert && verifiedStatus === 'cancelled' && (
        <Alert
          severity="info"
          sx={{ mb: 3 }}
          onClose={() => {
            setShowPaymentAlert(false);
            router.replace('/account', { scroll: false });
          }}
        >
          Payment cancelled. No charges were made.
        </Alert>
      )}

      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h3" component="h1" gutterBottom>
          My Account
        </Typography>
      </Box>

      {/* Balance Card */}
      <Paper sx={{ p: 4, mb: 4 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <WalletIcon sx={{ fontSize: 48, color: 'primary.main' }} />
            <Box>
              <Typography variant="body2" color="text.secondary">
                Available Balance
              </Typography>
              <Typography variant="h3" component="p" sx={{ fontWeight: 'bold' }}>
                ${account.balance.toFixed(2)}
              </Typography>
              <Typography variant="caption" color="text.secondary" textTransform="uppercase">
                {account.currency}
              </Typography>
            </Box>
          </Box>
          <Button
            variant="contained"
            size="large"
            startIcon={<AddIcon />}
            onClick={() => setModalOpen(true)}
          >
            Add Funds
          </Button>
        </Box>
      </Paper>

      {/* Transactions Table */}
      <Paper>
        <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="h6">
            Transactions
          </Typography>
        </Box>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Description</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell align="right">Balance</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                    <CircularProgress size={32} />
                  </TableCell>
                </TableRow>
              ) : account.transactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">
                      No transactions yet. Add funds to get started.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                account.transactions.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell>
                      {new Date(tx.createdAt).toLocaleDateString('en-US', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={TRANSACTION_TYPE_LABELS[tx.type] || tx.type}
                        color={TRANSACTION_TYPE_COLORS[tx.type] || 'default'}
                        size="small"
                        variant="outlined"
                      />
                      {tx.status !== 'COMPLETED' && (
                        <Chip
                          label={TRANSACTION_STATUS_LABELS[tx.status] || tx.status}
                          size="small"
                          sx={{ ml: 0.5 }}
                        />
                      )}
                    </TableCell>
                    <TableCell>{tx.description}</TableCell>
                    <TableCell
                      align="right"
                      sx={{
                        fontWeight: 'bold',
                        color: tx.amount >= 0 ? 'success.main' : 'error.main',
                      }}
                    >
                      {tx.amount >= 0 ? '+' : ''}${Math.abs(tx.amount).toFixed(2)}
                    </TableCell>
                    <TableCell align="right">
                      ${tx.balanceAfter.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={-1}
          page={page}
          onPageChange={handlePageChange}
          rowsPerPage={rowsPerPage}
          rowsPerPageOptions={[20]}
          labelDisplayedRows={({ from, to }) => `${from}–${to}`}
          slotProps={{
            actions: {
              nextButton: {
                disabled: account.transactions.length < rowsPerPage,
              },
            },
          }}
        />
      </Paper>

      {/* Add Funds Modal */}
      <Dialog
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setCheckoutError(null);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Add Funds</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Select an amount or enter a custom one. Minimum amount is $5.
          </Typography>

          {/* Preset amounts */}
          <ToggleButtonGroup
            value={selectedAmount}
            exclusive
            onChange={handleAmountToggle}
            sx={{ mb: 3, display: 'flex', flexWrap: 'wrap', gap: 1 }}
          >
            {PRESET_AMOUNTS.map((amount) => (
              <ToggleButton
                key={amount}
                value={amount}
                sx={{
                  flex: '1 1 auto',
                  minWidth: 80,
                  '&.Mui-selected': {
                    backgroundColor: '#fdd835',
                    color: 'black',
                    '&:hover': { backgroundColor: '#fbc02d' },
                  },
                }}
              >
                ${amount}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>

          {/* Custom amount */}
          <TextField
            fullWidth
            label="Custom amount"
            type="number"
            value={customAmount}
            onChange={handleCustomAmountChange}
            slotProps={{
              input: {
                startAdornment: <Typography sx={{ mr: 1 }}>$</Typography>,
              },
              htmlInput: { min: 5, step: 1 },
            }}
            helperText="Minimum $5 USD"
          />

          {/* Fee breakdown */}
          {getFinalAmount() >= 5 && (
            <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2">Deposit:</Typography>
                <Typography variant="body2">${getFinalAmount().toFixed(2)}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2" color="text.secondary">Stripe fee (estimated):</Typography>
                <Typography variant="body2" color="text.secondary">${calculateWorstCaseFee(getFinalAmount()).toFixed(2)}</Typography>
              </Box>
              <Divider sx={{ my: 1 }} />
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" fontWeight="bold">Total charge:</Typography>
                <Typography variant="body2" fontWeight="bold">${calculateTotalCharge(getFinalAmount()).toFixed(2)}</Typography>
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                If the actual fee is lower, the difference will be credited to your account.
              </Typography>
            </Box>
          )}

          {checkoutError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {checkoutError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, pt: 1, gap: 1 }}>
          <Button
            onClick={() => {
              setModalOpen(false);
              setCheckoutError(null);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleCheckout}
            disabled={checkoutLoading || getFinalAmount() < 5}
          >
            {checkoutLoading ? (
              <CircularProgress size={24} color="inherit" />
            ) : (
              `Pay $${calculateTotalCharge(getFinalAmount()).toFixed(2)} with Stripe`
            )}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
