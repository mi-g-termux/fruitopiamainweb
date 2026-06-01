# Fruitopia Ecommerce Script — Complete Installation Guide

This package includes the installer and payment-safety fixes.

## What was fixed in this update

- **Installer check fixed:** the installer now checks for `firebase-config.json` at both:
  - `/firebase-config.json`
  - `/public/firebase-config.json`
- **cPanel/source install path clarified:** if your files are inside `public_html`, place the config at:
  - `public_html/public/firebase-config.json`
- **No false install success:** installation will not continue until a real, valid Firebase config file is reachable.
- **Payment safety fixed:** automatic gateways no longer confirm orders when credentials are missing or invalid. If bKash, PayPal, Stripe, Nagad, SSLCommerz, Razorpay, Paytm, UPI, JazzCash, Easypaisa, or PayFast is not configured correctly, checkout shows a payment failed/configuration error and **does not create a paid order**.

---

## 1. Requirements

- Node.js 18+ or 20+
- npm
- A Firebase project
- A hosting platform: Vercel, Render, Netlify, cPanel, or VPS

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

Build static files:

```bash
npm run build
```

Start production server:

```bash
npm start
```

---

## 2. Firebase setup from zero

### Step 1 — Create Firebase project

1. Go to <https://console.firebase.google.com>
2. Click **Add project**
3. Enter a project name
4. Google Analytics is optional; you can disable it
5. Create the project

### Step 2 — Create Firestore database

1. Open your Firebase project
2. Go to **Build → Firestore Database**
3. Click **Create database**
4. Choose **Production mode**
5. Select the region closest to your customers
6. Create database

### Step 3 — Add Firestore rules

1. Go to **Firestore Database → Rules**
2. Open the included file: `firebase-firestore-rules-tab.json`
3. Copy all text from that file
4. Paste it into the Firebase Rules tab
5. Click **Publish**

If you prefer Firebase CLI, this package also includes `firestore.rules`.

### Step 4 — Enable Authentication

1. Go to **Build → Authentication**
2. Click **Get started**
3. Enable **Email/Password**
4. Enable **Google** if you want Google login
5. For Google login, add your support email and save

### Step 5 — Create Firebase Web App

1. Go to **Project settings → General**
2. Scroll to **Your apps**
3. Click the Web icon: `</>`
4. Register app name, for example: `Fruitopia Store`
5. Do not enable Firebase Hosting unless you want it
6. Copy these values from the Firebase config:

```js
apiKey
authDomain
projectId
storageBucket
messagingSenderId
appId
```

You will paste these into the installer.

---

## 3. Installer flow and firebase-config.json

On first website load, the installer appears if `firebase-config.json` is missing.

The installer only finishes when it confirms the config file exists and is valid.

### Correct config file locations

For normal Vite/static builds, the file should be reachable as:

```text
https://your-domain.com/firebase-config.json
```

For cPanel/source installs, place it here:

```text
public_html/public/firebase-config.json
```

The updated script checks both:

```text
/firebase-config.json
/public/firebase-config.json
```

### Important

Do not mark installation successful manually. If the file is missing, customers on other browsers/devices will see installer problems.

---

## 4. cPanel installation

1. Upload the project to your hosting account.
2. Put source files under your app folder. If the app is directly under `public_html`, keep the project `public` folder as:

```text
public_html/public/
```

3. In cPanel, open **Setup Node.js App**.
4. Create app:
   - Node version: 18+ or 20+
   - Startup file: `server.ts`
   - Application mode: Production
5. Open Terminal or SSH and run:

```bash
npm install
npm run build
npm start
```

6. Open your domain.
7. Complete the installer.
8. If the installer downloads `firebase-config.json`, upload it to:

```text
public_html/public/firebase-config.json
```

9. Click **Verify Upload** in the installer.

---

## 5. VPS installation

Example Ubuntu VPS:

```bash
sudo apt update
sudo apt install nodejs npm nginx -y
npm install
npm run build
npm start
```

