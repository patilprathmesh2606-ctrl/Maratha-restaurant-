/* =========================================================================
   MARATH — customer app
   ========================================================================= */
(() => {
  "use strict";

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  let settings = { restaurant_name: "Marath", tax_rate: 5, currency_symbol: "₹" };
  let categories = [];
  let dishes = [];
  let cart = loadCart();          // [{dish_id, name, price, image_url, qty}]
  let activeOrder = loadOrder();  // {order_id, order_number, customer_token}
  let orderChannel = null;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const money = (n) => Number(n || 0).toFixed(2);

  function loadCart() {
    try { return JSON.parse(localStorage.getItem("marath_cart")) || []; }
    catch { return []; }
  }
  function saveCart() { localStorage.setItem("marath_cart", JSON.stringify(cart)); }
  function loadOrder() {
    try { return JSON.parse(localStorage.getItem("marath_order")) || null; }
    catch { return null; }
  }
  function saveOrder(o) { localStorage.setItem("marath_order", JSON.stringify(o)); }
  function clearOrder() { localStorage.removeItem("marath_order"); activeOrder = null; }

  function uuid() {
    return (crypto.randomUUID ? crypto.randomUUID() :
      "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0, v = c === "x" ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      }));
  }

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._h);
    toast._h = setTimeout(() => t.classList.remove("show"), 2600);
  }

  // ---------------------------------------------------------------------
  // Load settings + menu from Supabase
  // ---------------------------------------------------------------------
  async function loadSettings() {
    const { data, error } = await db.from("restaurant_settings").select("*").eq("id", 1).single();
    if (error || !data) return;
    settings = data;

    $("#restaurantName").textContent = settings.restaurant_name || "Marath";
    $("#restaurantTagline").textContent = settings.tagline || "";
    $("#heroHours").textContent = `${settings.opens_at || "11:00"} – ${settings.closes_at || "23:00"}`;
    $("#heroAddress").textContent = settings.address || "See you soon";
    $("#footerInfo").innerHTML =
      `${settings.address ? settings.address + "<br>" : ""}` +
      `${settings.phone ? settings.phone + "<br>" : ""}` +
      `Open ${settings.opens_at || "11:00"} – ${settings.closes_at || "23:00"}`;
    $("#sumTaxLabel").textContent = `Tax (${Number(settings.tax_rate || 0)}%)`;

    const socials = [
      ["instagram", settings.social_instagram, "IG"],
      ["facebook", settings.social_facebook, "FB"],
      ["whatsapp", settings.social_whatsapp, "WA"],
      ["twitter", settings.social_twitter, "X"],
      ["youtube", settings.social_youtube, "YT"],
    ].filter(([, url]) => !!url);
    $("#socialRow").innerHTML = socials.map(([name, url, label]) =>
      `<a href="${url}" target="_blank" rel="noopener" aria-label="${name}">${label}</a>`
    ).join("");
  }

  async function loadMenu() {
    const [{ data: cats }, { data: ds, error }] = await Promise.all([
      db.from("categories").select("*").order("sort_order"),
      db.from("dishes").select("*").order("sort_order"),
    ]);
    categories = cats || [];
    dishes = ds || [];
    if (error) {
      $("#menuContainer").innerHTML = `<div class="empty-state">Couldn't load the menu. Please refresh.</div>`;
      return;
    }
    renderCatRail();
    renderMenu();
  }

  function renderCatRail() {
    $("#catRailInner").innerHTML = categories.map((c, i) =>
      `<button class="cat-pill${i === 0 ? " active" : ""}" data-cat="${c.id}">${c.name}</button>`
    ).join("");
    $$(".cat-pill").forEach(btn => btn.addEventListener("click", () => {
      $$(".cat-pill").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`cat-${btn.dataset.cat}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
  }

  function dishCardHTML(d) {
    const qty = cart.find(l => l.dish_id === d.id)?.qty || 0;
    const photo = d.image_url
      ? `<div class="dish-photo" style="background-image:url('${d.image_url}')"></div>`
      : `<div class="dish-photo"><div class="placeholder">Marath</div></div>`;
    return `
    <div class="dish-card ${d.is_available ? "" : "dish-unavailable"}">
      <div style="position:relative;">
        ${photo}
        ${!d.is_available ? `<span class="tag-86">86'd today</span>` : ""}
      </div>
      <div class="dish-body">
        <div class="dish-name">${escapeHTML(d.name)}</div>
        <div class="dish-desc">${escapeHTML(d.description || "")}</div>
        <div class="dish-foot">
          <span class="dish-price">${settings.currency_symbol}${money(d.price)}</span>
          ${d.is_available ? (
            qty > 0
              ? `<div class="stepper" data-dish="${d.id}">
                   <button class="dec">−</button><span class="qty">${qty}</span><button class="inc">+</button>
                 </div>`
              : `<button class="add-btn" data-add="${d.id}">Add +</button>`
          ) : `<span style="font-size:12px;color:var(--muted);">Unavailable</span>`}
        </div>
      </div>
    </div>`;
  }

  function renderMenu() {
    if (!dishes.length) {
      $("#menuContainer").innerHTML = `<div class="empty-state"><div class="glyph">🍽️</div>The menu is being set up. Check back soon.</div>`;
      return;
    }
    const byCat = {};
    dishes.forEach(d => { (byCat[d.category_id] = byCat[d.category_id] || []).push(d); });

    let html = "";
    categories.forEach(c => {
      const list = byCat[c.id];
      if (!list || !list.length) return;
      html += `<div class="category-block" id="cat-${c.id}">
        <h3>${escapeHTML(c.name)}</h3>
        <div class="dish-grid">${list.map(dishCardHTML).join("")}</div>
      </div>`;
    });
    const uncategorized = dishes.filter(d => !d.category_id);
    if (uncategorized.length) {
      html += `<div class="category-block"><h3>More</h3><div class="dish-grid">${uncategorized.map(dishCardHTML).join("")}</div></div>`;
    }
    $("#menuContainer").innerHTML = html;
    $("#dishCountLabel").textContent = `${dishes.filter(d => d.is_available).length} dishes today`;
    bindMenuEvents();
  }

  function bindMenuEvents() {
    $$("[data-add]").forEach(btn => btn.addEventListener("click", () => {
      addToCart(btn.dataset.add);
    }));
    $$(".stepper").forEach(step => {
      const id = step.dataset.dish;
      step.querySelector(".inc").addEventListener("click", () => changeQty(id, 1));
      step.querySelector(".dec").addEventListener("click", () => changeQty(id, -1));
    });
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  // ---------------------------------------------------------------------
  // Cart
  // ---------------------------------------------------------------------
  function addToCart(dishId) {
    const d = dishes.find(x => x.id === dishId);
    if (!d) return;
    const line = cart.find(l => l.dish_id === dishId);
    if (line) line.qty += 1;
    else cart.push({ dish_id: d.id, name: d.name, price: d.price, image_url: d.image_url, qty: 1 });
    saveCart();
    renderMenu();
    renderCart();
    toast(`Added ${d.name}`);
  }

  function changeQty(dishId, delta) {
    const line = cart.find(l => l.dish_id === dishId);
    if (!line) return;
    line.qty += delta;
    if (line.qty <= 0) cart = cart.filter(l => l.dish_id !== dishId);
    saveCart();
    renderMenu();
    renderCart();
  }

  function removeLine(dishId) {
    cart = cart.filter(l => l.dish_id !== dishId);
    saveCart();
    renderMenu();
    renderCart();
  }

  function cartTotals() {
    const subtotal = cart.reduce((s, l) => s + l.price * l.qty, 0);
    const taxRate = Number(settings.tax_rate || 0);
    const tax = Math.round(subtotal * taxRate) / 100;
    return { subtotal, tax, total: subtotal + tax, count: cart.reduce((s, l) => s + l.qty, 0) };
  }

  function renderCart() {
    const t = cartTotals();
    $("#cartCount").textContent = t.count;
    $("#mobileCartCount").textContent = t.count;
    $("#mobileCartTotal").textContent = `${settings.currency_symbol}${money(t.total)}`;
    $("#mobileCartBar").classList.toggle("show", t.count > 0 && !$("#cartDrawer").classList.contains("open"));

    if (!cart.length) {
      $("#cartBody").innerHTML = `<div class="empty-state"><div class="glyph">🧺</div>Your basket is empty.<br>Add a dish to get started.</div>`;
      $("#cartFoot").style.display = "none";
      return;
    }
    $("#cartFoot").style.display = "block";
    $("#cartBody").innerHTML = cart.map(l => `
      <div class="cart-line">
        ${l.image_url ? `<img src="${l.image_url}" alt="">` : `<img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E" alt="">`}
        <div class="info">
          <div class="name">${escapeHTML(l.name)}</div>
          <div class="price">${l.qty} × ${settings.currency_symbol}${money(l.price)} = ${settings.currency_symbol}${money(l.qty * l.price)}</div>
          <button class="remove" data-remove="${l.dish_id}">Remove</button>
        </div>
        <div class="stepper" data-dish="${l.dish_id}" style="align-self:flex-start;">
          <button class="dec">−</button><span class="qty">${l.qty}</span><button class="inc">+</button>
        </div>
      </div>
    `).join("");

    $$("#cartBody [data-remove]").forEach(b => b.addEventListener("click", () => removeLine(b.dataset.remove)));
    $$("#cartBody .stepper").forEach(step => {
      const id = step.dataset.dish;
      step.querySelector(".inc").addEventListener("click", () => changeQty(id, 1));
      step.querySelector(".dec").addEventListener("click", () => changeQty(id, -1));
    });

    $("#sumSubtotal").textContent = money(t.subtotal);
    $("#sumTax").textContent = money(t.tax);
    $("#sumTotal").textContent = money(t.total);
  }

  function openDrawer() {
    $("#cartDrawer").classList.add("open");
    $("#overlay").classList.add("open");
    $("#mobileCartBar").classList.remove("show");
  }
  function closeDrawer() {
    $("#cartDrawer").classList.remove("open");
    $("#overlay").classList.remove("open");
    renderCart();
  }

  // ---------------------------------------------------------------------
  // Place order
  // ---------------------------------------------------------------------
  async function placeOrder() {
    const name = $("#custName").value.trim();
    const phone = $("#custPhone").value.trim();
    const table = $("#tableNo").value.trim();
    const notes = $("#custNotes").value.trim();

    if (!name) { toast("Please add your name"); $("#custName").focus(); return; }
    if (!cart.length) { toast("Your basket is empty"); return; }

    const btn = $("#placeOrderBtn");
    btn.disabled = true; btn.textContent = "Sending to kitchen…";

    const customerToken = uuid();
    const items = cart.map(l => ({ dish_id: l.dish_id, quantity: l.qty }));

    const { data, error } = await db.rpc("place_order", {
      p_items: items,
      p_customer_name: name,
      p_customer_phone: phone,
      p_table_number: table,
      p_customer_token: customerToken,
      p_notes: notes,
    });

    btn.disabled = false; btn.textContent = "Place order";

    if (error) { toast(error.message || "Couldn't place the order"); return; }

    activeOrder = { order_id: data.order_id, order_number: data.order_number, customer_token: data.customer_token };
    saveOrder(activeOrder);
    cart = []; saveCart(); renderCart(); renderMenu();
    closeDrawer();
    toast(`Order ${data.order_number} sent to the kitchen`);
    showTrackingSection();
    subscribeToOrder(activeOrder.order_id);
    await refreshOrderStatus();
  }

  // ---------------------------------------------------------------------
  // Tracking + invoice
  // ---------------------------------------------------------------------
  const STEP_ORDER = ["pending", "preparing", "ready", "delivered", "completed"];

  function showTrackingSection() {
    $("#trackingSection").style.display = "block";
    $("#trackingSection").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderStepper(status) {
    const idx = STEP_ORDER.indexOf(status);
    $$("#stepperTrack .step").forEach(step => {
      const sIdx = STEP_ORDER.indexOf(step.dataset.step);
      step.classList.remove("done", "current");
      if (sIdx < idx) step.classList.add("done");
      else if (sIdx === idx) step.classList.add("current");
    });
  }

  async function refreshOrderStatus() {
    if (!activeOrder) return;
    const { data: order, error } = await db.from("orders").select("*").eq("id", activeOrder.order_id).single();
    if (error || !order) return;
    renderOrder(order);
  }

  function renderOrder(order) {
    $("#trackOrderNo").textContent = order.order_number;
    $("#trackStatusLabel").textContent = order.status.charAt(0).toUpperCase() + order.status.slice(1);
    renderStepper(order.status === "cancelled" ? "pending" : order.status);

    const acceptBox = $("#acceptBox");
    const invoiceBox = $("#invoiceBox");

    if (order.status === "delivered") {
      acceptBox.style.display = "block";
      invoiceBox.style.display = "none";
    } else if (order.status === "completed") {
      acceptBox.style.display = "none";
      loadInvoice(order.id);
    } else {
      acceptBox.style.display = "none";
      invoiceBox.style.display = "none";
    }
  }

  async function loadInvoice(orderId) {
    const [{ data: inv }, { data: items }] = await Promise.all([
      db.from("invoices").select("*").eq("order_id", orderId).single(),
      db.from("order_items").select("*").eq("order_id", orderId),
    ]);
    if (!inv) return;
    $("#invoiceNumber").textContent = inv.invoice_number;
    $("#invoiceLines").innerHTML = (items || []).map(l => `
      <div class="ticket-row">
        <span><span class="qty">${l.quantity}×</span>${escapeHTML(l.dish_name)}</span>
        <span class="amt">${settings.currency_symbol}${money(l.line_total)}</span>
      </div>`).join("");
    $("#invoiceTotals").innerHTML = `
      <div class="row"><span>Subtotal</span><span class="val">${settings.currency_symbol}${money(inv.subtotal)}</span></div>
      <div class="row"><span>Tax (${Number(inv.tax_rate)}%)</span><span class="val">${settings.currency_symbol}${money(inv.tax_amount)}</span></div>
      <div class="row total"><span>Total paid</span><span class="val">${settings.currency_symbol}${money(inv.total_amount)}</span></div>
    `;
    $("#invoiceBox").style.display = "block";
  }

  async function acceptDelivery() {
    if (!activeOrder) return;
    const btn = $("#acceptDeliveryBtn");
    btn.disabled = true; btn.textContent = "Confirming…";
    const { error } = await db.rpc("accept_delivery", {
      p_order_id: activeOrder.order_id,
      p_customer_token: activeOrder.customer_token,
    });
    btn.disabled = false; btn.textContent = "Accept & get invoice";
    if (error) { toast(error.message || "Couldn't confirm delivery"); return; }
    toast("Thanks! Here's your invoice.");
    await refreshOrderStatus();
  }

  function subscribeToOrder(orderId) {
    if (orderChannel) db.removeChannel(orderChannel);
    orderChannel = db.channel(`order-${orderId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${orderId}` },
        (payload) => renderOrder(payload.new)
      )
      .subscribe();
  }

  function startNewOrder() {
    clearOrder();
    if (orderChannel) { db.removeChannel(orderChannel); orderChannel = null; }
    $("#trackingSection").style.display = "none";
    $("#acceptBox").style.display = "none";
    $("#invoiceBox").style.display = "none";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---------------------------------------------------------------------
  // Wire up
  // ---------------------------------------------------------------------
  function bindStaticEvents() {
    $("#openCartBtn").addEventListener("click", openDrawer);
    $("#closeCartBtn").addEventListener("click", closeDrawer);
    $("#overlay").addEventListener("click", closeDrawer);
    $("#mobileCartBar").addEventListener("click", openDrawer);
    $("#placeOrderBtn").addEventListener("click", placeOrder);
    $("#acceptDeliveryBtn").addEventListener("click", acceptDelivery);
    $("#printInvoiceBtn").addEventListener("click", () => window.print());
    $("#newOrderBtn").addEventListener("click", startNewOrder);
    $("#year").textContent = new Date().getFullYear();
  }

  async function init() {
    bindStaticEvents();
    await loadSettings();
    await loadMenu();
    renderCart();

    if (activeOrder) {
      showTrackingSection();
      subscribeToOrder(activeOrder.order_id);
      await refreshOrderStatus();
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
