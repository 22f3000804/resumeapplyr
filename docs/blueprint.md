# JobApplyer — Problem Statement & Technical Blueprint

> **Note (13 Oct 2026):** the product is now called **resumeapplyr**. The first build is the
> desktop app in `apps/desktop` ([docs/desktop.md](desktop.md)), which runs the agent on the user's
> own computer as proposed in the review notes below. Those notes used to sit in table cells that
> GitHub doesn't render; they now appear as quoted notes under each section. This document was
> previously `22f3001562.md` at the repo root.

---

## 1. Problem Statement

**The modern job search is fundamentally broken.** A job seeker spends an average of **11 hours per week** on applications — most of that time wasted on repetitive tasks: copying the same information into different portals, reformatting resumes for each ATS (Applicant Tracking System), and scrolling through hundreds of irrelevant listings across fragmented job boards.

Meanwhile, **75% of resumes are rejected by ATS before a human ever reads them** — not because candidates are unqualified, but because their resume formatting, keyword usage, or structure fails automated parsing.

### The Core Pain Points

| # | Pain Point | Impact |
|---|-----------|--------|
| 1 | **Fragmented Job Discovery** | Jobs are scattered across Indeed, LinkedIn, Naukri, Glassdoor, company career pages. Manually checking each is exhausting. |
| 2 | **ATS-Hostile Resumes** | Candidates use fancy templates (Canva, multi-column PDFs) that ATS parsers can't read — their applications go into a black hole. |
| 3 | **Repetitive Data Entry** | Name, email, phone, work history — entered hundreds of times across different portals with different form layouts. |
| 4 | **No Intelligent Matching** | Job seekers waste time applying to roles that don't match their skills. There's no automated "fit score" before applying. |
| 5 | **Zero Tracking** | Most candidates lose track of where they applied, when, and what version of their resume they sent. |

### Our Solution: **JobApplyer**

An end-to-end, AI-powered platform that:

1. **Aggregates** jobs from multiple sources into a single, searchable feed
2. **Builds** ATS-optimized resumes tailored to each job description
3. **Applies** on behalf of the user with human-in-the-loop review
4. **Tracks** every application in a personal dashboard

> **Vision**: Reduce the time from "finding a job" to "submitting a tailored application" from **45 minutes → 2 minutes** per application.

---

## 2. System Architecture — High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER (Browser)                               │
│                   Next.js Frontend (Dashboard)                      │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ REST / WebSocket
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      API GATEWAY (FastAPI)                           │
│            Auth · Rate Limiting · Request Routing                    │
└──────┬──────────┬──────────┬───────────┬───────────┬────────────────┘
       │          │          │           │           │
       ▼          ▼          ▼           ▼           ▼
  ┌─────────┐ ┌────────┐ ┌──────────┐ ┌─────────┐ ┌──────────────┐
  │  Auth   │ │  Job   │ │ Resume   │ │ Apply   │ │ Notification │
  │ Service │ │Scraper │ │ Builder  │ │ Engine  │ │   Service    │
  │         │ │Service │ │ Service  │ │         │ │              │
  └────┬────┘ └───┬────┘ └────┬─────┘ └────┬────┘ └──────┬───────┘
       │          │           │            │             │
       ▼          ▼           ▼            ▼             ▼
  ┌─────────────────────────────────────────────────────────────┐
  │                   DATA LAYER                                 │
  │   PostgreSQL  ·  Redis (Cache/Queue)  ·  S3/MinIO (Files)   │
  └─────────────────────────────────────────────────────────────┘
