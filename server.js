const express = require('express');
const session = require('express-session');
const path = require('path');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const nodemailer = require('nodemailer');

const app = express();
const PORT = 3210;

// Multer configuration for CSV uploads
const upload = multer({ dest: 'uploads/' });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Session configuration
app.use(session({
  secret: 'bulk-email-sender-secret-key-' + Date.now(),
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Initialize session data
app.use((req, res, next) => {
  if (!req.session.smtp) {
    req.session.smtp = { email: '', appPassword: '', verified: false };
  }
  if (!req.session.recipients) {
    req.session.recipients = [];
  }
  if (!req.session.email) {
    req.session.email = { subject: '', body: '' };
  }
  if (!req.session.sending) {
    req.session.sending = { total: 0, sent: 0, failed: 0, status: 'idle', errors: [] };
  }
  next();
});

// Routes

// Home - redirect to SMTP setup
app.get('/', (req, res) => {
  res.redirect('/smtp');
});

// SMTP Setup Page
app.get('/smtp', (req, res) => {
  res.render('smtp', { 
    smtp: req.session.smtp,
    error: null,
    success: null
  });
});

// SMTP Verification
app.post('/smtp/verify', async (req, res) => {
  const { email, appPassword } = req.body;

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: email,
        pass: appPassword
      }
    });

    await transporter.verify();

    req.session.smtp = {
      email,
      appPassword,
      verified: true
    };

    res.render('smtp', {
      smtp: req.session.smtp,
      error: null,
      success: 'SMTP credentials verified successfully!'
    });
  } catch (error) {
    res.render('smtp', {
      smtp: { email, appPassword: '', verified: false },
      error: 'Failed to verify SMTP credentials. Please check your email and app password.',
      success: null
    });
  }
});

// Recipients Management Page
app.get('/recipients', (req, res) => {
  if (!req.session.smtp.verified) {
    return res.redirect('/smtp');
  }

  res.render('recipients', {
    recipients: req.session.recipients,
    error: null,
    success: null
  });
});

// CSV Upload
app.post('/recipients/upload', upload.single('csvFile'), (req, res) => {
  if (!req.file) {
    return res.render('recipients', {
      recipients: req.session.recipients,
      error: 'Please select a CSV file to upload.',
      success: null
    });
  }

  const recipients = [];
  const errors = [];

  fs.createReadStream(req.file.path)
    .pipe(csv({ headers: ['name', 'email'], skipLines: 0, mapHeaders: ({ header }) => header.toLowerCase().trim() }))
    .on('data', (row) => {
      const name = row.name?.trim();
      const email = row.email?.trim();

      if (name && email && email.includes('@')) {
        recipients.push({ name, email });
      } else if (name !== 'name' && email !== 'email') {
        errors.push(`Invalid row: ${JSON.stringify(row)}`);
      }
    })
    .on('end', () => {
      fs.unlinkSync(req.file.path);

      if (recipients.length === 0) {
        return res.render('recipients', {
          recipients: req.session.recipients,
          error: 'No valid recipients found in CSV file. Expected format: name,email',
          success: null
        });
      }

      req.session.recipients = recipients;

      res.render('recipients', {
        recipients: req.session.recipients,
        error: errors.length > 0 ? `Uploaded ${recipients.length} recipients. ${errors.length} rows skipped.` : null,
        success: `Successfully uploaded ${recipients.length} recipients.`
      });
    })
    .on('error', (error) => {
      fs.unlinkSync(req.file.path);
      res.render('recipients', {
        recipients: req.session.recipients,
        error: 'Failed to parse CSV file. Please ensure it has name,email columns.',
        success: null
      });
    });
});

// Update Recipients
app.post('/recipients/update', (req, res) => {
  const { recipients } = req.body;

  if (!recipients || !Array.isArray(recipients)) {
    return res.json({ success: false, error: 'Invalid recipient data' });
  }

  const validRecipients = recipients.filter(r => 
    r.name?.trim() && r.email?.trim() && r.email.includes('@')
  );

  req.session.recipients = validRecipients;

  res.json({ success: true, count: validRecipients.length });
});

