'use client';

import { Box, Container, Typography, Paper } from '@mui/material';
import Footer from '@/components/Footer';

export default function PrivacyPolicyClient() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Container maxWidth="md" sx={{ py: 4, flex: 1 }}>
        <Paper sx={{ p: 4 }}>
          <Typography variant="h3" component="h1" gutterBottom>
            Privacy Policy
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
            Last updated: January 2026
          </Typography>

          <Section title="1. Introduction">
            Welcome to Pijama Films. We respect your privacy and are committed to protecting your
            personal data. This privacy policy explains how we collect, use, and safeguard your
            information when you use our platform.
          </Section>

          <Section title="2. Information We Collect">
            We collect information you provide directly to us, including:
            {'\n\n'}
            - Account information (name, email, password)
            {'\n'}
            - Film and campaign data you upload
            {'\n'}
            - Usage data and analytics
            {'\n'}
            - Communications with our support team
          </Section>

          <Section title="3. How We Use Your Information">
            We use the information we collect to:
            {'\n\n'}
            - Provide, maintain, and improve our services
            {'\n'}
            - Process your transactions and manage your campaigns
            {'\n'}
            - Send you technical notices and support messages
            {'\n'}
            - Respond to your comments and questions
          </Section>

          <Section title="4. Information Sharing">
            We do not sell, trade, or rent your personal information to third parties. We may share
            your information only in the following circumstances:
            {'\n\n'}
            - With your consent
            {'\n'}
            - To comply with legal obligations
            {'\n'}
            - To protect our rights and prevent fraud
          </Section>

          <Section title="5. Data Security">
            We implement appropriate technical and organizational measures to protect your personal
            data against unauthorized access, alteration, disclosure, or destruction.
          </Section>

          <Section title="6. Cookies">
            We use cookies and similar tracking technologies to track activity on our platform and
            hold certain information. You can instruct your browser to refuse all cookies or to
            indicate when a cookie is being sent.
          </Section>

          <Section title="7. Your Rights">
            You have the right to:
            {'\n\n'}
            - Access your personal data
            {'\n'}
            - Correct inaccurate data
            {'\n'}
            - Request deletion of your data
            {'\n'}
            - Object to processing of your data
            {'\n'}
            - Data portability
          </Section>

          <Section title="8. Contact Information">
            If you have any questions about this Privacy Policy, please contact us at:
            {'\n\n'}
            Email: privacy@pijamafilms.com
          </Section>
        </Paper>
      </Container>
      <Footer />
    </Box>
  );
}

type SectionProps = {
  title: string;
  children: React.ReactNode;
};

function Section({ title, children }: SectionProps) {
  return (
    <Box sx={{ mb: 4 }}>
      <Typography variant="h5" component="h2" gutterBottom>
        {title}
      </Typography>
      <Typography variant="body1" sx={{ whiteSpace: 'pre-line' }}>
        {children}
      </Typography>
    </Box>
  );
}