```

> **Rowan:** i propose building it out as an electron web app, gives us control over all kinds of data the website will be collecting for anti bot activity. Along with more flexibility on  anti anti-bot system.

---

## 3. Feature Breakdown

### Module 1: Job Aggregator & Scraper

**Goal**: Continuously scrape and normalize job listings from multiple sources into a unified database.

| Feature | Description |
|---------|-------------|
| Multi-source scraping | Indeed, LinkedIn, Naukri, Glassdoor, Google Jobs API, company career pages |
| Intelligent deduplication | Match jobs across sources by `(company, title, location)` hash |
| Real-time normalization | Standardize salary ranges, experience levels, job types, locations |
| Smart search & filters | Full-text search with filters: role, location, salary, remote, experience |
| Job match scoring | AI-powered matching: compare JD against user's resume/profile → fit % |
| Scheduled pipelines | Cron-based scraping with configurable frequency per source |

> **Rowan, on "Multi-source scraping":** For websites that arent listed here (which are populat in other countries)   we will need a smart scraping solution where the ai agent analyzes the website and builds out a custom scraper in case our scraper isnt cutting it since we cant get personally involved for every building a scraper for every website.

**Existing Foundation**: The project already has `google_job.py` — a working scraper using the ScrapeBadger API for Google Jobs. This will be expanded into a multi-source scraping service.

---

### Module 2: ATS-Friendly Resume / CV Builder

**Goal**: Generate clean, machine-readable, ATS-optimized resumes that pass automated parsing.

| Feature | Description |
|---------|-------------|
| Structured data input | Form-based entry: personal info, experience, education, skills, projects |
| Multiple ATS templates | Single-column, standard-header templates proven to pass major ATS systems |
| AI keyword injection | Analyze JD → extract critical keywords → suggest additions to resume |
| Real-time preview | Live PDF preview as user edits sections |
| PDF generation | Clean, text-selectable, single-column PDF output (not image-based) |
| Resume parsing | Upload existing resume → extract structured data → rebuild in ATS format |
| Version management | Save multiple resume versions; track which version was sent where |
| Export formats | PDF (primary), DOCX, JSON (for data portability) |

**ATS Compliance Rules Enforced**:
- ✅ Single-column layout (no tables, no columns)
- ✅ Standard section headers (`Work Experience`, `Education`, `Skills`)
- ✅ Standard fonts (Arial, Calibri, Times New Roman)
- ✅ No images, icons, graphics, or charts
- ✅ Proper heading hierarchy (H1 → H2 → body text)
- ✅ Text-selectable PDF (not flattened/rasterized)

---

### Module 3: Automated Job Application Engine

**Goal**: Streamline the application process with AI-assisted form filling and human-in-the-loop review.

| Feature | Description |
|---------|-------------|
| One-click apply | Auto-fill application forms using stored profile data |
| Cover letter generation | AI-generated cover letters tailored to each specific JD |
| Screening question answers | AI-suggested answers to common screening questions |
| Human-in-the-loop review | **User reviews and confirms every application before submission** |
| Rate limiting | Max applications per day to avoid bot detection and spam |
| Anti-detection measures | Randomized delays, proxy rotation, human-like browser fingerprints |

> **Rowan, on "Human-in-the-loop review":** That or it can be fully automated once the user trusts it more.
>
> **Rowan, on "Anti-detection measures":** proxy rotation wont be needed since the application since itll be running in the users machine. in a month theyll be applying anyhwere between 1500-3000 resumes, which is roughly 2-4 resumes per hour, which is perfectly within human limits. so ip reputation is safe.

> **Design Principle**: The system assists — it does NOT blindly spray applications. Every submission requires explicit user approval. This is both an ethical requirement and a practical one (mass-blasting destroys your reputation with recruiters).

---

### Module 4: Application Tracker & Dashboard

**Goal**: Central command center for the entire job search.

| Feature | Description |
|---------|-------------|
| Application status board | Kanban-style: `Saved → Applied → Interview → Offer → Rejected` |
| Analytics | Applications/week, response rate, top-performing resume versions |
| Calendar integration | Interview scheduling reminders |
| Notifications | Email/push alerts for status changes, new matching jobs |
| Activity log | Full audit trail: when applied, which resume version, which cover letter |

---

## 4. Technology Stack

### Frontend

| Technology | Purpose | Why This? |
|-----------|---------|-----------|
| **Next.js 15** (App Router) | Web framework | SSR for SEO, React Server Components, excellent DX |
| **TypeScript** | Type safety | Catch bugs at compile time; auto-generate API clients from FastAPI |
| **Tailwind CSS v4** | Styling | Rapid UI development, consistent design system |
| **Shadcn/UI** | Component library | Accessible, customizable, production-ready components |
| **React PDF** | Resume PDF generation | Client-side PDF rendering with precise layout control |
| **Zustand** | State management | Lightweight, minimal boilerplate vs. Redux |
| **React Query (TanStack)** | Server state | Caching, background refetching, optimistic updates |

### Backend

| Technology | Purpose | Why This? |
|-----------|---------|-----------|
| **Python 3.12+** | Core language | Best ecosystem for scraping, AI/ML, and data processing |
| **FastAPI** | API framework | Async-native, auto-generates OpenAPI docs, Pydantic validation |
| **Playwright** | Browser automation | Industry-standard for scraping JS-heavy sites; stealth plugins available |
| **Celery + Redis** | Task queue | Background job processing (scraping, PDF generation, applications) |
| **SQLAlchemy + Alembic** | ORM + migrations | Type-safe database access with version-controlled schema changes |
| **LangChain + OpenAI API** | AI layer | JD parsing, keyword extraction, cover letter generation, match scoring |
| **BeautifulSoup / Selectolax** | HTML parsing | Fast extraction of structured data from scraped pages |

### Infrastructure & Data

| Technology | Purpose | Why This? |
|-----------|---------|-----------|
| **PostgreSQL** | Primary database | Relational integrity for users, jobs, applications; full-text search |
| **Redis** | Cache + message broker | Session cache, job queue, rate limiting, real-time pub/sub |
| **MinIO / S3** | File storage | Resume PDFs, cover letters, scraped HTML snapshots |
| **Docker + Docker Compose** | Containerization | Consistent dev/prod environments; isolate each microservice |
| **GitHub Actions** | CI/CD | Automated testing, linting, deployment on push |
| **Nginx** | Reverse proxy | SSL termination, load balancing, static file serving |

### AI & Intelligence Layer

| Technology | Purpose |
|-----------|---------|
| **OpenAI GPT-4o / GPT-4o-mini / Deepseek flash** | JD analysis, cover letter generation, screening question answers |
| **Sentence Transformers** | Semantic similarity for job-resume matching |
| **spaCy / NLTK** | Named entity recognition for resume parsing |
| **pdfplumber / PyMuPDF** | Extract text from uploaded resume PDFs |

---

## 5. Database Schema (Core Entities)

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│    users     │     │    job_listings   │     │    resumes      │
├──────────────┤     ├──────────────────┤     ├─────────────────┤
│ id (PK)      │     │ id (PK)          │     │ id (PK)         │
│ email        │     │ title            │     │ user_id (FK)    │
│ name         │     │ company          │     │ version_label   │
│ phone        │     │ location         │     │ template_id     │
│ password_hash│     │ salary_min       │     │ content_json    │
│ profile_json │     │ salary_max       │     │ pdf_url         │
│ created_at   │     │ job_type         │     │ created_at      │
└──────┬───────┘     │ description      │     └────────┬────────┘
       │             │ source_url       │              │
       │             │ source_platform  │              │
       │             │ apply_links      │              │
       │             │ dedup_hash       │              │
       │             │ scraped_at       │              │
       │             └────────┬─────────┘              │
       │                      │                        │
       │         ┌────────────┴────────────┐           │
       │         │     applications        │           │
       │         ├─────────────────────────┤           │
       └────────►│ id (PK)                 │◄──────────┘
                 │ user_id (FK)            │
                 │ job_id (FK)             │
                 │ resume_id (FK)          │
                 │ cover_letter_text       │
                 │ status (enum)           │
                 │ match_score (float)     │
                 │ applied_at              │
                 │ notes                   │
                 └─────────────────────────┘
```

