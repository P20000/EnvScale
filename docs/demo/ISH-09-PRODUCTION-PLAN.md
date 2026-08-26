# ISH-09 — Production Plan

**Project:** EnvScale  
**Branch:** `feature/ishika-ish-09`  
**Document purpose:** End-to-end guide for recording, editing, and exporting the 3-minute product demo video.

---

## 1. Recording Environment Setup

### Hardware Requirements
| Item | Requirement | Why |
|---|---|---|
| Screen resolution | 1920 × 1080 minimum | 1080p is the standard for a technical demo |
| RAM | 8 GB minimum (16 GB recommended) | Go streamer + Minikube + Vite + screen recorder simultaneously |
| Disk space | 2 GB free minimum | Minikube images + raw video recording |
| Browser | Google Chrome or Chromium (latest) | Consistent rendering of Tailwind/React Flow |
| Mouse | Physical mouse preferred | Smooth cursor movement on canvas pan/zoom |

### Software Requirements
| Tool | Purpose | Recommended |
|---|---|---|
| Screen recorder | Capture the browser at 1080p 30fps | OBS Studio (free, Windows/Linux/macOS), ShareX (Windows), Kap (macOS) |
| Video editor | Trim, combine clips, add title cards, captions | DaVinci Resolve Free (Windows/Linux/macOS), CapCut Desktop, OpenShot |
| Audio recorder | Voice-over narration | Audacity (free), or built-in mic in OBS |
| Cursor highlight | Makes mouse movements visible on screen | PowerToys Mouse Highlighter (Windows), KeyCastr (macOS), xdotool overlay (Linux) |
| Text editor | Opening `.yaml` demo file | Notepad or VSCode — use it only to have the file visible for drag-and-drop |

---

## 2. Browser Configuration

Before starting any recording session:

```
1. Open Chrome/Chromium in a fresh profile (no saved passwords, no bookmarks bar visible)
2. Set browser zoom to 100% (Ctrl+0)
3. Set window to exactly 1920 × 1080 or maximise on a 1080p display
4. Close all other browser tabs
5. Disable browser extensions (or use a fresh profile that has none)
6. Hide the bookmarks bar (Ctrl+Shift+B to toggle)
7. If using F11 fullscreen mode: test that the address bar disappears cleanly
8. Open DevTools, run: localStorage.clear() — press Enter, close DevTools
9. Navigate to http://localhost:5173
10. Wait 3 seconds for the app to fully render before any recording
```

### Recommended Chrome window style for recording
- Use Chrome in a normal (non-fullscreen) window so the address bar is visible showing `localhost:5173`
- This looks intentional and professional, confirming it is a real local app
- Alternatively, use F11 fullscreen if your screen recorder captures the full screen cleanly

---

## 3. Service Launch Order

Launch services in this exact order to avoid timing issues:

**Session A — Frontend-only shots (Segments 0–2, Shots 001–011):**
```powershell
# Terminal 1
cd C:\Users\Dell\Desktop\EnvScale\apps\web
pnpm dev
# Wait for: "  Local:   http://localhost:5173/"
# Open Chrome → http://localhost:5173
```

**Session B — Full stack shots (Segments 3–6, Shots 012–042):**

```powershell
# Terminal 1 (already running)
# apps/web pnpm dev → localhost:5173

# Terminal 2 — PostgreSQL + Redis via Docker
cd C:\Users\Dell\Desktop\EnvScale
docker compose -f docker-compose.dev.yml up -d
# Wait for: postgres healthy, redis healthy (docker compose ps)

# Terminal 3 — REST API server
cd C:\Users\Dell\Desktop\EnvScale\apps\api-server
# Copy .env.example to .env and fill in secrets if not done already
pnpm dev
# Wait for: "EnvScale API listening on :3000"

# Terminal 4 — Go K8s Streamer
cd C:\Users\Dell\Desktop\EnvScale\apps\k8s-streamer
go run ./cmd/server/main.go
# Wait for: "K8s Streamer listening :8080"
# Look for: "Cluster registered: mini-todo" in stdout (auto-registers on startup)

# Terminal 5 — Minikube (if not already running)
minikube start
kubectl apply -f C:\Users\Dell\Desktop\EnvScale\testing\k8s\
# Wait for: kubectl get pods -n testing-todo → all Running

# Verify stack is healthy before recording:
# - localhost:5173 loads
# - localhost:3000/health or any endpoint responds
# - localhost:8080 → WebSocket should accept connections
# - TopNavbar in browser shows green "CONNECTED" dot
```