Recommended with PM2:

```bash
npm install -g pm2
pm2 start "npm start" --name fruitopia
pm2 save
pm2 startup
```

Nginx reverse proxy example:

```nginx
server {
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3005;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Then install SSL with Certbot.

---

## 6. Vercel installation

1. Push the project to GitHub.
2. Import into Vercel.
3. Build command:

```bash
npm run build
```

4. Output directory:

```text
dist
```

5. Add Firebase environment variables in Vercel → Project Settings → Environment Variables:

```text
FIREBASE_API_KEY
FIREBASE_AUTH_DOMAIN
FIREBASE_PROJECT_ID
FIREBASE_STORAGE_BUCKET
FIREBASE_MESSAGING_SENDER_ID
FIREBASE_APP_ID
FIREBASE_DATABASE_ID

VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_FIREBASE_DATABASE_ID
```

6. Redeploy.

Vercel has a read-only runtime filesystem, so use environment variables instead of relying on the server writing `firebase-config.json`.

---

## 7. Render installation

1. Create a new **Web Service** on Render.
2. Connect your GitHub repo.
3. Build command:

```bash
npm install && npm run build
```

4. Start command:

```bash
npm start
```

5. Add environment variables if you do not want to use installer upload.
6. Deploy.

### Render SMTP warning

Render free services can have limitations with outbound SMTP ports depending on provider and plan. If SMTP email does not send on Render free tier, use a proper email API provider or deploy on VPS/cPanel where SMTP ports are available.

---

## 8. Netlify installation

Netlify is best for static frontend hosting. This script has backend API routes for payments/email, so you need one of these:

- Deploy full app on Vercel/Render/VPS/cPanel instead, or
- Use Netlify for frontend and proxy `/api/*` to a backend server.

Build command:

```bash
npm run build
```

Publish directory:

```text
dist
```

If using Netlify only, automatic payments and emails will not work unless `/api/*` is connected to a real Node backend.

---

## 9. Payment setup safety

Automatic payment methods must have real credentials in the admin panel.

If credentials are missing or invalid, checkout now shows an error and does not confirm the order as paid.

Configure from:

```text
/admin → Settings → Checkout / Payment Channels
```

Required examples:

- **bKash Auto:** App Key, App Secret, Username, Password
- **PayPal:** Client ID, Client Secret
- **Stripe:** Publishable Key, Secret Key
- **Nagad Auto:** Merchant ID, Private Key
- **SSLCommerz:** Store ID, Store Password
- **Razorpay:** Key ID, Key Secret
- **Paytm:** Merchant ID, Merchant Key
- **JazzCash:** Merchant ID, Password, Integrity Salt
- **Easypaisa:** Store ID, Hash Key
- **PayFast:** Merchant ID, Merchant Key
- **UPI:** UPI ID/VPA

Never enable an automatic gateway without credentials.

---

## 10. Admin login

After installation, open:

```text
/admin
```

Use the admin username/password you created in the installer.

---

## 11. Reinstall or reset

To reinstall, remove old config and lock files:

```bash
rm -f public/firebase-config.json public/install-helper.lock dist/firebase-config.json dist/install-helper.lock
```

Then restart the app and open `/install?reset=1`.

---

## 12. Troubleshooting

### Installer says config missing

Check these URLs in browser:

```text
https://your-domain.com/firebase-config.json
https://your-domain.com/public/firebase-config.json
```

At least one must show JSON with your Firebase keys.

### Firestore permission error

Make sure you copied and published `firebase-firestore-rules-tab.json` into Firebase → Firestore → Rules.

### Payment goes to failed

Check that the selected payment gateway is enabled and all required credentials are filled in admin panel.

### Email not sending

Check SMTP host, port, username, password. On Render free tier, SMTP port support may be limited.

---

## 13. Security notes

- Do not hardcode private payment secret keys in frontend code.
- Keep Firebase rules published.
- Disable unused payment methods.
- Test every automatic gateway in sandbox/test mode before enabling live mode.
