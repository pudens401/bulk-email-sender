# Bulk Email Sender

Local Gmail bulk email sender built with Node.js, Express, and EJS.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Build Tailwind CSS:
```bash
npx tailwindcss -i ./public/css/input.css -o ./public/css/output.css --watch
```

3. Start the server:
```bash
npm start
```

4. Open browser:
```
http://localhost:3210
```

## Features

- Gmail SMTP with App Password
- CSV upload for recipients
- Rich text editor for email composition
- HTML preview before sending
- Live progress tracking
- Session-based (no database)

## Gmail Setup

1. Enable 2FA on your Gmail account
2. Generate App Password: https://myaccount.google.com/apppasswords
3. Use the 16-character app password in the SMTP setup