**To reset between takes:**
```powershell
# Refresh browser: Ctrl+R (preserves localStorage clusters)
# Hard reset (clears all state): DevTools → localStorage.clear() → Ctrl+R
# The topology canvas will reload and re-populate from a fresh WebSocket snapshot
```

---

## 4. Pre-Recording Checklist

Run through this list before pressing Record:

**Environment:**
- [ ] All required terminal processes are running and healthy
- [ ] Minikube pods are all Running (`kubectl get pods --all-namespaces`)
- [ ] Browser is at `http://localhost:5173`, app is rendered
- [ ] `localStorage.clear()` was run → cluster shows "mini-todo" from store default
- [ ] DevTools console is closed
- [ ] System tray / notification area is hidden (Windows: Focus Assist = ON; macOS: Do Not Disturb = ON)
- [ ] Screen recording software is running and test-recorded successfully

**App state:**
- [ ] TopNavbar shows "mini-todo" cluster (or a clean custom cluster name)
- [ ] For full-stack shots: TopNavbar shows green "CONNECTED · Xms"
- [ ] Topology canvas shows clean state (either populated graph or empty state)
- [ ] No stale incident badges or notification popups visible

**Files for demo:**
- [ ] `kubeconfig-demo.yaml` placed on Desktop (any `.yaml` file will work — it does not need real content for the wizard demo)
- [ ] File is named neutrally — no personal usernames or machine names in the path

---

## 5. Recording Settings

### OBS Studio (Recommended for Windows)
```
Settings → Output → Recording:
  - Recording Format: MKV (record in MKV, remux to MP4 after)
  - Video Bitrate: 8000 Kbps (8 Mbps) for 1080p
  - Encoder: NVENC H.264 (GPU) if available, otherwise x264 (CPU)
  - Audio: 48000 Hz, AAC 192 kbps

Settings → Video:
  - Base (Canvas) Resolution: 1920 × 1080
  - Output (Scaled) Resolution: 1920 × 1080
  - Frame Rate: 30 fps

Scene setup:
  - Source: Display Capture or Window Capture (select Chrome window specifically)
  - Do NOT capture the OBS window itself
```

### ShareX (Windows alternative)
```
Capture → Scrolling Capture or Region → Window
Video codec: H.264, 30fps, quality 80%
Output folder: C:\Users\Dell\Desktop\EnvScale\docs\demo\recordings\
```

### Kap (macOS)
```
Format: MP4 (H.264)
FPS: 30
Include system audio: No (record voice separately)
Crop to browser window
```

---

## 6. Voice-Over Recording

### Option A — Live narration during screen recording (easier, lower quality)
Record your voice live while demonstrating the app. Use a quiet room, speak clearly and at a measured pace. Use a headset microphone or a USB microphone. Keep the recording in one unbroken take per segment if possible.

### Option B — Post-recording narration sync (recommended for quality)
1. Record the full screen demo first without narration
2. Watch back the recording and read the narration script from `ISH-09-VIDEO-DEMO-SCRIPT.md`
3. Record voice-over audio separately in Audacity or OBS
4. Sync the audio track to the video in your video editor

