import { useState, useEffect, useRef } from "react";
import { db } from "./firebase";
import { ref, onValue, push, update, set, get } from "firebase/database";

const MENU = [
  { id: 1, name: "Masala Dosa", price: 10.99, emoji: "🥙", desc: "Best seller! Crispy with spiced potato masala" },
  { id: 2, name: "Ghee Dosa", price: 8.99, emoji: "✨", desc: "Thin, golden & crispy with aromatic ghee" },
  { id: 3, name: "Chocolate Dosa", price: 9.99, emoji: "🍫", desc: "Kids' fave! Rich chocolate drizzle" },
  { id: 4, name: "South Indian Omelette", price: 4.99, emoji: "🍳", desc: "Eggs, onions, black pepper & fresh herbs" },
  { id: 5, name: "Samosa", price: 1.99, emoji: "🔺", desc: "Crispy pastry with spiced potato & peas" },
  { id: 6, name: "Ginger Lemonade", price: 1.99, emoji: "🍋", desc: "Freshly squeezed with a hint of ginger" },
  { id: 7, name: "Coconut Chutney", price: 0.99, emoji: "🥥", desc: "Creamy & mild" },
  { id: 8, name: "Tomato Chutney", price: 0.99, emoji: "🍅", desc: "Tangy & spicy" },
  { id: 9, name: "Sambar", price: 1.99, emoji: "🍲", desc: "Hearty & flavorful lentil soup" },
];

// Combos are stored as special cart items with negative id to avoid collision
const COMBOS = [
  { id: "c1", name: "Samosa + Lemonade", price: 3.99, emoji: "🔺🍋", desc: "Save $0.99 vs individual!" },
  { id: "c2", name: "2 Samosas", price: 3.00, emoji: "🔺🔺", desc: "Save $0.98 vs individual!" },
];

const TAX_RATE = 0.13;
const LOCAL_KEY = "dosahut_offline_orders";

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]"); } catch { return []; }
}
function saveLocal(orders) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(orders)); } catch {}
}

function useOrders() {
  const [orders, setOrders] = useState([]);
  const [connected, setConnected] = useState(false);
  const [mode, setMode] = useState("firebase");
  const localCounter = useRef(1);
  const offlineOrders = useRef(loadLocal());

  useEffect(() => {
    if (!db) { switchOffline(); return; }
    const connRef = ref(db, ".info/connected");
    const unsubConn = onValue(connRef, (snap) => setConnected(!!snap.val()));
    let unsubOrders;
    try {
      const ordersRef = ref(db, "orders");
      unsubOrders = onValue(ordersRef, (snap) => {
        const data = snap.val();
        if (data) {
          const list = Object.entries(data).map(([fbKey, val]) => ({ ...val, fbKey }));
          list.sort((a, b) => a.num - b.num);
          setOrders(list);
          setMode("firebase");
        } else { setOrders([]); }
      }, () => switchOffline());
    } catch { switchOffline(); }
    const timeout = setTimeout(() => { if (!connected) switchOffline(); }, 5000);
    return () => { unsubConn(); unsubOrders?.(); clearTimeout(timeout); };
  }, []);

  function switchOffline() {
    setMode("offline");
    const local = loadLocal();
    offlineOrders.current = local;
    if (local.length > 0) localCounter.current = Math.max(...local.map(o => o.num)) + 1;
    setOrders(local);
  }

  const addOrder = async (orderData) => {
    if (mode === "offline") {
      const num = localCounter.current++;
      const newOrder = { ...orderData, num, fbKey: `local_${Date.now()}` };
      const updated = [...offlineOrders.current, newOrder];
      offlineOrders.current = updated;
      saveLocal(updated);
      setOrders([...updated]);
      return num;
    }
    try {
      const counterRef = ref(db, "counter");
      const snap = await get(counterRef);
      const num = (snap.val() || 0) + 1;
      await set(counterRef, num);
      const newOrder = { ...orderData, num };
      await push(ref(db, "orders"), newOrder);
      return num;
    } catch { switchOffline(); return addOrder(orderData); }
  };

  const markDone = async (order) => {
    const completedAt = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (mode === "offline") {
      const updated = offlineOrders.current.map(o => o.fbKey === order.fbKey ? { ...o, status: "done", completedAt } : o);
      offlineOrders.current = updated; saveLocal(updated); setOrders([...updated]); return;
    }
    try { await update(ref(db, `orders/${order.fbKey}`), { status: "done", completedAt }); }
    catch { switchOffline(); }
  };

  const clearDone = async (doneOrders) => {
    if (mode === "offline") {
      const updated = offlineOrders.current.filter(o => o.status !== "done");
      offlineOrders.current = updated; saveLocal(updated); setOrders([...updated]); return;
    }
    try {
      const updates = {};
      doneOrders.forEach(o => { updates[`orders/${o.fbKey}`] = null; });
      await update(ref(db), updates);
    } catch { switchOffline(); }
  };

  return { orders, connected, mode, addOrder, markDone, clearDone };
}

