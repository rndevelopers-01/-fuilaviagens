# Fui Lá Excursões

## Run
- Start the app with `npm run dev` while developing.
- Run automated checks with `npm test`.
- The web server serves the public site and the private staff panel from the same origin.

## MySQL setup
- Copy `.env.example` to `.env` and fill in the MySQL host, port, database, user, and password. `.env` is ignored by Git; do not commit it or paste its contents into chat.
- Create an empty MySQL 8.0.16+ database, then run `schema.sql` against it once. The app creates its session table on startup.
- `MYSQL_SSL=true` enables TLS. `MYSQL_SSL_CA` can hold the server's PEM certificate when the provider uses a private certificate authority.
- For hosted environments, configure the same variables as environment secrets instead of committing `.env`.
- This schema creates a fresh MySQL database; it does not copy or migrate records from the previous PostgreSQL database.

## Other required configuration
- `SESSION_SECRET` — signs staff sessions.
- `STAFF_EMAIL` and `STAFF_PASSWORD` — the single staff login configured by the owner.
- `PII_ENCRYPTION_KEY` — 32-byte base64 key used to encrypt buyer and traveler data.
- `MERCADOPAGO_ACCESS_TOKEN` — Mercado Pago server-side credential.
- `MERCADOPAGO_WEBHOOK_SECRET` — validates payment notifications.
- `RESEND_API_KEY` and `RESEND_FROM_EMAIL` — send purchase confirmations from a verified sender.
- `PUBLIC_APP_URL` — public HTTPS origin used for payment return URLs and webhook setup.
- Excursion photos use Replit App Storage.

Never put credentials in source code, a committed `.env` file, browser code, URLs, logs, or customer-facing pages. The Resend key is read by the server from `RESEND_API_KEY`.

## Payment setup
The app uses Mercado Pago Checkout Pro, so card and Pix details are entered on Mercado Pago's hosted checkout—not on this site. Configure a Mercado Pago webhook for `POST /api/payments/webhook` and select payment notifications. The server confirms bookings and reduces available seats only after it verifies an approved payment.

## Buyer data
Participant contact details and CPF values are encrypted in MySQL. The staff panel requires the configured staff login. Purchase confirmation email only includes masked CPF values.