### Narration guidelines
- Speak at approximately 140–160 words per minute for technical content
- Pause 0.5s between sentences — do not rush
- Re-record any sentence where your voice is muffled, distracted, or the pacing is off
- The full narration script has approximately 340 words → target ~2 minutes 20 seconds of speech
- Leave 45 seconds of non-narrated moments (pauses, visual-only actions like zooming/panning)

---

## 7. Editing Sequence

### Step 1 — Organise raw clips

```
docs/demo/recordings/
  seg1-intro-raw.mp4
  seg2-onboarding-raw.mp4
  seg3-topology-raw.mp4
  seg4-inspector-incidents-metrics-raw.mp4
  seg5-leaderboard-settings-raw.mp4
  seg6-closing-raw.mp4
  narration-full.wav  (or per-segment .wav files)
```

### Step 2 — Import into video editor

Import all raw clips and narration audio into a new project:
- Resolution: 1920 × 1080
- Frame rate: 30 fps
- Timeline: 24-bit audio, 48000 Hz

### Step 3 — Trim each clip

| Segment | Approximate trim points |
|---|---|
| Title card | Create from scratch — no raw clip needed |
| Intro (Seg 1) | Cut 3s of browser loading before the app is visible |
| Onboarding (Seg 2) | Trim any hesitation on Step 1 typing |
| Topology (Seg 3) | Cut waiting time while canvas populates; speed up layout toggle to 1.2× |
| Inspection (Seg 4) | Trim excessive pause between Inspector tabs |
| Leaderboard (Seg 5) | Trim tab switch wait time |
| Closing | Trim after the full graph is in frame |

### Step 4 — Add transitions

| Transition | Where | Duration |
|---|---|---|
| Fade from black | Opening → Title card | 0.5s |
| Fade to black | Title card → Intro shot | 0.5s |
| Cross dissolve | Seg 1 → Seg 2 (cluster dropdown opens) | 0.3s |
| Cut (hard) | Most in-app navigation transitions | Instant |
| Cross dissolve | Seg 3 → Seg 4 | 0.3s |
| Cross dissolve | Seg 4 → Seg 5 | 0.3s |
| Cross dissolve | Seg 5 → Seg 6 | 0.3s |
| Fade to black | Seg 6 → Closing title card | 1.0s |
| Fade from black | Closing title card appears | 0.5s |
| Fade to black | Closing title card exit | 1.5s |

### Step 5 — Title cards

Create two title cards as simple text-over-background clips (10s each):

**Opening Title Card:**
```
Background: #09090B solid
Primary text: "EnvScale"  — color #F4F4F5, size 96px, Calibri Bold or Arial Black
Secondary: "Visual Kubernetes Observability Platform" — color #3B82F6, size 32px
Tertiary: "Semester 5 Engineering Project" — color #71717A, size 22px
Duration: 8 seconds
Animation: text fades in from opacity 0 to 1 over 1.5s
```

**Closing Title Card:**
```
Background: #09090B solid
Primary: "EnvScale" — same as above
Secondary: "Team: Pranav · Vinit · Neha · Ishika"
Tertiary: "Semester 5 Engineering Project · 2026"
Duration: 10 seconds
Animation: fade in over 2s, hold 6s, fade to black over 2s
```

### Step 6 — Captions / Subtitles (Optional but recommended)

If presenting to an audience that may not have audio:
- Create a `.srt` subtitle file matching the narration script timing
- Burn-in subtitles at the bottom (white text, dark semi-transparent background strip)
- Font: Arial or Calibri, 32px, lower third position

**SRT file location:** `docs/demo/EnvScale_ISH-09_Captions.srt`

### Step 7 — Audio mixing

```
Narration track: -12 dB to -10 dB (main speech level)
Background music (optional): -30 dB to -28 dB (subtle, non-distracting)
  Recommended: royalty-free lo-fi ambient / electronic — 
  Use music only under title card and closing. Fade in/out.
  DO NOT use music over the product demo footage — it sounds unprofessional.
```

