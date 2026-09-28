# CV — Álvaro Nieto Balmori

> Source of truth for the voice agent. Kept in English (original CV); the agent
> answers in the caller's language, defaulting to English.

## General
- **Name:** Álvaro Nieto Balmori
- **Title / role:** Business Analyst — Strategy & Operations
- **Location:** Luxembourg (open to relocation)
- **Contact:** +34 634 930 278 · alvaronieto97@gmail.com
- **LinkedIn:** linkedin.com/in/álvaro-nieto-balmori
- **Languages:** Spanish (native) · English (C1)

## Summary
Business analyst in Amazon's European last-mile operations, where over two years he has
helped scale weekly planning across **652 delivery stations in 9 countries**. He tends to
take a messy operational problem and run with it end-to-end — from the SQL and Python
underneath to the process the team relies on. Today he owns a route-allocation model that
plans across 5 regions, and has replaced several manual routines that used to cost hours
of work every week.

## Experience

### Business Analyst — Amazon · Strategy & Operations, Capacity Planning · Luxembourg
*August 2024 – Present*

- **Process owner of DRAM (DSP Route Allocation Model)** — owns end-to-end the
  business-critical model that allocates delivery volume across Amazon's **third-party
  delivery partners (DSPs)** at station, cycle and day level over a 13-week horizon across
  **5 European regions**; its output feeds the OKAMI planning platform and downstream
  capacity systems that commit routes to partners weekly. Owns the model
  (Python/AWS SageMaker), the SQL/ETL inputs, the operating procedure and the support model.
- **Redesigned DRAM's core allocation into a priority-based waterfall** and integrated
  multi-modal (Biker/Walker) route types — fixing a critical defect that zeroed out entire
  station plans when demand exceeded capacity, and protecting delivery-partner reliability
  scores.
- Built an **end-to-end serverless workflow** (AWS Lambda, EventBridge, S3, Slack alerts)
  that replaced a fully manual weekly planning routine across 5 regions — one trigger
  generates per-region inputs, launches the runs unattended and routes notifications to the
  right channels.
- Designed and shipped a **Same-Day automation** for the team's main planning application,
  replacing an error-prone manual upload routine and **eliminating 8–10 hours of
  error-correction work per cycle**.
- Tech owner of the **Guardrails Dashboard**: a root-cause attribution layer that diagnoses
  overstaffing across top European delivery sites — turning a flat KPI into an actionable
  diagnostic used by site leadership.
- Built and **deployed to production an ML model for net-drops forecasting** (13-week
  horizon, station- and DSP-level) that replaced the incumbent tool — **+9.4% accuracy
  improvement (up to +19.6% in Italy)**.

### Digital Assurance — Trainee · PwC · Madrid
*January 2024 – July 2024*

- Audit and assurance on financial datasets and ERP (SAP) controls — direct exposure to the
  financial-services and internal-control environment.

### Product Engineer (Renault Group) — Segula Technologies · Valladolid
*May 2023 – December 2023*

- Analysed vehicle test data and built validation structures for factory operations, working
  cross-functionally with project and factory teams.

## Education
- **MSc in Big Data Science** — Universidad de Navarra · 2023–2024. Thesis with Acciona:
  end-to-end computer-vision pipeline for industrial object tracking.
- **BSc in Physics** — Universidad de Valladolid · Graduated 2022. Erasmus exchange:
  Università degli Studi di Catania, Italy.

## Certifications
- **AWS Certified AI Practitioner** — Amazon Web Services.

## Skills
- **Engineering:** Python (pandas, NumPy, scikit-learn), SQL, AWS (Lambda, EventBridge, S3,
  SageMaker, IAM, CloudWatch, Redshift).
- **BI & tools:** Power BI, QuickSight, Git, pytest, Excel / Google Sheets, ETL design.

## Notable projects
- **Agent CV** (this project): an AI voice agent over telephony (Twilio + OpenAI Realtime +
  Node.js) that answers calls and responds with the information in this CV.