export default function DosaPos() {
  const [view, setView] = useState("order");
  const [cart, setCart] = useState([]); // array of {type:"item"|"combo", data, qty, lineTotal}
  const [paymentType, setPaymentType] = useState("card");
  const [flash, setFlash] = useState(null);
  const [completedFlash, setCompletedFlash] = useState(null);
  const [placing, setPlacing] = useState(false);
  const { orders, connected, mode, addOrder, markDone, clearDone } = useOrders();

  // Cart helpers
  const addItem = (item) => {
    setCart(prev => {
      const idx = prev.findIndex(l => l.type === "item" && l.data.id === item.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1, lineTotal: (next[idx].qty + 1) * item.price };
        return next;
      }
      return [...prev, { type: "item", data: item, qty: 1, lineTotal: item.price }];
    });
  };

  const removeItem = (item) => {
    setCart(prev => {
      const idx = prev.findIndex(l => l.type === "item" && l.data.id === item.id);
      if (idx < 0) return prev;
      const next = [...prev];
      if (next[idx].qty > 1) { next[idx] = { ...next[idx], qty: next[idx].qty - 1, lineTotal: (next[idx].qty - 1) * item.price }; }
      else next.splice(idx, 1);
      return next;
    });
  };

  const addCombo = (combo) => {
    setCart(prev => [...prev, { type: "combo", data: combo, qty: 1, lineTotal: combo.price }]);
  };

  const removeCombo = (combo, lineIdx) => {
    setCart(prev => prev.filter((_, i) => i !== lineIdx));
  };

  const itemQty = (itemId) => {
    const line = cart.find(l => l.type === "item" && l.data.id === itemId);
    return line ? line.qty : 0;
  };

  const subtotal = cart.reduce((s, l) => s + l.lineTotal, 0);
  const tax = paymentType === "card" ? subtotal * TAX_RATE : 0;
  const total = subtotal + tax;
  const cartCount = cart.reduce((s, l) => s + l.qty, 0);

  const placeOrder = async () => {
    if (cartCount === 0 || placing) return;
    setPlacing(true);
    const snapshot = [...cart];
    setCart([]);
    const orderItems = snapshot.map(l => ({
      name: l.data.name, emoji: l.data.emoji, price: l.data.price,
      qty: l.qty, lineTotal: l.lineTotal, type: l.type,
    }));
    const orderData = {
      items: orderItems, paymentType, subtotal, tax, total,
      status: "pending",
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      date: new Date().toLocaleDateString([], { month: "short", day: "numeric" }),
      completedAt: null,
    };
    try {
      const num = await addOrder(orderData);
      setFlash(`Order #${num} sent to kitchen!`);
      setTimeout(() => setFlash(null), 2500);
    } finally { setPlacing(false); }
  };

  const handleMarkDone = async (order) => {
    await markDone(order);
    setCompletedFlash(`Order #${order.num} complete! 🎉`);
    setTimeout(() => setCompletedFlash(null), 2000);
  };

  const pending = orders.filter(o => o.status === "pending");
  const done = orders.filter(o => o.status === "done");
  const history = [...orders].reverse();

  const totalRevenue = done.reduce((s, o) => s + o.total, 0);
  const cardRevenue = done.filter(o => o.paymentType === "card").reduce((s, o) => s + o.total, 0);
  const cashRevenue = done.filter(o => o.paymentType === "cash").reduce((s, o) => s + o.total, 0);
  const totalTax = done.reduce((s, o) => s + o.tax, 0);
  const cardOrders = done.filter(o => o.paymentType === "card").length;
  const cashOrders = done.filter(o => o.paymentType === "cash").length;
  const itemCounts = {};
  done.forEach(o => (o.items || []).forEach(i => { itemCounts[i.name] = (itemCounts[i.name] || 0) + i.qty; }));

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg, #1a0a00 0%, #2d1200 50%, #1a0800 100%)", fontFamily: "'Georgia', serif", color: "#fff" }}>
      <div style={{ position: "fixed", inset: 0, opacity: 0.04, backgroundImage: "radial-gradient(circle at 20% 50%, #ff6b00 0%, transparent 50%)", pointerEvents: "none" }} />

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #c44b00, #e65c00)", padding: "12px 14px 10px", boxShadow: "0 4px 20px rgba(0,0,0,0.5)", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: "bold", letterSpacing: 1 }}>🍽 Dosa Hut</div>
            <div style={{ fontSize: 10, opacity: 0.85 }}>Cambridge Multicultural Festival</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {pending.length > 0 && <div style={{ background: "#ffb300", color: "#000", borderRadius: 20, fontSize: 11, fontWeight: "bold", padding: "3px 10px" }}>{pending.length} pending</div>}
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, background: mode === "offline" ? "rgba(244,67,54,0.2)" : "rgba(0,0,0,0.2)", border: "1px solid " + (mode === "offline" ? "rgba(244,67,54,0.5)" : "rgba(255,255,255,0.15)"), borderRadius: 20, padding: "3px 8px" }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: mode === "offline" ? "#f44336" : connected ? "#4caf50" : "#ff9800" }} />
              {mode === "offline" ? "Offline" : connected ? "Live" : "Connecting..."}
            </div>
          </div>
        </div>
        {mode === "offline" && (
          <div style={{ background: "rgba(244,67,54,0.25)", border: "1px solid rgba(244,67,54,0.4)", borderRadius: 8, padding: "6px 10px", marginBottom: 8, fontSize: 11, color: "#ffcdd2" }}>
            ⚠️ Offline mode — orders saved locally. Reload when back online to sync.
          </div>
        )}
        <div style={{ display: "flex", gap: 6 }}>
          {["order", "kitchen", "history"].map(v => (
            <TabBtn key={v} active={view === v} onClick={() => setView(v)}>
              {v === "order" ? "🛒 Order" : v === "kitchen" ? "👨‍🍳 Kitchen" : "📋 History"}
            </TabBtn>
          ))}
        </div>
      </div>

      {(flash || completedFlash) && (
        <div style={{ position: "fixed", top: 100, left: "50%", transform: "translateX(-50%)", background: flash ? "#2d7a2d" : "#1565c0", color: "#fff", padding: "11px 22px", borderRadius: 30, fontWeight: "bold", fontSize: 14, zIndex: 999, boxShadow: "0 4px 20px rgba(0,0,0,0.4)", whiteSpace: "nowrap" }}>
          {flash || completedFlash}
        </div>
      )}

      {/* ── ORDER VIEW ── */}
      {view === "order" && (
        <div style={{ padding: "16px 14px", maxWidth: 500, margin: "0 auto" }}>

          {/* Menu items */}
          <div style={{ fontSize: 11, color: "#ffb38a", letterSpacing: 2, marginBottom: 12, textTransform: "uppercase" }}>Today's Menu</div>
          {MENU.map(item => (
            <div key={item.id} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,120,0,0.2)", borderRadius: 14, padding: "14px 16px", marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 26 }}>{item.emoji}</span>
                  <div>
                    <div style={{ fontWeight: "bold", fontSize: 15 }}>{item.name}</div>
                    <div style={{ fontSize: 11, color: "#ffb38a", marginTop: 2 }}>{item.desc}</div>
                    <div style={{ color: "#ffcc44", fontWeight: "bold", marginTop: 4, fontSize: 14 }}>${item.price.toFixed(2)}</div>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {itemQty(item.id) > 0 && <button onClick={() => removeItem(item)} style={qtyBtnStyle("#c44b00")}>−</button>}
                {itemQty(item.id) > 0 && <span style={{ fontSize: 16, fontWeight: "bold", minWidth: 20, textAlign: "center" }}>{itemQty(item.id)}</span>}
                <button onClick={() => addItem(item)} style={qtyBtnStyle("#2d7a00")}>+</button>
              </div>
            </div>
          ))}

          {/* Combos */}
          <div style={{ fontSize: 11, color: "#ffb38a", letterSpacing: 2, margin: "16px 0 10px", textTransform: "uppercase" }}>🎉 Value Combos</div>
          {COMBOS.map((combo) => (
            <div key={combo.id} style={{ background: "linear-gradient(135deg, rgba(255,180,0,0.1), rgba(255,100,0,0.1))", border: "1px solid rgba(255,180,0,0.35)", borderRadius: 14, padding: "14px 16px", marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 26 }}>{combo.emoji}</span>
                  <div>
                    <div style={{ fontWeight: "bold", fontSize: 15 }}>{combo.name}</div>
                    <div style={{ fontSize: 11, color: "#4caf50", marginTop: 2 }}>{combo.desc}</div>
                    <div style={{ color: "#ffcc44", fontWeight: "bold", marginTop: 4, fontSize: 14 }}>${combo.price.toFixed(2)}</div>
                  </div>
                </div>
              </div>
              <button onClick={() => addCombo(combo)} style={{ ...qtyBtnStyle("#8b5e00"), fontSize: 20, width: 36, height: 36 }}>+</button>
            </div>
          ))}

          {/* Payment */}
          <div style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,120,0,0.15)", borderRadius: 14, padding: "14px 16px", marginTop: 8 }}>
            <div style={{ fontSize: 11, color: "#ffb38a", letterSpacing: 1, marginBottom: 10, textTransform: "uppercase" }}>Payment Method</div>
            <div style={{ display: "flex", gap: 10 }}>
              <PayBtn active={paymentType === "card"} onClick={() => setPaymentType("card")}>💳 Card (+HST)</PayBtn>
              <PayBtn active={paymentType === "cash"} onClick={() => setPaymentType("cash")}>💵 Cash (No tax)</PayBtn>
            </div>
          </div>

          {/* Cart summary */}
          {cartCount > 0 && (
            <div style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,180,0,0.3)", borderRadius: 14, padding: "14px 16px", marginTop: 10 }}>
              <div style={{ fontSize: 11, color: "#ffb38a", letterSpacing: 1, marginBottom: 10, textTransform: "uppercase" }}>Order Summary</div>
              {cart.map((line, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, fontSize: 14 }}>
                  <span>{line.data.emoji} {line.data.name} × {line.qty}
                    {line.type === "combo" && <span style={{ fontSize: 10, color: "#4caf50", marginLeft: 6 }}>COMBO</span>}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>${line.lineTotal.toFixed(2)}</span>
                    {line.type === "combo" && (
                      <button onClick={() => removeCombo(line.data, i)} style={{ background: "#c44b00", border: "none", borderRadius: 6, color: "#fff", fontSize: 12, width: 22, height: 22, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
                    )}
                  </div>
                </div>
              ))}
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", marginTop: 10, paddingTop: 10 }}>
                <Row label="Subtotal" value={`$${subtotal.toFixed(2)}`} />
                {tax > 0 && <Row label="HST (13%)" value={`$${tax.toFixed(2)}`} color="#ffb38a" />}
                <Row label="TOTAL" value={`$${total.toFixed(2)}`} bold accent />
              </div>
            </div>
          )}

          <button onClick={placeOrder} disabled={cartCount === 0 || placing} style={{ width: "100%", marginTop: 14, background: cartCount > 0 && !placing ? "linear-gradient(135deg, #e65c00, #ff8c00)" : "rgba(255,255,255,0.08)", border: "none", borderRadius: 14, color: cartCount > 0 && !placing ? "#fff" : "rgba(255,255,255,0.3)", fontSize: 17, fontWeight: "bold", padding: "16px", cursor: cartCount > 0 && !placing ? "pointer" : "not-allowed", boxShadow: cartCount > 0 && !placing ? "0 4px 20px rgba(230,92,0,0.5)" : "none" }}>
            {placing ? "⏳ Sending..." : cartCount > 0 ? `🍽 Send to Kitchen — $${total.toFixed(2)}` : "Add items to order"}
          </button>
        </div>
      )}

      {/* ── KITCHEN VIEW ── */}
      {view === "kitchen" && (
        <div style={{ padding: "16px 14px", maxWidth: 500, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#ffb38a", letterSpacing: 2, textTransform: "uppercase" }}>Queue — {pending.length} pending</div>
            {done.length > 0 && <button onClick={() => clearDone(done)} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.5)", fontSize: 11, padding: "4px 10px", borderRadius: 20, cursor: "pointer" }}>Clear {done.length} done</button>}
          </div>
          {orders.length === 0 && <div style={{ textAlign: "center", padding: "60px 20px", color: "rgba(255,255,255,0.3)", fontSize: 15 }}><div style={{ fontSize: 48, marginBottom: 12 }}>🍽</div>No orders yet!</div>}
          {pending.map((order, i) => (
            <div key={order.fbKey} style={{ background: i === 0 ? "rgba(230,92,0,0.2)" : "rgba(255,255,255,0.05)", border: "1px solid " + (i === 0 ? "rgba(230,92,0,0.6)" : "rgba(255,255,255,0.08)"), borderRadius: 14, padding: "14px 16px", marginBottom: 10, position: "relative" }}>
              {i === 0 && <div style={{ position: "absolute", top: -1, right: 14, background: "#e65c00", fontSize: 10, fontWeight: "bold", padding: "2px 10px", borderRadius: "0 0 8px 8px" }}>NEXT UP</div>}
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontWeight: "bold", fontSize: 16 }}>Order #{order.num}</span>
                <span style={{ fontSize: 12, color: "#ffb38a" }}>{order.time}</span>
              </div>
              {(order.items || []).map((item, idx) => (
                <div key={idx} style={{ fontSize: 14, marginBottom: 3, display: "flex", alignItems: "center", gap: 6 }}>
                  {item.emoji} {item.name} × {item.qty}
                  {item.type === "combo" && <span style={{ fontSize: 10, color: "#ffcc44", background: "rgba(255,180,0,0.2)", borderRadius: 10, padding: "1px 6px" }}>COMBO</span>}
                </div>
              ))}
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div><PayTag type={order.paymentType} /><span style={{ fontWeight: "bold", color: "#ffcc44" }}>${order.total.toFixed(2)}</span></div>
                <button onClick={() => handleMarkDone(order)} style={{ background: "linear-gradient(135deg, #2d7a00, #4caf00)", border: "none", borderRadius: 10, color: "#fff", fontSize: 13, fontWeight: "bold", padding: "8px 16px", cursor: "pointer" }}>✓ Done</button>
              </div>
            </div>
          ))}
          {done.length > 0 && <>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", letterSpacing: 2, margin: "14px 0 8px", textTransform: "uppercase" }}>Completed</div>
            {done.map(order => (
              <div key={order.fbKey} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 14, padding: "10px 16px", marginBottom: 8, opacity: 0.45 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 14 }}>✓ Order #{order.num}</span>
                  <span style={{ fontSize: 13, color: "#ffcc44" }}>${order.total.toFixed(2)}</span>
                </div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 3 }}>{(order.items || []).map(i => `${i.name} ×${i.qty}`).join(", ")}</div>
              </div>
            ))}
          </>}
        </div>
      )}

      {/* ── HISTORY VIEW ── */}
      {view === "history" && (
        <div style={{ padding: "16px 14px", maxWidth: 500, margin: "0 auto" }}>
          <div style={{ fontSize: 11, color: "#ffb38a", letterSpacing: 2, marginBottom: 12, textTransform: "uppercase" }}>Sales Summary</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
            <StatCard label="Total Revenue" value={`$${totalRevenue.toFixed(2)}`} color="#ffcc44" icon="💰" />
            <StatCard label="Orders Completed" value={done.length} color="#4caf50" icon="✅" />
            <StatCard label="HST Collected" value={`$${totalTax.toFixed(2)}`} color="#64b5f6" icon="🏛" />
            <StatCard label="Pending Orders" value={pending.length} color="#ff8c00" icon="⏳" />
          </div>
          {done.length > 0 && (
            <div style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,120,0,0.2)", borderRadius: 14, padding: "14px 16px", marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: "#ffb38a", letterSpacing: 2, marginBottom: 12, textTransform: "uppercase" }}>Payment Breakdown</div>
              <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                <div style={{ flex: 1, background: "rgba(30,100,200,0.2)", border: "1px solid rgba(80,150,255,0.3)", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, color: "#90caf9", marginBottom: 4 }}>💳 Card</div>
                  <div style={{ fontWeight: "bold", fontSize: 18 }}>${cardRevenue.toFixed(2)}</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>{cardOrders} order{cardOrders !== 1 ? "s" : ""}</div>
                </div>
                <div style={{ flex: 1, background: "rgba(0,150,0,0.2)", border: "1px solid rgba(0,200,0,0.3)", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, color: "#a5d6a7", marginBottom: 4 }}>💵 Cash</div>
                  <div style={{ fontWeight: "bold", fontSize: 18 }}>${cashRevenue.toFixed(2)}</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>{cashOrders} order{cashOrders !== 1 ? "s" : ""}</div>
                </div>
              </div>
              {(cardOrders + cashOrders) > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 5 }}>Payment mix</div>
                  <div style={{ height: 8, background: "rgba(255,255,255,0.1)", borderRadius: 4, overflow: "hidden", display: "flex" }}>
                    <div style={{ width: `${(cardOrders / (cardOrders + cashOrders)) * 100}%`, background: "#1e88e5" }} />
                    <div style={{ flex: 1, background: "#2e7d32" }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>
                    <span>Card {Math.round((cardOrders / (cardOrders + cashOrders)) * 100)}%</span>
                    <span>Cash {Math.round((cashOrders / (cardOrders + cashOrders)) * 100)}%</span>
                  </div>
                </div>
              )}
            </div>
          )}
          {Object.keys(itemCounts).length > 0 && (
            <div style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,120,0,0.2)", borderRadius: 14, padding: "14px 16px", marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: "#ffb38a", letterSpacing: 2, marginBottom: 10, textTransform: "uppercase" }}>Item Popularity</div>
              {[...MENU, ...COMBOS].map(item => {
                const count = itemCounts[item.name] || 0;
                if (!count) return null;
                const max = Math.max(...Object.values(itemCounts));
                return (
                  <div key={item.id} style={{ marginBottom: 9 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                      <span>{item.emoji} {item.name}</span>
                      <span style={{ color: "#ffcc44" }}>{count} sold</span>
                    </div>
                    <div style={{ height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${(count / max) * 100}%`, height: "100%", background: "linear-gradient(90deg, #e65c00, #ffcc44)", borderRadius: 3 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ fontSize: 11, color: "#ffb38a", letterSpacing: 2, marginBottom: 10, textTransform: "uppercase" }}>All Orders ({orders.length})</div>
          {orders.length === 0 && <div style={{ textAlign: "center", padding: "40px 20px", color: "rgba(255,255,255,0.3)", fontSize: 14 }}><div style={{ fontSize: 40, marginBottom: 10 }}>📋</div>No orders placed yet</div>}
          {history.map(order => (
            <div key={order.fbKey} style={{ background: order.status === "done" ? "rgba(255,255,255,0.04)" : "rgba(230,92,0,0.1)", border: "1px solid " + (order.status === "done" ? "rgba(255,255,255,0.08)" : "rgba(230,92,0,0.3)"), borderRadius: 12, padding: "12px 14px", marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: "bold", fontSize: 15 }}>#{order.num}</span>
                  <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, fontWeight: "bold", background: order.status === "done" ? "rgba(76,175,0,0.25)" : "rgba(255,140,0,0.25)", border: "1px solid " + (order.status === "done" ? "rgba(76,175,0,0.5)" : "rgba(255,140,0,0.5)"), color: order.status === "done" ? "#a5d6a7" : "#ffb74d" }}>
                    {order.status === "done" ? "✓ Done" : "⏳ Pending"}
                  </span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: "bold", color: "#ffcc44", fontSize: 15 }}>${order.total.toFixed(2)}</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{order.date} · {order.time}</div>
                </div>
              </div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", marginBottom: 8 }}>{(order.items || []).map(i => `${i.emoji} ${i.name} ×${i.qty}`).join("  ·  ")}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <PayTag type={order.paymentType} />
                  {order.tax > 0 && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>HST ${order.tax.toFixed(2)}</span>}
                </div>
                {order.completedAt && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>Completed {order.completedAt}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      <style>{`@keyframes fadeIn { from { opacity:0; } to { opacity:1; } }`}</style>
    </div>
  );
}

function TabBtn({ active, onClick, children }) {
  return <button onClick={onClick} style={{ flex: 1, background: active ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.07)", border: "1px solid " + (active ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.1)"), borderRadius: 20, color: "#fff", fontSize: 12, padding: "6px 8px", cursor: "pointer", fontFamily: "inherit", fontWeight: active ? "bold" : "normal" }}>{children}</button>;
}
function PayBtn({ active, onClick, children }) {
  return <button onClick={onClick} style={{ flex: 1, background: active ? "rgba(230,92,0,0.3)" : "rgba(255,255,255,0.05)", border: "2px solid " + (active ? "#e65c00" : "rgba(255,255,255,0.1)"), borderRadius: 10, color: active ? "#fff" : "rgba(255,255,255,0.5)", padding: "10px 8px", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: active ? "bold" : "normal" }}>{children}</button>;
}
function PayTag({ type }) {
  return <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, marginRight: 6, background: type === "card" ? "rgba(30,100,200,0.4)" : "rgba(0,150,0,0.4)", border: "1px solid " + (type === "card" ? "rgba(80,150,255,0.4)" : "rgba(0,200,0,0.3)") }}>{type === "card" ? "💳 Card" : "💵 Cash"}</span>;
}
function StatCard({ label, value, color, icon }) {
  return <div style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,120,0,0.15)", borderRadius: 12, padding: "12px 14px" }}><div style={{ fontSize: 18, marginBottom: 4 }}>{icon}</div><div style={{ fontSize: 20, fontWeight: "bold", color }}>{value}</div><div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>{label}</div></div>;
}
function qtyBtnStyle(bg) {
  return { background: bg, border: "none", borderRadius: 8, color: "#fff", fontSize: 18, width: 32, height: 32, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold" };
}
function Row({ label, value, bold, accent, color }) {
  return <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, fontSize: bold ? 16 : 14, fontWeight: bold ? "bold" : "normal", color: accent ? "#ffcc44" : color || "#fff" }}><span>{label}</span><span>{value}</span></div>;
}