---

## 6. Implementation Phases

### Phase 1 — Foundation (Weeks 1–3)
> **Goal**: Project skeleton, auth, and basic job scraping

- [ ] Initialize monorepo: Next.js frontend + FastAPI backend
- [ ] Set up Docker Compose (PostgreSQL, Redis, API, Frontend)
- [ ] Implement user authentication (JWT + OAuth with Google)
- [ ] Expand `google_job.py` into a proper scraping service
- [ ] Build job listing API endpoints (CRUD, search, pagination)
- [ ] Create basic job feed UI with search & filters

### Phase 2 — Resume Builder (Weeks 4–6)
> **Goal**: Fully functional ATS-optimized resume builder

- [ ] Design resume data schema (structured JSON)
- [ ] Build resume editor UI (form-based sections)
- [ ] Implement 3–4 ATS-compliant PDF templates
- [ ] Add live PDF preview with React PDF
- [ ] Build resume upload & parsing (PDF → structured data)
- [ ] Implement resume version management

### Phase 3 — AI Intelligence Layer (Weeks 7–9)
> **Goal**: Smart matching and content generation

- [ ] Integrate OpenAI API for JD analysis
- [ ] Build job-resume match scoring algorithm
- [ ] Implement AI keyword suggestion for resumes
- [ ] Build cover letter generation pipeline
- [ ] Add screening question answer suggestions
- [ ] Create "Job Fit" dashboard with per-job scores

### Phase 4 — Application Engine (Weeks 10–12)
> **Goal**: Assisted application submission with human review

- [ ] Build application form auto-fill engine (Playwright)
- [ ] Implement human-in-the-loop review workflow
- [ ] Add rate limiting and anti-detection measures
- [ ] Build application tracking dashboard (Kanban board)
- [ ] Implement email notifications (application status updates)
- [ ] Create analytics dashboard (application stats, response rates)

### Phase 5 — Polish & Scale (Weeks 13–16)
> **Goal**: Production hardening and advanced features

