# VPAY - AI Voice-Enabled Smart Payment & Expense Manager

Built for the **PayPal AI Hackathon**. Speak (or type) a payment command in Hindi, Hinglish or English. VPAY understands it with AI, asks for confirmation, pays through PayPal, and tracks your expenses.

## Features

- **Voice or text commands**: "Rahul ko 5 dollar bhejo khane ke liye" or "Amit ko 500 rupaye bhejo chai ke liye"
- **AI intent parsing**: Gemini extracts the receiver, amount, currency and category from natural language
- **Safe by design**: voice can be misheard, so nothing is paid on voice alone. A confirmation card comes first, then PayPal approval
- **PayPal payments**: orders are created and captured with the PayPal Orders API (sandbox)
- **INR support**: rupee amounts are converted to USD for the sandbox payment (demo rate: 1 USD = 85 INR)
- **Expense tracking**: every payment is stored with its category and shown in a table
- **Ask about your spending**: "is hafte kitna kharch hua?" is answered by AI using your expense data
- **Resilient AI layer**: retries with fallback Gemini models and a local fallback parser if the AI is unavailable

## How PayPal and AI are used

| Part | Tool | What it does |
|---|---|---|
| Payments | PayPal Orders API v2 + PayPal JS SDK (sandbox) | Creates the order, shows PayPal checkout, captures the payment |
| Intent parsing | Google Gemini (gemini-2.5-flash, gemini-2.5-flash-lite) | Converts a spoken or typed command into structured JSON |
| Spending insights | Google Gemini | Answers questions about the user's expenses in Hinglish |
| Voice input | Browser Web Speech API (Chrome) | Speech to text |

## Tech stack

Node.js, Express, vanilla HTML/JS, PayPal REST API, Gemini API.

## Run locally

Requirements: Node.js 18 or newer, Chrome (for the microphone).

1. Clone the repo and install dependencies:
   ```bash
   git clone <your-repo-url>
   cd vpay
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in your own keys:
   - PayPal **sandbox** Client ID and Secret: https://developer.paypal.com/dashboard (Apps & Credentials, Sandbox)
   - Gemini API key: https://aistudio.google.com
3. Start the server:
   ```bash
   npm start
   ```
4. Open `http://localhost:3000` in Chrome.

## How to test a payment

1. Type or say: `Rahul ko 5 dollar bhejo khane ke liye`
2. Check the confirmation card, then click the PayPal button.
3. Log in with a **PayPal sandbox personal (buyer) account** (Dashboard > Testing Tools > Sandbox Accounts) and pay.
4. The expense appears in the table. Then ask: `is hafte kitna kharch hua?`

## Notes

- Everything runs in the PayPal **sandbox**. No real money is moved.
- Expenses are kept in server memory, so a restart clears them. This is a hackathon prototype.
- The `.env` file with real keys is never committed.

## What's next (roadmap, not in this build)

- Saved contacts with direct sends through PayPal Payouts and a spoken "confirm" step
- Per-contact spending limits and a voice PIN for larger amounts
- Persistent database instead of in-memory storage
- Live INR to USD exchange rates

## License

MIT. See the [LICENSE](LICENSE) file.