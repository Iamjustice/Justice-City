# Justice City - Trust-First Real Estate Marketplace

Justice City is a modern real estate platform designed with a focus on trust and verification. It aims to eliminate scams and fake listings by ensuring every user and every property on the platform is verified.

## Features

- **Verified Property Listings**: Browse a wide range of properties (Buy, Rent) with verified documentation.
- **Advanced Search & Filtering**: Find the perfect property using filters for price, bedrooms, and property type.
- **Identity & Trust System**: Built-in verification for agents and users to build instant trust.
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

### Backend
- **Express**: Robust Node.js web framework.
- **Drizzle ORM**: Next-generation TypeScript ORM.
- **PostgreSQL**: Reliable relational database.
- **Passport.js**: Flexible authentication middleware.
- **Zod**: TypeScript-first schema validation.

## Project Structure

```
├── client/              # Frontend React application
│   ├── src/
│   │   ├── components/  # Reusable UI components
│   │   ├── hooks/       # Custom React hooks
│   │   ├── lib/         # Utility functions and API clients
│   │   ├── pages/       # Route components
│   │   └── App.tsx      # Main application entry and routing
├── server/              # Backend Express application
│   ├── index.ts         # Server entry point
│   ├── routes.ts        # API route definitions
│   ├── storage.ts       # Data storage interface and implementation
│   └── auth.ts          # Authentication logic
├── shared/              # Shared types and schemas (Zod/Drizzle)
│   └── schema.ts        # Database schema and validation types
├── script/              # Build and utility scripts
└── public/              # Static assets
```

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- PostgreSQL database

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

### Running the Application

1. Set up your environment variables (Database URL, etc.)
2. Push the database schema:
   ```bash
   npm run db:push
   ```
3. Start the development server:
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