// Email Composition Page
app.get('/compose', (req, res) => {
  if (!req.session.smtp.verified) {
    return res.redirect('/smtp');
  }

  if (req.session.recipients.length === 0) {
    return res.redirect('/recipients');
  }

  res.render('compose', {
    email: req.session.email,
    recipientCount: req.session.recipients.length
  });
});

// Save Email Composition
app.post('/compose/save', (req, res) => {
  const { subject, body } = req.body;

  req.session.email = { subject, body };

  res.json({ success: true });
});

// Preview Email
app.post('/compose/preview', (req, res) => {
  const { subject, body } = req.body;
  const sampleRecipient = req.session.recipients[0] || { name: 'Sample Name' };

  const previewSubject = subject.replace(/\{\{name\}\}/g, sampleRecipient.name);
  const previewBody = body.replace(/\{\{name\}\}/g, sampleRecipient.name);

  res.json({
    success: true,
    subject: previewSubject,
    body: previewBody
  });
});

// Send Emails Page
app.get('/send', (req, res) => {
  if (!req.session.smtp.verified) {
    return res.redirect('/smtp');
  }

  if (req.session.recipients.length === 0) {
    return res.redirect('/recipients');
  }

  if (!req.session.email.subject || !req.session.email.body) {
    return res.redirect('/compose');
  }

  res.render('send', {
    recipientCount: req.session.recipients.length,
    subject: req.session.email.subject,
    sending: req.session.sending
  });
});

// Start Sending Emails
app.post('/send/start', async (req, res) => {
  if (req.session.sending.status === 'sending') {
    return res.json({ success: false, error: 'Already sending emails' });
  }

  req.session.sending = {
    total: req.session.recipients.length,
    sent: 0,
    failed: 0,
    status: 'sending',
    errors: [],
    currentEmail: ''
  };

  res.json({ success: true });

  // Send emails in background - pass session ID
  sendEmailsInBackground(req.sessionID, req.sessionStore);
});

// SSE Progress Stream
app.get('/send/progress', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendUpdate = () => {
    const data = JSON.stringify(req.session.sending);
    res.write(`data: ${data}\n\n`);

    if (req.session.sending.status === 'completed' || req.session.sending.status === 'error') {
      res.end();
    }
  };

  const interval = setInterval(sendUpdate, 500);

  req.on('close', () => {
    clearInterval(interval);
  });
});

// Clear Session
app.post('/session/clear', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.json({ success: false, error: 'Failed to clear session' });
    }
    res.json({ success: true });
  });
});

// Background email sending function
async function sendEmailsInBackground(sessionID, sessionStore) {
  // Get session data
  sessionStore.get(sessionID, async (err, sessionData) => {
    if (err || !sessionData) {
      console.error('Failed to get session:', err);
      return;
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: sessionData.smtp.email,
        pass: sessionData.smtp.appPassword
      }
    });

    for (let i = 0; i < sessionData.recipients.length; i++) {
      const recipient = sessionData.recipients[i];

      // Update current email
      sessionData.sending.currentEmail = recipient.email;
      sessionStore.set(sessionID, sessionData);

      try {
        const personalizedSubject = sessionData.email.subject.replace(/\{\{name\}\}/g, recipient.name);
        const personalizedBody = sessionData.email.body.replace(/\{\{name\}\}/g, recipient.name);

        await transporter.sendMail({
          from: sessionData.smtp.email,
          to: recipient.email,
          subject: personalizedSubject,
          html: personalizedBody
        });

        sessionData.sending.sent++;
      } catch (error) {
        sessionData.sending.failed++;
        sessionData.sending.errors.push({
          email: recipient.email,
          error: error.message
        });
      }

      // Save progress after each email
      sessionStore.set(sessionID, sessionData);

      // Delay 1 second between emails
      if (i < sessionData.recipients.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    sessionData.sending.status = 'completed';
    sessionData.sending.currentEmail = '';
    sessionStore.set(sessionID, sessionData);
  });
}

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
