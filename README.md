# Piyush-Store (Gesture Games) — Auth + Postgres

This app serves a futuristic static store (`/`) with gesture-based games and a FastAPI backend.

## Required environment variables

- **`DATABASE_URL`**: PostgreSQL connection string.
  - Local example: `postgresql://postgres:password@localhost:5432/piyush_store`
  - Render sometimes provides `postgres://...` — the app automatically converts it to `postgresql://...` for SQLAlchemy.
- **`JWT_SECRET`**: a random secret string used to sign JWTs.
- **`JWT_EXPIRES_MINUTES`** (optional): defaults to **7 days**.

## Local run

1. Create a Postgres database locally.
2. Create a `.env` file in the project root:

```bash
DATABASE_URL=postgresql://postgres:password@localhost:5432/piyush_store
JWT_SECRET=change-me-to-a-long-random-string
JWT_EXPIRES_MINUTES=10080
```

3. Install and run:

```bash
pip install -r requirements.txt
uvicorn main:app --reload
```

4. Open:
   - **`/login`** to sign up / log in
   - **`/`** for the store (requires auth)
   - **`/profile`** to view name/email

## Render deployment

Add these env vars in your Render service settings:

- `DATABASE_URL` (from your Render Postgres instance)
- `JWT_SECRET` (generate a secure random string)
- `JWT_EXPIRES_MINUTES` (optional)

The app creates the `users` table automatically on startup.

# ✋ Hand Gesture Controlled Web UI

A real-time hand-gesture controlled web interface that transforms **pinch + hand tracking** into a fully functional **cursor + click system** — no mouse required.

This project demonstrates how **Computer Vision + Real-time systems + Web technologies** can create intuitive, touchless user experiences.

---

## 🚀 Demo

> Control your browser using just your hand  
> Move cursor → Point with index finger  
> Click → Pinch gesture  

---

## 🧠 How It Works

### 🔄 End-to-End Flow

1. **Capture**
   - Webcam captures live video feed

2. **Process**
   - MediaPipe detects **21 hand landmarks**

3. **Classify**
   - Custom gesture classifier identifies:
     - Pinch (Click)
     - Point (Cursor)
     - Open Hand
     - Fist
     - Peace

4. **Stream**
   - Data sent via **WebSockets (FastAPI backend)**

5. **Render**
   - Frontend:
     - Draws live hand skeleton
     - Moves cursor
     - Triggers click events

---

## 🏗️ Tech Stack

### 🔙 Backend
- Python
- FastAPI
- OpenCV
- MediaPipe
- WebSockets

### 🔜 Frontend
- HTML5
- CSS3
- JavaScript
- Canvas API
- WebSocket Client

---

## ⚡ Features

- 🎯 Real-time hand tracking (21 landmarks)
- 🖱️ Cursor control using index finger
- 🤏 Pinch-to-click interaction
- 🧍 Live hand skeleton overlay
- 🔄 Low-latency WebSocket streaming
- 🧠 Custom gesture classification
- 🌐 Fully browser-based UI

---

## 📡 API Endpoints

### REST
- `GET /health` → Check server status
- `GET /gesture` → Get current gesture state

### Streaming
- `GET /video` → MJPEG video stream

### WebSocket
- `/ws/gesture` → Real-time gesture data

---

## 📦 Installation

### 1. Clone repo
```bash
git clone https://github.com/your-username/HandGesture-WebNavigation.git
cd HandGesture-WebNavigation
