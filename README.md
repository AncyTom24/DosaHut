# 🍽 Dosa Corner POS

Multi-device point-of-sale system for the Cambridge Multicultural Festival.
Real-time sync across all phones via Firebase.

---

## 🔥 Step 1 — Set up Firebase (5 mins)

1. Go to https://firebase.google.com → **Get Started**
2. Create a project called `dosa-pos`, skip Analytics
3. In the left menu → **Build** → **Realtime Database** → **Create Database**
4. Choose **Start in test mode** → Done
5. Click ⚙️ gear icon → **Project Settings** → scroll to **Your apps**
6. Click **</>** (Web) → Register app (name it anything) → copy the config

---

## ✏️ Step 2 — Paste your Firebase config

Open `src/firebase.js` and replace the placeholder values with your actual config:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "dosa-pos.firebaseapp.com",
  databaseURL: "https://dosa-pos-default-rtdb.firebaseio.com",
  projectId: "dosa-pos",
  storageBucket: "dosa-pos.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123:web:abc123",
};
```

---

## 🚀 Step 3 — Deploy to Vercel (free, 2 mins)

1. Push this folder to a GitHub repo
2. Go to https://vercel.com → Import your repo
3. Leave all settings default → **Deploy**
4. You'll get a URL like `https://dosa-pos.vercel.app`

Share that URL with your 2 friends — done!

---

## 📱 Step 4 — Add to home screen on phones

**iPhone:** Open URL in Safari → Share button → "Add to Home Screen"  
**Android:** Open URL in Chrome → ⋮ menu → "Add to Home Screen"

It will open fullscreen like a native app, no App Store needed.

---

## 💡 Features

- 🛒 Order taking with cart
- 💳 Card (HST 13%) / 💵 Cash (no tax) payment toggle
- 👨‍🍳 Kitchen queue in FIFO order
- 📋 Order history with sales summary
- 🟢 Live connection indicator
- 🔄 Real-time sync across all phones via Firebase
