# EnvScale — Team Git & Daily Workflow Guide (Cheat Sheet)

> **Target Audience:** All Team Members (Vinit, Neha, Ishika, Pranav)  
> **Rule #1:** Never code directly on `main`. Always work on your designated feature branch!

---

## 👥 Your Designated Branch

| Team Member | Branch Name | Domain |
| :--- | :--- | :--- |
| **Vinit** | `feature/vinit-api-server` | Backend REST APIs, PostgreSQL, Drizzle ORM |
| **Neha** | `feature/neha-web-ui` | React Flow Canvas, Zustand store, UI components |
| **Ishika** | `feature/ishika-docs-qa` | Onboarding Wizard, UI library, Docs & QA |
| **Pranav** | `feature/pranav-k8s-streamer` | Go WebSocket streamer, K8s Informers, Chaos Engine |

---

## ⚡ Daily 4-Step Workflow (Copy & Paste)

### Step 1: Switch to your branch & pull latest updates
Before starting any work every day, open your terminal and run:

```bash
# Example for Vinit (replace branch name with yours)
git checkout feature/vinit-api-server
git pull origin develop
```

---

### Step 2: Write your code & test locally
Make changes in your code folder (`apps/api-server`, `apps/web`, or `apps/k8s-streamer`).

Run local verification:
```bash
pnpm build
pnpm lint
```

---

### Step 3: Commit your changes
Save your work with a clear message:

```bash
git add .
git commit -m "feat: setup initial postgres schema"
```

---

### Step 4: Push to GitHub & Create PR
Push your branch updates to GitHub:

```bash
git push origin feature/vinit-api-server
```

1. Open **`https://github.com/P20000/EnvScale`** in your browser.
2. Click the green button: **"Compare & pull request"**.
3. Target branch: **`develop`** (NOT `main`).
4. Assign **Pranav** as reviewer.

---

## 🛠️ How to Check Your Assigned Tasks

Option A (Browser): Go to `https://github.com/P20000/EnvScale/issues`  
Option B (Terminal): Run `./agent summary` or `./agent list <your_github_username>`

---

## 🚨 Common Emergency Commands

### If git gives an error during push:
```bash
# Always pull latest develop changes first
git pull origin develop
```

### If you don't know what branch you are on:
```bash
git status
```
