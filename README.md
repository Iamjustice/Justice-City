# Justice City - Trust-First Real Estate Marketplace

Justice City is a modern real estate platform designed with a focus on trust and verification. It aims to eliminate scams and fake listings by ensuring every user and every property on the platform is verified.

## Features

- **Verified Property Listings**: Browse a wide range of properties (Buy, Rent) with verified documentation.
- **Advanced Search & Filtering**: Find the perfect property using filters for price, bedrooms, and property type.
- **Identity & Trust System**: Built-in verification using Supabase Auth for agents and users to build instant trust.
- **Professional Services**: Access verified experts for:
  - Land Surveying
  - Property Valuation
  - Land Verification
- **User Dashboard**: Manage your profile, listings, and saved properties.
- **Interactive Tour Scheduling**: Request property tours directly through the platform.
- **Responsive Design**: Fully responsive UI built with Tailwind CSS and Framer Motion.

## Tech Stack

### Frontend
- **React 19**: Modern UI library.
- **Vite**: Ultra-fast frontend build tool.
- **Wouter**: Minimalist routing.
- **TanStack Query**: Powerful data fetching and state management.
- **Tailwind CSS**: Utility-first CSS framework.
- **Shadcn UI**: High-quality accessible components.
- **Framer Motion**: Smooth animations and transitions.
- **Lucide React**: Beautiful, consistent icons.
- **Supabase Auth**: Secure user authentication and management.

### Backend
- **Express**: Robust Node.js web framework.
- **Drizzle ORM**: Next-generation TypeScript ORM.
- **PostgreSQL (Supabase)**: Reliable relational database.
- **Zod**: TypeScript-first schema validation.

## Project Structure

```
├── client/              # Frontend React application
│   ├── src/
│   │   ├── components/  # Reusable UI components
│   │   ├── hooks/       # Custom React hooks
│   │   ├── lib/         # Utility functions, API clients, and Auth
│   │   ├── pages/       # Route components
│   │   └── App.tsx      # Main application entry and routing
├── server/              # Backend Express application
│   ├── index.ts         # Server entry point
│   ├── routes.ts        # API route definitions
│   ├── storage.ts       # Database storage interface and implementation
│   ├── db.ts            # Drizzle database initialization
│   └── static.ts        # Static file serving logic
├── shared/              # Shared types and schemas (Zod/Drizzle)
│   └── schema.ts        # Database schema and validation types
├── script/              # Build and utility scripts
└── public/              # Static assets
```

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- Supabase Project (URL, Anon Key, and Database Password)

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

### Supabase Setup

1. Create a new project in the [Supabase Dashboard](https://app.supabase.com/).
2. Run the SQL provided in `supabase_schema.sql` in the Supabase SQL Editor to set up the tables and RLS policies.
3. Copy your project URL and Anon Key from the Supabase settings.
4. Obtain your database password (set during project creation).

### Configuration

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Fill in your Supabase credentials and database connection string in the `.env` file:
   ```env
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-ID].supabase.co:5432/postgres
   ```

### Database Migrations

If you make changes to `shared/schema.ts`, you can push them to the database using:
```bash
npm run db:push
```

### Running the Application

1. Start the development server:
   ```bash
   npm run dev
   ```
   The application will be available at `http://localhost:5000`.

### Build for Production

```bash
npm run build
npm start
```

## License

MIT
