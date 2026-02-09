'use client';

import {
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Divider,
  Box,
} from '@mui/material';
import {
  Movie as MovieIcon,
  Analytics as AnalyticsIcon,
  Drafts as DraftsIcon,
  AccountBalanceWallet as AccountBalanceWalletIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';
import { useRouter, usePathname } from 'next/navigation';
import Image from 'next/image';

const drawerWidth = 240;

const menuItems = [
  { text: 'My Films', icon: <MovieIcon />, path: '/films' },
  { text: 'Drafts', icon: <DraftsIcon />, path: '/campaigns/drafts' },
  { text: 'Results', icon: <AnalyticsIcon />, path: '/campaigns' },
  { text: 'My Account', icon: <AccountBalanceWalletIcon />, path: '/account' },
];

const settingsItems = [
  { text: 'Settings', icon: <SettingsIcon />, path: '/settings' },
];

function isSelected(pathname: string, itemPath: string, allPaths: string[]): boolean {
  if (pathname === itemPath) return true;
  if (!pathname.startsWith(itemPath + '/') && !pathname.startsWith(itemPath + '?')) return false;
  // Don't match if a more specific path also matches (e.g. /campaigns vs /campaigns/drafts)
  return !allPaths.some(p => p !== itemPath && p.startsWith(itemPath) && pathname.startsWith(p));
}

export default function NavigationDrawer() {
  const router = useRouter();
  const pathname = usePathname();
  const allMenuPaths = menuItems.map(i => i.path);

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: drawerWidth,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: drawerWidth,
          boxSizing: 'border-box',
        },
      }}
    >
      <Toolbar>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
          <Image
            src="/logo_pijama.png"
            alt="Pijama Films"
            width={120}
            height={48}
            style={{ objectFit: 'contain' }}
          />
        </Box>
      </Toolbar>
      <Divider />
      <Box sx={{ overflow: 'auto' }}>
        <List>
          {menuItems.map((item) => (
            <ListItem key={item.text} disablePadding>
              <ListItemButton
                selected={isSelected(pathname, item.path, allMenuPaths)}
                onClick={() => router.push(item.path)}
              >
                <ListItemIcon>{item.icon}</ListItemIcon>
                <ListItemText primary={item.text} />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
        <Divider />
        <List>
          {settingsItems.map((item) => (
            <ListItem key={item.text} disablePadding>
              <ListItemButton
                selected={pathname === item.path || pathname.startsWith(item.path + '/')}
                onClick={() => router.push(item.path)}
              >
                <ListItemIcon>{item.icon}</ListItemIcon>
                <ListItemText primary={item.text} />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </Box>
    </Drawer>
  );
}
