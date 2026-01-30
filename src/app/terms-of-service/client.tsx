'use client';

import { Box, Container, Typography, Paper } from '@mui/material';
import Footer from '@/components/Footer';

export default function TermsOfServiceClient() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Container maxWidth="md" sx={{ py: 4, flex: 1 }}>
        <Paper sx={{ p: 4 }}>
          <Typography variant="h3" component="h1" gutterBottom>
            Terms of Service
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
            Last updated: January 2026
          </Typography>

          <Section title="1. Acceptance of Terms">
            By accessing or using Pijama Films, you agree to be bound by these Terms of Service. If
            you do not agree to these terms, please do not use our platform.
          </Section>

          <Section title="2. Description of Service">
            Pijama Films is an advertising platform designed for independent film producers. Our
            service allows you to create and manage advertising campaigns for your films on our
            streaming rental network.
          </Section>

          <Section title="3. User Accounts">
            To use our services, you must create an account. You are responsible for:
            {'\n\n'}
            - Maintaining the confidentiality of your account credentials
            {'\n'}
            - All activities that occur under your account
            {'\n'}
            - Providing accurate and complete information
            {'\n'}
            - Notifying us immediately of any unauthorized use
          </Section>

          <Section title="4. User Content">
            You retain ownership of all content you upload to our platform. By uploading content,
            you grant us a license to use, display, and distribute your content solely for the
            purpose of providing our services.
            {'\n\n'}
            You represent that you have all necessary rights to the content you upload.
          </Section>

          <Section title="5. Prohibited Uses">
            You agree not to:
            {'\n\n'}
            - Upload content that infringes on intellectual property rights
            {'\n'}
            - Use the platform for illegal purposes
            {'\n'}
            - Attempt to gain unauthorized access to our systems
            {'\n'}
            - Interfere with the proper working of the platform
            {'\n'}
            - Upload malicious code or harmful content
          </Section>

          <Section title="6. Intellectual Property">
            The Pijama Films platform, including its design, features, and content (excluding user
            content), is owned by Pijama Films and protected by intellectual property laws.
          </Section>

          <Section title="7. Limitation of Liability">
            To the maximum extent permitted by law, Pijama Films shall not be liable for any
            indirect, incidental, special, consequential, or punitive damages resulting from your
            use of or inability to use the service.
          </Section>

          <Section title="8. Changes to Terms">
            We reserve the right to modify these terms at any time. We will notify users of any
            material changes by posting the new terms on this page and updating the &quot;Last
            updated&quot; date.
          </Section>

          <Section title="9. Contact Information">
            If you have any questions about these Terms of Service, please contact us at:
            {'\n\n'}
            Email: legal@pijamafilms.com
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
