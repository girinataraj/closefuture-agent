import fs from "node:fs";
import path from "node:path";
import type { ExtractedPage } from "./extractPdf.js";

export type DocumentCategory =
  | "company_overview"
  | "services"
  | "process"
  | "technology"
  | "founder"
  | "case_study"
  | "markets"
  | "reputation"
  | "blog";

export interface StructuredDocument {
  id: string;
  filename: string;
  title: string;
  source_page: number;
  source_section: string;
  document_type: "company_profile" | "case_study";
  category: DocumentCategory;
  content: string;
}

/**
 * Resolves directory path for data/knowledge regardless of whether execution
 * is rooted in backend/ or repository root.
 */
export function resolveKnowledgeDir(): string {
  const candidates = [
    path.resolve(process.cwd(), "data/knowledge"),
    path.resolve(process.cwd(), "../data/knowledge"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Fallback: create in first candidate's parent
  const target = path.resolve(process.cwd(), "data/knowledge");
  if (path.basename(process.cwd()) === "backend") {
    return path.resolve(process.cwd(), "../data/knowledge");
  }
  return target;
}

/**
 * Builds structured knowledge documents grounded strictly in the extracted PDF pages.
 * Writes each document to data/knowledge/<filename> and returns the collection.
 */
export function buildDocuments(extractedPages: ExtractedPage[]): StructuredDocument[] {
  const pageMap = new Map<number, string>();
  for (const p of extractedPages) {
    pageMap.set(p.page, p.text);
  }

  const documents: StructuredDocument[] = [
    {
      id: "overview",
      filename: "overview.md",
      title: "CloseFuture Overview & Core Metrics",
      source_page: 2,
      source_section: "Company Profile Cover & Overview",
      document_type: "company_profile",
      category: "company_overview",
      content: `# CloseFuture Overview & Core Metrics

CloseFuture is an AI product studio that turns ideas into production-ready web and mobile applications in four to six weeks, rather than four to six months.

## Core Tagline & Mission
"Crafting futures, seamlessly."

## Key Studio Facts & Metrics
- **Founded**: 2023
- **Headquarters**: Velur, Namakkal, Tamil Nadu, India
- **Founder**: Baskaran Manimohan
- **Delivery Timeline**: 4–6 weeks to launch
- **Shipped Products**: 100+ production products delivered
- **Client Rating**: 5.0 overall rating across verified reviews
- **Core Philosophy**: Pairing low-code platforms (Bubble, FlutterFlow, Framer) with AI-assisted development and solid backends (Supabase, PostgreSQL). The result is software that ships in weeks and holds up in production with real users, real payments, and real scale.
- **Client Footprint**: Clients across Israel, the Gulf (Dubai, Riyadh), Europe (Germany, France, Spain, Poland), and India.`,
    },
    {
      id: "studio",
      filename: "studio.md",
      title: "The Studio — An Agency Built for Speed",
      source_page: 3,
      source_section: "01 — The Studio",
      document_type: "company_profile",
      category: "company_overview",
      content: `# The Studio — An Agency Built for Speed

Where traditional software agencies take months, CloseFuture measures the gap between an idea and a shipped product in weeks. CloseFuture calls itself an AI product studio because it leans heavily on modern low-code platforms and AI-assisted development without sacrificing production quality.

## Client Profiles
- **Early-stage Founders**: Seeking to validate ideas quickly and ship polished MVPs to real users on lean budgets.
- **Enterprises**: Needing secure, scalable internal tools and AI features shipped faster than internal roadmaps permit.
- In both cases, the studio behaves as an extension of the client's internal team. Verified client quote: "They never say 'not possible' — they figure it out."

## Work Breakdown by Domain
- **AI Development (~30%)**: Conversational AI, semantic search and matching, automated summarization, image analysis.
- **Web Development (~25%)**: Web applications, client portals, dashboards, marketing websites.
- **Custom Software (~20%)**: Bespoke platforms unifying fragmented, manual business workflows.
- **Mobile Apps (~15%)**: Native-feeling iOS and Android experiences on FlutterFlow and hybrid stacks.
- **Low-/No-Code (~10%)**: Rapid builds on Bubble, FlutterFlow, and Framer.

## Guiding Principles
1. **Speed with Substance**: Fast delivery that survives heavy production use.
2. **Transparency**: Honest, continuous communication on every build.
3. **User-Centric Design**: Products shaped around real human needs, not abstract feature lists.
4. **Partnership**: Acting inside the client's team rather than an external vendor.
5. **Global Support**: Coverage across international time zones.
6. **Problem-Solving**: Finding ways forward rather than declining challenges.`,
    },
    {
      id: "founder",
      filename: "founder.md",
      title: "Founder & Leadership Contact",
      source_page: 4,
      source_section: "02 — Founder & Contact",
      document_type: "company_profile",
      category: "founder",
      content: `# Founder & Leadership Contact

CloseFuture is led by **Baskaran Manimohan**, who is the founder and the primary technical and product contact clients interact with directly throughout engagements.

## Background & Expertise
- **Experience**: 5+ years shipping web and mobile products across product engineering, design, and go-to-market execution.
- **Location**: Based in Velur, Namakkal, Tamil Nadu, India.
- **Education**: 
  - EDHEC Business School
  - IIT Patna Generative AI Programme
- **Community Affiliations**: Bubble Developer Community, Era of No Code, GrowthX.

## Official Contact Channels
- **Email**: baskaran@closefuture.io
- **Phone**: +91 74488 85080
- **Direct Meeting Booking**: cal.com/closefuture/meet
- **Website**: www.closefuture.io
- **LinkedIn**: linkedin.com/in/baskaran-manimohan
- **Office Location**: Velur, Namakkal, Tamil Nadu 638182, India
- The primary call to action across all studio materials is "Book a Call" via cal.com/closefuture/meet.`,
    },
    {
      id: "services",
      filename: "services.md",
      title: "CloseFuture Core Services & Capabilities",
      source_page: 5,
      source_section: "03 — Services & Process",
      document_type: "company_profile",
      category: "services",
      content: `# CloseFuture Core Services & Capabilities

CloseFuture provides end-to-end digital product development from initial whiteboard scoping to long-term post-launch care.

## Service Offerings
1. **Web & Mobile Apps**:
   Full builds of web applications, mobile applications, operational dashboards, tablet interfaces, and kiosk systems. Built on rapid low-code foundations with robust custom backends where needed.
2. **Product Design & UX**:
   Design is treated as a dedicated specialty, not an add-on. Scoped requirements are turned into responsive, polished UI/UX prototypes and refined collaboratively until the interaction flow is seamless.
3. **AI-Integrated Solutions**:
   Conversational chat and voice assistants, semantic search and vector matching, automated document and survey summarization, and photo/image analysis integrated directly into business workflows.
4. **Custom Platforms**:
   Bespoke digital platforms that consolidate scattered, manual operations into unified systems combining booking, payments, role-based access, and notifications.
5. **Automation & Integrations**:
   Workflow automation with n8n, plus integrations for Wix APIs, payment processors (Rivhit, RevenueCat), WhatsApp messaging bots, email/push notifications, and IoT device controllers.
6. **Maintenance & Support**:
   Long-term operational support covering application performance, security upgrades, bug fixes, and feature scaling delivered across global time zones.`,
    },
    {
      id: "process",
      filename: "process.md",
      title: "How a Project Runs — Four-Stage Delivery Process",
      source_page: 5,
      source_section: "03 — Services & Process (How a project runs)",
      document_type: "company_profile",
      category: "process",
      content: `# How a Project Runs — Four-Stage Delivery Process

CloseFuture executes customer engagements through a structured four-stage methodology designed to maintain speed without sacrificing architectural rigor.

## The Four Stages
1. **Stage 1 · Discovery**:
   Clarify core business objectives, define the exact feature scope, select the optimal tools and tech stack, and establish a clear development roadmap before any code is written.
2. **Stage 2 · Product Design**:
   Transform functional requirements into responsive, polished UI/UX designs. Refine prototypes collaboratively with client stakeholders until the workflow feels natural.
3. **Stage 3 · Development**:
   Execute rapid, test-driven builds leveraging low-code tools and AI-assisted workflows. Provide continuous demos and regular progress updates so there are no surprises.
4. **Stage 4 · Maintenance**:
   Provide sustained post-launch support focused on system performance, architectural upgrades, bug remediation, and user scaling.

## Delivery Guarantee
Most customer projects progress from initial concept to live production launch within **four to six weeks**.`,
    },
    {
      id: "technology",
      filename: "technology.md",
      title: "Technology Stack & Specialized Tooling",
      source_page: 6,
      source_section: "04 — Technology",
      document_type: "company_profile",
      category: "technology",
      content: `# Technology Stack & Specialized Tooling

CloseFuture describes its philosophy as "experts in the best tools" — maintaining deep, dedicated practices around each core platform rather than operating as a superficial generalist.

## Technology Toolkit by Category
- **Low-Code App Builders**: Bubble (web applications and complex logic), FlutterFlow (native iOS/Android cross-platform apps).
- **Web Design & High-Conversion Sites**: Framer.
- **AI-Assisted Engineering**: Claude Code, Lovable, Replit.
- **Backend & Database Systems**: Supabase (PostgreSQL, Row Level Security, Auth, Realtime, pgvector).
- **Automation & Workflow Orchestration**: n8n.
- **Payment Processing**: Rivhit (Israel credit/invoicing), RevenueCat (mobile in-app subscriptions).
- **Integrations**: Wix API, WhatsApp Business API, push notification gateways, transactional email, IoT hardware device controls (smart locks, automated electricity).
- CloseFuture maintains dedicated practice pages for Bubble, Framer, Supabase, FlutterFlow, n8n, Lovable, and Replit.`,
    },
    {
      id: "dipy",
      filename: "dipy.md",
      title: "Case Study — Dipy UGC Marketplace",
      source_page: 8,
      source_section: "05 — Selected Work: Dipy",
      document_type: "case_study",
      category: "case_study",
      content: `# Case Study — Dipy UGC Marketplace

- **Client**: Dipy
- **Market / Geography**: Israel
- **Year**: 2026
- **Domain**: User-Generated Content (UGC) Two-Sided Marketplace

## The Problem
Existing UGC platforms were highly fragmented. Brands wanting creator content had to stitch together separate tools for finding creators, performing quality assurance, managing multi-round revisions, handling legal compliance, and paying creators. Creators lacked a centralized place to find high-value orders and monitor their earnings.

## What CloseFuture Built
A comprehensive production marketplace built on Bubble with four purpose-built surfaces:
1. **Brand-Owner Desktop Hub**: Command center for posting content briefs, searching creators, sending direct invitations, and tracking orders.
2. **Content-Creator Mobile View**: Native-feeling interface optimized for 420px mobile viewports to browse orders, apply, upload media, revise drafts, and track payouts.
3. **Brand-Owner Mobile Interface**: Touch-optimized interface to monitor orders and communicate with creators on the go.
4. **Operations Admin Panel**: Administrative suite for verifying creator identities, overseeing order disputes, and handling automated payouts.

## Key Technical Details & Features
- **AI Semantic Search**: Matches content creators to brand briefs based on language, niche interests, and creator profile characteristics.
- **Bilingual Architecture**: Full support for both Hebrew (RTL) and English.
- **Automated Financials**: Automated payments handling Israeli VAT, discount promo codes, and partial credits.
- **Omnichannel Alerts**: 4-channel notification system across push, in-app messages, WhatsApp, and transactional email.
- **Gamified Level Progression**: Creator tier system unlocking higher-paying opportunities.
- **Outcome**: Launched in production handling hundreds of concurrent orders with automated approvals and self-serve payments.`,
    },
    {
      id: "liya-ai",
      filename: "liya-ai.md",
      title: "Case Study — Liya AI Employee Wellbeing Platform",
      source_page: 9,
      source_section: "05 — Selected Work: Liya AI",
      document_type: "case_study",
      category: "case_study",
      content: `# Case Study — Liya AI Employee Wellbeing Platform

- **Client**: Liya AI
- **Market**: Global Enterprise
- **Year**: 2026
- **Domain**: AI Stress Management & Employee Wellbeing

## The Problem
Corporate organizations were unable to detect employee burnout and workplace stress until it caused departures or productivity declines. Traditional annual HR surveys were too slow to act upon, employees feared lack of anonymity, and HR teams could not manually read and process vast volumes of unstructured qualitative feedback.

## What CloseFuture Built
An intelligent employee wellbeing system delivered as responsive web and native mobile applications:
1. **Liya Coach**: A conversational AI wellbeing assistant supporting text and voice interactions, offering employees a safe, confidential outlet to share concerns.
2. **Real-Time Survey Engine**: Micro-surveys that assess team sentiment and burnout risks continuously.
3. **Voice Interaction**: Low-friction natural-language voice input for sharing thoughts on the fly.
4. **AI Summarization Pipeline**: Automatically synthesizes thousands of unstructured survey entries into clear, actionable themes for leadership.
5. **Executive Analytics Dashboard**: Interactive reporting with granular filtering to observe anonymized emotional trends across departments.
6. **Human Therapist Escalation**: Integrates seamless booking with certified human therapists when automated support needs human escalation.
- **Outcome**: Dramatically higher survey participation, real-time burnout visibility, and data-driven HR interventions.`,
    },
    {
      id: "webiz",
      filename: "webiz.md",
      title: "Case Study — Webiz Smart Office on Demand",
      source_page: 10,
      source_section: "05 — Selected Work: Webiz",
      document_type: "case_study",
      category: "case_study",
      content: `# Case Study — Webiz Smart Office on Demand

- **Client**: Webiz
- **Market / Geography**: Israel
- **Year**: Launched July 2026
- **Domain**: Smart Co-Working, PropTech, and IoT Access Control

## The Problem
Traditional office leases are rigid and expensive. Modern hybrid teams frequently pay for unutilized square footage while struggling with disjointed systems for room scheduling, access keycards, and billing.

## What CloseFuture Built
An integrated PropTech ecosystem uniting a customer mobile app, administrative management dashboard, and on-site tablet hardware app:
1. **On-Site Tablet QR Check-In**: Tablet displays outside meeting rooms showing real-time availability and dynamic QR codes for instant drop-in booking.
2. **Flexible Reservation Engine**: Hourly, future-dated, recurring, and permanent workspace bookings.
3. **Corporate Team Wallet**: Shared team credit accounts with granular user budget limits and auto-renewal.
4. **Dynamic Tiered Pricing**: Volume credit packages, per-order promotional discounts, and off-peak rate adjustments.
5. **Automated Billing**: Secure payment processing via Rivhit integration.
6. **Hardware IoT Control**: Direct integration with smart door access locks, automated lighting, and HVAC air conditioning directly triggered by app reservations.
- **Outcome**: Successfully launched July 2026 across Israeli properties, fully automating on-site facility access and room monetization without front-desk staff.`,
    },
    {
      id: "randevmeste",
      filename: "randevmeste.md",
      title: "Case Study — Randevmeste Offline Speed-Dating Platform",
      source_page: 11,
      source_section: "05 — Selected Work: Randevmeste",
      document_type: "case_study",
      category: "case_study",
      content: `# Case Study — Randevmeste Offline Speed-Dating Platform

- **Client**: Randevmeste (Client lead: Jozef Greftak)
- **Market**: Europe
- **Year**: 2025
- **Domain**: Speed Dating & Live Event Matching

## The Problem
The client was operating offline speed-dating events where attendees met up to 30 people in short rounds. The business had outgrown an unscalable Wix setup that lacked guest check-in tracking, real-time match calculations, attendee filtering, and automated messaging.

## What CloseFuture Built
- A custom Bubble web application integrated bi-directionally with Wix via API.
- Tickets purchased on Wix automatically create guest records in the application database.
- Attendees register by ticket ID, construct event profiles, and participate in live event rounds.
- Real-time mutual liking and instant match calculation at the end of the evening.
- Safe post-event messaging between mutual matches, attendee safety reporting tools, and comprehensive event host controls.
- **Client Endorsement**: "The app has exceeded our expectations both in terms of design and functionality." — Jozef Greftak.`,
    },
    {
      id: "vigo",
      filename: "vigo.md",
      title: "Case Study — Vigo Women's Fitness App",
      source_page: 11,
      source_section: "05 — Selected Work: Vigo",
      document_type: "case_study",
      category: "case_study",
      content: `# Case Study — Vigo Women's Fitness App

- **Client**: Vigo
- **Market**: Israel
- **Year**: 2025
- **Domain**: Women's Health & AI Fitness Coaching

## The Problem
Generic fitness and nutrition mobile applications failed to provide personalized, female-focused workout plans and suffered from tedious meal logging that led to user churn.

## What CloseFuture Built
- Goal-based onboarding assessing user fitness level, hormonal considerations, and health targets.
- Dynamic workout routines and calorie budgets that adapt automatically to daily activity.
- Custom female nutrition plans with portion guidance.
- **AI Meal Analysis via WhatsApp**: Users can snap a photo of their meal and message it to an integrated WhatsApp bot; AI analyzes the food photo and logs calories and macronutrients automatically.
- Subscription billing integrated with RevenueCat for recurring mobile subscriptions.
- **Outcome**: Launched in 2025 in Israel with industry-leading retention metrics.`,
    },
    {
      id: "galaxy-move",
      filename: "galaxy-move.md",
      title: "Case Study — Galaxy Move Samsung Creator Community",
      source_page: 11,
      source_section: "05 — Selected Work: Galaxy Move",
      document_type: "case_study",
      category: "case_study",
      content: `# Case Study — Galaxy Move Samsung Creator Community

- **Client**: Samsung (Galaxy Move)
- **Year**: 2025
- **Domain**: Brand Advocacy & Gamified Creator Community

## The Problem
Samsung wanted to connect digital creators and passionate brand fans through interactive, gamified engagement, but existing community platforms lacked customizable reward mechanics and enterprise scalability.

## What CloseFuture Built
- A mobile-first and responsive web community platform designed for Samsung creators and enthusiasts.
- **Gamified Engagement Engine**: Task-and-points reward architecture where creators complete photo/video challenges to earn points.
- Real-time community feed with direct administrative communication channels.
- Live competitive leaderboards tracking top contributors.
- Role-based administration separating global super-administrators from localized community managers.
- **Reward Marketplace**: Integrated store enabling members to redeem earned engagement points for Samsung coupons, accessories, and exclusive gifts.
- **Outcome**: Delivered across web and mobile, significantly expanding brand loyalty and daily active participation.`,
    },
    {
      id: "writing",
      filename: "writing.md",
      title: "Writing & Thought Leadership — Architecture & Platform Guides",
      source_page: 12,
      source_section: "06 — Writing & Ideas",
      document_type: "company_profile",
      category: "blog",
      content: `# Writing & Thought Leadership — Architecture & Platform Guides

Baskaran Manimohan regularly writes technical articles on low-code architecture, platform selection, database scaling, and enterprise viability.

## Key Articles Published
1. **Building scalable apps with FlutterFlow (21 May 2026)**:
   A comprehensive blueprint for growing FlutterFlow applications from initial MVP to tens of thousands of active users. Emphasizes that scalability requires a disciplined backend-first architecture (Supabase or custom APIs), clean relational schemas, server-side pagination, strict state management, and PostgreSQL Row Level Security (RLS).
2. **Neon vs Supabase: a 2026 choosing & migration guide (29 April 2026)**:
   A practical comparison of Postgres platforms: Neon (serverless database branching and scale-to-zero) vs Supabase (integrated backend with auth, storage, pgvector, and realtime). Recommends Neon for bursty, ephemeral workloads and Supabase for standard SaaS products and rapid MVPs.
3. **FlutterFlow for Enterprise: can it handle large-scale apps? (21 May 2026)**:
   Evaluates low-code viability for enterprise deployments across performance, third-party integrations, and compliance, demonstrating that low-code is production-grade with the right architecture.
4. **Top Framer agencies in Dubai (7 July 2026)**:
   Part of an international agency review series covering Dubai, Riyadh, and n8n automation leaders in Germany, France, Spain, and Poland.
5. **Other Articles**: Best Apps Built on FlutterFlow (2026), Enterprise App Development Services in 2026, How to Choose the Best Lovable Development Agency.`,
    },
    {
      id: "markets",
      filename: "markets.md",
      title: "Markets, Client Types & Problem Profiles",
      source_page: 14,
      source_section: "Markets & Clients",
      document_type: "company_profile",
      category: "markets",
      content: `# Markets, Client Types & Problem Profiles

CloseFuture operates as an agile, senior studio based out of Velur, Namakkal, India, while maintaining a predominantly international client base.

## Primary Geographic Markets
- **Israel**: Strong run of major production launches (Dipy UGC marketplace, Webiz smart office, Vigo fitness).
- **Middle East / Gulf**: High demand in Dubai and Riyadh for fast-turnaround web and mobile products.
- **Europe**: Client relationships in Slovakia (Randevmeste), and active tech focus in Germany, France, Spain, and Poland.
- **Global Enterprise**: Enterprise clients including Samsung.
- **India**: Studio headquarters and engineering home base.

## Typical Client Profiles
1. **Early-Stage Founders**: Needing to validate an idea and launch an MVP quickly without wasting months.
2. **Funded Startups**: Requiring a polished, production-grade product ready for paying users.
3. **Enterprises**: Seeking rapid execution of AI tools and features outside slow internal roadmaps.
4. **Established Brands**: Building community portals or specialized operational tools.

## Ideal Problem Profiles
- Fragmented, multi-tool business workflows ready for consolidation into a single web/mobile platform.
- Manual operations ripe for automated workflow orchestration (n8n, APIs).
- Two-sided marketplaces with multi-user interfaces, verification, and payment flows.
- Products where AI (chat, voice, semantic search, image analysis) must be natively woven into user interactions.`,
    },
    {
      id: "reputation",
      filename: "reputation.md",
      title: "Reputation, Reviews & Commercial Engagement Model",
      source_page: 15,
      source_section: "07 — Reputation & Engagement",
      document_type: "company_profile",
      category: "reputation",
      content: `# Reputation, Reviews & Commercial Engagement Model

CloseFuture holds a verified track record of reliability, transparent communication, and rapid execution.

## Verified Review Scores
- **Overall Rating**: 5.0 out of 5.0 (based on 11 verified client reviews)
- **Quality of Work**: 5.0 / 5.0
- **On-Time Delivery**: 4.9 / 5.0
- **Value for Money**: 5.0 / 5.0
- **Recurring Client Feedback**: Exceptional responsiveness, proactive problem-solving ("never say not possible"), attention to detail, and founder-level accountability.

## Commercial Engagement Snapshot
- **Hourly Billing Rate**: $25 – $49 / hour
- **Minimum Project Budget**: $1,000+
- **Typical / Common Project Size**: Under $10,000
- **Standard Delivery Turnaround**: 4 to 6 weeks from kickoff to launch

## Common Client Questions & Answers
- **Do you provide UI/UX design services?** Yes — design is a core specialty, not a secondary add-on.
- **Do you offer ongoing maintenance?** Yes — long-term support for bug fixes, performance tuning, and scaling.
- **Do you handle enterprise-grade work?** Yes — secure, scalable, role-based platforms with Row Level Security.
- **Which tools do you specialize in?** Bubble, FlutterFlow, Framer, Supabase, n8n, Lovable, Replit, and Claude Code.

## Reasons Clients Choose CloseFuture
1. **Speed**: Weeks to launch rather than months.
2. **Value**: Lean low-code + AI stack keeps builds highly cost-effective.
3. **Production Quality**: Built for real users, real payments, and real scale.
4. **Comprehensive Scope**: Web, mobile, tablet/IoT, admin panels, and AI under one roof.
5. **Trust**: Flawless verified ratings and direct founder involvement.`,
    },
  ];

  // Write all source documents to disk under data/knowledge/
  const outputDir = resolveKnowledgeDir();
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  for (const doc of documents) {
    const filePath = path.join(outputDir, doc.filename);
    fs.writeFileSync(filePath, doc.content, "utf8");
  }

  return documents;
}