- [ ] Add more scraping sources (LinkedIn, Naukri, Glassdoor)
- [ ] Implement proxy rotation and stealth mode
- [ ] Build browser extension for one-click apply from any job page
- [ ] Add calendar integration for interview scheduling
- [ ] Performance optimization and caching
- [ ] Security audit and penetration testing
- [ ] User onboarding flow and documentation

---

## 7. Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Platform bans** (LinkedIn, Indeed ToS violations) | 🔴 High | Use human-in-the-loop; respect rate limits; rotate proxies; mimic human behavior |
| **ATS format changes** | 🟡 Medium | Build a testing pipeline that validates PDF output against major ATS parsers |
| **DOM/layout changes on job sites** | 🟡 Medium | Use network interception (capture JSON APIs) over brittle CSS selectors; alerting on selector failures |
| **AI hallucination in cover letters** | 🟡 Medium | Always require human review before submission; add fact-checking prompts |
| **API cost overruns** (OpenAI, scraping APIs) | 🟡 Medium | Use GPT-4o-mini for bulk tasks; cache AI responses; set spending alerts |
| **Data privacy / GDPR compliance** | 🔴 High | Encrypt PII at rest; provide data export/deletion; never log credentials |
| **"Spray and pray" reputation damage** | 🟡 Medium | Hard cap on daily applications; quality score threshold before allowing apply |

---

## 8. Ethical Design Principles

1. **Human-in-the-Loop**: Every application is reviewed and confirmed by the user before submission
2. **Quality Over Quantity**: AI match scoring prevents applying to irrelevant jobs
3. **Transparency**: No misrepresentation of qualifications; AI-generated content is clearly marked
4. **Rate Responsibility**: Built-in limits prevent flooding recruiter pipelines with low-quality applications
5. **Data Sovereignty**: Users own their data; full export and deletion capabilities
6. **No Deception**: The system does not impersonate human behavior to bypass security — it assists legitimate users

---

## 9. Success Metrics

| Metric | Target |
|--------|--------|
| Time per application | < 3 minutes (vs. industry avg of 45 min) |
| ATS pass-through rate | > 85% (vs. industry avg of 25%) |
| Job-resume match accuracy | > 80% correlation with interview callbacks |
| User applications per session | 10–20 quality applications in under 1 hour |
| System uptime | > 99.5% |
| User satisfaction (NPS) | > 50 |

> **Rowan, on "Time per application":** shouldnt be applying more than 2-4 (depends on the tier the user is on)
>
> **Rowan, on "User applications per session":** too much

---

## 10. Competitive Landscape

| Competitor | What They Do | Our Differentiator |
|-----------|-------------|-------------------|
| **LazyApply** | Auto-applies to jobs on LinkedIn | We build the resume too; human-in-the-loop; multi-platform |
| **Jobscan** | ATS resume scanner | We go beyond scanning — we build, optimize, AND apply |
| **Teal** | Job tracking + resume builder | We add automated scraping + AI-assisted application submission |
| **Simplify** | Browser extension for auto-fill | We are a full platform: scrape → build → match → apply → track |
| **Reactive Resume** | Open-source resume builder | We integrate the resume into the full application pipeline |

---

## 11. Folder Structure (Proposed)

```
jobapplyer/
├── frontend/                    # Next.js 15 App
│   ├── app/                     # App Router pages
│   │   ├── (auth)/              # Login, Register
│   │   ├── dashboard/           # Main dashboard
│   │   ├── jobs/                # Job feed & search
│   │   ├── resume/              # Resume builder
│   │   ├── applications/        # Application tracker
│   │   └── settings/            # User settings
│   ├── components/              # Shared UI components
│   ├── lib/                     # Utilities, API client
│   └── public/                  # Static assets
│
├── backend/                     # FastAPI Backend
│   ├── app/
│   │   ├── api/                 # Route handlers
│   │   │   ├── auth.py
│   │   │   ├── jobs.py
│   │   │   ├── resumes.py
│   │   │   └── applications.py
│   │   ├── core/                # Config, security, deps
│   │   ├── models/              # SQLAlchemy models
│   │   ├── schemas/             # Pydantic schemas
│   │   ├── services/            # Business logic
│   │   │   ├── scraper/         # Multi-source scraping
│   │   │   ├── resume_builder/  # PDF generation
│   │   │   ├── ai/              # LLM integration
│   │   │   └── applier/         # Application engine
│   │   └── workers/             # Celery background tasks
│   ├── alembic/                 # Database migrations
│   └── tests/
│
├── docker-compose.yml           # Full stack orchestration
├── .env.example                 # Environment variables template
└── README.md
```

---

> **Next Step**: Approve this blueprint, and we start building Phase 1 — the project skeleton, authentication, and expanding the existing job scraper into a proper multi-source service.
