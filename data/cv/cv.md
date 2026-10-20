# CV — Álvaro Nieto Balmori

> Source of truth for the voice agent. Kept in English (original CV); the agent
> answers in the caller's language, defaulting to English.

## General
- **Name:** Álvaro Nieto Balmori
- **Current role:** Business Analyst at Amazon (Strategy & Operations, Capacity Planning)
- **Location:** Luxembourg (open to relocation)
- **Contact:** +34 634 930 278 · alvaronieto97@gmail.com
- **LinkedIn:** linkedin.com/in/alvaro-nieto-balmori
- **GitHub:** github.com/alvaronie
- **Languages:** Spanish (native) · English (C1, professional working proficiency)

## What he is looking for
Customer-facing technical roles such as Solutions Engineering, in voice AI and applied AI:
designing integrations, building demos and turning repeated customer needs into
self-serve tools.

## Summary
Analyst and hands-on builder in Amazon's European delivery network (650+ delivery
stations in 9 countries). He turns what planning teams in five countries need into
production software: an AI agent, automated pipelines, web tools and a forecasting model,
built in Python on AWS. He tends to take a messy operational problem and own it end to
end, from the SQL and Python underneath to the process the team relies on. Outside work he
built and runs a voice AI phone agent (this one) that handles real calls.

## Experience

### Business Analyst — Amazon · Strategy & Operations, Capacity Planning · Luxembourg
*August 2024 – Present · Top-tier performance rating · 650+ delivery stations across 9
European countries*

- **Developed an AI agent that investigates, every day and unattended, why delivery
  capacity changed across Europe**, and sends internal planning teams a written report in
  about 15 minutes. Added evaluation and guardrails: a validator checks each report before
  it is published, and an evaluation step recalculates every figure from the raw data;
  fixing what it caught raised the evaluation score from about 62 to 95–97 out of 100.
  Built with Python, Amazon Bedrock (Claude), Athena and AWS Lambda.
- **Replaced a manual Excel process with a self-serve tool for internal customers.**
  Planning teams in two countries built a weekly plan in four macro-heavy Excel
  workbooks. He turned the existing optimisation logic into a web page: upload the data,
  press Run, download the result, with the same numbers as before. Built on AWS (Python,
  Lambda, API Gateway, S3) with secure sign-in.
- **Owns end to end the model that allocates delivery volume across Amazon's third-party
  delivery partners**, by station, day and delivery cycle, over a 13-week horizon in 5
  European regions; its output feeds the planning systems that commit routes to partners
  every week. He owns the model (Python on AWS), its SQL data inputs, the operating
  procedure and its support. He redesigned its core allocation into a priority-based
  approach and added bike and walking routes, fixing a defect that wiped out whole
  station plans when demand exceeded capacity.
- **Helped launch Amazon's delivery network in Portugal.** Gathered requirements from
  business stakeholders and two partner teams on how the first two Portuguese delivery
  stations had to be planned, then integrated them into the planning tools so they no
  longer had to be added by hand, saving about 3 hours of work every week.
- **Designed a planning dashboard after interviewing internal customers in five
  countries.** Each country's planners prepared their weekly inputs differently in Excel.
  He agreed one shared method with them, built it and presented it to the country leads.
  It saves each planner about 4–5 hours a week.
- **Technical owner of a dashboard that explains the causes of overstaffing** at Amazon's
  top European delivery sites, turning a single KPI into a diagnosis that site leadership
  can act on.
- **Built a machine-learning model that forecasts how many drivers each delivery partner
  will lose over the next 13 weeks**, a key input for deciding how much delivery capacity
  to plan. It beat the existing planning tool in 58 of 72 country, quarter and horizon
  comparisons (9.4% lower error overall) and is live in production.
- **Automated the weekly preparation of planning inputs.** A scheduled serverless
  pipeline (Python, Lambda, EventBridge, S3, with Slack alerts) now generates every
  region's input files each week and launches the planning runs unattended, instead of
  analysts building them by hand.
- **Automated a same-day planning upload** for the team's main planning application,
  replacing an error-prone manual routine and removing 8–10 hours of error-correction work
  per cycle.

### Digital Assurance — Trainee · PwC · Madrid
*January 2024 – July 2024*
- Analysed financial datasets and reviewed IT / ERP environments (including SAP) and
  internal controls for audit engagements.

### Product Engineer (Renault Group) — Segula Technologies · Valladolid
*May 2023 – December 2023*
- Analysed vehicle test data and built validation structures for factory operations,
  working with project and factory teams.

### Continuous Improvement Engineer — Renault Group · Valladolid
*September 2022 – February 2023*
- Built Power BI production-KPI dashboards and digital field apps that removed manual
  reporting on the production line.

## Education
- **MSc in Big Data Science** — Universidad de Navarra · 2023–2024. Thesis with Acciona:
  end-to-end computer-vision pipeline for industrial object tracking.
- **BSc in Physics** — Universidad de Valladolid · Graduated 2022. Erasmus exchange:
  Università degli Studi di Catania, Italy.

## Certifications
- **AWS Certified AI Practitioner** — Amazon Web Services.

## Skills
- **Engineering:** Python (pandas, NumPy, scikit-learn, SciPy), Node.js/JavaScript, SQL,
  REST APIs, WebSockets, AWS (Lambda, API Gateway, EventBridge, S3, IAM, CloudWatch,
  Redshift, Bedrock), Docker, Git, unit testing (pytest); TypeScript/React (working
  knowledge).
- **Voice & real-time:** Twilio (Voice, Media Streams), OpenAI Realtime API, ElevenLabs
  streaming text-to-speech, tool/function calling in voice agents, latency measurement.
- **Applied AI:** LLM agents, voice AI agents, LLM evaluation and guardrails, machine
  learning forecasting, AI coding agents in daily work.
- **Customer & communication:** interviewing users, demos and presentations,
  documentation, turning repeated requests into self-serve tools.
- **Analysis & BI:** root-cause diagnosis, experiment design, business cases, ETL design,
  dashboards (Power BI, QuickSight), Excel / Google Sheets.

## Notable projects
- **Agent CV** (this project, github.com/alvaronie/Agent-CV): a live voice AI phone agent
  that answers questions about this CV. A Node.js backend bridges Twilio's phone audio by
  hand to the OpenAI Realtime API, with an optional ElevenLabs streaming voice. It can
  transfer the call to Álvaro, take the caller's details and email him a summary after
  each call, with guardrails such as Twilio signature validation, call limits and
  automatic reconnection. A latency study on real calls found no penalty for the
  ElevenLabs voice (about 491 ms vs 493 ms to the first audio of an answer).
