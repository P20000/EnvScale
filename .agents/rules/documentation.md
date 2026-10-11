# Documentation Governance & Anti-Redundancy Rules

## 1. Zero Redundant Documentation Policy
- **No Unprompted Documentation Files:** AI assistants MUST NEVER create new `.md` files unless the user explicitly requests: *"create a file"*, *"save this in a markdown file"*, or similar explicit commands. General inquiries, explanations, summaries, and conceptual walkthroughs must be delivered in the conversation response.
- **Single Source of Truth:** Do not fragment domain knowledge across multiple overlapping files. 
  - Implementation roadmap & milestones belong exclusively in [`docs/milestones.md`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/docs/milestones.md).
  - Feature inventory & granular task IDs belong exclusively in [`docs/features.md`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/docs/features.md).
  - High-level system architecture belongs in [`docs/system-architecture.md`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/docs/system-architecture.md).
  - Detailed design models (UML, ER diagrams, statecharts, flowcharts) belong in [`docs/detailed-design.md`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/docs/detailed-design.md).
  - Database schema & auth architecture belong in [`docs/db-and-auth-architecture.md`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/docs/db-and-auth-architecture.md).
  - UI/UX layout and design tokens belong in [`docs/design.md`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/docs/design.md).
- **Update Instead of Duplicate:** If new architectural details or task breakdowns emerge, update the relevant canonical documentation file rather than introducing a new document.
