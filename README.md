# Justice City: Trust-First Real Estate Marketplace

Justice City is a verified real estate platform dedicated to restoring trust in the Nigerian property market. By enforcing mandatory identity verification (KYC) and property title verification, we eliminate fraud and ensure a secure environment for buyers, renters, owners, and agents.

## 🚀 Key Features

- **Mandatory Identity Verification:** Integrated with **Smile ID** for biometric KYC (facial recognition and document verification).
- **Property Title Verification:** All listings undergo a rigorous verification process by qualified legal and land professionals.
- **Role-Based Access Control:** Secure dashboards for Buyers, Renters, Property Owners, Real Estate Agents, and System Administrators.
- **Real-Time Communication:** Direct, secure messaging between verified parties.
- **Secure Marketplace:** Verified listings for sales and rentals with transparent history.

## 🛠 Tech Stack

- **Frontend:** React 19, Vite, TanStack Query, Tailwind CSS, Lucide React, Wouter.
- **Backend:** Node.js, Express.
- **Database & Auth:** Supabase (PostgreSQL, Auth, Storage, Edge Functions).
- **ORM:** Drizzle ORM for type-safe database interactions.
- **Verification:** Smile ID Web SDK for biometric identity capture.

## 📁 Project Structure

```text
├── client/              # Frontend React application
│   ├── public/assets/   # Branding assets (logos, icons)
│   ├── src/
│   │   ├── components/  # Reusable UI components (shadcn/ui)
│   │   ├── hooks/       # Custom React hooks
│   │   ├── lib/         # Utility functions and API clients (Supabase, Auth)
│   │   ├── pages/       # Page components (Marketplace, Verify, Dashboard, etc.)
│   │   └── App.tsx      # Main application routing
├── server/              # Backend Express application
│   ├── db/              # Database schema and Drizzle configuration
│   ├── routes.ts        # API route definitions
│   └── index.ts         # Server entry point
└── drizzle/             # Database migrations
```

## 🛠 Setup & Installation

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd justice-city
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Environment Configuration:**
   Create a `.env` file in the root directory and provide the following variables:
   - `VITE_SUPABASE_URL`: Your Supabase Project URL.
   - `VITE_SUPABASE_ANON_KEY`: Your Supabase Anonymous Key.
   - `DATABASE_URL`: Connection string for your Supabase PostgreSQL database.
   - `SMILE_ID_API_KEY`: (Optional) Your Smile ID API key for enhanced verification.

4. **Database Migration:**
   ```bash
   npm run db:push
   ```

5. **Start the development server:**
   ```bash
   npm run dev
   ```

## 🛡 Verification Flow

1. **User Registration:** Users sign up and select their primary role.
2. **Smile ID KYC:** Users are directed to the `/verify` page to complete biometric identity capture.
3. **Document Submission:** Property owners and agents must submit proof of identity and professional credentials.
4. **Approval:** Administrators review the submissions to grant "Verified" status.

## 📄 License

© 2026 Justice City Ltd. All rights reserved.
