# ⬡ OfferFlow — HR Offer Letter Builder

> A professional, full-stack SaaS application for HR teams to create, manage, and track offer letters with e-signature support, PDF generation, and workflow automation.

---

## ✨ Features

### Core
- **HR Authentication** — JWT-based login/signup with role-based access (Admin, HR, Viewer)
- **Dashboard** — Offer statistics, trend charts, recent activity
- **Template Builder** — Rich editor with `{{placeholder}}` syntax, live preview, side-by-side editing
- **Candidate Management** — Full CRUD with search, filtering, offer history per candidate
- **Offer Generation** — Create offers from templates with auto-filled candidate data
- **Live Preview** — Real-time preview of rendered offer letter
- **PDF Download** — Puppeteer-based server-side PDF generation (PDFKit fallback)
- **Offer Workflow** — Draft → Sent → Accepted / Rejected
- **Version History** — Full audit log with timestamps and user tracking
- **Status Logs** — Every state change recorded with user, timestamp, note

### Bonus Features
- **Email Sending** — Nodemailer sends PDF attachment on offer send
- **E-Signature** — Candidate signature capture endpoint with IP logging
- **CSV Bulk Upload** — Import multiple candidates via CSV file
- **Draft Watermark** — DRAFT watermark applied to unfinalized PDFs
- **Dark Mode** — Full dark theme toggle, persisted to localStorage
- **REST API** — Fully validated, documented endpoints with rate limiting

---

## 🗂 Folder Structure

```
offerflow/
├── index.html              ← Standalone frontend (open in browser — no build needed)
│
├── backend/
│   ├── server.js           ← Express API server
│   ├── schema.sql          ← PostgreSQL schema + seed data
│   ├── package.json
│   └── .env.example
│
└── README.md
```

### For full Vite/React build:
```
frontend/
├── src/
│   ├── pages/
│   │   ├── Dashboard.jsx
│   │   ├── Offers.jsx
│   │   ├── Templates.jsx
│   │   ├── Candidates.jsx
│   │   └── Settings.jsx
│   ├── components/
│   │   ├── Sidebar.jsx
│   │   ├── Modal.jsx
│   │   ├── TemplateEditor.jsx
│   │   ├── OfferPreview.jsx
│   │   └── PDFViewer.jsx
│   ├── hooks/
│   │   ├── useAuth.js
│   │   └── useOffers.js
│   ├── api/
│   │   └── client.js       ← axios instance with JWT interceptor
│   ├── context/
│   │   └── AuthContext.jsx
│   ├── App.jsx
│   └── main.jsx
├── public/
├── vite.config.js
└── tailwind.config.js
```

---

## 🚀 Quick Start

### Option A: Standalone Frontend (No Backend)
1. Open `index.html` directly in your browser
2. Login with any email + 6-character password
3. All data is stored in-memory (demo mode)

### Option B: Full Stack

#### 1. Database Setup
```bash
# Create database
psql -U postgres -c "CREATE DATABASE offerflow;"

# Run schema
psql -U postgres -d offerflow -f backend/schema.sql
```

#### 2. Backend Setup
```bash
cd backend
cp .env.example .env
# Edit .env with your values

npm install
npm run dev
# API running at http://localhost:5000
```

#### 3. Frontend (Vite/React)
```bash
cd frontend
npm create vite@latest . --template react
npm install tailwindcss @tailwindcss/forms axios react-router-dom
npx tailwindcss init -p

npm run dev
# App running at http://localhost:5173
```

---

## 📡 API Reference

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new HR user |
| POST | `/api/auth/login` | Login, returns JWT |
| GET | `/api/auth/me` | Get current user profile |

### Templates
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/templates` | List all templates |
| POST | `/api/templates` | Create template |
| PUT | `/api/templates/:id` | Update template |
| DELETE | `/api/templates/:id` | Delete template |

### Candidates
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/candidates` | List candidates (with search/filter) |
| POST | `/api/candidates` | Add candidate |
| PUT | `/api/candidates/:id` | Update candidate |
| POST | `/api/candidates/bulk` | CSV bulk import |

