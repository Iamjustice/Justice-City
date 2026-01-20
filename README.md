# Justice City: Trust-First Real Estate Marketplace

Justice City is a verified real estate platform dedicated to restoring trust in the Nigerian property market. By enforcing mandatory biometric identity verification (KYC) and property title verification, we eliminate fraud and ensure a secure environment for buyers, renters, owners, and agents.

## 🚀 Key Features

### 🛡️ Verification & Security
- **Biometric Identity Verification:** Powered by **Smile ID** for secure, real-time facial recognition and document verification.
- **100% Identity Checks:** Every user on the platform must be verified to interact with listings, ensuring zero anonymity for scammers.
- **Property Title Verification:** All listings undergo a rigorous verification process by qualified legal and land professionals.
- **Verified Badge System:** Trust is instantly recognizable via the "Verified" shield on user profiles and property listings.

### 🏠 Property Marketplace
- **Verified Listings:** A curated marketplace with over 2,400+ listings that have undergone document review.
- **Transparent History:** Access detailed property specifications, including square footage, bedroom/bathroom counts, and verified pricing in NGN (₦).
- **Search & Advanced Filtering:** Powerful search tools with filters for price range, property type (Sale/Rent), and location.

### 💼 Professional Services
- **Land Surveying:** Accurate boundary mapping and topographical surveys by licensed professionals.
- **Property Valuation:** Professional appraisal services to determine true market value.
- **Land Verification:** Complete document review and physical site inspection for absolute peace of mind.

## 🛠 Tech Stack

- **Frontend:** [React 19.2.0](https://react.dev/), [Vite 7.1.9](https://vitejs.dev/), [TanStack Query](https://tanstack.com/query/latest), [Tailwind CSS 4.1.14](https://tailwindcss.com/), [Framer Motion](https://www.framer.com/motion/), [Wouter](https://github.com/molefrog/wouter).
- **Backend:** [Node.js](https://nodejs.org/), [Express 4.21.2](https://expressjs.com/).
- **Database & Auth:** [Supabase 2.90.1](https://supabase.com/) (PostgreSQL, Auth, Storage).
- **ORM:** [Drizzle ORM 0.39.3](https://orm.drizzle.team/) for type-safe database interactions.
- **Identity Verification:** [Smile ID Web SDK](https://www.smileidentity.com/) for biometric identity capture.

## 📁 Project Structure

```text
├── client/              # Frontend React application
│   ├── public/assets/   # Branding assets (logos, icons)
│   ├── src/
│   │   ├── components/  # Reusable UI components (shadcn/ui, property cards)
│   │   ├── hooks/       # Custom React hooks for data fetching
│   │   ├── lib/         # Utility functions and API clients (Supabase, Auth)
│   │   ├── pages/       # Page components (Marketplace, Verify, Dashboard, etc.)
│   │   └── App.tsx      # Main application routing
├── server/              # Backend Express application
│   ├── db/              # Database schema and Drizzle configuration
│   ├── routes.ts        # API route definitions
│   └── index.ts         # Server entry point
├── shared/              # Shared types and Zod schemas
└── drizzle/             # Database migrations
```

## 🛠 Setup & Installation

### Prerequisites
- **Node.js**: v20 or later.
- **Supabase Account**: A project with a PostgreSQL database and Auth enabled.

### 1. Clone & Install
```bash
git clone <repository-url>
cd justice-city
npm install
```

### 2. Environment Configuration
Create a `.env` file in the root directory and provide the following variables:
- `VITE_SUPABASE_URL`: Your Supabase Project URL.
- `VITE_SUPABASE_ANON_KEY`: Your Supabase Anonymous Key.
- `DATABASE_URL`: Connection string for your Supabase PostgreSQL database.
- `SMILE_ID_API_KEY`: Your Smile ID API key for biometric verification processing.

### 3. Database Migration
```bash
npm run db:push
```

### 4. Start Development
```bash
# Start the full-stack app (Server + Client via Vite proxy)
npm run dev
```

## 🏗 Architecture & Core Logic

### 🛡 The Trust Gate
Justice City employs a "Trust Gate" architectural pattern. Access to core features (listing properties, requesting services, contacting sellers) is restricted to verified users.
- **Unverified State:** Limited browsing and read-only access.
- **Verified State:** Full access to marketplace transactions and professional services.

### 👥 Role-Based Access Control (RBAC)
The platform supports five distinct roles, each with specific permissions:
- **Buyer:** Can browse, save, and purchase verified properties.
- **Seller (Owner):** Can list properties after identity and title verification.
- **Agent:** Verified professionals who can manage multiple listings and represent owners.
- **Renter:** Focused on short-term or long-term lease opportunities.
- **Admin:** Oversight of verification processes and marketplace integrity.

### 💰 Commission Model
Justice City operates on a **5% flat commission** model for successful transactions. This commission ensures the platform can continue to fund high-quality manual document verification and physical site inspections.

## 🛡 Verification Flow

1. **User Registration:** Users sign up and select their primary role (Buyer, Agent, Owner).
2. **Smile ID KYC:** Users are directed to the `/verify` page where the **Smile ID SmartSelfie™** and **Document Verification** components handle biometric and ID capture.
3. **Trust Validation:** Data is processed via Smile ID's biometric engine. Upon success, the `user.is_verified` flag is toggled in Supabase, triggering the "Verified" badge across the UI.

## 📄 License

© 2026 Justice City Ltd. All rights reserved.