### Step 8 — Export settings

```
Format: MP4 (H.264 / AAC)
Resolution: 1920 × 1080
Frame rate: 30 fps
Video bitrate: 8 Mbps (CRF 18 in x264)
Audio bitrate: 192 kbps AAC, 48000 Hz stereo
Profile: High, Level 4.1
```

**Output filename:** `EnvScale_ISH-09_Product_Demo.mp4`  
**Output path:** `docs/demo/EnvScale_ISH-09_Product_Demo.mp4`

---

## 8. Reset Procedure Between Takes

If a take is ruined and you need to start a segment over:

```
1. Stop screen recording (do not save yet — confirm the take was bad first)
2. In browser: open DevTools → Console → localStorage.clear() → Ctrl+R
3. Wait 3 seconds for app to re-render
4. Re-select "mini-todo" from cluster dropdown if needed
5. For full-stack takes: check that WebSocket reconnects (TopNavbar turns green within 10s)
6. For wizard takes: the wizard is stateless — just open it again
7. Start recording again
```

---

## 9. Final Quality Checklist

Before submitting the final video:

**Duration:**
- [ ] Total duration is between 2:45 and 3:15

**Visual quality:**
- [ ] Resolution is 1920 × 1080
- [ ] No pixelation or compression artefacts on text
- [ ] No black bars (letterboxing/pillarboxing)
- [ ] Cursor is visible in all shots where interaction occurs
- [ ] No personal file paths, credentials, or usernames visible in any frame

**Content accuracy:**
- [ ] No feature is demonstrated that does not exist in the codebase
- [ ] Leaderboard member tab is not presented as live data
- [ ] Alert rules are not presented as persistent database-backed records
- [ ] Narration does not claim full production deployment or live user metrics

**Audio:**
- [ ] No background noise (fan, typing, notifications) in narration
- [ ] Narration is synchronised with on-screen actions (±1s)
- [ ] No clipping or distortion

**Transitions:**
- [ ] No abrupt jump cuts during a continuous action (e.g. mid-type)
- [ ] Title cards are legible (text does not overflow)

**Accessibility:**
- [ ] Captions/subtitles present (if submitting to faculty who may be hard of hearing)
- [ ] Text on title cards is large enough to read when projected at 720p

---

## 10. File Storage

The final MP4 file is **not committed to Git** because binary video files are inappropriate for a Git repository without LFS.

```
Option A — Local: Keep at C:\Users\Dell\Desktop\EnvScale\docs\demo\EnvScale_ISH-09_Product_Demo.mp4
Option B — Google Drive: Upload to the team's shared drive folder "EnvScale/Semester 5/Demo"
Option C — YouTube (unlisted): Upload as an unlisted video; add the link to docs/demo/ISH-09-PRODUCTION-PLAN.md
```

If uploaded to an external platform, record the final URL here:

```
Demo Video URL: _____________________________________________
Upload date:    _____________________________________________
Uploader:       Ishika
Duration:       _____________________________________________
File size:      _____________________________________________
```

---

## 11. Git Commit Plan for ISH-09 Assets

The following files ARE committed to Git (text/markdown only, no binary video):

```bash
git add docs/demo/ISH-09-FEATURE-INVENTORY.md
git add docs/demo/ISH-09-VIDEO-DEMO-SCRIPT.md
git add docs/demo/ISH-09-SHOT-LIST.md
git add docs/demo/ISH-09-PRODUCTION-PLAN.md

git commit -m "docs(ish-09): add 3-minute product demo script, shot list, and production plan"
git push -u origin feature/ishika-ish-09
```

The following files are NOT committed (add to .gitignore if needed):
- `docs/demo/recordings/` — raw video clips
- `docs/demo/EnvScale_ISH-09_Product_Demo.mp4` — final exported video
- `docs/demo/*.srt` — caption files (optional: commit if small)