### Offers
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/offers` | List offers (paginated, filterable) |
| GET | `/api/offers/stats` | Dashboard statistics |
| GET | `/api/offers/:id` | Get single offer |
| POST | `/api/offers` | Create offer (draft) |
| PUT | `/api/offers/:id` | Edit offer data |
| POST | `/api/offers/:id/send` | Send offer + email PDF |
| POST | `/api/offers/:id/status` | Update status (accepted/rejected) |
| GET | `/api/offers/:id/pdf` | Download PDF |
| GET | `/api/offers/:id/history` | Get audit history |
| POST | `/api/offers/:id/sign` | Submit e-signature |

### Request/Response Examples

**POST /api/auth/login**
```json
{ "email": "hr@company.com", "password": "secret123" }
// Response:
{ "token": "eyJhbGc...", "user": { "id": 1, "name": "HR Admin", "role": "admin" } }
```

**POST /api/offers**
```json
{
  "candidate_id": 12,
  "template_id": 3,
  "data": {
    "name": "Priya Sharma",
    "position": "Senior Engineer",
    "salary": "1800000",
    "currency": "₹",
    "doj": "2025-03-15",
    "company": "TechVentures",
    "department": "Engineering",
    "manager": "Rahul Gupta",
    "location": "Bengaluru",
    "probation": "3",
    "benefits": "Health insurance, ESOP",
    "deadline": "2025-03-01"
  }
}
```

---

## 🗄 Database Schema

### Key Tables

**`offers`** — Core offer data
- `id`, `candidate_id`, `template_id`, `data` (JSONB), `status`
- `sent_at`, `responded_at`, `expires_at`
- `signature`, `signed_at`, `signed_ip` (e-signature)
- `created_by`, `created_at`, `updated_at`

**`offer_history`** — Immutable audit log
- `offer_id`, `status`, `changed_by`, `note`, `created_at`

**`templates`** — Letter templates with `{{placeholder}}` syntax

**`candidates`** — Candidate profiles

**`users`** — HR users with roles: `admin`, `hr`, `viewer`

---

## 🌐 Deployment

### Backend (Railway / Render / EC2)
```bash
# Railway
railway init && railway up

# Render: connect GitHub repo, set env vars, auto-deploys

# Manual (EC2/VPS)
pm2 start backend/server.js --name offerflow-api
nginx reverse proxy → localhost:5000
```

### Frontend
```bash
# Vercel
vercel --prod

# Netlify
netlify deploy --prod --dir=dist

# Standalone HTML
# Just upload index.html to any static host (GitHub Pages, S3, Cloudflare Pages)
```

### Docker
```dockerfile
# Backend Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --production
COPY backend/ .
EXPOSE 5000
CMD ["node", "server.js"]
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: offerflow
      POSTGRES_PASSWORD: postgres
    volumes:
      - ./backend/schema.sql:/docker-entrypoint-initdb.d/schema.sql
  api:
    build: .
    ports: ["5000:5000"]
    environment:
      DB_HOST: db
      JWT_SECRET: changeme
    depends_on: [db]
```

---

## 🔒 Security

- Passwords hashed with bcrypt (12 rounds)
- JWT tokens expire in 7 days
- Role-based access control on all write operations
- Rate limiting: 200 req/15min per IP
- Helmet.js security headers
- SQL injection protected via parameterized queries
- CORS restricted to frontend origin

---

## 📋 Template Placeholders

| Placeholder | Description |
|-------------|-------------|
| `{{name}}` | Candidate full name |
| `{{position}}` | Job title |
| `{{salary}}` | Annual salary amount |
| `{{currency}}` | Currency symbol (₹, $, €) |
| `{{doj}}` | Date of joining |
| `{{company}}` | Company name |
| `{{department}}` | Department name |
| `{{manager}}` | Reporting manager |
| `{{location}}` | Office location |
| `{{email}}` | Candidate email |
| `{{phone}}` | Candidate phone |
| `{{probation}}` | Probation period (months) |
| `{{benefits}}` | Benefits description |
| `{{deadline}}` | Offer acceptance deadline |

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + Vite + Tailwind CSS |
| Backend | Node.js + Express |
| Database | PostgreSQL |
| Auth | JWT + bcryptjs |
| PDF | Puppeteer (primary) + PDFKit (fallback) |
| Email | Nodemailer |
| CSV | csv-parser + multer |
| Security | helmet, rate-limit, cors |

---

## 📄 License

MIT License — free to use, modify, and deploy.

---

*Built for HR hackathon · OfferFlow v1.0*
